/**
 * Tests for ExportRuleEditor — inline settings editor for ExportRule variants.
 *
 * Covers: source-type switching (folder/tag/note), picker section swapping,
 * flattenOnTarget visibility, validation gating on Save, save flow for all three
 * variants, cancel, renderForEdit pre-population, and scope-violation error.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, Plugin, PluginSettingTab } from "obsidian";
import type { Rule, RuleId, ExportRule, ExportFolderRule, ExportTagRule, ExportNoteRule } from "../../../src/types/index";
import { ExportRuleEditor, type ExportRuleEditorDeps } from "../../../src/settings/editor/ExportRuleEditor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

function makeRuleId(id = "test-rule-id"): RuleId {
	return id as RuleId;
}

function makeDeps(overrides?: Partial<ExportRuleEditorDeps>): ExportRuleEditorDeps {
	return {
		ruleStore: {
			add: vi.fn(async (rule: Rule) => [rule]),
			update: vi.fn(async (_id: RuleId, _partial: Partial<ExportRule>) => []),
		},
		deviceStore: {
			setEnabled: vi.fn(async () => {}),
			markCreatedHere: vi.fn(async () => {}),
		},
		vaultRoot: "/vault",
		pluginDir: "/vault/.obsidian/plugins/miyo-hakobi",
		chooseFsFolder: vi.fn(async () => "/some/external/folder"),
		chooseVaultFolder: vi.fn(async () => undefined),
		notePathSuggester: vi.fn(),
		newRuleId: () => makeRuleId("generated-id"),
		...overrides,
	};
}

/** Fire input event on an element whose value has just been set. */
function fireInput(el: HTMLInputElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Fire change event on a select element. */
function fireChange(el: HTMLSelectElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Find a button in a container by its text label. */
function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll("button")).find(
		(b) => b.textContent?.trim() === label,
	) as HTMLButtonElement | undefined;
}

