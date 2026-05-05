// ImportSubtab — renders the Import tab in the Hakobi settings panel.
//
// WHY this file exists:
// The subtab owns two distinct rendering paths:
//   1. Empty state — no import rules yet; shows a description paragraph and a
//      single "+ Add import rule" button. Clicking the button replaces the body
//      with the inline ImportRuleEditor (renderForCreate). This is the ADR-10
//      inline-expand pattern: the editor renders inside the SAME subtab body
//      element rather than in a Modal, keeping the UX lightweight for v0.1.
//   2. Populated list — renders one compact row per import rule (name,
//      source→destination summary, badges, overflow menu, per-device toggle).
//
// Per-device toggle: calls DeviceStore.setEnabled so each machine can
// independently enable/disable a rule without affecting the shared rule
// definition stored in data.json (ADR-3 hybrid storage contract).
//
// Confirm injection seam: the `confirm` dep is a Promise<boolean> function
// so tests can inject vi.fn() returning false to verify Delete is a no-op
// when cancelled, without relying on window.confirm (which is undefined in
// jsdom test environments).
//
// openOverflowMenu seam: the `openOverflowMenu` dep is injected so tests
// can avoid needing a real Obsidian Menu. Production wires this to
// `new Menu().addItem(...).showAtMouseEvent(...)`.

import { Setting } from "obsidian";
import type { ImportRule, Rule, RuleId } from "../../domain/rule";

// ---------------------------------------------------------------------------
// Dep interfaces
// ---------------------------------------------------------------------------

export interface ImportSubtabDeps {
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
	importRuleEditor: {
		renderForCreate(
			containerEl: HTMLElement,
			onDone: (rule: Rule | undefined) => void,
		): void;
		renderForEdit(
			containerEl: HTMLElement,
			rule: ImportRule,
			onDone: (rule: Rule | undefined) => void,
		): void;
	};
	notices: {
		transient(message: string): void;
	};
	confirm(message: string): Promise<boolean>;
	openOverflowMenu(
		anchor: HTMLElement,
		items: { label: string; onClick: () => void }[],
	): void;
	plugin: {
		registerDomEvent(
			el: HTMLElement,
			type: string,
			callback: (ev: Event) => void,
		): void;
	};
}

// ---------------------------------------------------------------------------
// ImportSubtab
// ---------------------------------------------------------------------------

export class ImportSubtab {
	private readonly deps: ImportSubtabDeps;

	constructor(deps: ImportSubtabDeps) {
		this.deps = deps;
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/** Render the import subtab into `containerEl`. Async-init pattern:
	 *  starts a loadAndRender cycle immediately, fire-and-forget style. */
	render(containerEl: HTMLElement): void {
		void this.loadAndRender(containerEl);
	}

	// -------------------------------------------------------------------------
	// Private: load + render cycle
	// -------------------------------------------------------------------------

	private async loadAndRender(containerEl: HTMLElement): Promise<void> {
		const { rules } = await this.deps.ruleStore.load();
		const importRules = rules.filter(
			(r): r is ImportRule => r.direction === "import",
		);

		this.clearContainer(containerEl);

		if (importRules.length === 0) {
			this.renderEmptyState(containerEl);
		} else {
			await this.renderPopulatedList(containerEl, importRules);
		}
	}

	/** Empty the container element's children. */
	private clearContainer(containerEl: HTMLElement): void {
		while (containerEl.firstChild) {
			containerEl.removeChild(containerEl.firstChild);
		}
	}

	// -------------------------------------------------------------------------
	// Private: empty state
	// -------------------------------------------------------------------------

	private renderEmptyState(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Rules").setHeading();

		new Setting(containerEl)
			.setName("Add an import rule")
			.setDesc(
				"Import rules pull files from local folders into your vault on a schedule. " +
					"Add a rule to ferry your inbox.",
			)
			.addButton((btn) =>
				btn
					.setButtonText("+ add import rule")
					.setCta()
					.onClick(() => {
						this.clearContainer(containerEl);
						this.deps.importRuleEditor.renderForCreate(
							containerEl,
							(created) => {
								// Rerender the whole subtab regardless of whether the user saved
								// or cancelled — this handles both "rule now exists" and "still
								// empty".
								if (created !== undefined) {
									void this.deps.scheduler.onRuleChanged(created);
								}
								void this.loadAndRender(containerEl);
							},
						);
					}),
			);
	}

	// -------------------------------------------------------------------------
	// Private: populated list
	// -------------------------------------------------------------------------

	private async renderPopulatedList(
		containerEl: HTMLElement,
		rules: ImportRule[],
	): Promise<void> {
		new Setting(containerEl).setName("Rules").setHeading();

		// "+ add import rule" inline-expand button. Inline expand means the click
		// clears the body and renders the rule editor in-place, not in a Modal.
		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("+ add import rule")
				.setCta()
				.onClick(() => {
					this.clearContainer(containerEl);
					this.deps.importRuleEditor.renderForCreate(containerEl, (created) => {
						if (created !== undefined) {
							void this.deps.scheduler.onRuleChanged(created);
						}
						void this.loadAndRender(containerEl);
					});
				}),
		);

		// Render one row per rule
		for (const rule of rules) {
			const enabled = await this.deps.deviceStore.isEnabled(rule.id);
			this.renderRuleRow(containerEl, rule, !!enabled);
		}
	}

