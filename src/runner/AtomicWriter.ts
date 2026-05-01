// AtomicWriter — temp-then-rename helpers and the collision-suffix algorithm (T1.9).
//
// WHY this file exists:
// External FS writes (NodeFs) and in-vault writes (VaultIo) must never leave a
// half-written file visible to consumers. The pattern is the same for both:
// write to `<final>.tmp.<rand>`, then rename into place. On any failure the
// temp file is removed best-effort and the ORIGINAL error is re-thrown — the
// cleanup path must never mask the real cause. This is the standard solution
// per SDD/Cross-Cutting Concepts/System-Wide Patterns/Atomic write-temp-then-
// rename, and is what BR3 (no half-files in destination on simulated mid-write
// failure) requires.
//
// `resolveCollisionName` is the byte-for-byte reference implementation from
// SDD/Implementation Examples — kept verbatim because the traced walkthrough
// is the spec. It is fully pure (no FS dependency); the caller injects an
// `exists(path)` probe that wraps either NodeFs.lstat / VaultIo
// .existsAtVaultPath, so this helper can run against either side of the ferry.
//
// Design notes:
//  - All helpers are parameterized by adapter (DI). No raw `node:fs` or
//    `obsidian` imports here — that's the adapters' job.
//  - Random suffix uses crypto.randomUUID(), which is available in both Node
//    and the Electron renderer that hosts Obsidian; collisions on the same
//    final destination from concurrent calls are therefore astronomically
//    unlikely. The temp path is always a sibling of the final file (not a
//    process-wide tmpdir) so rename is same-volume on any reasonable layout.
//  - T2.6 ExportRunner addition: `writeFsBinaryAtomic` mirrors `writeFsAtomic`
//    but accepts an ArrayBuffer so ExportRunner can write vault note bytes to
//    the FS without going through a string encoding path that would corrupt
//    non-ASCII bytes. NodeFs.writeFileBinary (added in T2.6) is the backing
//    adapter method.

import type { NodeFs } from "../fs/NodeFs";
import type { VaultIo } from "../vault/VaultIo";

// ---------------------------------------------------------------------------
// resolveCollisionName — verbatim from SDD/Implementation Examples.
// MAX_SUFFIX_ATTEMPTS = 999 is a hard part of the contract: the traced
// walkthrough's "1000+ collisions → too-many-collisions" case bakes the value
// in as observable behaviour.
// ---------------------------------------------------------------------------

export const MAX_SUFFIX_ATTEMPTS = 999;

export async function resolveCollisionName(
	destinationDir: string,
	baseName: string,
	exists: (path: string) => Promise<boolean>,
): Promise<
	| { ok: true; finalName: string }
	| { ok: false; reason: "too-many-collisions" }
> {
	if (!(await exists(`${destinationDir}/${baseName}`))) {
		return { ok: true, finalName: baseName };
	}
	const dot = baseName.lastIndexOf(".");
	const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
	const ext = dot > 0 ? baseName.slice(dot) : "";
	for (let i = 1; i <= MAX_SUFFIX_ATTEMPTS; i++) {
		const candidate = `${stem}-${i}${ext}`;
		if (!(await exists(`${destinationDir}/${candidate}`))) {
			return { ok: true, finalName: candidate };
		}
	}
	return { ok: false, reason: "too-many-collisions" };
}

// ---------------------------------------------------------------------------
// writeFsAtomic — external FS write through NodeFs.
//
// NodeFs.writeFile only accepts string content in v0.1; the type follows the
// adapter rather than introducing a Buffer/Uint8Array surface that no caller
// uses yet. If a future task needs binary external writes, NodeFs grows a
// second method and this signature follows.
// ---------------------------------------------------------------------------

export async function writeFsAtomic(
	fs: NodeFs,
	path: string,
	data: string,
): Promise<void> {
	const tmp = `${path}.tmp.${randomToken()}`;
	try {
		await fs.writeFile(tmp, data);
		await fs.rename(tmp, path);
	} catch (err) {
		// Cleanup is best-effort. Swallow any unlink error so the original
		// failure is what surfaces — the user-actionable cause.
		try {
			await fs.unlink(tmp);
		} catch {
			// intentional
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// writeFsBinaryAtomic — external FS write for binary (ArrayBuffer) content.
//
// Added in T2.6 for ExportRunner: vault note bytes come out of Obsidian as
// ArrayBuffer; NodeFs.writeFileBinary preserves them byte-for-byte. The
// temp-then-rename pattern is identical to writeFsAtomic so no half-files
// land at the destination on failure.
// ---------------------------------------------------------------------------

export async function writeFsBinaryAtomic(
	fs: NodeFs,
	path: string,
	data: ArrayBuffer,
): Promise<void> {
	const tmp = `${path}.tmp.${randomToken()}`;
	try {
		await fs.writeFileBinary(tmp, data);
		await fs.rename(tmp, path);
	} catch (err) {
		try {
			await fs.unlink(tmp);
		} catch {
			// intentional — cleanup is best-effort
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// writeVaultAtomic — in-vault write through VaultIo.
//
// VaultIo.writeBinary takes ArrayBuffer (the Obsidian Vault API's native
// shape). Mirrors writeFsAtomic but uses the Vault API rename/remove via
// vault.adapter — exposed by the small VaultIo extension landed alongside
// this file.
// ---------------------------------------------------------------------------

export async function writeVaultAtomic(
	vault: VaultIo,
	path: string,
	bytes: ArrayBuffer,
): Promise<void> {
	const tmp = `${path}.tmp.${randomToken()}`;
	try {
		await vault.writeBinary(tmp, bytes);
		await vault.renameInVault(tmp, path);
	} catch (err) {
		try {
			await vault.removeInVault(tmp);
		} catch {
			// intentional
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function randomToken(): string {
	// crypto.randomUUID() is available in both Node 18+ and the Electron
	// renderer used by Obsidian. Using a UUID rather than Math.random keeps
	// us safe under high-concurrency scheduling without needing an explicit
	// counter-or-mutex.
	return crypto.randomUUID();
}
