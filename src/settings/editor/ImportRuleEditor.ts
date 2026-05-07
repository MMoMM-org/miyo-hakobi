// Inline editor for ImportRule (T3.6).
//
// WHY this file exists: per ADR-10 the editor renders into the SAME subtab
// body element rather than a Modal, keeping the UX lightweight for v0.1.
//
// The `chooseFsFolder` seam exists so tests don't need to mock Electron; in
// production the caller wires `dialog.showOpenDialog` behind this slot.
//
// Validation runs on every input change. The Save button is enabled iff
// BOTH `validateRule(...)` AND `scope.validateRuleAtSave(...)` succeed.
// Scope violations (vault-loop, forbidden-path, traversal) are shown in a
// dedicated error block so the user understands why Save is blocked.
//
// Refs: PRD/F1, SDD/UI Visualization Guide (Import subtab), ADR-5, ADR-7,
//       ADR-10.

import { Setting } from "obsidian";
import { validateRule } from "../../domain/rule";
import { validateRuleAtSave } from "../../domain/scope";
import { expandUserPath } from "../../fs/PathSafe";
import type { ImportRule, Rule } from "../../domain/rule";
import type { RuleId } from "../../domain/ruleId";

// ---------------------------------------------------------------------------
// Dep interfaces — structurally typed so tests can inject simple fakes
// ---------------------------------------------------------------------------

export interface ImportRuleEditorDeps {
	ruleStore: {
		add(rule: Rule): Promise<Rule[]>;
		update(id: RuleId, partial: Partial<ImportRule>): Promise<Rule[]>;
	};
	deviceStore: {
		setEnabled(ruleId: RuleId, enabled: boolean): Promise<void>;
		markCreatedHere(ruleId: RuleId): Promise<void>;
	};
	/** app.vault.adapter.getBasePath() in production */
	vaultRoot: string;
	/** .obsidian/plugins/miyo-hakobi */
	pluginDir: string;
	/**
	 * OS folder picker seam. Defaults to a stub that resolves to undefined so
	 * the editor degrades gracefully in environments without Electron.
	 * Production wires Electron's dialog.showOpenDialog behind this slot.
	 */
	chooseFsFolder?: () => Promise<string | undefined>;
	/**
	 * OS-style vault folder picker. Returns the chosen folder's vault-relative
	 * path (the vault root resolves to ""), or undefined if the user closed
	 * without choosing. Wired in main.ts to VaultFolderPickerModal.pick(...).
	 * When absent, the destination field is a plain text input — acceptable for
	 * environments without a modal harness (e.g. some unit tests).
	 */
	chooseVaultFolder?: () => Promise<string | undefined>;
	/**
	 * Injectable RuleId factory for deterministic tests. Defaults to
	 * crypto.randomUUID() per ADR-7.
	 */
	newRuleId?: () => RuleId;
}

// ---------------------------------------------------------------------------
// Internal form state
// ---------------------------------------------------------------------------

interface FormState {
	name: string;
	sourcePath: string;
	destinationVaultPath: string;
	everyMinutes: string;
	action: "copy" | "move";
	onCollision: "skip" | "suffix";
	flattenOnTarget: boolean;
	dryRun: boolean;
}

function emptyState(): FormState {
	return {
		name: "",
		sourcePath: "",
		destinationVaultPath: "",
		everyMinutes: "",
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
	};
}

function stateFromRule(rule: ImportRule): FormState {
	return {
		name: rule.name,
		sourcePath: rule.sourcePath,
		destinationVaultPath: rule.destinationVaultPath,
		everyMinutes: String(rule.everyMinutes),
		action: rule.action,
		onCollision: rule.onCollision,
		flattenOnTarget: rule.flattenOnTarget,
		dryRun: rule.dryRun,
	};
}

// ---------------------------------------------------------------------------
// ImportRuleEditor
// ---------------------------------------------------------------------------

export class ImportRuleEditor {
	private readonly deps: ImportRuleEditorDeps;
	private readonly chooseFsFolder: () => Promise<string | undefined>;
	private readonly newRuleId: () => RuleId;

