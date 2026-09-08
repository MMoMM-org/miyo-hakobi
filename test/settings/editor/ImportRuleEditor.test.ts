/**
 * Tests for ImportRuleEditor (T3.6).
 *
 * Covers: field rendering, chooseFsFolder seam, save/cancel flows, validation
 * gating (loop, forbidden-path), edit mode pre-population, and the create vs.
 * edit distinction for store calls.
 *
 * Uses vitest + jsdom + the obsidian mock. Container element is augmented via
 * the PluginSettingTab factory so Obsidian createEl/empty helpers are present.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginSettingTab, Plugin, App } from "obsidian";
import { ImportRuleEditor, type ImportRuleEditorDeps } from "../../../src/settings/editor/ImportRuleEditor";
import type { ImportRule } from "../../../src/domain/rule";
import type { RuleId } from "../../../src/domain/ruleId";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an augmented HTMLElement (Obsidian createEl/empty/etc.) */
function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

const VAULT_ROOT = "/Vault";
const PLUGIN_DIR = "/Vault/.obsidian/plugins/miyo-hakobi";
const FIXED_ID = "aaaa-bbbb-cccc-dddd" as RuleId;

/** Build a minimal valid deps object */
function makeDeps(overrides: Partial<ImportRuleEditorDeps> = {}): ImportRuleEditorDeps {
	return {
		ruleStore: {
			add: vi.fn(async (r) => [r]),
			update: vi.fn(async () => []),
		},
		deviceStore: {
			markCreatedHere: vi.fn(async () => {}),
			setEnabled: vi.fn(async () => {}),
		},
		vaultRoot: VAULT_ROOT,
		pluginDir: PLUGIN_DIR,
		chooseFsFolder: vi.fn(async () => "/users/m/voice"),
		newRuleId: () => FIXED_ID,
		...overrides,
	};
}

/** Fill all required fields with valid values so Save becomes enabled. */
async function fillValidForm(container: HTMLElement): Promise<void> {
	// Name
	const nameInput = container.querySelector<HTMLInputElement>(
		'input[data-field="name"]',
	)!;
	nameInput.value = "Voice Memos";
	nameInput.dispatchEvent(new Event("input"));

	// Source path — use data-field="sourcePath"
	const srcInput = container.querySelector<HTMLInputElement>(
		'input[data-field="sourcePath"]',
	)!;
	srcInput.value = "/users/m/voice";
	srcInput.dispatchEvent(new Event("input"));

	// Destination
	const destInput = container.querySelector<HTMLInputElement>(
		'input[data-field="destinationVaultPath"]',
	)!;
	destInput.value = "Inbox/voice";
	destInput.dispatchEvent(new Event("input"));

	// everyMinutes — numeric text input
	const everyInput = container.querySelector<HTMLInputElement>(
		'input[data-field="everyMinutes"]',
	)!;
	everyInput.value = "5";
	everyInput.dispatchEvent(new Event("input"));

	// action dropdown — default "copy" should already be valid; fire change anyway
	const actionSel = container.querySelector<HTMLSelectElement>(
		'select[data-field="action"]',
	)!;
	actionSel.value = "copy";
	actionSel.dispatchEvent(new Event("change"));

	// onCollision dropdown
	const collisionSel = container.querySelector<HTMLSelectElement>(
		'select[data-field="onCollision"]',
	)!;
	collisionSel.value = "skip";
	collisionSel.dispatchEvent(new Event("change"));
}

// ---------------------------------------------------------------------------
// Existing rule fixture for renderForEdit tests
// ---------------------------------------------------------------------------

