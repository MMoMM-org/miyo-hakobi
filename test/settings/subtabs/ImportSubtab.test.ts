/**
 * Tests for ImportSubtab (T3.8).
 *
 * Covers: empty state, populated list (name, source/destination summary,
 * badges, toggle, overflow menu actions — Run now, Run dry-run, Edit,
 * Delete confirmed/cancelled), and direction filter (export rules excluded).
 *
 * Uses vitest + jsdom + the obsidian mock. The `openOverflowMenu` dep is
 * injected as a vi.fn() that immediately calls the chosen item's onClick so
 * tests can assert actions without a real Obsidian Menu.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import { PluginSettingTab, Plugin, App, Notice } from "obsidian";
import { ImportSubtab, type ImportSubtabDeps } from "../../../src/settings/subtabs/ImportSubtab";
import type { ImportRule, Rule } from "../../../src/domain/rule";
import type { RuleId } from "../../../src/domain/ruleId";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

/** Flush all pending promises / microtasks. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const ID_A = "rule-id-a" as RuleId;
const ID_B = "rule-id-b" as RuleId;
const ID_EXPORT = "rule-id-export" as RuleId;

function makeImportRule(overrides: Partial<ImportRule> = {}): ImportRule {
	return {
		id: ID_A,
		direction: "import",
		name: "Voice Memos",
		sourcePath: "/users/m/voice" as ImportRule["sourcePath"],
		destinationVaultPath: "Inbox/voice" as ImportRule["destinationVaultPath"],
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		...overrides,
	};
}

function makeExportRule(): Rule {
	return {
		id: ID_EXPORT,
		direction: "export",
		sourceType: "folder",
		name: "Export Notes",
		sourceVaultPath: "Notes" as Rule extends { sourceVaultPath: infer P } ? P : never,
		destinationPath: "/users/m/export" as Rule extends { destinationPath: infer P } ? P : never,
		everyMinutes: 10,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
	} as Rule;
}

/** Builds a minimal valid deps object for ImportSubtab. */
function makeDeps(
	overrides: Partial<ImportSubtabDeps> = {},
): ImportSubtabDeps {
	// Default: no rules
	const ruleStore: ImportSubtabDeps["ruleStore"] = {
		load: vi.fn(async () => ({ rules: [] as Rule[] })),
		remove: vi.fn(async () => [] as Rule[]),
	};

	const deviceStore: ImportSubtabDeps["deviceStore"] = {
		isEnabled: vi.fn(async () => false),
		setEnabled: vi.fn(async () => {}),
		removeRule: vi.fn(async () => {}),
	};

	const scheduler: ImportSubtabDeps["scheduler"] = {
		runOnce: vi.fn(async () => {}),
		onRuleChanged: vi.fn(async () => {}),
		onRuleRemoved: vi.fn(() => {}),
	};

	const importRuleEditor: ImportSubtabDeps["importRuleEditor"] = {
		renderForCreate: vi.fn((_c, _onDone) => {}),
		renderForEdit: vi.fn((_c, _rule, _onDone) => {}),
	};

	const notices: ImportSubtabDeps["notices"] = {
		transient: vi.fn(),
	};

	const confirm: ImportSubtabDeps["confirm"] = vi.fn(async () => true);

	// openOverflowMenu: immediately invoke the chosen item by label
	// Tests will pick which item to invoke via a helper.
	const openOverflowMenu: ImportSubtabDeps["openOverflowMenu"] = vi.fn();

	return {
		ruleStore,
		deviceStore,
		scheduler,
		importRuleEditor,
		notices,
		confirm,
		openOverflowMenu,
		...overrides,
	};
}

/**
 * Invokes a specific overflow menu item by label on the most recent call
 * to `openOverflowMenu`.
 */