	constructor(deps: ImportRuleEditorDeps) {
		this.deps = deps;
		this.chooseFsFolder = deps.chooseFsFolder ?? (() => Promise.resolve(undefined));
		this.newRuleId = deps.newRuleId ?? (() => crypto.randomUUID() as RuleId);
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/** Render a blank form for creating a new ImportRule. */
	renderForCreate(
		containerEl: HTMLElement,
		onDone: (created: Rule | undefined) => void,
	): void {
		this._render(containerEl, null, onDone);
	}

	/** Render a pre-populated form for editing an existing ImportRule. */
	renderForEdit(
		containerEl: HTMLElement,
		rule: ImportRule,
		onDone: (updated: Rule | undefined) => void,
	): void {
		this._render(containerEl, rule, onDone);
	}

	// -------------------------------------------------------------------------
	// Private render logic
	// -------------------------------------------------------------------------

	private _render(
		containerEl: HTMLElement,
		existingRule: ImportRule | null,
		onDone: (result: Rule | undefined) => void,
	): void {
		const state: FormState =
			existingRule !== null ? stateFromRule(existingRule) : emptyState();

		// Error display element — lives below the form, above the action buttons.
		// We create it early so validation can reference it.
		const errorDiv = containerEl.ownerDocument.createElement("div");
		errorDiv.setAttribute("data-role", "scope-error");
		errorDiv.classList.add("hakobi-editor-error");

		let saveBtn: HTMLButtonElement | null = null;

		/** Re-validate the current state and update the Save button + error block. */
		const revalidate = (): void => {
			const minutes = parseInt(state.everyMinutes, 10);

			// Expand the source path before passing to validateRule
			const expandResult = expandUserPath(state.sourcePath);
			const resolvedSourcePath = expandResult.ok
				? expandResult.value
				: state.sourcePath;

			const candidate = {
				id: existingRule?.id ?? "placeholder-id",
				direction: "import" as const,
				name: state.name,
				everyMinutes: isNaN(minutes) ? 0 : minutes,
				action: state.action,
				onCollision: state.onCollision,
				flattenOnTarget: state.flattenOnTarget,
				dryRun: state.dryRun,
				sourcePath: resolvedSourcePath,
				destinationVaultPath: state.destinationVaultPath,
			};

			const ruleResult = validateRule(candidate);

			if (!ruleResult.ok) {
				if (saveBtn) saveBtn.disabled = true;
				const firstError = ruleResult.errors[0];
				errorDiv.textContent = firstError
					? `${firstError.path}: ${firstError.message}`
					: "Rule is invalid";
				return;
			}

			const scopeResult = validateRuleAtSave(
				ruleResult.value,
				this.deps.vaultRoot,
				this.deps.pluginDir,
			);

			if (!scopeResult.ok) {
				if (saveBtn) saveBtn.disabled = true;
				errorDiv.textContent =
					scopeResult.errors.detail ??
					scopeResult.errors.reason;
				return;
			}

			// All good
			errorDiv.textContent = "";
			if (saveBtn) saveBtn.disabled = false;
		};

		// --- Field: Name ---
		new Setting(containerEl)
			.setName("Name")
			.setDesc("Descriptive name for this rule.")
			.addText((text) => {
				const input = text.inputEl;
				input.setAttribute("data-field", "name");
				text.setValue(state.name);
				text.onChange((value) => {
					state.name = value;
					revalidate();
				});
			});

		// --- Field: Source path (FS) + Browse button ---
		new Setting(containerEl)
			.setName("Source path")
			.setDesc("Absolute path on your filesystem. ~ and $home are expanded.")
			.addText((text) => {
				const input = text.inputEl;
				input.setAttribute("data-field", "sourcePath");
				text.setValue(state.sourcePath);
				text.onChange((value) => {
					state.sourcePath = value;
					revalidate();
				});
			})
			.addButton((btn) => {
				btn.buttonEl.setAttribute("data-action", "browse-source");
				btn.setButtonText("Browse…").onClick(() => {
					void this.chooseFsFolder().then((chosen) => {
						if (chosen === undefined) return;
						state.sourcePath = chosen;
						// Find the source input and update its displayed value
						const srcInput = containerEl.querySelector<HTMLInputElement>(
							'input[data-field="sourcePath"]',
						);
						if (srcInput) {
							srcInput.value = chosen;
							srcInput.dispatchEvent(new Event("input"));
						}
						revalidate();
					});
				});
			});

		// --- Field: Destination (vault-relative) + Pick button ---
		new Setting(containerEl)
			.setName("Destination in vault")
			.setDesc("Vault-relative folder path (e.g. Inbox/voice).")
			.addText((text) => {
				const input = text.inputEl;
				input.setAttribute("data-field", "destinationVaultPath");
				text.setValue(state.destinationVaultPath);
				text.onChange((value) => {
					state.destinationVaultPath = value;
					revalidate();
				});
			})
			.addButton((btn) => {
				btn.buttonEl.setAttribute("data-action", "pick-destination");
				btn.setButtonText("Pick").onClick(() => {
					const picker = this.deps.chooseVaultFolder;
					if (picker === undefined) return;
					void picker().then((chosen) => {
						if (chosen === undefined) return;
						state.destinationVaultPath = chosen;
						const destInput = containerEl.querySelector<HTMLInputElement>(
							'input[data-field="destinationVaultPath"]',
						);
						if (destInput) {
							destInput.value = chosen;
							destInput.dispatchEvent(new Event("input"));
						}
						revalidate();
					});
				});
			});

		// --- Field: Run every (minutes) ---
		new Setting(containerEl)
			.setName("Run every (minutes)")
			.setDesc("Minimum interval between automatic runs. Integer ≥ 1.")
			.addText((text) => {
				const input = text.inputEl;
				input.setAttribute("data-field", "everyMinutes");
				input.type = "number";
				input.min = "1";
				input.step = "1";
				text.setValue(state.everyMinutes);
				text.onChange((value) => {
					state.everyMinutes = value;
					revalidate();
				});
			});

		// --- Field: Action ---
		new Setting(containerEl)
			.setName("Action")
			.setDesc("Whether to copy or move files from source to vault.")
			.addDropdown((dd) => {
				dd.selectEl.setAttribute("data-field", "action");
				dd.addOption("copy", "Copy")
					.addOption("move", "Move")
					.setValue(state.action)
					.onChange((value) => {
						state.action = value as "copy" | "move";
						revalidate();
					});
			});

		// --- Field: On collision ---
		new Setting(containerEl)
			.setName("On collision")
			.setDesc("What to do when a file with the same name already exists in the vault.")
			.addDropdown((dd) => {
				dd.selectEl.setAttribute("data-field", "onCollision");
				dd.addOption("skip", "Skip")
					.addOption("suffix", "Add suffix")
					.setValue(state.onCollision)
					.onChange((value) => {
						state.onCollision = value as "skip" | "suffix";
						revalidate();
					});
			});

		// --- Field: Flatten on target ---
		new Setting(containerEl)
			.setName("Flatten on target")
			.setDesc("Place all files directly in the destination folder (ignores subdirectory structure).")
			.addToggle((toggle) => {
				toggle.toggleEl.setAttribute("data-field", "flattenOnTarget");
				toggle.setValue(state.flattenOnTarget).onChange((value) => {
					state.flattenOnTarget = value;
					revalidate();
				});
			});

		// --- Field: Dry run ---
		new Setting(containerEl)
			.setName("Dry run")
			.setDesc("Log what would happen without actually moving files.")
			.addToggle((toggle) => {
				toggle.toggleEl.setAttribute("data-field", "dryRun");
				toggle.setValue(state.dryRun).onChange((value) => {
					state.dryRun = value;
					revalidate();
				});
			});

		// --- Error block ---
		containerEl.appendChild(errorDiv);

		// --- Action buttons: Save + Cancel ---
		const actionsEl = containerEl.ownerDocument.createElement("div");
		actionsEl.setAttribute("data-role", "editor-actions");

		// Save button
		const saveSetting = new Setting(actionsEl)
			.addButton((btn) => {
				btn.buttonEl.setAttribute("data-action", "save");
				btn.setButtonText(existingRule !== null ? "Update" : "Save")
					.setCta()
					.onClick(() => {
						void this._save(state, existingRule, containerEl, onDone);
					});
				saveBtn = btn.buttonEl;
				saveBtn.disabled = true; // start disabled — revalidate() will enable
			});

		// Cancel button — inline in same Setting row
		saveSetting.addButton((btn) => {
			btn.buttonEl.setAttribute("data-action", "cancel");
			btn.setButtonText("Cancel").onClick(() => {
				onDone(undefined);
			});
		});

		containerEl.appendChild(actionsEl);

		// Run initial validation (needed for edit mode where fields are pre-filled)
		revalidate();
	}

	// -------------------------------------------------------------------------
	// Save flow
	// -------------------------------------------------------------------------

	private async _save(
		state: FormState,
		existingRule: ImportRule | null,
		_containerEl: HTMLElement,
		onDone: (result: Rule | undefined) => void,
	): Promise<void> {
		const minutes = parseInt(state.everyMinutes, 10);

		const expandResult = expandUserPath(state.sourcePath);
		const resolvedSourcePath = expandResult.ok
			? expandResult.value
			: state.sourcePath;

		if (existingRule === null) {
			// Create flow
			const id = this.newRuleId();
			const rule: ImportRule = {
				id,
				direction: "import",
				name: state.name,
				everyMinutes: isNaN(minutes) ? 1 : minutes,
				action: state.action,
				onCollision: state.onCollision,
				flattenOnTarget: state.flattenOnTarget,
				dryRun: state.dryRun,
				sourcePath: resolvedSourcePath as ImportRule["sourcePath"],
				destinationVaultPath:
					state.destinationVaultPath as ImportRule["destinationVaultPath"],
			};
			await this.deps.ruleStore.add(rule);
			await this.deps.deviceStore.markCreatedHere(id);
			onDone(rule);
		} else {
			// Edit flow
			const partial: Partial<ImportRule> = {
				name: state.name,
				everyMinutes: isNaN(minutes) ? existingRule.everyMinutes : minutes,
				action: state.action,
				onCollision: state.onCollision,
				flattenOnTarget: state.flattenOnTarget,
				dryRun: state.dryRun,
				sourcePath: resolvedSourcePath as ImportRule["sourcePath"],
				destinationVaultPath:
					state.destinationVaultPath as ImportRule["destinationVaultPath"],
			};
			await this.deps.ruleStore.update(existingRule.id, partial);
			const updated: ImportRule = { ...existingRule, ...partial };
			onDone(updated);
		}
	}
}
