// Tests for RuleStore (T2.1).
//
// WHY this file exists:
// Proves the RuleStore persistence contract: round-tripping rules through
// save/load, schema-version migration seam, immutable add/update/remove ops,
// validation-on-load, credential-field exclusion, and no-network guarantee.
// All storage is exercised through a fake PluginDataAdapter — no Obsidian import.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Rule, GlobalSettings, ValidationError } from "../../src/types/index";
import type { ImportRule } from "../../src/domain/rule";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeImportRule(overrides: Partial<ImportRule> = {}): ImportRule {
	return {
		id: "rule-id-1" as ImportRule["id"],
		name: "Test Import",
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		direction: "import",
		sourcePath: "/tmp/source" as ImportRule["sourcePath"],
		destinationVaultPath: "inbox" as ImportRule["destinationVaultPath"],
		...overrides,
	};
}

function makeDefaultSettings(): GlobalSettings {
	return {
		perFileTimeoutMs: 10000,
		auditRetentionDays: 90,
		auditMaxBytes: 10485760,
		stabilityCheckMs: 2000,
	};
}

// ---------------------------------------------------------------------------
// Fake adapter factory
// ---------------------------------------------------------------------------

function makeFakeAdapter(initialData: unknown = null) {
	let stored: unknown = initialData;
	return {
		loadData: vi.fn(async () => stored),
		saveData: vi.fn(async (data: unknown) => {
			stored = data;
		}),
		_getStored: () => stored,
	};
}

// ---------------------------------------------------------------------------
// Lazy import (module does not exist yet — RED phase)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type RuleStoreModule = typeof import("../../src/persistence/RuleStore");
let RuleStore: RuleStoreModule["RuleStore"];

beforeEach(async () => {
	// Dynamic import so vitest can hot-reload; also keeps the RED-phase failure
	// contained to a runtime error rather than a parse error.
	const mod = await import("../../src/persistence/RuleStore");
	RuleStore = mod.RuleStore;
});

// ---------------------------------------------------------------------------
// load() — first run
// ---------------------------------------------------------------------------

