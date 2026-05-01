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
		const desc = containerEl.ownerDocument.createElement("p");
		desc.className = "hakobi-empty-state";
		desc.textContent =
			"Import rules pull files from local folders into your vault on a schedule. " +
			"Add a rule to ferry your inbox.";
		containerEl.appendChild(desc);

		const addBtn = containerEl.ownerDocument.createElement("button");
		addBtn.textContent = "+ add import rule";
		addBtn.addEventListener("click", () => {
			this.clearContainer(containerEl);
			this.deps.importRuleEditor.renderForCreate(
				containerEl,
				(created) => {
					// Rerender the whole subtab regardless of whether the user saved or
					// cancelled — this handles both "rule now exists" and "still empty".
					void this.loadAndRender(containerEl);
					void created; // creation is persisted by the editor; we just reload
				},
			);
		});
		containerEl.appendChild(addBtn);
	}

	// -------------------------------------------------------------------------
	// Private: populated list
	// -------------------------------------------------------------------------

	private async renderPopulatedList(
		containerEl: HTMLElement,
		rules: ImportRule[],
	): Promise<void> {
		// "+ add import rule" button at the top
		const addBtn = containerEl.ownerDocument.createElement("button");
		addBtn.textContent = "+ add import rule";
		addBtn.addEventListener("click", () => {
			// Inline-expand pattern: clear the body and render the editor.
			this.clearContainer(containerEl);
			this.deps.importRuleEditor.renderForCreate(containerEl, () => {
				void this.loadAndRender(containerEl);
			});
		});
		containerEl.appendChild(addBtn);

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
		const row = containerEl.ownerDocument.createElement("div");
		row.className = "hakobi-rule-row";
		row.setAttribute("data-rule-id", rule.id);

		// Per-device enable toggle
		const toggleEl = containerEl.ownerDocument.createElement("div");
		toggleEl.setAttribute("role", "switch");
		toggleEl.setAttribute("aria-checked", String(initialEnabled));
		toggleEl.className = "hakobi-toggle";

		let currentEnabled = initialEnabled;

		toggleEl.addEventListener("click", () => {
			const next = !currentEnabled;
			currentEnabled = next;
			toggleEl.setAttribute("aria-checked", String(next));
			void this.deps.deviceStore.setEnabled(rule.id, next);
		});
		row.appendChild(toggleEl);

		// Rule name
		const nameEl = containerEl.ownerDocument.createElement("span");
		nameEl.className = "hakobi-rule-name";
		nameEl.textContent = rule.name;
		row.appendChild(nameEl);

		// Source → destination summary
		const summaryEl = containerEl.ownerDocument.createElement("span");
		summaryEl.className = "hakobi-rule-summary";
		summaryEl.textContent = `${rule.sourcePath} → ${rule.destinationVaultPath}`;
		row.appendChild(summaryEl);

		// Badges
		const badgesEl = containerEl.ownerDocument.createElement("span");
		badgesEl.className = "hakobi-rule-badges";

		const badges: string[] = [
			`every ${rule.everyMinutes}m`,
			rule.action,
			rule.onCollision,
			rule.flattenOnTarget ? "flatten" : "mirror",
		];
		if (rule.dryRun) {
			badges.push("dry-run");
		}
		badgesEl.textContent = badges.join(" · ");
		row.appendChild(badgesEl);

		// Overflow menu button
		const overflowBtn = containerEl.ownerDocument.createElement("button");
		overflowBtn.setAttribute("data-action", "overflow");
		overflowBtn.textContent = "⋯";
		overflowBtn.addEventListener("click", () => {
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
						() => {
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
		// Rerender with the updated rule list
		void this.loadAndRender(containerEl);
	}
}
