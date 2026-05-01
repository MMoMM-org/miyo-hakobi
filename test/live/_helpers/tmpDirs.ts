// tmpDirs — hermetic tmp directory helpers for live tests (T4.2).
//
// WHY this file exists:
// Vault-backed E2E tests need real disk paths for both the source tree (the
// "external" filesystem the rule reads from) and the Obsidian vault (the
// destination). All paths live under `<repo>/test/tmp/` (gitignored) and are
// removed via the returned `cleanup` callback regardless of test outcome.
//
// Each helper produces a unique subdirectory per call so parallel tests do
// not collide.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// _helpers → live → test → repo root
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const TMP_ROOT = path.join(REPO_ROOT, "test", "tmp");

/** Disposable tmp directory handle. */
export interface TmpDir {
	path: string;
	cleanup: () => Promise<void>;
}

async function ensureTmpRoot(): Promise<void> {
	await fs.mkdir(TMP_ROOT, { recursive: true });
}

/** Create a unique tmp directory under test/tmp/<prefix>-<uuid>/. */
async function mkTmpDir(prefix: string): Promise<TmpDir> {
	await ensureTmpRoot();
	const dir = path.join(TMP_ROOT, `${prefix}-${randomUUID()}`);
	await fs.mkdir(dir, { recursive: true });
	return {
		path: dir,
		cleanup: async () => {
			await fs.rm(dir, { recursive: true, force: true });
		},
	};
}

/**
 * A tmp directory representing an external filesystem location. Used as an
 * import source (rule reads from it) or an export destination (rule writes
 * into it) — the generic name fits both directions for T4.3 reuse.
 */
export async function mkTmpExternalDir(): Promise<TmpDir> {
	return mkTmpDir("external");
}

/** A tmp directory used as the Obsidian vault root. */
export async function mkTmpVault(): Promise<TmpDir> {
	return mkTmpDir("vault");
}

/**
 * Write a file under `dir` at `relPath` with the given utf-8 contents.
 * Sets mtime to `mtimeMs` if provided so tests can place files in the
 * "stable" window (mtime ≤ now − stabilityCheckMs).
 */
export async function writeFileAt(
	dir: string,
	relPath: string,
	contents: string,
	mtimeMs?: number,
): Promise<string> {
	const abs = path.join(dir, relPath);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, contents, "utf8");
	if (mtimeMs !== undefined) {
		const t = new Date(mtimeMs);
		await fs.utimes(abs, t, t);
	}
	return abs;
}

/** Return the contents of a file under `dir/relPath` as a UTF-8 string. */
export async function readFileAt(
	dir: string,
	relPath: string,
): Promise<string> {
	return fs.readFile(path.join(dir, relPath), "utf8");
}

/** True iff `dir/relPath` exists as a regular file. */
export async function fileExistsAt(
	dir: string,
	relPath: string,
): Promise<boolean> {
	try {
		const s = await fs.stat(path.join(dir, relPath));
		return s.isFile();
	} catch {
		return false;
	}
}
