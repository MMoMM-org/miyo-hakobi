// RuleStore — wraps plugin.loadData() / plugin.saveData() for rule persistence.
//
// WHY this module exists:
// Provides a clean, Obsidian-decoupled persistence layer for rules and global
// settings. All Obsidian coupling is behind the PluginDataAdapter interface so
// unit tests run without importing obsidian. The real adapter is wired in
// Phase 3 main.ts by passing `{ loadData: () => plugin.loadData(), saveData: (d) => plugin.saveData(d) }`.
//
// Public surface:
//   load()                  → Promise<{ rules, globalSettings, warnings }>
//   save(rules)             → Promise<void>
//   add(rule)               → Promise<Rule[]>
//   update(id, partial)     → Promise<Rule[]>
//   remove(id)              → Promise<Rule[]>
//   getById(id)             → Rule | undefined
//   loadGlobalSettings()    → Promise<GlobalSettings>
//   saveGlobalSettings(s)   → Promise<void>
//
// Rules are always validated on load; invalid entries surface as warnings
// instead of exceptions — callers decide how to present them.
//
// Immutability: add/update/remove always return a NEW Rule[] and never mutate
// the stored array or the objects inside it.

import type { Rule, RuleId, GlobalSettings, ValidationError } from "../types/index";
import { validateRule } from "../domain/rule";

// ---------------------------------------------------------------------------
// Adapter interface (structural — no Obsidian import)
// ---------------------------------------------------------------------------

export interface PluginDataAdapter {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal shape of data.json
// ---------------------------------------------------------------------------

interface PersistedData {
	schemaVersion: number;
	rules: unknown[];
	globalSettings: Partial<GlobalSettings>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
	perFileTimeoutMs: 10000,
	auditRetentionDays: 90,
	auditMaxBytes: 10485760,
	stabilityCheckMs: 2000,
};

const CURRENT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Internal migration seam
// ---------------------------------------------------------------------------

/**
 * Identity migration for v1 (the only current version). When a future schema
 * version is introduced, add a branch here. The seam is called on load
 * whenever the persisted schemaVersion !== CURRENT_SCHEMA_VERSION.
 */
function migrate(data: unknown, _fromVersion: unknown): unknown {
	// No actual migration exists yet — return data unchanged.
	// Future: if (fromVersion === 1) return migrateV1toV2(data);
	return data;
}

// ---------------------------------------------------------------------------
// Result of load()
// ---------------------------------------------------------------------------

export interface LoadResult {
	rules: Rule[];
	globalSettings: GlobalSettings;
	warnings: ValidationError[];
}

// ---------------------------------------------------------------------------
// RuleStore class
// ---------------------------------------------------------------------------

export class RuleStore {
	private readonly adapter: PluginDataAdapter;

	/** Cached state after the most recent load() or mutation. */
	private _rules: Rule[] = [];
	private _globalSettings: GlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS };

	constructor(adapter: PluginDataAdapter) {
		this.adapter = adapter;
	}

	// -------------------------------------------------------------------------
	// load()
	// -------------------------------------------------------------------------

	async load(): Promise<LoadResult> {
		const raw = await this.adapter.loadData();

		const { data, migrated } = this._normalizeAndMigrate(raw);

		const { rules, warnings } = this._validateRules(data.rules);
		const globalSettings = this._mergeSettings(data.globalSettings);

		this._rules = rules;
		this._globalSettings = globalSettings;

		// If migration ran, persist the normalised document so subsequent loads
		// don't re-trigger migration. Suppress errors — a failed write here
		// should not abort the load.
		if (migrated) {
			await this._persist().catch(() => undefined);
		}

		return { rules, globalSettings, warnings };
	}

	// -------------------------------------------------------------------------
	// save(rules)
	// -------------------------------------------------------------------------

	/** Persists a new rules array, preserving the last-loaded globalSettings. */
	async save(rules: Rule[]): Promise<void> {
		this._rules = [...rules];
		await this._persist();
	}

	// -------------------------------------------------------------------------
	// add / update / remove — immutable mutations
	// -------------------------------------------------------------------------

	/** Returns a new Rule[] with the rule appended and persists it. */
	async add(rule: Rule): Promise<Rule[]> {
		const next = [...this._rules, rule];
		this._rules = next;
		await this._persist();
		return next;
	}

