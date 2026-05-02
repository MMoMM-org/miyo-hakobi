// VaultFolderPickerModal — Obsidian FuzzySuggestModal subclass for vault folder selection.
//
// WHY this file exists:
// ImportRuleEditor's "Destination vault folder" field and ExportRuleEditor's
// "Source vault folder" field need a folder picker so the user does not have
// to type vault-relative paths by hand. This module is the concrete production
// implementation of the `chooseVaultFolder` seam — a thin Promise-returning
// wrapper around Obsidian's FuzzySuggestModal that lists every TFolder in the
// vault (root included). The seam stays generic so unit tests can keep
// injecting a vi.fn() instead of spinning up a real modal.
//
// Resolution semantics:
//   - User picks a folder → resolves with `folder.path`. The vault root has
//     `path === ""` per Obsidian's contract; callers should treat the empty
//     string as "the vault root".
//   - User closes the modal without picking (Esc, click-outside) → undefined.
//   - The promise resolves exactly once; defensive guard against double-fire.
//
// The vault root is displayed as "/" so it is visually selectable in the
// fuzzy list, but the resolved value remains the empty string so it round-
// trips through the rule schema unchanged.

import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class VaultFolderPickerModal extends FuzzySuggestModal<TFolder> {
	private readonly folders: TFolder[];
	private readonly resolveFn: (folderPath: string | undefined) => void;
	private resolved = false;

	/**
	 * Convenience factory: enumerate vault folders, build the modal, open it,
	 * and return a Promise that resolves with the chosen folder's vault-
	 * relative path (or undefined on cancel).
	 */
	static pick(
		app: App,
		placeholder?: string,
	): Promise<string | undefined> {
		const folders = app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder);
		return new Promise((resolve) => {
			const modal = new VaultFolderPickerModal(app, folders, resolve);
			if (placeholder !== undefined) modal.setPlaceholder(placeholder);
			modal.open();
		});
	}

	constructor(
		app: App,
		folders: TFolder[],
		resolve: (folderPath: string | undefined) => void,
	) {
		super(app);
		this.folders = folders;
		this.resolveFn = resolve;
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		// Obsidian represents the vault root as a TFolder with path === "".
		// Display "/" so the root is visually selectable in the fuzzy list.
		return folder.path === "" ? "/" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		if (this.resolved) return;
		this.resolved = true;
		// Schema convention: vault root is the empty string, not "/".
		this.resolveFn(folder.path);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			this.resolved = true;
			this.resolveFn(undefined);
		}
	}
}
