// ExportSubtab — export rule list view for the Hakobi settings tab.
//
// WHY this file exists:
// This is the export-side mirror of ImportSubtab. It renders the list of
// ExportRule entries (folder, tag, and note types) with a source-type-specific
// summary line for each row. The key difference from ImportSubtab is in the
// summary: rather than a single "source → destination" path pair, it must
// handle three ExportRule discriminants (folder / tag / note) and vary the
// displayed text accordingly. assertNever() ensures exhaustiveness at
// compile-time so adding a new ExportRule variant surfaces as a type error here.
//
// Refs: PRD/F2, SDD/ADR-10, T3.9

import type { Rule, RuleId, ExportRule } from "../../types/index";
import { assertNever } from "../../domain/rule";

// ---------------------------------------------------------------------------
// Dependency interfaces (structural — no Obsidian or Node import)
// ---------------------------------------------------------------------------

export interface ExportSubtabDeps {
	ruleStore: {
		load(): Promise<{ rules: Rule[] }>;
		remove(id: RuleId): Promise<Rule[]>;
	};
	deviceStore: {
		isEnabled(id: RuleId): boolean | Promise<boolean>;
		setEnabled(id: RuleId, enabled: boolean): Promise<void>;
		removeRule(id: RuleId): Promise<void>;
	};
	scheduler: {
		runOnce(id: RuleId, opts?: { dryRun?: boolean }): Promise<void>;
		// onRuleChanged / onRuleRemoved keep the in-memory timer table in sync
		// with rule mutations from the UI. Without these calls, freshly created
		// or edited rules stay dormant until the plugin reloads.
		onRuleChanged(rule: Rule): Promise<void>;
		onRuleRemoved(id: RuleId): void;
	};
	exportRuleEditor: {
		renderForCreate(c: HTMLElement, onDone: (r: Rule | undefined) => void): void;
		renderForEdit(
			c: HTMLElement,
			r: ExportRule,
			onDone: (r: Rule | undefined) => void,
		): void;
	};
	notices: {
		transient(m: string): void;
	};
	confirm(msg: string): Promise<boolean>;
	openOverflowMenu(
		anchor: HTMLElement,
		items: { label: string; onClick: () => void }[],
	): void;
}

// ---------------------------------------------------------------------------
// Internal helper: compute source-type-specific summary string
// ---------------------------------------------------------------------------

function sourceSummary(rule: ExportRule): string {
	switch (rule.sourceType) {
		case "folder":
			return `${rule.sourceVaultPath} → ${rule.destinationPath}`;
		case "tag":
			return `[${rule.tags.join(", ")}] (${rule.tagMatch}) → ${rule.destinationPath}`;
		case "note":
			return `${rule.sourceVaultNotePath} → ${rule.destinationPath}`;
		default:
			return assertNever(rule);
	}
}

// ---------------------------------------------------------------------------
// ExportSubtab
// ---------------------------------------------------------------------------

export class ExportSubtab {
	private readonly deps: ExportSubtabDeps;

