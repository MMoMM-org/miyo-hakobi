/**
 * Tests for ExportSubtab — export rule list + empty state.
 *
 * Covers:
 *  1.  Empty state: no export rules → empty-state text + "+ add export rule" button
 *  2.  Empty state: clicking "+ add export rule" → exportRuleEditor.renderForCreate called
 *  3.  Populated: three rules (folder/tag/note) all render
 *  4.  Folder-type summary contains sourceVaultPath and destinationPath
 *  5.  Tag-type summary contains comma-joined tags and tagMatch text
 *  6.  Note-type summary contains sourceVaultNotePath; flatten/mirror badge is OMITTED
 *  7.  Per-device toggle reflects deviceStore.isEnabled
 *  8.  Clicking the toggle calls deviceStore.setEnabled
 *  9.  Overflow Run now → scheduler.runOnce(id, { dryRun: false })
 * 10.  Overflow Run dry-run → scheduler.runOnce(id, { dryRun: true })
 * 11.  Overflow Edit → exportRuleEditor.renderForEdit called with the rule
 * 12.  Overflow Delete with confirm=true → ruleStore.remove + deviceStore.removeRule
 * 13.  Overflow Delete with confirm=false → no removal
 * 14.  Filters: an import rule in the load result does NOT appear in the export subtab
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginSettingTab, Plugin, App } from "obsidian";
import { ExportSubtab } from "../../../src/settings/subtabs/ExportSubtab";
import type { Rule, ExportRule, RuleId } from "../../../src/types/index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FOLDER_RULE: ExportRule = {
	id: "r-folder" as RuleId,
	name: "My Folder Export",
	direction: "export",
	sourceType: "folder",
	sourceVaultPath: "Notes/projects" as import("../../../src/types/index").VaultRelativePath,
	destinationPath: "/backup/projects" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 15,
	action: "copy",
	onCollision: "skip",
	flattenOnTarget: false,
	dryRun: false,
};

const TAG_RULE: ExportRule = {
	id: "r-tag" as RuleId,
	name: "My Tag Export",
	direction: "export",
	sourceType: "tag",
	tags: ["#Project", "#work"],
	tagMatch: "any",
	destinationPath: "/backup/tagged" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 30,
	action: "move",
	onCollision: "suffix",
	flattenOnTarget: true,
	dryRun: false,
};

const NOTE_RULE: ExportRule = {
	id: "r-note" as RuleId,
	name: "My Note Export",
	direction: "export",
	sourceType: "note",
	sourceVaultNotePath: "Daily/2026-05-01.md" as import("../../../src/types/index").VaultRelativePath,
	destinationPath: "/backup/daily" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 60,
	action: "copy",
	onCollision: "skip",
	flattenOnTarget: false,
	dryRun: true,
};

const IMPORT_RULE: Rule = {
	id: "r-import" as RuleId,
	name: "My Import Rule",
	direction: "import",
	sourcePath: "/downloads/voice" as import("../../../src/types/index").AbsolutePath,
	destinationVaultPath: "Inbox/voice" as import("../../../src/types/index").VaultRelativePath,
	everyMinutes: 5,
	action: "copy",
	onCollision: "skip",
	flattenOnTarget: false,
	dryRun: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

/** Drains the microtask queue so fire-and-forget async render completes. */
async function flushMicrotasks(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeDeps(overrides: Partial<{
	rules: Rule[];
	isEnabled: boolean;
	confirmResult: boolean;
}> = {}) {
	const rules = overrides.rules ?? [];
	const isEnabled = overrides.isEnabled ?? false;
	const confirmResult = overrides.confirmResult ?? true;

	return {
		ruleStore: {
			load: vi.fn(async () => ({ rules })),
			remove: vi.fn(async () => []),
		},
		deviceStore: {
			isEnabled: vi.fn((_id: RuleId) => isEnabled),
			setEnabled: vi.fn(async () => {}),
			removeRule: vi.fn(async () => {}),
		},
		scheduler: {
			runOnce: vi.fn(async () => {}),
		},
		exportRuleEditor: {
			renderForCreate: vi.fn((_c: HTMLElement, _onDone: (r: Rule | undefined) => void) => {}),
			renderForEdit: vi.fn((_c: HTMLElement, _r: ExportRule, _onDone: (r: Rule | undefined) => void) => {}),
		},
		notices: {
			transient: vi.fn(),
		},
		confirm: vi.fn(async () => confirmResult),
		openOverflowMenu: vi.fn(
			(
				_anchor: HTMLElement,
				items: { label: string; onClick: () => void }[],
			) => {
				// Store items so tests can invoke them by label
				(_anchor as HTMLElement & { _menuItems?: typeof items })._menuItems = items;
			},
		),
	};
}

/** Find a button whose text content includes the given text. */
function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
	return (
		Array.from(container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes(text),
		) ?? null
	);
}