function clickOverflowItem(
	openOverflowMenuFn: MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
	label: string,
): void {
	const calls = openOverflowMenuFn.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	const lastCall = calls[calls.length - 1];
	// lastCall: [anchor, items]
	const items = lastCall[1];
	const item = items.find((i) => i.label === label);
	expect(item, `overflow item '${label}' not found`).toBeDefined();
	item!.onClick();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ImportSubtab", () => {
	let containerEl: HTMLElement;

	beforeEach(() => {
		containerEl = makeContainer();
		Notice._reset();
	});

	// -------------------------------------------------------------------------
	// 1. Empty state: shows description text + Add button
	// -------------------------------------------------------------------------
	it("empty state shows empty-state description text + '+ add import rule' button", async () => {
		const deps = makeDeps();
		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		expect(containerEl.textContent).toContain("Import rules pull files");
		const addBtn = Array.from(containerEl.querySelectorAll("button")).find(
			(b) => b.textContent?.includes("add import rule"),
		);
		expect(addBtn).toBeDefined();
	});

	// -------------------------------------------------------------------------
	// 2. Empty state: clicking Add button calls renderForCreate
	// -------------------------------------------------------------------------
	it("clicking '+ add import rule' in empty state calls importRuleEditor.renderForCreate", async () => {
		const deps = makeDeps();
		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const addBtn = Array.from(containerEl.querySelectorAll("button")).find(
			(b) => b.textContent?.includes("add import rule"),
		)!;
		addBtn.click();

		expect(deps.importRuleEditor.renderForCreate).toHaveBeenCalledOnce();
		// Second arg is the onDone callback
		const [, onDone] = (deps.importRuleEditor.renderForCreate as MockedFunction<typeof deps.importRuleEditor.renderForCreate>).mock.calls[0];
		expect(typeof onDone).toBe("function");
	});

	// -------------------------------------------------------------------------
	// 3. Populated: two import rules → two rows with correct name + source/dest
	// -------------------------------------------------------------------------
	it("renders one row per import rule with name and source→destination summary", async () => {
		const ruleA = makeImportRule({ id: ID_A, name: "Voice Memos" });
		const ruleB = makeImportRule({
			id: ID_B,
			name: "Snippets",
			sourcePath: "/users/m/snippets" as ImportRule["sourcePath"],
			destinationVaultPath: "Inbox/snippets" as ImportRule["destinationVaultPath"],
		});

		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [ruleA, ruleB] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("Voice Memos");
		expect(text).toContain("Snippets");
		// Source → destination summaries
		expect(text).toContain("/users/m/voice");
		expect(text).toContain("Inbox/voice");
		expect(text).toContain("/users/m/snippets");
		expect(text).toContain("Inbox/snippets");
	});

	// -------------------------------------------------------------------------
	// 4. Toggle reflects deviceStore.isEnabled value
	// -------------------------------------------------------------------------
	it("per-device toggle reflects deviceStore.isEnabled value (true → checked)", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
			deviceStore: {
				isEnabled: vi.fn(async (_id: RuleId) => true),
				setEnabled: vi.fn(async () => {}),
				removeRule: vi.fn(async () => {}),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const toggle = containerEl.querySelector<HTMLElement>('[role="switch"]');
		expect(toggle).toBeDefined();
		expect(toggle?.getAttribute("aria-checked")).toBe("true");
	});

	// -------------------------------------------------------------------------
	// 5. Clicking toggle calls deviceStore.setEnabled with the inverted value
	// -------------------------------------------------------------------------
	it("clicking the toggle calls deviceStore.setEnabled(ruleId, !currentValue)", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
			deviceStore: {
				isEnabled: vi.fn(async () => false), // starts disabled
				setEnabled: vi.fn(async () => {}),
				removeRule: vi.fn(async () => {}),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const toggle = containerEl.querySelector<HTMLElement>('[role="switch"]')!;
		toggle.click(); // mock ToggleComponent fires _onChange
		await flush();

		expect(deps.deviceStore.setEnabled).toHaveBeenCalledWith(ID_A, true);
	});

	// -------------------------------------------------------------------------
	// 6. Overflow: "Run now" calls scheduler.runOnce with dryRun: false
	// -------------------------------------------------------------------------
	it("overflow 'Run now' calls scheduler.runOnce(ruleId, { dryRun: false })", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		// Click the overflow button to trigger openOverflowMenu
		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		expect(overflowBtn).toBeDefined();
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Run now",
		);
		await flush();

		expect(deps.scheduler.runOnce).toHaveBeenCalledWith(ID_A, { dryRun: false });
	});

	// -------------------------------------------------------------------------
	// 7. Overflow: "Run dry-run" calls scheduler.runOnce with dryRun: true
	// -------------------------------------------------------------------------
	it("overflow 'Run dry-run' calls scheduler.runOnce(ruleId, { dryRun: true })", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Run dry-run",
		);
		await flush();

		expect(deps.scheduler.runOnce).toHaveBeenCalledWith(ID_A, { dryRun: true });
	});

	// -------------------------------------------------------------------------
	// 8. Overflow: "Edit" calls importRuleEditor.renderForEdit with the rule
	// -------------------------------------------------------------------------
	it("overflow 'Edit' calls importRuleEditor.renderForEdit with the rule", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Edit",
		);

		expect(deps.importRuleEditor.renderForEdit).toHaveBeenCalledOnce();
		const [, editedRule] = (deps.importRuleEditor.renderForEdit as MockedFunction<typeof deps.importRuleEditor.renderForEdit>).mock.calls[0];
		expect(editedRule.id).toBe(ID_A);
	});

	// -------------------------------------------------------------------------
	// 9. Delete confirmed: ruleStore.remove + deviceStore.removeRule both called
	// -------------------------------------------------------------------------
	it("overflow 'Delete' confirmed → ruleStore.remove + deviceStore.removeRule called", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
			confirm: vi.fn(async () => true),
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Delete",
		);
		await flush();

		expect(deps.confirm).toHaveBeenCalledOnce();
		expect(deps.ruleStore.remove).toHaveBeenCalledWith(ID_A);
		expect(deps.deviceStore.removeRule).toHaveBeenCalledWith(ID_A);
	});

	// -------------------------------------------------------------------------
	// 10. Delete cancelled: ruleStore.remove NOT called
	// -------------------------------------------------------------------------
	it("overflow 'Delete' cancelled → ruleStore.remove NOT called", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
			confirm: vi.fn(async () => false),
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Delete",
		);
		await flush();

		expect(deps.confirm).toHaveBeenCalledOnce();
		expect(deps.ruleStore.remove).not.toHaveBeenCalled();
		expect(deps.deviceStore.removeRule).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// 11. Filter: export rules NOT rendered in import subtab
	// -------------------------------------------------------------------------
	it("export rules in the load result are NOT rendered in the import subtab", async () => {
		const importRule = makeImportRule({ name: "My Imports" });
		const exportRule = makeExportRule();

		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({
					rules: [importRule, exportRule] as Rule[],
				})),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("My Imports");
		expect(text).not.toContain("Export Notes");
	});

	// -------------------------------------------------------------------------
	// Extra: badges render correctly
	// -------------------------------------------------------------------------
	it("renders schedule, action, collision, and flatten badges for a rule", async () => {
		const rule = makeImportRule({
			everyMinutes: 15,
			action: "move",
			onCollision: "suffix",
			flattenOnTarget: true,
		});

		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("15m");
		expect(text).toContain("move");
		expect(text).toContain("suffix");
		expect(text).toContain("flatten");
	});

	// -------------------------------------------------------------------------
	// 12. Populated state: Add button calls importRuleEditor.renderForCreate
	// -------------------------------------------------------------------------
	it("populated-state '+ add import rule' button calls importRuleEditor.renderForCreate", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		// The populated path renders a "+ add import rule" button at the top.
		const addBtn = Array.from(containerEl.querySelectorAll("button")).find(
			(b) => b.textContent?.includes("add import rule"),
		)!;
		expect(addBtn).toBeDefined();
		addBtn.click();

		expect(deps.importRuleEditor.renderForCreate).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// 13. dryRun: true → "dry-run" badge is rendered in the rule row
	// -------------------------------------------------------------------------
	it("renders 'dry-run' badge when rule.dryRun is true", async () => {
		const rule = makeImportRule({ dryRun: true });
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("dry-run");
	});

	// -------------------------------------------------------------------------
	// 14. notices.transient called on "Run now"
	// -------------------------------------------------------------------------
	it("overflow 'Run now' calls notices.transient with /Running rule/i message", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Run now",
		);
		await flush();

		expect(deps.notices.transient).toHaveBeenCalledOnce();
		expect((deps.notices.transient as MockedFunction<typeof deps.notices.transient>).mock.calls[0][0]).toMatch(/Running rule/i);
	});

	// -------------------------------------------------------------------------
	// 15. notices.transient called on "Run dry-run"
	// -------------------------------------------------------------------------
	it("overflow 'Run dry-run' calls notices.transient with /Dry-running rule/i message", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();

		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Run dry-run",
		);
		await flush();

		expect(deps.notices.transient).toHaveBeenCalledOnce();
		expect((deps.notices.transient as MockedFunction<typeof deps.notices.transient>).mock.calls[0][0]).toMatch(/Dry-running rule/i);
	});

	// -------------------------------------------------------------------------
	// Bug 3 — Subtab → Scheduler wiring
	//
	// The Scheduler used to learn about new/changed/removed rules only on
	// plugin reload. Until then, freshly created rules sat dormant in
	// data.json and never produced a tick. These tests pin the wiring:
	// every mutation path (create / edit / toggle / delete) must inform
	// the Scheduler immediately.
	// -------------------------------------------------------------------------

	it("create flow: invokes scheduler.onRuleChanged with the freshly created rule", async () => {
		const created = makeImportRule({ name: "Brand new rule" });
		const editor: ImportSubtabDeps["importRuleEditor"] = {
			renderForCreate: vi.fn((_c, onDone) => onDone(created)),
			renderForEdit: vi.fn(),
		};
		const deps = makeDeps({ importRuleEditor: editor });

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		// Empty state shows a single "+ add import rule" button — click it
		const addBtn = containerEl.querySelector<HTMLButtonElement>("button")!;
		addBtn.click();
		await flush();

		expect(deps.scheduler.onRuleChanged).toHaveBeenCalledWith(created);
	});

	it("edit flow: invokes scheduler.onRuleChanged with the updated rule", async () => {
		const original = makeImportRule({ name: "Before" });
		const updated = makeImportRule({ name: "After" });
		const editor: ImportSubtabDeps["importRuleEditor"] = {
			renderForCreate: vi.fn(),
			renderForEdit: vi.fn((_c, _r, onDone) => onDone(updated)),
		};
		const deps = makeDeps({
			importRuleEditor: editor,
			ruleStore: {
				load: vi.fn(async () => ({ rules: [original] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();
		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Edit",
		);
		await flush();

		expect(deps.scheduler.onRuleChanged).toHaveBeenCalledWith(updated);
	});

	it("delete flow (confirmed): invokes scheduler.onRuleRemoved with the rule id", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();
		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Delete",
		);
		await flush();

		expect(deps.scheduler.onRuleRemoved).toHaveBeenCalledWith(rule.id);
	});

	it("delete flow (cancelled): does NOT invoke scheduler.onRuleRemoved", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
			confirm: vi.fn(async () => false),
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const overflowBtn = containerEl.querySelector<HTMLButtonElement>(
			'button[data-action="overflow"]',
		)!;
		overflowBtn.click();
		clickOverflowItem(
			deps.openOverflowMenu as MockedFunction<ImportSubtabDeps["openOverflowMenu"]>,
			"Delete",
		);
		await flush();

		expect(deps.scheduler.onRuleRemoved).not.toHaveBeenCalled();
	});

	it("toggle flow: invokes scheduler.onRuleChanged with the rule after setEnabled", async () => {
		const rule = makeImportRule();
		const deps = makeDeps({
			ruleStore: {
				load: vi.fn(async () => ({ rules: [rule] as Rule[] })),
				remove: vi.fn(async () => [] as Rule[]),
			},
		});

		const subtab = new ImportSubtab(deps);
		subtab.render(containerEl);
		await flush();

		const toggleEl = containerEl.querySelector<HTMLElement>(
			'[role="switch"]',
		)!;
		toggleEl.click();
		await flush();

		expect(deps.deviceStore.setEnabled).toHaveBeenCalledWith(rule.id, true);
		expect(deps.scheduler.onRuleChanged).toHaveBeenCalledWith(rule);
	});
});
