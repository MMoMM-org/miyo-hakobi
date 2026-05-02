// ExportRuleEditor — inline settings editor for ExportRule variants.
//
// WHY this file exists: renders the inline form for creating and editing
// ExportFolderRule, ExportTagRule, and ExportNoteRule entries inside the
// ExportSubtab. The source-type radio (folder | tag | note) swaps out the
// picker subsection, but never destroys the rest of the form — so the user's
// destination path, everyMinutes, action, onCollision, dryRun values are
// preserved when toggling source type. flattenOnTarget is visible for folder
// and tag types; it is hidden (but forced to false) for note type.
//
// Refs: PRD/F2, SDD/ADR-10, T3.7

import { Setting } from "obsidian";
import { validateRule } from "../../domain/rule";
import { validateRuleAtSave } from "../../domain/scope";
import { newRuleId } from "../../domain/ruleId";

import type {
	Rule,
	RuleId,
	ExportRule,
} from "../../types/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportSourceType = "folder" | "tag" | "note";

export interface ExportRuleEditorDeps {
	ruleStore: {
		add(rule: Rule): Promise<Rule[]>;
		update(id: RuleId, partial: Partial<ExportRule>): Promise<Rule[]>;
	};
	deviceStore: {
		setEnabled(ruleId: RuleId, enabled: boolean): Promise<void>;
		markCreatedHere(ruleId: RuleId): Promise<void>;
	};
	vaultRoot: string;
	pluginDir: string;
	/** Optional: opens an OS folder picker and returns the chosen path. */
	chooseFsFolder?: () => Promise<string | undefined>;
	/**
	 * Optional vault folder picker. Returns the chosen folder's vault-relative
	 * path (the vault root resolves to ""), or undefined if the user closed
	 * without choosing. Wired in main.ts to VaultFolderPickerModal.pick(...).
	 * When absent, the source-folder field is a plain text input — acceptable
	 * for environments without a modal harness (e.g. some unit tests).
	 */
	chooseVaultFolder?: () => Promise<string | undefined>;
	/** Optional: wires an Obsidian note-path suggester to a text input. */
	notePathSuggester?: (input: HTMLInputElement, currentValue: string) => void;
	/** Injectable rule-ID generator — defaults to newRuleId(). */
	newRuleId?: () => RuleId;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clear an Obsidian-augmented element, using the empty() helper when available.
 * empty() is a prototype method that reads `this`, so it must be invoked as a
 * method on the element — bare calls strip `this` and crash at runtime. */
function emptyEl(el: HTMLElement): void {
	const augmented = el as unknown as { empty?: () => void };
	if (typeof augmented.empty === "function") {
		augmented.empty();
	} else {
		while (el.firstChild) el.removeChild(el.firstChild);
	}
}

// ---------------------------------------------------------------------------
// ExportRuleEditor
// ---------------------------------------------------------------------------

export class ExportRuleEditor {
	private readonly deps: ExportRuleEditorDeps;