/** Find overflow menu items stored by the mock openOverflowMenu. */
function getMenuItems(
	anchor: HTMLElement,
): { label: string; onClick: () => void }[] {
	return (
		(anchor as HTMLElement & { _menuItems?: { label: string; onClick: () => void }[] })
			._menuItems ?? []
	);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ExportSubtab", () => {
	let containerEl: HTMLElement;

	beforeEach(() => {
		containerEl = makeContainer();
	});

	// -------------------------------------------------------------------------
	// Test 1: Empty state shows description and add button
	// -------------------------------------------------------------------------

	it("empty state: shows export description and '+ add export rule' button", async () => {
		const deps = makeDeps({ rules: [] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("Export rules push files from your vault to local folders");

		const addBtn = findButtonByText(containerEl, "add export rule");
		expect(addBtn).not.toBeNull();
	});

	// -------------------------------------------------------------------------
	// Test 2: Clicking "+ add export rule" in empty state calls renderForCreate
	// -------------------------------------------------------------------------

	it("empty state: clicking '+ add export rule' calls exportRuleEditor.renderForCreate", async () => {
		const deps = makeDeps({ rules: [] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const addBtn = findButtonByText(containerEl, "add export rule");
		expect(addBtn).not.toBeNull();
		addBtn!.click();

		expect(deps.exportRuleEditor.renderForCreate).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Test 3: Populated list renders all three rule types
	// -------------------------------------------------------------------------

	it("populated: three rules (folder/tag/note) all appear in the list", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE, TAG_RULE, NOTE_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("My Folder Export");
		expect(text).toContain("My Tag Export");
		expect(text).toContain("My Note Export");
	});

	// -------------------------------------------------------------------------
	// Test 4: Folder-type summary contains sourceVaultPath and destinationPath
	// -------------------------------------------------------------------------

	it("folder rule: summary contains sourceVaultPath and destinationPath", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		expect(text).toContain("Notes/projects");
		expect(text).toContain("/backup/projects");
	});

	// -------------------------------------------------------------------------
	// Test 5: Tag-type summary contains comma-joined tags and tagMatch
	// -------------------------------------------------------------------------

	it("tag rule: summary contains comma-joined tags and tagMatch text", async () => {
		const deps = makeDeps({ rules: [TAG_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		// Tags joined
		expect(text).toContain("#Project");
		expect(text).toContain("#work");
		// tagMatch
		expect(text).toContain("any");
	});

	// -------------------------------------------------------------------------
	// Test 6: Note-type summary contains sourceVaultNotePath; flatten badge OMITTED
	// -------------------------------------------------------------------------

	it("note rule: summary contains sourceVaultNotePath and does NOT show flatten badge", async () => {
		// Use a folder rule with flattenOnTarget=true to ensure "flatten" can appear
		// for other types, then verify it is absent for the note rule.
		const folderWithFlatten: ExportRule = {
			...FOLDER_RULE,
			id: "r-folder-flat" as RuleId,
			flattenOnTarget: true,
		};
		const deps = makeDeps({ rules: [folderWithFlatten, NOTE_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		// Note rule path is present
		expect(text).toContain("Daily/2026-05-01.md");

		// "flatten" appears for the folder rule
		expect(text).toContain("flatten");

		// Find the note rule row specifically — get the row element text
		// Look for a container element that contains the note rule name
		const allRows = Array.from(containerEl.querySelectorAll("[data-rule-id]"));
		const noteRow = allRows.find((el) => el.getAttribute("data-rule-id") === "r-note");
		expect(noteRow).not.toBeUndefined();
		expect(noteRow!.textContent).not.toContain("flatten");
	});

	// -------------------------------------------------------------------------
	// Test 7: Toggle reflects deviceStore.isEnabled
	// -------------------------------------------------------------------------

	it("toggle: reflects deviceStore.isEnabled(ruleId)", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE], isEnabled: true });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		expect(deps.deviceStore.isEnabled).toHaveBeenCalledWith(FOLDER_RULE.id);

		// The toggle should have aria-checked="true" since isEnabled returns true
		const toggleEl = containerEl.querySelector("[role='switch']");
		expect(toggleEl).not.toBeNull();
		expect(toggleEl!.getAttribute("aria-checked")).toBe("true");
	});

	// -------------------------------------------------------------------------
	// Test 8: Clicking the toggle calls deviceStore.setEnabled
	// -------------------------------------------------------------------------

	it("toggle: clicking calls deviceStore.setEnabled with new value", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE], isEnabled: false });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const toggleEl = containerEl.querySelector("[role='switch']") as HTMLElement | null;
		expect(toggleEl).not.toBeNull();
		toggleEl!.click();
		await flushMicrotasks();

		expect(deps.deviceStore.setEnabled).toHaveBeenCalledOnce();
		expect(deps.deviceStore.setEnabled).toHaveBeenCalledWith(FOLDER_RULE.id, true);
	});

	// -------------------------------------------------------------------------
	// Test 9: Overflow Run now → scheduler.runOnce(id, { dryRun: false })
	// -------------------------------------------------------------------------

	it("overflow Run now: calls scheduler.runOnce(id, { dryRun: false }) and fires transient notice", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		// Find the overflow button and click it to open the menu
		const overflowBtn = findButtonByText(containerEl, "⋯");
		expect(overflowBtn).not.toBeNull();
		overflowBtn!.click();

		// Find the "Run now" menu item and invoke it
		const items = getMenuItems(overflowBtn!);
		const runNow = items.find((i) => i.label === "Run now");
		expect(runNow).toBeDefined();
		runNow!.onClick();
		await flushMicrotasks();

		expect(deps.scheduler.runOnce).toHaveBeenCalledOnce();
		expect(deps.scheduler.runOnce).toHaveBeenCalledWith(FOLDER_RULE.id, { dryRun: false });
		expect(deps.notices.transient).toHaveBeenCalledWith(`Running rule '${FOLDER_RULE.name}'…`);
	});

	// -------------------------------------------------------------------------
	// Test 10: Overflow Run dry-run → scheduler.runOnce(id, { dryRun: true })
	// -------------------------------------------------------------------------

	it("overflow Run dry-run: calls scheduler.runOnce(id, { dryRun: true }) and fires transient notice", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const overflowBtn = findButtonByText(containerEl, "⋯");
		expect(overflowBtn).not.toBeNull();
		overflowBtn!.click();

		const items = getMenuItems(overflowBtn!);
		const runDryRun = items.find((i) => i.label === "Run dry-run");
		expect(runDryRun).toBeDefined();
		runDryRun!.onClick();
		await flushMicrotasks();

		expect(deps.scheduler.runOnce).toHaveBeenCalledOnce();
		expect(deps.scheduler.runOnce).toHaveBeenCalledWith(FOLDER_RULE.id, { dryRun: true });
		expect(deps.notices.transient).toHaveBeenCalledWith(`Dry-running rule '${FOLDER_RULE.name}'…`);
	});

	// -------------------------------------------------------------------------
	// Test 11: Overflow Edit → exportRuleEditor.renderForEdit called with the rule
	// -------------------------------------------------------------------------

	it("overflow Edit: calls exportRuleEditor.renderForEdit with the rule", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const overflowBtn = findButtonByText(containerEl, "⋯");
		expect(overflowBtn).not.toBeNull();
		overflowBtn!.click();

		const items = getMenuItems(overflowBtn!);
		const edit = items.find((i) => i.label === "Edit");
		expect(edit).toBeDefined();
		edit!.onClick();

		expect(deps.exportRuleEditor.renderForEdit).toHaveBeenCalledOnce();
		const [, calledRule] = (deps.exportRuleEditor.renderForEdit as ReturnType<typeof vi.fn>).mock.calls[0] as [HTMLElement, ExportRule, unknown];
		expect(calledRule.id).toBe(FOLDER_RULE.id);
	});

	// -------------------------------------------------------------------------
	// Test 12: Overflow Delete confirmed → ruleStore.remove + deviceStore.removeRule
	// -------------------------------------------------------------------------

	it("overflow Delete confirmed: calls ruleStore.remove and deviceStore.removeRule", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE], confirmResult: true });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const overflowBtn = findButtonByText(containerEl, "⋯");
		expect(overflowBtn).not.toBeNull();
		overflowBtn!.click();

		const items = getMenuItems(overflowBtn!);
		const del = items.find((i) => i.label === "Delete");
		expect(del).toBeDefined();
		del!.onClick();
		await flushMicrotasks();

		expect(deps.ruleStore.remove).toHaveBeenCalledOnce();
		expect(deps.ruleStore.remove).toHaveBeenCalledWith(FOLDER_RULE.id);
		expect(deps.deviceStore.removeRule).toHaveBeenCalledOnce();
		expect(deps.deviceStore.removeRule).toHaveBeenCalledWith(FOLDER_RULE.id);
	});

	// -------------------------------------------------------------------------
	// Test 13: Overflow Delete declined → no removal
	// -------------------------------------------------------------------------

	it("overflow Delete declined: does NOT call ruleStore.remove or deviceStore.removeRule", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE], confirmResult: false });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const overflowBtn = findButtonByText(containerEl, "⋯");
		expect(overflowBtn).not.toBeNull();
		overflowBtn!.click();

		const items = getMenuItems(overflowBtn!);
		const del = items.find((i) => i.label === "Delete");
		expect(del).toBeDefined();
		del!.onClick();
		await flushMicrotasks();

		expect(deps.ruleStore.remove).not.toHaveBeenCalled();
		expect(deps.deviceStore.removeRule).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Test 14: Import rule in load result does NOT appear in export subtab
	// -------------------------------------------------------------------------

	it("filters: an import rule does NOT appear in the export subtab", async () => {
		const deps = makeDeps({ rules: [IMPORT_RULE, FOLDER_RULE] });
		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const text = containerEl.textContent ?? "";
		// Import rule name must not appear
		expect(text).not.toContain("My Import Rule");
		// Export rule name must appear
		expect(text).toContain("My Folder Export");
	});

	// -------------------------------------------------------------------------
	// Test 15: async isEnabled path — toggle reflects Promise<boolean> result
	// -------------------------------------------------------------------------

	it("toggle async: reflects deviceStore.isEnabled when it returns a Promise", async () => {
		const deps = makeDeps({ rules: [FOLDER_RULE] });
		// Override isEnabled to return a Promise<boolean> instead of a sync boolean
		deps.deviceStore.isEnabled = vi.fn((_id: RuleId) => Promise.resolve(true));

		const subtab = new ExportSubtab(deps);
		subtab.render(containerEl);

		// First flush: drains _renderAsync (ruleStore.load + _paint)
		await flushMicrotasks();
		// Second flush: drains the .then() callback after isEnabled Promise resolves
		await flushMicrotasks();

		const toggleEl = containerEl.querySelector("[role='switch']");
		expect(toggleEl).not.toBeNull();
		expect(toggleEl!.getAttribute("aria-checked")).toBe("true");
	});
});