	constructor(deps: ExportSubtabDeps) {
		this.deps = deps;
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/** Render the export subtab into containerEl. Uses an async-init pattern:
	 *  synchronous DOM scaffolding fires immediately; rule data populates once
	 *  the async load settles. */
	render(containerEl: HTMLElement): void {
		void this._renderAsync(containerEl);
	}

	// -------------------------------------------------------------------------
	// Private: async render body
	// -------------------------------------------------------------------------

	private async _renderAsync(containerEl: HTMLElement): Promise<void> {
		const { rules } = await this.deps.ruleStore.load();
		const exportRules = rules.filter(
			(r): r is ExportRule => r.direction === "export",
		);

		this._paint(containerEl, exportRules);
	}

	// -------------------------------------------------------------------------
	// Private: paint the subtab
	// -------------------------------------------------------------------------

	private _paint(containerEl: HTMLElement, exportRules: ExportRule[]): void {
		// Clear previous content
		this._empty(containerEl);

		// "+ Add export rule" button — always present
		const addBtn = containerEl.ownerDocument.createElement("button");
		addBtn.textContent = "+ add export rule";
		addBtn.addEventListener("click", () => {
			this.deps.exportRuleEditor.renderForCreate(containerEl, (created) => {
				if (created !== undefined) {
					void this.deps.scheduler.onRuleChanged(created);
				}
				void this._renderAsync(containerEl);
			});
		});
		containerEl.appendChild(addBtn);

		if (exportRules.length === 0) {
			// Empty state
			const desc = containerEl.ownerDocument.createElement("p");
			desc.textContent =
				"Export rules push files from your vault to local folders on a schedule. " +
				"Add a rule to start.";
			containerEl.appendChild(desc);
			return;
		}

		// Populated list
		for (const rule of exportRules) {
			this._renderRuleRow(containerEl, rule);
		}
	}

	// -------------------------------------------------------------------------
	// Private: render a single rule row
	// -------------------------------------------------------------------------

	private _renderRuleRow(containerEl: HTMLElement, rule: ExportRule): void {
		const row = containerEl.ownerDocument.createElement("div");
		row.setAttribute("data-rule-id", rule.id);

		// --- Per-device enable toggle ---
		const toggle = containerEl.ownerDocument.createElement("div");
		toggle.setAttribute("role", "switch");

		// Resolve isEnabled (may be sync or async)
		const enabledResult = this.deps.deviceStore.isEnabled(rule.id);
		const setToggle = (enabled: boolean): void => {
			toggle.setAttribute("aria-checked", String(enabled));
		};

		if (typeof enabledResult === "boolean") {
			setToggle(enabledResult);
		} else {
			void enabledResult.then(setToggle);
		}

		toggle.addEventListener("click", () => {
			const current = toggle.getAttribute("aria-checked") === "true";
			setToggle(!current);
			void (async () => {
				await this.deps.deviceStore.setEnabled(rule.id, !current);
				// Scheduler reads enable state through DeviceStore — onRuleChanged
				// causes it to (re-)evaluate and add or drop the timer.
				await this.deps.scheduler.onRuleChanged(rule);
			})();
		});

		row.appendChild(toggle);

		// --- Rule name ---
		const nameEl = containerEl.ownerDocument.createElement("span");
		nameEl.textContent = rule.name;
		row.appendChild(nameEl);

		// --- Source-type-specific summary ---
		const summaryEl = containerEl.ownerDocument.createElement("span");
		summaryEl.textContent = sourceSummary(rule);
		row.appendChild(summaryEl);

		// --- Badges ---
		const badgesEl = containerEl.ownerDocument.createElement("span");
		const badges: string[] = [
			`every ${rule.everyMinutes}m`,
			rule.action,
			rule.onCollision,
		];

		// flatten badge: only for folder and tag types (not note)
		if (rule.sourceType === "folder" || rule.sourceType === "tag") {
			if (rule.flattenOnTarget) {
				badges.push("flatten");
			}
		}

		if (rule.dryRun) {
			badges.push("dry-run");
		}

		badgesEl.textContent = badges.join(" · ");
		row.appendChild(badgesEl);

		// --- Overflow menu button ---
		const overflowBtn = containerEl.ownerDocument.createElement("button");
		overflowBtn.textContent = "⋯";
		overflowBtn.addEventListener("click", () => {
			this.deps.openOverflowMenu(overflowBtn, [
				{
					label: "Edit",
					onClick: () => {
						this.deps.exportRuleEditor.renderForEdit(
							containerEl,
							rule,
							(updated) => {
								if (updated !== undefined) {
									void this.deps.scheduler.onRuleChanged(updated);
								}
								void this._renderAsync(containerEl);
							},
						);
					},
				},
				{
					label: "Run now",
					onClick: () => {
						this.deps.notices.transient(`Running rule '${rule.name}'…`);
						void this.deps.scheduler.runOnce(rule.id, { dryRun: false });
					},
				},
				{
					label: "Run dry-run",
					onClick: () => {
						this.deps.notices.transient(`Dry-running rule '${rule.name}'…`);
						void this.deps.scheduler.runOnce(rule.id, { dryRun: true });
					},
				},
				{
					label: "Delete",
					onClick: () => {
						void (async () => {
							const confirmed = await this.deps.confirm(
								`Delete export rule "${rule.name}"? This cannot be undone.`,
							);
							if (!confirmed) return;
							await this.deps.ruleStore.remove(rule.id);
							await this.deps.deviceStore.removeRule(rule.id);
							this.deps.scheduler.onRuleRemoved(rule.id);
							void this._renderAsync(containerEl);
						})();
					},
				},
			]);
		});
		row.appendChild(overflowBtn);

		containerEl.appendChild(row);
	}

	// -------------------------------------------------------------------------
	// Private: clear container content
	// -------------------------------------------------------------------------

	private _empty(containerEl: HTMLElement): void {
		// Obsidian's empty() is a prototype method that reads `this`, so it must
		// be invoked as a method on the element — bare calls strip `this` and crash.
		const augmented = containerEl as unknown as { empty?: () => void };
		if (typeof augmented.empty === "function") {
			augmented.empty();
		} else {
			while (containerEl.firstChild) {
				containerEl.removeChild(containerEl.firstChild);
			}
		}
	}
}