	constructor(deps: ExportRuleEditorDeps) {
		this.deps = deps;
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/** Render the create form into containerEl. onDone receives the created Rule
	 *  or undefined when the user cancels. */
	renderForCreate(
		containerEl: HTMLElement,
		onDone: (created: Rule | undefined) => void,
	): void {
		this._render(containerEl, undefined, onDone);
	}

	/** Render the edit form pre-populated with an existing ExportRule. onDone
	 *  receives the updated Rule or undefined when the user cancels. */
	renderForEdit(
		containerEl: HTMLElement,
		rule: ExportRule,
		onDone: (updated: Rule | undefined) => void,
	): void {
		this._render(containerEl, rule, onDone);
	}

	// -------------------------------------------------------------------------
	// Core render
	// -------------------------------------------------------------------------

	private _render(
		containerEl: HTMLElement,
		existing: ExportRule | undefined,
		onDone: (result: Rule | undefined) => void,
	): void {
		// -----------------------------------------------------------------------
		// Shared mutable form state — preserved across source-type switches.
		// -----------------------------------------------------------------------

		let name = existing?.name ?? "";
		let sourceType: ExportSourceType = existing?.sourceType ?? "folder";
		let destinationPath = existing?.destinationPath ?? "";
		let everyMinutes = existing?.everyMinutes ?? 30;
		let action: "copy" | "move" = existing?.action ?? "copy";
		let onCollision: "skip" | "suffix" = existing?.onCollision ?? "skip";
		let flattenOnTarget = existing?.flattenOnTarget ?? false;
		let dryRun = existing?.dryRun ?? false;

		// Source-type-specific state (preserved across switches so switching back
		// restores previously entered values without destroying them).
		let sourceVaultPath: string =
			existing?.sourceType === "folder" ? existing.sourceVaultPath : "";
		let tags: string =
			existing?.sourceType === "tag" ? existing.tags.join(", ") : "";
		let tagMatch: "any" | "all" =
			existing?.sourceType === "tag" ? existing.tagMatch : "any";
		let sourceVaultNotePath: string =
			existing?.sourceType === "note" ? existing.sourceVaultNotePath : "";

		// -----------------------------------------------------------------------
		// Save button ref — set once the button is built.
		// -----------------------------------------------------------------------

		let saveBtn: HTMLButtonElement | null = null;

		// -----------------------------------------------------------------------
		// Helper: build the candidate rule object and validate it. Returns the
		// validated Rule on success or null on validation failure.
		// -----------------------------------------------------------------------

		const buildCandidate = (): Rule | null => {
			const id = existing?.id ?? (this.deps.newRuleId ?? newRuleId)();

			const base = {
				id,
				name,
				everyMinutes,
				action,
				onCollision,
				// flattenOnTarget is always false for note source type (hidden in UI).
				flattenOnTarget: sourceType === "note" ? false : flattenOnTarget,
				dryRun,
				direction: "export" as const,
			};

			let candidate: unknown;

			if (sourceType === "folder") {
				candidate = {
					...base,
					sourceType: "folder" as const,
					sourceVaultPath,
					destinationPath,
				};
			} else if (sourceType === "tag") {
				const parsedTags = tags
					.split(",")
					.map((t) => t.trim())
					.filter((t) => t.length > 0);
				candidate = {
					...base,
					sourceType: "tag" as const,
					tags: parsedTags,
					tagMatch,
					destinationPath,
				};
			} else {
				candidate = {
					...base,
					sourceType: "note" as const,
					sourceVaultNotePath,
					destinationPath,
				};
			}

			const result = validateRule(candidate);
			if (!result.ok) return null;

			const scopeResult = validateRuleAtSave(result.value, this.deps.vaultRoot, this.deps.pluginDir);
			if (!scopeResult.ok) return null;

			return result.value;
		};

		// -----------------------------------------------------------------------
		// Helper: update Save button disabled state.
		// -----------------------------------------------------------------------

		const refreshSave = (): void => {
			if (saveBtn === null) return;
			saveBtn.disabled = buildCandidate() === null;
		};

		// -----------------------------------------------------------------------
		// Helper: render the picker subsection into a wrapper element.
		// The wrapper lives between the source-type row and the destination row
		// so switching source-type only replaces this section.
		// -----------------------------------------------------------------------

		const renderPickerSection = (pickerWrapper: HTMLElement): void => {
			emptyEl(pickerWrapper);

			if (sourceType === "folder") {
				let srcVaultInputEl: HTMLInputElement | undefined;
				new Setting(pickerWrapper)
					.setName("Source vault folder")
					.setDesc("Vault-relative path to export (e.g. Notes/projects).")
					.addText((text) => {
						srcVaultInputEl = text.inputEl;
						text.inputEl.setAttribute("data-field", "sourceVaultPath");
						text
							.setPlaceholder("Notes/projects")
							.setValue(sourceVaultPath)
							.onChange((v) => {
								sourceVaultPath = v;
								refreshSave();
							});
					})
					.addButton((btn) => {
						btn.buttonEl.setAttribute("data-action", "pick-source-vault");
						btn.setButtonText("Pick").onClick(async () => {
							if (!this.deps.chooseVaultFolder) return;
							const chosen = await this.deps.chooseVaultFolder();
							if (chosen === undefined) return;
							sourceVaultPath = chosen;
							if (srcVaultInputEl !== undefined) {
								srcVaultInputEl.value = chosen;
								srcVaultInputEl.dispatchEvent(new Event("input"));
							}
							refreshSave();
						});
					});
			} else if (sourceType === "tag") {
				new Setting(pickerWrapper)
					.setName("Tags")
					.setDesc("Comma-separated tags to export (each must start with #).")
					.addText((text) => {
						text
							.setPlaceholder("#Project, #work")
							.setValue(tags)
							.onChange((v) => {
								tags = v;
								refreshSave();
							});
					});

				new Setting(pickerWrapper)
					.setName("Tag match")
					.setDesc("Export notes matching any of the tags, or all of them.")
					.addDropdown((dd) => {
						dd.addOption("any", "Any")
							.addOption("all", "All")
							.setValue(tagMatch)
							.onChange((v) => {
								if (v === "any" || v === "all") tagMatch = v;
								refreshSave();
							});
					});
			} else {
				new Setting(pickerWrapper)
					.setName("Source note path")
					.setDesc("Vault-relative path to the note to export (e.g. Daily/2026-05-01.md).")
					.addText((text) => {
						text
							.setPlaceholder("daily/2026-05-01.md")
							.setValue(sourceVaultNotePath)
							.onChange((v) => {
								sourceVaultNotePath = v;
								refreshSave();
							});
						if (this.deps.notePathSuggester) {
							this.deps.notePathSuggester(text.inputEl, sourceVaultNotePath);
						}
					});
			}
		};

		// -----------------------------------------------------------------------
		// Helper: render or re-render the flattenOnTarget row.
		// Visible for folder and tag; removed for note.
		// -----------------------------------------------------------------------

		const renderFlattenSection = (flattenWrapper: HTMLElement): void => {
			emptyEl(flattenWrapper);

			if (sourceType === "note") return;

			new Setting(flattenWrapper)
				.setName("Flatten on target")
				.setDesc("Copy all files into a single destination folder (no subfolders).")
				.addToggle((toggle) => {
					toggle
						.setValue(flattenOnTarget)
						.onChange((v) => {
							flattenOnTarget = v;
							refreshSave();
						});
				});
		};

		// -----------------------------------------------------------------------
		// Build the form
		// -----------------------------------------------------------------------

		// 1. Name
		new Setting(containerEl)
			.setName("Name")
			.setDesc("A human-readable label for this rule.")
			.addText((text) => {
				text
					.setPlaceholder("My export rule")
					.setValue(name)
					.onChange((v) => {
						name = v;
						refreshSave();
					});
			});

		// 2. Source type
		new Setting(containerEl)
			.setName("Source type")
			.setDesc("What to export: a vault folder, notes with specific tags, or a single note.")
			.addDropdown((dd) => {
				dd.addOption("folder", "Vault folder")
					.addOption("tag", "By tag")
					.addOption("note", "Single note")
					.setValue(sourceType)
					.onChange((v) => {
						if (v === "folder" || v === "tag" || v === "note") sourceType = v;
						renderPickerSection(pickerWrapper);
						renderFlattenSection(flattenWrapper);
						refreshSave();
					});
			});

		// 3. Picker subsection wrapper — content replaced on source-type change.
		const pickerWrapper = containerEl.ownerDocument.createElement("div");
		containerEl.appendChild(pickerWrapper);
		renderPickerSection(pickerWrapper);

		// 4. Destination path (FS absolute) + Browse button.
		let destInputEl: HTMLInputElement | undefined;
		new Setting(containerEl)
			.setName("Destination path")
			.setDesc("Absolute filesystem path where files will be exported.")
			.addText((text) => {
				destInputEl = text.inputEl;
				text
					.setPlaceholder("/users/me/backup")
					.setValue(destinationPath)
					.onChange((v) => {
						destinationPath = v;
						refreshSave();
					});
			})
			.addButton((btn) => {
				btn.setButtonText("Browse…").onClick(async () => {
					if (!this.deps.chooseFsFolder) return;
					const chosen = await this.deps.chooseFsFolder();
					if (chosen !== undefined) {
						destinationPath = chosen;
						if (destInputEl !== undefined) {
							destInputEl.value = chosen;
							destInputEl.dispatchEvent(new Event("input"));
						}
						refreshSave();
					}
				});
			});

		// 5. Run every (minutes)
		new Setting(containerEl)
			.setName("Run every (minutes)")
			.setDesc("How often this rule runs automatically. Minimum: 1 minute.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setValue(String(everyMinutes))
					.onChange((v) => {
						const parsed = parseInt(v, 10);
						everyMinutes = isNaN(parsed) ? 0 : parsed;
						refreshSave();
					});
			});

		// 6. Action
		new Setting(containerEl)
			.setName("Action")
			.setDesc("Copy leaves the source file; move removes it after a successful transfer.")
			.addDropdown((dd) => {
				dd.addOption("copy", "Copy")
					.addOption("move", "Move")
					.setValue(action)
					.onChange((v) => {
						if (v === "copy" || v === "move") action = v;
						refreshSave();
					});
			});

		// 7. On collision
		new Setting(containerEl)
			.setName("On collision")
			.setDesc("What to do when a file with the same name already exists at the destination.")
			.addDropdown((dd) => {
				dd.addOption("skip", "Skip")
					.addOption("suffix", "Add suffix")
					.setValue(onCollision)
					.onChange((v) => {
						if (v === "skip" || v === "suffix") onCollision = v;
						refreshSave();
					});
			});

		// 8. Flatten on target (conditionally shown) — wrapper approach.
		const flattenWrapper = containerEl.ownerDocument.createElement("div");
		containerEl.appendChild(flattenWrapper);
		renderFlattenSection(flattenWrapper);

		// 9. Dry run
		new Setting(containerEl)
			.setName("Dry run")
			.setDesc("Simulate the transfer without writing any files.")
			.addToggle((toggle) => {
				toggle.setValue(dryRun).onChange((v) => {
					dryRun = v;
					refreshSave();
				});
			});

		// 10. Save + Cancel buttons
		const buttonSetting = new Setting(containerEl);

		buttonSetting.addButton((btn) => {
			saveBtn = btn.buttonEl;
			saveBtn.disabled = true;
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(async () => {
					const rule = buildCandidate();
					if (rule === null) return;

					if (existing !== undefined) {
						// Edit mode: merge the validated rule onto the existing id.
						// buildCandidate always returns an ExportRule in this editor.
						const updatedRule: ExportRule = { ...(rule as ExportRule), id: existing.id };
						const { id: _discardedId, ...partial } = updatedRule;
						void _discardedId;
						await this.deps.ruleStore.update(existing.id, partial);
						onDone(updatedRule);
					} else {
						// Create mode: persist and mark created on this device.
						await this.deps.ruleStore.add(rule);
						await this.deps.deviceStore.markCreatedHere(rule.id);
						onDone(rule);
					}
				});
		});

		buttonSetting.addButton((btn) => {
			btn.setButtonText("Cancel").onClick(() => {
				onDone(undefined);
			});
		});

		// Initial validation — sets Save disabled state correctly.
		refreshSave();
	}
}
