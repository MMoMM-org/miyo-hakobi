// makeNodeApp — NodeFS-backed App for vault-backed live tests (T4.2).
//
// WHY this file exists:
// Live tests under `test/live/**` exercise HakobiPlugin against real disk I/O
// (tmp source dir + tmp vault dir) but DO NOT spin up an actual Obsidian
// runtime. We synthesize an `App`-shaped object whose `vault.adapter` and
// `vault` methods read/write the real filesystem under a configured vault
// root. The shape covers exactly the surface that production code calls:
//
//   adapter:
//     getBasePath()        — vault root absolute path
//     getFullPath(rel)     — adapter-relative → absolute
//     read/write/exists    — utf-8 string I/O at vault-relative path
//     rename/remove        — vault-relative path
//     stat                 — used by the obsidian mock; returns null
//
//   vault:
//     getAbstractFileByPath(p) — vault-relative; returns TFile | TFolder | null
//     getFileByPath(p)         — vault-relative; returns TFile | null
//     readBinary(file)         — returns ArrayBuffer
//     createBinary(p, bytes)   — write new file
//     modifyBinary(file, bytes)— overwrite existing file
//     createFolder(p)          — mkdir -p
//     getMarkdownFiles()       — lists all .md files (recursive)
//     getFiles()               — same, all files
//     delete(file)             — remove vault file (ExportRunner)
//
// We reuse the `TFile` and `TFolder` mock classes from `test/__mocks__/obsidian.ts`
// because VaultIo branches on `instanceof TFile` / `instanceof TFolder` — the
// classes returned by the adapter MUST be those exact constructors for the
// branches to fire correctly.

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { vi } from "vitest";
import { App, TFile, TFolder } from "obsidian";

// ---------------------------------------------------------------------------
// File handle materialization
// ---------------------------------------------------------------------------

/**
 * Pure constructor for a TFile from a vault-relative path and an `fs.Stats`-
 * shaped object. Centralized so sync (`getAbstractFileByPath`, `listAllFilesSync`)
 * and async (`materializeFile`) call sites do not diverge on the field shape
 * the rest of the test harness depends on. T4.3 (export E2E) reuses this.
 */
function buildTFile(
	vrel: string,
	name: string,
	stat: { ctimeMs: number; mtimeMs: number; size: number },
): TFile {
	const dot = name.lastIndexOf(".");
	const basename = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot + 1) : "";

	const tfile = new TFile();
	tfile.path = vrel;
	tfile.name = name;
	tfile.basename = basename;
	tfile.extension = extension;
	tfile.stat = {
		ctime: stat.ctimeMs,
		mtime: stat.mtimeMs,
		size: stat.size,
	};
	return tfile;
}

/**
 * Materialize a TFile instance whose `path`, `name`, `basename`, `extension`,
 * and `stat.mtime` reflect the on-disk file at `<vaultRoot>/<vrel>`. Returns
 * undefined if the path does not exist or is a directory.
 */
async function materializeFile(
	vaultRoot: string,
	vrel: string,
): Promise<TFile | undefined> {
	const abs = path.join(vaultRoot, vrel);
	let stat: import("node:fs").Stats;
	try {
		stat = await fs.stat(abs);
	} catch {
		return undefined;
	}
	if (!stat.isFile()) return undefined;

	const name = path.posix.basename(vrel);
	return buildTFile(vrel, name, stat);
}

/**
 * Materialize a TFolder instance for a directory at `<vaultRoot>/<vrel>`.
 * Returns undefined if the path does not exist or is a file.
 */
async function materializeFolder(
	vaultRoot: string,
	vrel: string,
): Promise<TFolder | undefined> {
	const abs = path.join(vaultRoot, vrel);
	let stat: import("node:fs").Stats;
	try {
		stat = await fs.stat(abs);
	} catch {
		return undefined;
	}
	if (!stat.isDirectory()) return undefined;

	const tfolder = new TFolder();
	tfolder.path = vrel;
	tfolder.name = path.posix.basename(vrel) || vrel;
	// `children` is materialized lazily by callers that need it; the v0.1
	// VaultIo paths used by ImportRunner do not consume it.
	return tfolder;
}

