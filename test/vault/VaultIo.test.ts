// Tests for src/vault/VaultIo.ts — the single adapter that owns all in-vault
// I/O (T1.8). Each method must delegate to the Obsidian Vault / metadataCache /
// workspace API so the rest of Hakobi never reaches into Obsidian directly.
//
// Mocking strategy: the project-level `obsidian` alias points to the in-repo
// mock at test/__mocks__/obsidian.ts. We construct a fresh `App` per test, wire
// vi.mocked spies onto its methods, and assert both delegation and return
// values. No real Obsidian runtime is involved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	App,
	TFile,
	TFolder,
	createMockTFile,
	createMockCachedMetadata,
	getAllTags,
	type CachedMetadata,
} from "obsidian";
import { VaultIo, VaultIoError } from "../../src/vault/VaultIo";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TFolder with the given path and optional children. */
function makeFolder(path: string, children: (TFile | TFolder)[] = []): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	folder.children = children;
	return folder;
}

beforeEach(() => {
	vi.mocked(getAllTags).mockReset();
});

// ---------------------------------------------------------------------------
// Construction + DI
// ---------------------------------------------------------------------------

describe("VaultIo — construction", () => {
	it("exposes the seven required methods", () => {
		const app = new App();
		const io = new VaultIo(app);
		expect(typeof io.readBinary).toBe("function");
		expect(typeof io.writeBinary).toBe("function");
		expect(typeof io.existsAtVaultPath).toBe("function");
		expect(typeof io.listFolder).toBe("function");
		expect(typeof io.notesByTag).toBe("function");
		expect(typeof io.getActiveFile).toBe("function");
		expect(typeof io.ensureFolder).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// readBinary
// ---------------------------------------------------------------------------

describe("VaultIo — readBinary", () => {
	it("resolves the path through getFileByPath and delegates to vault.readBinary", async () => {
		const app = new App();
		const file = createMockTFile({ path: "media/clip.mp3" });
		const buf = new ArrayBuffer(8);
		vi.mocked(app.vault.getFileByPath).mockReturnValueOnce(file);
		vi.mocked(app.vault.readBinary).mockResolvedValueOnce(buf);

		const io = new VaultIo(app);
		const out = await io.readBinary("media/clip.mp3");

		expect(out).toBe(buf);
		expect(app.vault.getFileByPath).toHaveBeenCalledWith("media/clip.mp3");
		// readBinary must receive the resolved TFile, not the path string.
		expect(app.vault.readBinary).toHaveBeenCalledWith(file);
	});

	it("throws VaultIoError(kind='not-found') when getFileByPath returns null", async () => {
		const app = new App();
		vi.mocked(app.vault.getFileByPath).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		try {
			await io.readBinary("missing.md");
			throw new Error("expected VaultIoError");
		} catch (e) {
			expect(e).toBeInstanceOf(VaultIoError);
			expect((e as VaultIoError).kind).toBe("not-found");
			expect((e as VaultIoError).path).toBe("missing.md");
		}
		expect(app.vault.readBinary).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// writeBinary
// ---------------------------------------------------------------------------

describe("VaultIo — writeBinary", () => {
	it("modifyBinary on the existing TFile when the path resolves to one", async () => {
		const app = new App();
		const file = createMockTFile({ path: "media/clip.mp3" });
		const bytes = new ArrayBuffer(16);
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(file);

		const io = new VaultIo(app);
		await io.writeBinary("media/clip.mp3", bytes);

		expect(app.vault.modifyBinary).toHaveBeenCalledWith(file, bytes);
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("createBinary when no file exists at the target path", async () => {
		const app = new App();
		const bytes = new ArrayBuffer(16);
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		await io.writeBinary("media/new.mp3", bytes);

		expect(app.vault.createBinary).toHaveBeenCalledWith("media/new.mp3", bytes);
		expect(app.vault.modifyBinary).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// existsAtVaultPath
// ---------------------------------------------------------------------------

describe("VaultIo — existsAtVaultPath", () => {
	it("returns true when getAbstractFileByPath returns a TFile", () => {
		const app = new App();
		const file = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(file);

		const io = new VaultIo(app);
		expect(io.existsAtVaultPath("n.md")).toBe(true);
	});

	it("returns true when getAbstractFileByPath returns a TFolder", () => {
		const app = new App();
		const folder = makeFolder("subdir");
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(folder);

		const io = new VaultIo(app);
		expect(io.existsAtVaultPath("subdir")).toBe(true);
	});

	it("returns false when getAbstractFileByPath returns null", () => {
		const app = new App();
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		expect(io.existsAtVaultPath("missing")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// listFolder
// ---------------------------------------------------------------------------

describe("VaultIo — listFolder", () => {
	it("throws VaultIoError(kind='not-folder') when path resolves to nothing", async () => {
		const app = new App();
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		await expect(io.listFolder("missing", { recursive: false })).rejects.toBeInstanceOf(
			VaultIoError,
		);
	});

	it("throws VaultIoError(kind='not-folder') when path resolves to a TFile", async () => {
		const app = new App();
		const file = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(file);

		const io = new VaultIo(app);
		try {
			await io.listFolder("n.md", { recursive: false });
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VaultIoError);
			expect((e as VaultIoError).kind).toBe("not-folder");
		}
	});

	it("non-recursive: returns immediate TFile children only (skips sub-folders)", async () => {
		const app = new App();
		const a = createMockTFile({ path: "root/a.md" });
		const b = createMockTFile({ path: "root/b.md" });
		const sub = makeFolder("root/sub", [createMockTFile({ path: "root/sub/c.md" })]);
		const root = makeFolder("root", [a, b, sub]);
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(root);

		const io = new VaultIo(app);
		const out = await io.listFolder("root", { recursive: false });

		expect(out).toEqual([a, b]);
	});

	it("recursive: walks the folder tree and returns ALL TFile descendants", async () => {
		const app = new App();
		const c = createMockTFile({ path: "root/sub/c.md" });
		const d = createMockTFile({ path: "root/sub/deep/d.md" });
		const deep = makeFolder("root/sub/deep", [d]);
		const sub = makeFolder("root/sub", [c, deep]);
		const a = createMockTFile({ path: "root/a.md" });
		const root = makeFolder("root", [a, sub]);
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(root);

		const io = new VaultIo(app);
		const out = await io.listFolder("root", { recursive: true });

		// Order is a depth-first walk; we don't pin it but require the set.
		expect(new Set(out)).toEqual(new Set([a, c, d]));
	});
});

// ---------------------------------------------------------------------------
// notesByTag
// ---------------------------------------------------------------------------

describe("VaultIo — notesByTag", () => {
	function tagsCache(tags: string[]): CachedMetadata {
		return createMockCachedMetadata({
			tags: tags.map((t) => ({ tag: t })),
		});
	}

	it("match='any' includes a file whose tag matches at least one rule tag", async () => {
		const app = new App();
		const file = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([file]);
		vi.mocked(app.metadataCache.getFileCache).mockImplementation(() => tagsCache(["#projects/foo"]));
		vi.mocked(getAllTags).mockImplementation((cache) => (cache.tags ?? []).map((t) => t.tag));

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#projects"], "any");

		expect(out).toEqual([file]);
		// Must traverse via getMarkdownFiles + getFileCache + getAllTags.
		expect(app.vault.getMarkdownFiles).toHaveBeenCalled();
		expect(app.metadataCache.getFileCache).toHaveBeenCalledWith(file);
	});

	it("ADR-11: rule tag '#projects' matches file tag '#projects/foo' (nested-tag inclusive)", async () => {
		const app = new App();
		const f = createMockTFile({ path: "p.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([f]);
		vi.mocked(app.metadataCache.getFileCache).mockImplementation(() =>
			tagsCache(["#projects/foo"]),
		);
		vi.mocked(getAllTags).mockImplementation((cache) => (cache.tags ?? []).map((t) => t.tag));

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#projects"], "any");

		expect(out).toEqual([f]);
	});

	it("match='all' rejects when one of the rule tags is not present", async () => {
		const app = new App();
		const f = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([f]);
		vi.mocked(app.metadataCache.getFileCache).mockImplementation(() =>
			tagsCache(["#projects/foo", "#other"]),
		);
		vi.mocked(getAllTags).mockImplementation((cache) => (cache.tags ?? []).map((t) => t.tag));

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#projects", "#thirdunused"], "all");

		expect(out).toEqual([]);
	});

	it("match='all' includes a file when every rule tag matches some file tag", async () => {
		const app = new App();
		const f = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([f]);
		vi.mocked(app.metadataCache.getFileCache).mockImplementation(() =>
			tagsCache(["#projects/foo", "#other"]),
		);
		vi.mocked(getAllTags).mockImplementation((cache) => (cache.tags ?? []).map((t) => t.tag));

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#projects", "#other"], "all");

		expect(out).toEqual([f]);
	});

	it("excludes files with no metadata cache (getFileCache returns null)", async () => {
		const app = new App();
		const f = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([f]);
		vi.mocked(app.metadataCache.getFileCache).mockReturnValueOnce(null);
		vi.mocked(getAllTags).mockImplementation((cache) => (cache.tags ?? []).map((t) => t.tag));

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#anything"], "any");

		expect(out).toEqual([]);
	});

	it("excludes files whose cache exists but has no tags", async () => {
		const app = new App();
		const f = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getMarkdownFiles).mockReturnValueOnce([f]);
		vi.mocked(app.metadataCache.getFileCache).mockImplementation(() => tagsCache([]));
		vi.mocked(getAllTags).mockImplementation(() => null);

		const io = new VaultIo(app);
		const out = await io.notesByTag(["#anything"], "any");

		expect(out).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// getActiveFile
// ---------------------------------------------------------------------------

describe("VaultIo — getActiveFile", () => {
	it("delegates to workspace.getActiveFile and returns the TFile when one is active", () => {
		const app = new App();
		const active = createMockTFile({ path: "open.md" });
		vi.mocked(app.workspace.getActiveFile).mockReturnValueOnce(active);

		const io = new VaultIo(app);
		expect(io.getActiveFile()).toBe(active);
		expect(app.workspace.getActiveFile).toHaveBeenCalled();
	});

	it("returns null when no file is active", () => {
		const app = new App();
		vi.mocked(app.workspace.getActiveFile).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		expect(io.getActiveFile()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// ensureFolder
// ---------------------------------------------------------------------------

describe("VaultIo — ensureFolder", () => {
	it("no-op when the folder already exists", async () => {
		const app = new App();
		const folder = makeFolder("Inbox");
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(folder);

		const io = new VaultIo(app);
		await io.ensureFolder("Inbox");

		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it("creates the folder when it does not exist", async () => {
		const app = new App();
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(null);

		const io = new VaultIo(app);
		await io.ensureFolder("New/Nested");

		expect(app.vault.createFolder).toHaveBeenCalledWith("New/Nested");
	});

	it("throws VaultIoError(kind='not-folder') when the path resolves to a TFile", async () => {
		const app = new App();
		const file = createMockTFile({ path: "n.md" });
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValueOnce(file);

		const io = new VaultIo(app);
		try {
			await io.ensureFolder("n.md");
			throw new Error("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VaultIoError);
			expect((e as VaultIoError).kind).toBe("not-folder");
		}
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});
});