	/** Returns a new Rule[] with the matching rule shallow-merged and persisted.
	 *  If no rule matches `id`, the array is returned unchanged (still a new ref). */
	async update(id: RuleId, partial: Partial<Rule>): Promise<Rule[]> {
		const next = this._rules.map((r) =>
			r.id === id ? ({ ...r, ...partial } as Rule) : r,
		);
		this._rules = next;
		await this._persist();
		return next;
	}

	/** Returns a new Rule[] with the matching rule removed and persists it.
	 *  If no rule matches `id`, the original rules are returned as a new array. */
	async remove(id: RuleId): Promise<Rule[]> {
		const next = this._rules.filter((r) => r.id !== id);
		this._rules = next;
		await this._persist();
		return next;
	}

	// -------------------------------------------------------------------------
	// getById — synchronous read from cached state
	// -------------------------------------------------------------------------

	getById(id: RuleId): Rule | undefined {
		return this._rules.find((r) => r.id === id);
	}

	// -------------------------------------------------------------------------
	// globalSettings pair
	// -------------------------------------------------------------------------

	async loadGlobalSettings(): Promise<GlobalSettings> {
		const raw = await this.adapter.loadData();
		const { data } = this._normalizeAndMigrate(raw);
		const settings = this._mergeSettings(data.globalSettings);
		this._globalSettings = settings;
		return settings;
	}

	/** Persists new settings without discarding the cached rules. */
	async saveGlobalSettings(settings: GlobalSettings): Promise<void> {
		this._globalSettings = { ...settings };
		await this._persist();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/** Writes the current in-memory state to the adapter. */
	private async _persist(): Promise<void> {
		const doc = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			rules: this._rules,
			globalSettings: this._globalSettings,
		};
		await this.adapter.saveData(doc);
	}

	/** Coerces raw loaded data into a PersistedData-shaped object and triggers
	 *  migration when the schema version differs from the current version. */
	private _normalizeAndMigrate(raw: unknown): {
		data: PersistedData;
		migrated: boolean;
	} {
		if (
			typeof raw !== "object" ||
			raw === null ||
			Array.isArray(raw)
		) {
			// First run or corrupted/missing file.
			return {
				data: { schemaVersion: CURRENT_SCHEMA_VERSION, rules: [], globalSettings: {} },
				migrated: false,
			};
		}

		const obj = raw as Record<string, unknown>;
		const storedVersion = obj["schemaVersion"];
		let data: unknown = raw;
		let migrated = false;

		if (storedVersion !== CURRENT_SCHEMA_VERSION) {
			data = migrate(raw, storedVersion);
			migrated = true;
		}

		// Re-coerce after possible migration.
		const d = (typeof data === "object" && data !== null) ? data as Record<string, unknown> : {};
		return {
			data: {
				schemaVersion:
					typeof d["schemaVersion"] === "number"
						? d["schemaVersion"]
						: CURRENT_SCHEMA_VERSION,
				rules: Array.isArray(d["rules"]) ? d["rules"] : [],
				globalSettings: isPlainObject(d["globalSettings"])
					? d["globalSettings"]
					: {},
			},
			migrated,
		};
	}

	/** Validates each element of a raw rules array, separating valid rules from
	 *  warning entries. */
	private _validateRules(rawRules: unknown[]): {
		rules: Rule[];
		warnings: ValidationError[];
	} {
		const rules: Rule[] = [];
		const warnings: ValidationError[] = [];

		for (const item of rawRules) {
			const result = validateRule(item);
			if (result.ok) {
				rules.push(result.value);
			} else {
				warnings.push(...result.errors);
			}
		}

		return { rules, warnings };
	}

	/** Merges a partial settings object with defaults. */
	private _mergeSettings(partial: Partial<GlobalSettings>): GlobalSettings {
		return {
			perFileTimeoutMs:
				typeof partial.perFileTimeoutMs === "number"
					? partial.perFileTimeoutMs
					: DEFAULT_GLOBAL_SETTINGS.perFileTimeoutMs,
			auditRetentionDays:
				typeof partial.auditRetentionDays === "number"
					? partial.auditRetentionDays
					: DEFAULT_GLOBAL_SETTINGS.auditRetentionDays,
			auditMaxBytes:
				typeof partial.auditMaxBytes === "number"
					? partial.auditMaxBytes
					: DEFAULT_GLOBAL_SETTINGS.auditMaxBytes,
			stabilityCheckMs:
				typeof partial.stabilityCheckMs === "number"
					? partial.stabilityCheckMs
					: DEFAULT_GLOBAL_SETTINGS.stabilityCheckMs,
		};
	}
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