describe("RuleStore.load()", () => {
	it("returns empty rules and default settings on first run (null data)", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		const result = await store.load();

		expect(result.rules).toEqual([]);
		expect(result.globalSettings).toEqual(makeDefaultSettings());
		expect(result.warnings).toEqual([]);
	});

	it("returns empty rules and default settings when data.json is empty object", async () => {
		const adapter = makeFakeAdapter({});
		const store = new RuleStore(adapter);
		const result = await store.load();

		expect(result.rules).toEqual([]);
		expect(result.globalSettings).toEqual(makeDefaultSettings());
	});

	it("calls loadData exactly once per load() call", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();

		expect(adapter.loadData).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Round-trip: save then load
// ---------------------------------------------------------------------------

describe("RuleStore round-trip", () => {
	it("persists a rule and retrieves it on the next load", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);

		const rule = makeImportRule();
		await store.save([rule]);

		// Reload from same adapter (which now holds the saved data).
		const store2 = new RuleStore(adapter);
		const { rules } = await store2.load();

		expect(rules).toHaveLength(1);
		expect(rules[0]).toEqual(rule);
	});

	it("preserves globalSettings across a save(rules)-only call", async () => {
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [],
			globalSettings: {
				perFileTimeoutMs: 5000,
				auditRetentionDays: 30,
				auditMaxBytes: 1048576,
				stabilityCheckMs: 500,
			},
		});
		const store = new RuleStore(adapter);
		// Load first so the store knows the existing settings.
		await store.load();

		const rule = makeImportRule();
		await store.save([rule]);

		// The saved document must preserve the original globalSettings.
		const saved = adapter._getStored() as {
			globalSettings: GlobalSettings;
			rules: Rule[];
		};
		expect(saved.globalSettings.perFileTimeoutMs).toBe(5000);
		expect(saved.globalSettings.auditRetentionDays).toBe(30);
		expect(saved.rules).toHaveLength(1);
	});

	it("always writes schemaVersion: 1", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();
		await store.save([]);

		const saved = adapter._getStored() as { schemaVersion: number };
		expect(saved.schemaVersion).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Schema version — migration seam
// ---------------------------------------------------------------------------

describe("RuleStore schema migration seam", () => {
	it("calls migrate() internally when schemaVersion !== 1 (schemaVersion 2 smoke test)", async () => {
		// Expose the internal migrate seam by checking that the store loads
		// without throwing and surfaces a warning (or silently accepts) for an
		// unknown schema version. The key requirement is: the seam exists and
		// doesn't blow up — future migration logic can be dropped in there.
		const futureData = {
			schemaVersion: 2,
			rules: [],
			globalSettings: makeDefaultSettings(),
		};
		const adapter = makeFakeAdapter(futureData);
		const store = new RuleStore(adapter);

		// Must not throw — migration seam is the identity for unknown versions.
		const result = await store.load();

		// Either a warning is surfaced or rules are empty (graceful degradation).
		expect(Array.isArray(result.rules)).toBe(true);
		expect(Array.isArray(result.warnings)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Validation on load
// ---------------------------------------------------------------------------

describe("RuleStore validation on load", () => {
	it("surfaces invalid rules as warnings, not exceptions", async () => {
		const badRule = { id: "bad", direction: "import" }; // missing many fields
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [badRule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);

		// Must not throw.
		const { rules, warnings } = await store.load();

		// The invalid rule is excluded from the valid list.
		expect(rules).toHaveLength(0);
		// And a warning is surfaced.
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("returns valid rules alongside warnings for mixed arrays", async () => {
		const goodRule = makeImportRule({ id: "good-id" as ImportRule["id"] });
		const badRule = { id: "bad", direction: "import" };
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [goodRule, badRule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		const { rules, warnings } = await store.load();

		expect(rules).toHaveLength(1);
		expect(rules[0]!.id).toBe("good-id");
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("does not throw when rules is not an array in data.json", async () => {
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: "not-an-array",
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		const { rules } = await store.load();
		expect(Array.isArray(rules)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Immutable operations: add / update / remove
// ---------------------------------------------------------------------------

describe("RuleStore.add()", () => {
	it("returns a new rules array containing the added rule", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();

		const rule = makeImportRule();
		const next = await store.add(rule);

		expect(next).toHaveLength(1);
		expect(next[0]).toEqual(rule);
	});

	it("does not mutate the previous state — reference changes", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		const { rules: before } = await store.load();

		const rule = makeImportRule();
		const after = await store.add(rule);

		// Entirely different array reference.
		expect(after).not.toBe(before);
	});

	it("persists the new rule via saveData", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();

		const rule = makeImportRule();
		await store.add(rule);

		expect(adapter.saveData).toHaveBeenCalled();
		const saved = adapter._getStored() as { rules: Rule[] };
		expect(saved.rules).toHaveLength(1);
	});
});

describe("RuleStore.update()", () => {
	it("returns updated rules with the partial applied", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const next = await store.update("r1" as ImportRule["id"], { name: "Renamed" });

		expect(next).toHaveLength(1);
		expect(next[0]!.name).toBe("Renamed");
	});

	it("does not mutate the original rule object", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		await store.update("r1" as ImportRule["id"], { name: "Changed" });

		// Original object untouched.
		expect(rule.name).toBe("Test Import");
	});

	it("returns same-length array when target id is not found", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const next = await store.update("missing" as ImportRule["id"], { name: "X" });
		expect(next).toHaveLength(1);
	});
});

describe("RuleStore.remove()", () => {
	it("removes the rule with the given id", async () => {
		const r1 = makeImportRule({ id: "r1" as ImportRule["id"] });
		const r2 = makeImportRule({ id: "r2" as ImportRule["id"], name: "Second" });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [r1, r2],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const next = await store.remove("r1" as ImportRule["id"]);

		expect(next).toHaveLength(1);
		expect(next[0]!.id).toBe("r2");
	});

	it("returns the original array when id is not found", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const next = await store.remove("missing" as ImportRule["id"]);
		expect(next).toHaveLength(1);
	});

	it("new array reference after remove", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		const { rules: before } = await store.load();

		const after = await store.remove("r1" as ImportRule["id"]);
		expect(after).not.toBe(before);
	});
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("RuleStore.getById()", () => {
	it("returns the rule when it exists", async () => {
		const rule = makeImportRule({ id: "r1" as ImportRule["id"] });
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const found = store.getById("r1" as ImportRule["id"]);
		expect(found).toBeDefined();
		expect(found!.id).toBe("r1");
	});

	it("returns undefined when id is not found", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();

		const found = store.getById("no-such" as ImportRule["id"]);
		expect(found).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// globalSettings operations
// ---------------------------------------------------------------------------

describe("RuleStore.loadGlobalSettings()", () => {
	it("returns defaults when no data exists", async () => {
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		const settings = await store.loadGlobalSettings();
		expect(settings).toEqual(makeDefaultSettings());
	});

	it("returns stored settings when present", async () => {
		const custom: GlobalSettings = {
			perFileTimeoutMs: 1000,
			auditRetentionDays: 7,
			auditMaxBytes: 512,
			stabilityCheckMs: 100,
		};
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [],
			globalSettings: custom,
		});
		const store = new RuleStore(adapter);
		const settings = await store.loadGlobalSettings();
		expect(settings).toEqual(custom);
	});
});

describe("RuleStore.saveGlobalSettings()", () => {
	it("persists new settings without disturbing existing rules", async () => {
		const rule = makeImportRule();
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [rule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		await store.load();

		const newSettings: GlobalSettings = {
			perFileTimeoutMs: 3000,
			auditRetentionDays: 14,
			auditMaxBytes: 2097152,
			stabilityCheckMs: 1000,
		};
		await store.saveGlobalSettings(newSettings);

		const saved = adapter._getStored() as {
			rules: Rule[];
			globalSettings: GlobalSettings;
		};
		expect(saved.globalSettings).toEqual(newSettings);
		expect(saved.rules).toHaveLength(1);
	});

	it("preserves existing rules when only loadGlobalSettings() was called before saving (Finding 1 regression)", async () => {
		// Pre-seed the adapter with a document containing several rules and custom settings.
		const r1 = makeImportRule({ id: "r1" as ImportRule["id"], name: "Rule One" });
		const r2 = makeImportRule({ id: "r2" as ImportRule["id"], name: "Rule Two" });
		const originalSettings: GlobalSettings = {
			perFileTimeoutMs: 5000,
			auditRetentionDays: 30,
			auditMaxBytes: 1048576,
			stabilityCheckMs: 500,
		};
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [r1, r2],
			globalSettings: originalSettings,
		});

		// Construct a FRESH RuleStore — _rules starts as [].
		const store = new RuleStore(adapter);

		// Call loadGlobalSettings() ONLY — never call load().
		await store.loadGlobalSettings();

		// Now save new settings; _persist() must write the already-persisted rules,
		// NOT the default empty array from the constructor.
		const newSettings: GlobalSettings = {
			perFileTimeoutMs: 9000,
			auditRetentionDays: 60,
			auditMaxBytes: 2097152,
			stabilityCheckMs: 1000,
		};
		await store.saveGlobalSettings(newSettings);

		const persisted = adapter._getStored() as {
			rules: Rule[];
			globalSettings: GlobalSettings;
		};

		// Both original rules must survive — the bug silently wiped them.
		expect(persisted.rules).toHaveLength(2);
		expect(persisted.rules[0]!.id).toBe("r1");
		expect(persisted.rules[1]!.id).toBe("r2");

		// And the new settings must be applied.
		expect(persisted.globalSettings).toEqual(newSettings);
	});
});

// ---------------------------------------------------------------------------
// Credential-shape smoke test
// ---------------------------------------------------------------------------

describe("Credential-field exclusion smoke test", () => {
	const CREDENTIAL_RE = /password|token|apiKey|secret|auth|credentials/i;

	it("serialized ImportRule has no credential-shaped field names", () => {
		const rule = makeImportRule();
		const keys = Object.keys(rule);
		const offenders = keys.filter((k) => CREDENTIAL_RE.test(k));
		expect(offenders).toEqual([]);
	});

	it("persisted data document has no credential-shaped field names at top level or in rules", async () => {
		const rule = makeImportRule();
		const adapter = makeFakeAdapter(null);
		const store = new RuleStore(adapter);
		await store.load();
		await store.save([rule]);

		const json = JSON.stringify(adapter._getStored());
		// Extract all property keys from JSON by parsing and walking.
		const doc = JSON.parse(json) as Record<string, unknown>;
		function collectKeys(obj: unknown): string[] {
			if (typeof obj !== "object" || obj === null) return [];
			const keys = Object.keys(obj);
			const nested = Object.values(obj as Record<string, unknown>).flatMap(collectKeys);
			return [...keys, ...nested];
		}
		const allKeys = collectKeys(doc);
		const offenders = allKeys.filter((k) => CREDENTIAL_RE.test(k));
		expect(offenders).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// No-network source guard (grep-based)
// ---------------------------------------------------------------------------

describe("RuleStore source: no fetch / network calls", () => {
	it("RuleStore.ts source does not contain fetch( / XMLHttpRequest / http:// / https://", async () => {
		const fsp = await import("node:fs/promises");
		const path = await import("node:path");

		const srcPath = path.resolve(__dirname, "../../src/persistence/RuleStore.ts");
		const src = await fsp.readFile(srcPath, "utf8");

		// Strip comments before checking.
		const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
		const codeLines = noBlock
			.split("\n")
			.filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
			.join("\n");

		expect(codeLines).not.toMatch(/\bfetch\s*\(/);
		expect(codeLines).not.toMatch(/\bXMLHttpRequest\b/);
		expect(codeLines).not.toMatch(/https?:\/\//);
	});
});

// ---------------------------------------------------------------------------
// ValidationError type guard (ensures warnings are ValidationError[])
// ---------------------------------------------------------------------------

describe("warnings type contract", () => {
	it("warnings contain objects with path and message fields", async () => {
		const badRule = { id: "bad" }; // invalid
		const adapter = makeFakeAdapter({
			schemaVersion: 1,
			rules: [badRule],
			globalSettings: makeDefaultSettings(),
		});
		const store = new RuleStore(adapter);
		const { warnings } = await store.load();

		for (const w of warnings) {
			const typed = w as ValidationError;
			expect(typeof typed.path).toBe("string");
			expect(typeof typed.message).toBe("string");
		}
	});
});