/** Best-effort sync probe: returns "file" | "folder" | null. */
function probeKind(absPath: string): "file" | "folder" | null {
	try {
		const s = fsSync.statSync(absPath);
		if (s.isFile()) return "file";
		if (s.isDirectory()) return "folder";
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// makeNodeApp
// ---------------------------------------------------------------------------

export interface NodeApp {
	app: App;
	vaultRoot: string;
}

/**
 * Build an `App`-shaped object whose vault and vault.adapter methods are backed
 * by `node:fs` rooted at `vaultRoot`. The directory at `vaultRoot` MUST exist
 * before the first call.
 */
export function makeNodeApp(vaultRoot: string): NodeApp {
	const app = new App();

	// Synchronous APIs that sniff disk shape — used by VaultIo on the hot path
	// (getAbstractFileByPath / getFileByPath). The Obsidian original is
	// synchronous because Obsidian keeps an in-memory index; here we hit
	// `statSync` instead. Acceptable for tests; the hot-path doesn't matter.
	const adapter = app.vault.adapter as unknown as Record<string, unknown>;

	adapter["getBasePath"] = vi.fn(() => vaultRoot);
	adapter["getFullPath"] = vi.fn((rel: string) => path.join(vaultRoot, rel));

	adapter["read"] = vi.fn(async (vrel: string): Promise<string> => {
		const abs = path.join(vaultRoot, vrel);
		return await fs.readFile(abs, "utf8");
	});

	adapter["write"] = vi.fn(async (vrel: string, data: string): Promise<void> => {
		const abs = path.join(vaultRoot, vrel);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, data, "utf8");
	});

	adapter["exists"] = vi.fn(async (vrel: string): Promise<boolean> => {
		const abs = path.join(vaultRoot, vrel);
		try {
			await fs.stat(abs);
			return true;
		} catch {
			return false;
		}
	});

	adapter["stat"] = vi.fn(async (vrel: string): Promise<unknown | null> => {
		const abs = path.join(vaultRoot, vrel);
		try {
			const s = await fs.stat(abs);
			return {
				type: s.isDirectory() ? "folder" : "file",
				ctime: s.ctimeMs,
				mtime: s.mtimeMs,
				size: s.size,
			};
		} catch {
			return null;
		}
	});

	adapter["rename"] = vi.fn(async (from: string, to: string): Promise<void> => {
		const fromAbs = path.join(vaultRoot, from);
		const toAbs = path.join(vaultRoot, to);
		await fs.mkdir(path.dirname(toAbs), { recursive: true });
		await fs.rename(fromAbs, toAbs);
	});

	adapter["remove"] = vi.fn(async (vrel: string): Promise<void> => {
		const abs = path.join(vaultRoot, vrel);
		await fs.unlink(abs);
	});

	// ----- vault-level helpers -----

	const vaultAny = app.vault as unknown as Record<string, unknown>;

	vaultAny["getAbstractFileByPath"] = vi.fn((vrel: string): TFile | TFolder | null => {
		// VaultIo calls this synchronously. We probe the disk synchronously.
		const abs = path.join(vaultRoot, vrel);
		const kind = probeKind(abs);
		if (kind === null) return null;
		if (kind === "file") {
			const s = fsSync.statSync(abs);
			return buildTFile(vrel, path.posix.basename(vrel), s);
		}
		const tfolder = new TFolder();
		tfolder.path = vrel;
		tfolder.name = path.posix.basename(vrel) || vrel;
		return tfolder;
	});

	vaultAny["getFileByPath"] = vi.fn((vrel: string): TFile | null => {
		const node = (app.vault as unknown as {
			getAbstractFileByPath(p: string): TFile | TFolder | null;
		}).getAbstractFileByPath(vrel);
		return node instanceof TFile ? node : null;
	});

	vaultAny["readBinary"] = vi.fn(async (file: TFile): Promise<ArrayBuffer> => {
		const abs = path.join(vaultRoot, file.path);
		const buf = await fs.readFile(abs);
		// Convert Buffer to a tightly-fitting ArrayBuffer slice.
		return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	});

	vaultAny["createBinary"] = vi.fn(async (vrel: string, data: ArrayBuffer): Promise<TFile> => {
		const abs = path.join(vaultRoot, vrel);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, Buffer.from(data));
		const file = await materializeFile(vaultRoot, vrel);
		// Fall back to a synthetic TFile if stat fails (shouldn't, just-written).
		return file ?? new TFile();
	});

	vaultAny["modifyBinary"] = vi.fn(async (file: TFile, data: ArrayBuffer): Promise<void> => {
		const abs = path.join(vaultRoot, file.path);
		await fs.writeFile(abs, Buffer.from(data));
	});

	vaultAny["createFolder"] = vi.fn(async (vrel: string): Promise<TFolder> => {
		const abs = path.join(vaultRoot, vrel);
		await fs.mkdir(abs, { recursive: true });
		const folder = await materializeFolder(vaultRoot, vrel);
		return folder ?? new TFolder();
	});

	// Recursive walk for getMarkdownFiles / getFiles. Synchronous because the
	// Obsidian originals are synchronous (in-memory index); fine for tests.
	function listAllFilesSync(filterExt?: string): TFile[] {
		const out: TFile[] = [];
		function walk(absDir: string, relDir: string): void {
			let entries: import("node:fs").Dirent[];
			try {
				entries = fsSync.readdirSync(absDir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const childAbs = path.join(absDir, e.name);
				const childRel = relDir === "" ? e.name : `${relDir}/${e.name}`;
				if (e.isDirectory()) {
					walk(childAbs, childRel);
				} else if (e.isFile()) {
					if (filterExt !== undefined && !e.name.endsWith(filterExt)) continue;
					const s = fsSync.statSync(childAbs);
					out.push(buildTFile(childRel, e.name, s));
				}
			}
		}
		walk(vaultRoot, "");
		return out;
	}

	vaultAny["getMarkdownFiles"] = vi.fn(() => listAllFilesSync(".md"));
	vaultAny["getFiles"] = vi.fn(() => listAllFilesSync());

	vaultAny["delete"] = vi.fn(async (file: TFile): Promise<void> => {
		const abs = path.join(vaultRoot, file.path);
		await fs.unlink(abs);
	});

	// metadataCache.getFileCache: live tests don't exercise tag matching here,
	// but ExportRunner tag rules would. Default to null cache; callers can
	// override on the returned `app` if needed.

	return { app, vaultRoot };
}
