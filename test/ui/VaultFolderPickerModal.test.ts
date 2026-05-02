// VaultFolderPickerModal.test.ts — unit tests for the production vault-folder picker.
//
// Verifies the FuzzySuggestModal contract surface ImportRuleEditor and
// ExportRuleEditor depend on via the chooseVaultFolder seam:
//   - getItems() returns the supplied folders verbatim
//   - getItemText(folder) returns folder.path, with the vault root rendered as "/"
//   - onChooseItem(folder) resolves with folder.path (root → "" per schema)
//   - Closing without selection resolves with undefined
//   - The Promise resolves exactly once even if onClose fires after a pick
//   - .pick() factory enumerates vault folders, opens the modal, resolves on selection

import { describe, it, expect, vi } from "vitest";

import { App, TFolder, TFile } from "obsidian";

import { VaultFolderPickerModal } from "../../src/ui/VaultFolderPickerModal";

function makeFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path === "" ? "" : path.split("/").pop()!;
	return folder;
}

describe("VaultFolderPickerModal", () => {
	it("getItems() returns the supplied folders verbatim", () => {
		const app = new App();
		const folders = [makeFolder("Inbox"), makeFolder("Inbox/Voice")];
		const modal = new VaultFolderPickerModal(app, folders, () => {});
		expect(modal.getItems()).toEqual(folders);
	});

	it("getItemText(folder) returns folder.path", () => {
		const app = new App();
		const folder = makeFolder("Notes/Projects");
		const modal = new VaultFolderPickerModal(app, [folder], () => {});
		expect(modal.getItemText(folder)).toBe("Notes/Projects");
	});

	it("getItemText(rootFolder) returns '/' for the vault root (path === '')", () => {
		const app = new App();
		const root = makeFolder("");
		const modal = new VaultFolderPickerModal(app, [root], () => {});
		expect(modal.getItemText(root)).toBe("/");
	});

	it("onChooseItem(folder) resolves with folder.path", async () => {
		const app = new App();
		const a = makeFolder("Inbox");
		const b = makeFolder("Notes/Projects");

		const promise = new Promise<string | undefined>((resolve) => {
			const modal = new VaultFolderPickerModal(app, [a, b], resolve);
			modal.open();
			modal.onChooseItem(b);
		});

		await expect(promise).resolves.toBe("Notes/Projects");
	});

	it("onChooseItem(rootFolder) resolves with '' (schema convention, not '/')", async () => {
		const app = new App();
		const root = makeFolder("");

		const promise = new Promise<string | undefined>((resolve) => {
			const modal = new VaultFolderPickerModal(app, [root], resolve);
			modal.open();
			modal.onChooseItem(root);
		});

		await expect(promise).resolves.toBe("");
	});

	it("closing without selection resolves with undefined", async () => {
		const app = new App();
		const folder = makeFolder("Inbox");

		const promise = new Promise<string | undefined>((resolve) => {
			const modal = new VaultFolderPickerModal(app, [folder], resolve);
			modal.open();
			modal.close(); // simulate user pressing Esc / clicking outside
		});

		await expect(promise).resolves.toBeUndefined();
	});

	it("resolves exactly once even when onClose fires after a pick", () => {
		const app = new App();
		const folder = makeFolder("Inbox");

		let resolveCount = 0;
		let lastValue: string | undefined;
		const modal = new VaultFolderPickerModal(app, [folder], (p) => {
			resolveCount += 1;
			lastValue = p;
		});
		modal.open();
		modal.onChooseItem(folder);
		modal.close(); // would resolve again without the dedupe guard
		expect(resolveCount).toBe(1);
		expect(lastValue).toBe("Inbox");
	});

	it(".pick() factory enumerates TFolders from app.vault and resolves on selection", async () => {
		const app = new App();

		// Mix folders and files — pick() must filter to TFolder only.
		const folderA = makeFolder("Inbox");
		const folderB = makeFolder("Notes/Projects");
		const file = new TFile();
		file.path = "Inbox/voice.m4a";
		vi.mocked(app.vault.getAllLoadedFiles).mockReturnValue([
			folderA,
			file,
			folderB,
		]);

		// Capture the modal instance the factory just constructed via setPlaceholder.
		let captured: VaultFolderPickerModal | undefined;
		const placeholderSpy = vi
			.spyOn(VaultFolderPickerModal.prototype, "setPlaceholder")
			.mockImplementation(function (
				this: VaultFolderPickerModal,
			): VaultFolderPickerModal {
				captured = this;
				return this;
			});

		try {
			const promise = VaultFolderPickerModal.pick(app, "Pick a vault folder");
			expect(captured).toBeDefined();
			// Only folders should be listed — files filtered out.
			expect(captured!.getItems()).toEqual([folderA, folderB]);
			captured!.onChooseItem(folderB);
			await expect(promise).resolves.toBe("Notes/Projects");
		} finally {
			placeholderSpy.mockRestore();
		}
	});
});