const EXISTING_RULE: ImportRule = {
	id: FIXED_ID,
	name: "Existing Rule",
	direction: "import",
	everyMinutes: 10,
	action: "move",
	onCollision: "suffix",
	flattenOnTarget: true,
	dryRun: true,
	sourcePath: "/users/m/existing" as ImportRule["sourcePath"],
	destinationVaultPath: "Inbox/existing" as ImportRule["destinationVaultPath"],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ImportRuleEditor", () => {
	let container: HTMLElement;
	let deps: ImportRuleEditorDeps;
	let editor: ImportRuleEditor;

	beforeEach(() => {
		container = makeContainer();
		deps = makeDeps();
		editor = new ImportRuleEditor(deps);
	});

	// -----------------------------------------------------------------------
	// T3.6.1 — Renders all 8 input/control elements
	// -----------------------------------------------------------------------

	it("renderForCreate produces all 8 field controls", () => {
		editor.renderForCreate(container, vi.fn());

		// 1. Name text input
		const nameInput = container.querySelector('input[data-field="name"]');
		expect(nameInput, "name input").toBeTruthy();

		// 2a. Source path text input
		const srcInput = container.querySelector('input[data-field="sourcePath"]');
		expect(srcInput, "sourcePath input").toBeTruthy();

		// 2b. Browse button
		const browseBtn = container.querySelector('button[data-action="browse-source"]');
		expect(browseBtn, "browse button").toBeTruthy();

		// 3. Destination vault path input
		const destInput = container.querySelector('input[data-field="destinationVaultPath"]');
		expect(destInput, "destinationVaultPath input").toBeTruthy();

		// 4. everyMinutes input
		const everyInput = container.querySelector('input[data-field="everyMinutes"]');
		expect(everyInput, "everyMinutes input").toBeTruthy();

		// 5. Action dropdown
		const actionSel = container.querySelector('select[data-field="action"]');
		expect(actionSel, "action dropdown").toBeTruthy();

		// 6. onCollision dropdown
		const collisionSel = container.querySelector('select[data-field="onCollision"]');
		expect(collisionSel, "onCollision dropdown").toBeTruthy();

		// 7. flattenOnTarget toggle
		const flattenToggle = container.querySelector('[role="switch"][data-field="flattenOnTarget"]');
		expect(flattenToggle, "flattenOnTarget toggle").toBeTruthy();

		// 8. dryRun toggle
		const dryRunToggle = container.querySelector('[role="switch"][data-field="dryRun"]');
		expect(dryRunToggle, "dryRun toggle").toBeTruthy();
	});

	// -----------------------------------------------------------------------
	// T3.6.2 — chooseFsFolder seam: clicking Browse calls the seam once and
	//           populates the source path input.
	// -----------------------------------------------------------------------

	it("clicking Browse calls chooseFsFolder and populates sourcePath input", async () => {
		editor.renderForCreate(container, vi.fn());

		const browseBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="browse-source"]',
		)!;
		expect(browseBtn).toBeTruthy();

		browseBtn.click();
		// Allow the async chooseFsFolder promise chain to resolve
		await Promise.resolve();
		await Promise.resolve();

		expect(deps.chooseFsFolder).toHaveBeenCalledOnce();

		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourcePath"]',
		)!;
		expect(srcInput.value).toBe("/users/m/voice");
	});

	// -----------------------------------------------------------------------
	// chooseVaultFolder seam: clicking Pick calls the seam once and populates
	// the destinationVaultPath input.
	// -----------------------------------------------------------------------

	it("clicking Pick calls chooseVaultFolder and populates destinationVaultPath input", async () => {
		const chooseVaultFolder = vi.fn(async () => "Inbox/voice");
		const localDeps = makeDeps({ chooseVaultFolder });
		const localEditor = new ImportRuleEditor(localDeps);
		localEditor.renderForCreate(container, vi.fn());

		const pickBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="pick-destination"]',
		)!;
		expect(pickBtn, "pick destination button").toBeTruthy();

		pickBtn.click();
		// Allow the async chooseVaultFolder promise chain to resolve
		await Promise.resolve();
		await Promise.resolve();

		expect(chooseVaultFolder).toHaveBeenCalledOnce();

		const destInput = container.querySelector<HTMLInputElement>(
			'input[data-field="destinationVaultPath"]',
		)!;
		expect(destInput.value).toBe("Inbox/voice");
	});

	// -----------------------------------------------------------------------
	// T3.6.3 — Save initially disabled (required fields empty)
	// -----------------------------------------------------------------------

	it("Save button is initially disabled before any fields are filled", () => {
		editor.renderForCreate(container, vi.fn());

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn, "save button").toBeTruthy();
		expect(saveBtn.disabled).toBe(true);
	});

	// -----------------------------------------------------------------------
	// T3.6.4 — Filling all valid fields enables Save
	// -----------------------------------------------------------------------

	it("Save button becomes enabled after all valid fields are filled", async () => {
		editor.renderForCreate(container, vi.fn());

		await fillValidForm(container);

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(false);
	});

	// -----------------------------------------------------------------------
	// T3.6.5 — Loop case: source = vault root → Save disabled with error
	// -----------------------------------------------------------------------

	it("disables Save and shows loop error when sourcePath is inside the vault root", async () => {
		editor.renderForCreate(container, vi.fn());

		// Fill everything valid first, then set source to the vault root
		await fillValidForm(container);

		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourcePath"]',
		)!;
		srcInput.value = VAULT_ROOT; // /Vault — the vault root itself
		srcInput.dispatchEvent(new Event("input"));

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(true);

		// Error message must reference "loop" or "vault-loop"
		const errorEl = container.querySelector('[data-role="scope-error"]');
		expect(errorEl?.textContent?.toLowerCase()).toMatch(/loop|vault/);
	});

	// -----------------------------------------------------------------------
	// T3.6.6 — Forbidden-path: destination = .obsidian → Save disabled
	// -----------------------------------------------------------------------

	it("disables Save and shows forbidden-path error when destination is .obsidian", async () => {
		editor.renderForCreate(container, vi.fn());

		await fillValidForm(container);

		const destInput = container.querySelector<HTMLInputElement>(
			'input[data-field="destinationVaultPath"]',
		)!;
		destInput.value = ".obsidian";
		destInput.dispatchEvent(new Event("input"));

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(true);

		const errorEl = container.querySelector('[data-role="scope-error"]');
		expect(errorEl?.textContent).toBeTruthy();
		// The scope error message from validateRuleAtSave for forbidden-path:
		// "resolves to vault root, Obsidian config dir, or plugin data dir"
		expect(errorEl?.textContent).toContain("resolves to vault root");
	});

	// -----------------------------------------------------------------------
	// T3.6.7 — Save with valid form: store + deviceStore called correctly
	// -----------------------------------------------------------------------

	it("clicking Save with valid form calls ruleStore.add, markCreatedHere, and onDone", async () => {
		const onDone = vi.fn();
		editor.renderForCreate(container, onDone);

		await fillValidForm(container);

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(false);

		saveBtn.click();
		// Flush async calls
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		// ruleStore.add called once with an ImportRule
		expect(deps.ruleStore.add).toHaveBeenCalledOnce();
		const addedRule = (deps.ruleStore.add as ReturnType<typeof vi.fn>).mock.calls[0][0] as ImportRule;
		expect(addedRule.direction).toBe("import");
		expect(addedRule.id).toBe(FIXED_ID);
		expect(addedRule.name).toBe("Voice Memos");
		expect(addedRule.sourcePath).toBe("/users/m/voice");
		expect(addedRule.destinationVaultPath).toBe("Inbox/voice");
		expect(addedRule.everyMinutes).toBe(5);

		// deviceStore.markCreatedHere called once with the rule id
		expect(deps.deviceStore.markCreatedHere).toHaveBeenCalledOnce();
		expect(deps.deviceStore.markCreatedHere).toHaveBeenCalledWith(FIXED_ID);

		// onDone called with the created rule
		expect(onDone).toHaveBeenCalledOnce();
		expect(onDone).toHaveBeenCalledWith(addedRule);
	});

	// -----------------------------------------------------------------------
	// T3.6.8 — Cancel: onDone(undefined) called, store NOT called
	// -----------------------------------------------------------------------

	it("clicking Cancel calls onDone(undefined) without persisting", () => {
		const onDone = vi.fn();
		editor.renderForCreate(container, onDone);

		const cancelBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="cancel"]',
		)!;
		expect(cancelBtn, "cancel button").toBeTruthy();

		cancelBtn.click();

		expect(onDone).toHaveBeenCalledOnce();
		expect(onDone).toHaveBeenCalledWith(undefined);
		expect(deps.ruleStore.add).not.toHaveBeenCalled();
		expect(deps.deviceStore.markCreatedHere).not.toHaveBeenCalled();
		expect(deps.deviceStore.setEnabled).not.toHaveBeenCalled();
	});

	// -----------------------------------------------------------------------
	// T3.6.9 — renderForEdit pre-populates all fields
	// -----------------------------------------------------------------------

	it("renderForEdit pre-populates all form fields with the existing rule's values", () => {
		editor.renderForEdit(container, EXISTING_RULE, vi.fn());

		const nameInput = container.querySelector<HTMLInputElement>(
			'input[data-field="name"]',
		)!;
		expect(nameInput.value).toBe(EXISTING_RULE.name);

		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourcePath"]',
		)!;
		expect(srcInput.value).toBe(EXISTING_RULE.sourcePath);

		const destInput = container.querySelector<HTMLInputElement>(
			'input[data-field="destinationVaultPath"]',
		)!;
		expect(destInput.value).toBe(EXISTING_RULE.destinationVaultPath);

		const everyInput = container.querySelector<HTMLInputElement>(
			'input[data-field="everyMinutes"]',
		)!;
		expect(everyInput.value).toBe(String(EXISTING_RULE.everyMinutes));

		const actionSel = container.querySelector<HTMLSelectElement>(
			'select[data-field="action"]',
		)!;
		expect(actionSel.value).toBe(EXISTING_RULE.action);

		const collisionSel = container.querySelector<HTMLSelectElement>(
			'select[data-field="onCollision"]',
		)!;
		expect(collisionSel.value).toBe(EXISTING_RULE.onCollision);

		const flattenToggle = container.querySelector<HTMLElement>(
			'[role="switch"][data-field="flattenOnTarget"]',
		)!;
		expect(flattenToggle.getAttribute("aria-checked")).toBe(
			String(EXISTING_RULE.flattenOnTarget),
		);

		const dryRunToggle = container.querySelector<HTMLElement>(
			'[role="switch"][data-field="dryRun"]',
		)!;
		expect(dryRunToggle.getAttribute("aria-checked")).toBe(
			String(EXISTING_RULE.dryRun),
		);
	});

	// -----------------------------------------------------------------------
	// T3.6.11 — validateRule failures: Save disabled AND inline error shown
	// -----------------------------------------------------------------------

	it("shows inline field error in errorDiv when validateRule rejects (empty name)", async () => {
		editor.renderForCreate(container, vi.fn());

		// Fill all fields valid except name (leave empty — triggers validateRule failure)
		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourcePath"]',
		)!;
		srcInput.value = "/users/m/voice";
		srcInput.dispatchEvent(new Event("input"));

		const destInput = container.querySelector<HTMLInputElement>(
			'input[data-field="destinationVaultPath"]',
		)!;
		destInput.value = "Inbox/voice";
		destInput.dispatchEvent(new Event("input"));

		const everyInput = container.querySelector<HTMLInputElement>(
			'input[data-field="everyMinutes"]',
		)!;
		everyInput.value = "5";
		everyInput.dispatchEvent(new Event("input"));

		// Name is left empty — validateRule should reject with a "name" error

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(true);

		const errorEl = container.querySelector<HTMLElement>('[data-role="scope-error"]')!;
		// The errorDiv must NOT be empty — it must show the validateRule error
		expect(errorEl.textContent).toBeTruthy();
		// The error message must reference the "name" field
		expect(errorEl.textContent).toMatch(/name/i);
	});

	// -----------------------------------------------------------------------
	// T3.6.10 — Edit-mode Save: update called, NOT add; markCreatedHere NOT called
	// -----------------------------------------------------------------------

	it("edit-mode Save calls ruleStore.update (not add), skips markCreatedHere, calls onDone", async () => {
		const onDone = vi.fn();
		editor.renderForEdit(container, EXISTING_RULE, onDone);

		// The existing rule pre-populates all fields with valid data, so Save
		// should be enabled immediately. Trigger a re-validation by re-dispatching
		// input events on the name field.
		const nameInput = container.querySelector<HTMLInputElement>(
			'input[data-field="name"]',
		)!;
		nameInput.dispatchEvent(new Event("input"));

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		// Allow a tick for any async validation
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(saveBtn.disabled).toBe(false);

		saveBtn.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		// update called, NOT add
		expect(deps.ruleStore.update).toHaveBeenCalledOnce();
		expect(deps.ruleStore.add).not.toHaveBeenCalled();

		// markCreatedHere NOT called in edit mode
		expect(deps.deviceStore.markCreatedHere).not.toHaveBeenCalled();

		// onDone called with the updated rule
		expect(onDone).toHaveBeenCalledOnce();
		const [updatedRule] = (onDone as ReturnType<typeof vi.fn>).mock.calls[0] as [ImportRule];
		expect(updatedRule).toBeDefined();
		expect(updatedRule.id).toBe(EXISTING_RULE.id);
	});
	// -----------------------------------------------------------------------
	// Regression: a doubled separator in the source path must not survive Save.
	// realpath() collapses it, and the run-time scope guard compares the
	// resolved path against the stored one as strings — so an un-normalized
	// path was reported as an escape from its own source root (forbidden-path).
	// -----------------------------------------------------------------------

	it("canonicalizes the source path before persisting it", async () => {
		const onDone = vi.fn();
		editor.renderForCreate(container, onDone);

		await fillValidForm(container);

		const srcInput = container.querySelector<HTMLInputElement>(
			'input[data-field="sourcePath"]',
		)!;
		srcInput.value = "/users/m//voice/memos/";
		srcInput.dispatchEvent(new Event("input"));

		const saveBtn = container.querySelector<HTMLButtonElement>(
			'button[data-action="save"]',
		)!;
		expect(saveBtn.disabled).toBe(false);

		saveBtn.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		const addedRule = (deps.ruleStore.add as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ImportRule;
		expect(addedRule.sourcePath).toBe("/users/m/voice/memos");
	});
});