	// -------------------------------------------------------------------------
	// Private: single rule row
	// -------------------------------------------------------------------------

	private renderRuleRow(
		containerEl: HTMLElement,
		rule: ImportRule,
		initialEnabled: boolean,
	): void {
		const doc = containerEl.ownerDocument;
		const row = doc.createElement("div");
		row.className = "hakobi-rule-row";
		row.setAttribute("data-rule-id", rule.id);

		// Per-device enable toggle (col 1, spans both rows of the card)
		const toggleEl = doc.createElement("div");
		toggleEl.setAttribute("role", "switch");
		toggleEl.setAttribute("aria-checked", String(initialEnabled));
		toggleEl.className = "hakobi-toggle";

		let currentEnabled = initialEnabled;

		this.deps.plugin.registerDomEvent(toggleEl, "click", () => {
			const next = !currentEnabled;
			currentEnabled = next;
			toggleEl.setAttribute("aria-checked", String(next));
			void (async () => {
				await this.deps.deviceStore.setEnabled(rule.id, next);
				// Scheduler reads enable state through DeviceStore — onRuleChanged
				// causes it to (re-)evaluate and add or drop the timer.
				await this.deps.scheduler.onRuleChanged(rule);
			})();
		});
		row.appendChild(toggleEl);

		// Identity block (col 2): name + summary + badges stacked vertically
		const identity = doc.createElement("div");
		identity.className = "hakobi-rule-identity";

		const nameEl = doc.createElement("span");
		nameEl.className = "hakobi-rule-name";
		nameEl.textContent = rule.name;
		identity.appendChild(nameEl);

		const summaryEl = doc.createElement("span");
		summaryEl.className = "hakobi-rule-summary";
		summaryEl.textContent = `${rule.sourcePath} → ${rule.destinationVaultPath}`;
		identity.appendChild(summaryEl);

		const badges: string[] = [
			`every ${rule.everyMinutes}m`,
			rule.action,
			rule.onCollision,
			rule.flattenOnTarget ? "flatten" : "mirror",
		];
		if (rule.dryRun) {
			badges.push("dry-run");
		}
		const badgesEl = doc.createElement("span");
		badgesEl.className = "hakobi-rule-badges";
		badgesEl.textContent = badges.join(" · ");
		identity.appendChild(badgesEl);

		row.appendChild(identity);

		// Overflow menu button (col 3, spans both rows)
		const overflowBtn = doc.createElement("button");
		overflowBtn.setAttribute("data-action", "overflow");
		overflowBtn.textContent = "⋯";
		this.deps.plugin.registerDomEvent(overflowBtn, "click", () => {
			this.openOverflow(overflowBtn, rule, containerEl, row);
		});
		row.appendChild(overflowBtn);

		containerEl.appendChild(row);
	}

	// -------------------------------------------------------------------------
	// Private: overflow menu items
	// -------------------------------------------------------------------------

	private openOverflow(
		anchor: HTMLElement,
		rule: ImportRule,
		containerEl: HTMLElement,
		row: HTMLElement,
	): void {
		this.deps.openOverflowMenu(anchor, [
			{
				label: "Edit",
				onClick: () => {
					// Replace the row with the inline editor.
					const editorContainer = containerEl.ownerDocument.createElement("div");
					editorContainer.className = "hakobi-rule-editor-inline";
					row.replaceWith(editorContainer);
					this.deps.importRuleEditor.renderForEdit(
						editorContainer,
						rule,
						(updated) => {
							if (updated !== undefined) {
								void this.deps.scheduler.onRuleChanged(updated);
							}
							void this.loadAndRender(containerEl);
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
					void this.handleDelete(rule, containerEl);
				},
			},
		]);
	}

	// -------------------------------------------------------------------------
	// Private: delete flow
	// -------------------------------------------------------------------------

	private async handleDelete(
		rule: ImportRule,
		containerEl: HTMLElement,
	): Promise<void> {
		const confirmed = await this.deps.confirm(
			`Delete rule '${rule.name}'? This cannot be undone.`,
		);
		if (!confirmed) return;

		await this.deps.ruleStore.remove(rule.id);
		await this.deps.deviceStore.removeRule(rule.id);
		this.deps.scheduler.onRuleRemoved(rule.id);
		// Rerender with the updated rule list
		void this.loadAndRender(containerEl);
	}
}