/** Find a select element that contains the given option values. */
function findSelectWithOption(container: HTMLElement, optionValue: string): HTMLSelectElement | undefined {
	return Array.from(container.querySelectorAll("select")).find((sel) =>
		Array.from(sel.options).some((o) => o.value === optionValue),
	) as HTMLSelectElement | undefined;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FOLDER_RULE: ExportFolderRule = {
	id: makeRuleId("folder-rule-id"),
	name: "Folder Export",
	direction: "export",
	sourceType: "folder",
	sourceVaultPath: "Notes/Projects" as import("../../../src/types/index").VaultRelativePath,
	destinationPath: "/external/backup" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 30,
	action: "copy",
	onCollision: "skip",
	flattenOnTarget: false,
	dryRun: false,
};

const TAG_RULE: ExportTagRule = {
	id: makeRuleId("tag-rule-id"),
	name: "Tag Export",
	direction: "export",
	sourceType: "tag",
	tags: ["#projects", "#notes"],
	tagMatch: "any",
	destinationPath: "/external/tagged" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 60,
	action: "copy",
	onCollision: "skip",
	flattenOnTarget: true,
	dryRun: false,
};

const NOTE_RULE: ExportNoteRule = {
	id: makeRuleId("note-rule-id"),
	name: "Note Export",
	direction: "export",
	sourceType: "note",
	sourceVaultNotePath: "Daily/2026-05-01.md" as import("../../../src/types/index").VaultRelativePath,
	destinationPath: "/external/notes" as import("../../../src/types/index").AbsolutePath,
	everyMinutes: 15,
	action: "move",
	onCollision: "suffix",
	flattenOnTarget: false,
	dryRun: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExportRuleEditor", () => {
	let container: HTMLElement;
	let deps: ExportRuleEditorDeps;

	beforeEach(() => {
		container = makeContainer();
		deps = makeDeps();
	});

	// -------------------------------------------------------------------------
	// T1: renderForCreate produces source-type selector + shared form fields
	// -------------------------------------------------------------------------

	it("T1: renderForCreate renders source-type selector with folder/tag/note options plus shared form fields", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		// Source-type selector must exist with all three options
		const sourceTypeSelect = findSelectWithOption(container, "folder");
		expect(sourceTypeSelect, "source-type select must exist").toBeDefined();
		const options = Array.from(sourceTypeSelect!.options).map((o) => o.value);
		expect(options).toContain("folder");
		expect(options).toContain("tag");
		expect(options).toContain("note");

		// Save and Cancel buttons must exist
		expect(findButton(container, "Save"), "Save button must exist").toBeDefined();
		expect(findButton(container, "Cancel"), "Cancel button must exist").toBeDefined();

		// Shared fields: everyMinutes (number input), action select, onCollision select
		const numberInputs = container.querySelectorAll("input[type=number]");
		expect(numberInputs.length, "everyMinutes numeric input must exist").toBeGreaterThan(0);

		const actionSelect = findSelectWithOption(container, "copy");
		expect(actionSelect, "action select must exist").toBeDefined();

		const collisionSelect = findSelectWithOption(container, "skip");
		expect(collisionSelect, "onCollision select must exist").toBeDefined();
	});

	it("T1b: default source type is folder — vault folder input visible initially", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder");
		expect(sourceTypeSelect!.value).toBe("folder");
	});

	// -------------------------------------------------------------------------
	// T2: switching to tag swaps picker section
	// -------------------------------------------------------------------------

	it("T2: switching source-type to tag shows tags input and tagMatch dropdown", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "tag");

		// tagMatch dropdown must appear
		const tagMatchSelect = findSelectWithOption(container, "any");
		expect(tagMatchSelect, "tagMatch select must appear for tag source type").toBeDefined();

		const tagMatchOptions = Array.from(tagMatchSelect!.options).map((o) => o.value);
		expect(tagMatchOptions).toContain("any");
		expect(tagMatchOptions).toContain("all");

		// A text input for tags must appear
		const textInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		// At least one text input (for tags) in addition to name and destination
		expect(textInputs.length).toBeGreaterThanOrEqual(2);
	});

	// -------------------------------------------------------------------------
	// T3: switching to note swaps picker section
	// -------------------------------------------------------------------------

	it("T3: switching source-type to note shows note path input, not tag fields", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "note");

		// tagMatch dropdown must NOT be visible (it's for tag type only)
		const tagMatchSelect = findSelectWithOption(container, "any");
		expect(tagMatchSelect, "tagMatch select must be hidden for note source type").toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// T4: switching back to folder
	// -------------------------------------------------------------------------

	it("T4: switching from note back to folder restores vault folder input", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "note");
		fireChange(sourceTypeSelect, "folder");

		// tagMatch select should not exist
		const tagMatchSelect = findSelectWithOption(container, "any");
		expect(tagMatchSelect).toBeUndefined();

		// Source type should be back to folder
		expect(sourceTypeSelect.value).toBe("folder");
	});

	// -------------------------------------------------------------------------
	// T5: flattenOnTarget visibility
	// -------------------------------------------------------------------------

	it("T5a: flattenOnTarget toggle is visible when source type is folder", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		// Default is folder — flatten toggle must be visible
		const flattenToggle = container.querySelector("[role=switch]");
		const flattenSettingEl = flattenToggle?.closest("[data-setting-name]");
		const flattenSettingName = flattenSettingEl?.getAttribute("data-setting-name")?.toLowerCase();
		expect(flattenSettingName, "flattenOnTarget setting visible for folder").toContain("flatten");
	});

	it("T5b: flattenOnTarget toggle is visible when source type is tag", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "tag");

		// Check flatten toggle exists — visible for tag type
		const allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		const flattenSetting = allSettings.find((el) =>
			el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten"),
		);
		expect(flattenSetting, "flattenOnTarget setting visible for tag").toBeDefined();
	});

	it("T5c: flattenOnTarget toggle is hidden when source type is note", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "note");

		// Check flatten toggle is gone — hidden for note type
		const allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		const flattenSetting = allSettings.find((el) =>
			el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten"),
		);
		expect(flattenSetting, "flattenOnTarget setting hidden for note").toBeUndefined();
	});

	it("T5d: flattenOnTarget visibility transitions correctly: folder→note→tag", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;

		// folder: visible
		let allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		expect(
			allSettings.find((el) => el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten")),
		).toBeDefined();

		// note: hidden
		fireChange(sourceTypeSelect, "note");
		allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		expect(
			allSettings.find((el) => el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten")),
		).toBeUndefined();

		// tag: visible again
		fireChange(sourceTypeSelect, "tag");
		allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		expect(
			allSettings.find((el) => el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten")),
		).toBeDefined();
	});

	// -------------------------------------------------------------------------
	// T6: Save initially disabled
	// -------------------------------------------------------------------------

	it("T6: Save button is initially disabled with empty form", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled, "Save must be disabled when form is empty").toBe(true);
	});

	// -------------------------------------------------------------------------
	// T7: Folder variant — happy-path save
	// -------------------------------------------------------------------------

	it("T7: folder variant — filling all valid fields enables Save and calls ruleStore.add correctly", async () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, onDone);

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const nameInput = allInputs[0];
		const sourceInput = allInputs[1];
		const destInput = allInputs[2];
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;

		fireInput(nameInput, "Folder Export Rule");
		fireInput(sourceInput, "Notes/Projects");
		fireInput(destInput, "/external/backup");
		fireInput(everyInput, "60");

		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled, "Save should be enabled with valid data").toBe(false);

		saveBtn.click();
		await vi.waitFor(() => expect(deps.ruleStore.add).toHaveBeenCalled());

		const addCall = vi.mocked(deps.ruleStore.add).mock.calls[0]?.[0] as ExportFolderRule;
		expect(addCall.direction).toBe("export");
		expect(addCall.sourceType).toBe("folder");
		expect(addCall.sourceVaultPath).toBe("Notes/Projects");
		expect(addCall.destinationPath).toBe("/external/backup");
		expect(addCall.everyMinutes).toBe(60);
		expect(typeof addCall.flattenOnTarget).toBe("boolean");

		await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ direction: "export", sourceType: "folder" })));
	});

	it("T7b: save calls deviceStore.markCreatedHere on create", async () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		fireInput(allInputs[0], "Rule Name");
		fireInput(allInputs[1], "Notes/Projects");
		fireInput(allInputs[2], "/external/backup");
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;
		fireInput(everyInput, "30");

		findButton(container, "Save")!.click();
		await vi.waitFor(() => expect(deps.deviceStore.markCreatedHere).toHaveBeenCalled());
	});

	// -------------------------------------------------------------------------
	// T8: Tag variant save
	// -------------------------------------------------------------------------

	it("T8: tag variant — tags and tagMatch saved correctly", async () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, onDone);

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "tag");

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		// After switching to tag: name input, tags input, dest input
		const nameInput = allInputs[0];
		// Find tags input — it's a separate text input shown for the picker
		const tagsInput = allInputs[1];
		const destInput = allInputs[2];
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;

		fireInput(nameInput, "Tag Export Rule");
		fireInput(tagsInput, "#projects, #notes");
		fireInput(destInput, "/external/tagged");
		fireInput(everyInput, "60");

		// tagMatch is any by default — keep it
		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled).toBe(false);
		saveBtn.click();

		await vi.waitFor(() => expect(deps.ruleStore.add).toHaveBeenCalled());
		const addCall = vi.mocked(deps.ruleStore.add).mock.calls[0]?.[0] as ExportTagRule;
		expect(addCall.sourceType).toBe("tag");
		expect(addCall.tags).toEqual(["#projects", "#notes"]);
		expect(addCall.tagMatch).toBe("any");
	});

	it("T8b: tagMatch=all is saved when changed", async () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, onDone);

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "tag");

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		fireInput(allInputs[0], "Tag Export Rule");
		fireInput(allInputs[1], "#projects, #notes");
		fireInput(allInputs[2], "/external/tagged");
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;
		fireInput(everyInput, "60");

		const tagMatchSelect = findSelectWithOption(container, "any")!;
		fireChange(tagMatchSelect, "all");

		findButton(container, "Save")!.click();
		await vi.waitFor(() => expect(deps.ruleStore.add).toHaveBeenCalled());
		const addCall = vi.mocked(deps.ruleStore.add).mock.calls[0]?.[0] as ExportTagRule;
		expect(addCall.tagMatch).toBe("all");
	});

	// -------------------------------------------------------------------------
	// T9: Note variant save — no flattenOnTarget UI; flattenOnTarget=false persisted
	// -------------------------------------------------------------------------

	it("T9: note variant — sourceVaultNotePath persisted, flattenOnTarget not in UI but false in persisted shape", async () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, onDone);

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "note");

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const nameInput = allInputs[0];
		const notePathInput = allInputs[1];
		const destInput = allInputs[2];
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;

		fireInput(nameInput, "Note Export Rule");
		fireInput(notePathInput, "Daily/2026-05-01.md");
		fireInput(destInput, "/external/notes");
		fireInput(everyInput, "15");

		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled).toBe(false);
		saveBtn.click();

		await vi.waitFor(() => expect(deps.ruleStore.add).toHaveBeenCalled());
		const addCall = vi.mocked(deps.ruleStore.add).mock.calls[0]?.[0] as ExportNoteRule;
		expect(addCall.sourceType).toBe("note");
		expect(addCall.sourceVaultNotePath).toBe("Daily/2026-05-01.md");
		// flattenOnTarget must be false (validated requirement even if hidden in UI)
		expect(addCall.flattenOnTarget).toBe(false);
	});

	// -------------------------------------------------------------------------
	// T10: Scope violation disables Save with error
	// -------------------------------------------------------------------------

	it("T10: scope violation (destination inside vault) disables Save with inline error", async () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		fireInput(allInputs[0], "Bad Rule");
		fireInput(allInputs[1], "Notes/Projects");
		// Destination inside the vault = vault-loop
		fireInput(allInputs[2], "/vault/subfolder");
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;
		fireInput(everyInput, "30");

		const saveBtn = findButton(container, "Save")!;
		// Save should be disabled because scope check fails
		expect(saveBtn.disabled, "Save must be disabled when scope check fails").toBe(true);
	});

	// -------------------------------------------------------------------------
	// T11: Cancel calls onDone(undefined) without persistence
	// -------------------------------------------------------------------------

	it("T11: Cancel calls onDone(undefined) and does not persist", () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, onDone);

		findButton(container, "Cancel")!.click();

		expect(onDone).toHaveBeenCalledWith(undefined);
		expect(deps.ruleStore.add).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// T12: renderForEdit — folder rule pre-population
	// -------------------------------------------------------------------------

	it("T12: renderForEdit with ExportFolderRule pre-populates all fields and calls update on save", async () => {
		const onDone = vi.fn();
		const editor = new ExportRuleEditor(deps);
		editor.renderForEdit(container, FOLDER_RULE, onDone);

		// Name should be pre-populated
		const nameInput = Array.from(container.querySelectorAll("input[type=text], input:not([type])")).find(
			(el) => (el as HTMLInputElement).value === "Folder Export",
		) as HTMLInputElement | undefined;
		expect(nameInput, "name input pre-populated with 'Folder Export'").toBeDefined();

		// Source type selector should be on "folder"
		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		expect(sourceTypeSelect.value).toBe("folder");

		// sourceVaultPath pre-populated
		const sourceInput = Array.from(container.querySelectorAll("input[type=text], input:not([type])")).find(
			(el) => (el as HTMLInputElement).value === "Notes/Projects",
		) as HTMLInputElement | undefined;
		expect(sourceInput, "sourceVaultPath pre-populated").toBeDefined();

		// Save calls update
		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled).toBe(false);
		saveBtn.click();

		await vi.waitFor(() => expect(deps.ruleStore.update).toHaveBeenCalledWith(
			FOLDER_RULE.id,
			expect.objectContaining({ direction: "export", sourceType: "folder" }),
		));
		await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: FOLDER_RULE.id })));
	});

	// -------------------------------------------------------------------------
	// T13: renderForEdit — tag rule pre-population
	// -------------------------------------------------------------------------

	it("T13: renderForEdit with ExportTagRule — source-type radio on tag; tags + tagMatch pre-populated", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForEdit(container, TAG_RULE, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		expect(sourceTypeSelect.value).toBe("tag");

		// tagMatch should be pre-populated
		const tagMatchSelect = findSelectWithOption(container, "any")!;
		expect(tagMatchSelect.value).toBe("any");

		// tags text input should contain the tags
		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const tagsInput = allInputs.find(
			(el) => el.value.includes("#projects") || el.value.includes("#notes"),
		);
		expect(tagsInput, "tags pre-populated").toBeDefined();
	});

	// -------------------------------------------------------------------------
	// T14: renderForEdit — note rule, flatten hidden
	// -------------------------------------------------------------------------

	it("T14: renderForEdit with ExportNoteRule — source-type on note; flatten toggle hidden", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForEdit(container, NOTE_RULE, vi.fn());

		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		expect(sourceTypeSelect.value).toBe("note");

		// Flatten setting must be absent
		const allSettings = Array.from(container.querySelectorAll("[data-setting-name]"));
		const flattenSetting = allSettings.find((el) =>
			el.getAttribute("data-setting-name")?.toLowerCase().includes("flatten"),
		);
		expect(flattenSetting, "flattenOnTarget hidden for note in edit mode").toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// T15: Browse button updates the destination input element visually
	// -------------------------------------------------------------------------

	it("T15: Browse button updates destination input value after path is chosen", async () => {
		const chooseFsFolder = vi.fn(async () => "/users/m/exports");
		const localDeps = makeDeps({ chooseFsFolder });
		const editor = new ExportRuleEditor(localDeps);
		editor.renderForCreate(container, vi.fn());

		// Fill enough fields to be close to valid (folder variant)
		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const nameInput = allInputs[0];
		const sourceInput = allInputs[1];
		const everyInput = Array.from(container.querySelectorAll("input[type=number]"))[0] as HTMLInputElement;
		fireInput(nameInput, "Browse Test Rule");
		fireInput(sourceInput, "Notes/Projects");
		fireInput(everyInput, "30");

		// destination input before Browse
		const destInput = allInputs[2];
		expect(destInput.value, "destination input starts empty").toBe("");

		// Click Browse button
		const browseBtn = findButton(container, "Browse…");
		expect(browseBtn, "Browse button must exist").toBeDefined();
		browseBtn!.click();

		// Wait for the async chooseFsFolder promise to resolve
		await vi.waitFor(() => expect(chooseFsFolder).toHaveBeenCalledOnce());

		// The input element must reflect the chosen path
		expect(destInput.value, "destination input must show chosen path after Browse").toBe("/users/m/exports");

		// The chosen path must be included in the persisted rule when Save is clicked
		const saveBtn = findButton(container, "Save")!;
		expect(saveBtn.disabled, "Save enabled after Browse sets a valid destination").toBe(false);
		saveBtn.click();
		await vi.waitFor(() => expect(localDeps.ruleStore.add).toHaveBeenCalled());
		const addCall = vi.mocked(localDeps.ruleStore.add).mock.calls[0]?.[0] as ExportFolderRule;
		expect(addCall.destinationPath).toBe("/users/m/exports");
	});

	// -------------------------------------------------------------------------
	// chooseVaultFolder seam: clicking Pick on the source vault folder field
	// calls the seam and updates the sourceVaultPath input.
	// -------------------------------------------------------------------------

	it("clicking Pick on Source vault folder calls chooseVaultFolder and updates the input", async () => {
		const chooseVaultFolder = vi.fn(async () => "Notes/Projects");
		const localDeps = makeDeps({ chooseVaultFolder });
		const editor = new ExportRuleEditor(localDeps);
		editor.renderForCreate(container, vi.fn());

		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourceVaultPath"]',
		);
		expect(srcInput, "source vault path input").toBeTruthy();
		expect(srcInput!.value).toBe("");

		const pickBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="pick-source-vault"]',
		);
		expect(pickBtn, "pick source vault folder button must exist").toBeTruthy();
		pickBtn!.click();

		await vi.waitFor(() => expect(chooseVaultFolder).toHaveBeenCalledOnce());

		expect(srcInput!.value, "source vault path input reflects chosen path").toBe(
			"Notes/Projects",
		);
	});

	// -------------------------------------------------------------------------
	// T16: Source-type round-trip preserves shared field values
	// -------------------------------------------------------------------------

	it("T16: switching source-type back to folder preserves name and destination values", () => {
		const editor = new ExportRuleEditor(deps);
		editor.renderForCreate(container, vi.fn());

		// Fill in shared fields while on folder source type
		const allInputs = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const nameInput = allInputs[0];
		const destInput = allInputs[2]; // index 0=name, 1=sourceVaultPath, 2=dest
		fireInput(nameInput, "My export");
		fireInput(destInput, "/exports/foo");

		// Switch source type to note
		const sourceTypeSelect = findSelectWithOption(container, "folder")!;
		fireChange(sourceTypeSelect, "note");

		// Switch back to folder
		fireChange(sourceTypeSelect, "folder");

		// The shared form elements are re-queried after re-render of picker section
		const allInputsAfter = Array.from(container.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
		const nameInputAfter = allInputsAfter[0];
		const destInputAfter = allInputsAfter[2]; // same position: name, sourceVaultPath, dest

		expect(nameInputAfter.value, "name input preserves value after source-type round-trip").toBe("My export");
		expect(destInputAfter.value, "destination input preserves value after source-type round-trip").toBe("/exports/foo");
	});
});
