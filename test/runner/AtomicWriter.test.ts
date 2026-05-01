// Tests for src/runner/AtomicWriter.ts — temp-then-rename helpers and the
// collision-suffix algorithm (T1.9).
//
// What is asserted here:
//  - resolveCollisionName matches the SDD reference impl byte-for-byte across
//    every traced walkthrough case (incl. the dotfile edge where dot === 0
//    and the 1000+ collision exhaustion case).
//  - writeFsAtomic / writeVaultAtomic write to a temp path, rename into place,
//    and on either failure (write or rename) clean up the temp file
//    best-effort and re-throw the ORIGINAL error (no masking).
//  - Random suffix uniqueness: two parallel calls do not collide on temp paths.
//  - "No half-file" invariant: under failure, no path-final write/rename
//    actually lands at the destination — asserted through the spy log.
//
// Adapter strategy: rather than instantiating a real NodeFs / VaultIo, we
// build minimal stubs that match the structural surface AtomicWriter consumes.
// This keeps the test focused on AtomicWriter's behaviour rather than the
// adapters' (which have their own suites).

import { describe, it, expect, vi } from "vitest";
import {
	resolveCollisionName,
	writeFsAtomic,
	writeVaultAtomic,
	MAX_SUFFIX_ATTEMPTS,
} from "../../src/runner/AtomicWriter";
import type { NodeFs } from "../../src/fs/NodeFs";
import type { VaultIo } from "../../src/vault/VaultIo";

// ---------------------------------------------------------------------------
// Test stubs
// ---------------------------------------------------------------------------

/**
 * Build a minimal NodeFs-shaped stub for AtomicWriter's needs.
 * AtomicWriter only calls writeFile / rename / unlink on the FS adapter.
 */
function makeFsStub(opts?: {
	writeFile?: (path: string, data: string) => Promise<void>;
	rename?: (from: string, to: string) => Promise<void>;
	unlink?: (path: string) => Promise<void>;
}): NodeFs {
	const stub = {
		writeFile: vi.fn(opts?.writeFile ?? (async () => {})),
		rename: vi.fn(opts?.rename ?? (async () => {})),
		unlink: vi.fn(opts?.unlink ?? (async () => {})),
	};
	return stub as unknown as NodeFs;
}

/**
 * Build a minimal VaultIo-shaped stub for AtomicWriter's needs.
 * AtomicWriter only calls writeBinary / renameInVault / removeInVault.
 */
function makeVaultStub(opts?: {
	writeBinary?: (path: string, bytes: ArrayBuffer) => Promise<void>;
	renameInVault?: (from: string, to: string) => Promise<void>;
	removeInVault?: (path: string) => Promise<void>;
}): VaultIo {
	const stub = {
		writeBinary: vi.fn(opts?.writeBinary ?? (async () => {})),
		renameInVault: vi.fn(opts?.renameInVault ?? (async () => {})),
		removeInVault: vi.fn(opts?.removeInVault ?? (async () => {})),
	};
	return stub as unknown as VaultIo;
}

// ---------------------------------------------------------------------------
// resolveCollisionName — traced walkthrough cases (SDD/Implementation Examples)
// ---------------------------------------------------------------------------

describe("resolveCollisionName — SDD walkthrough", () => {
	it("returns baseName when no file exists at destination", async () => {
		// empty dir → "note.md" → "note.md"
		const exists = vi.fn().mockResolvedValue(false);
		const out = await resolveCollisionName("/dest", "note.md", exists);
		expect(out).toEqual({ ok: true, finalName: "note.md" });
	});

	it("appends -1 suffix on first collision", async () => {
		// "note.md" exists → "note-1.md"
		const taken = new Set(["/dest/note.md"]);
		const exists = vi.fn(async (p: string) => taken.has(p));
		const out = await resolveCollisionName("/dest", "note.md", exists);
		expect(out).toEqual({ ok: true, finalName: "note-1.md" });
	});

	it("appends -2 suffix when -1 is also taken", async () => {
		// "note.md" + "note-1.md" exist → "note-2.md"
		const taken = new Set(["/dest/note.md", "/dest/note-1.md"]);
		const exists = vi.fn(async (p: string) => taken.has(p));
		const out = await resolveCollisionName("/dest", "note.md", exists);
		expect(out).toEqual({ ok: true, finalName: "note-2.md" });
	});

	it("appends suffix to extensionless name (no dot in baseName)", async () => {
		// "README" exists → "README-1"
		const taken = new Set(["/dest/README"]);
		const exists = vi.fn(async (p: string) => taken.has(p));
		const out = await resolveCollisionName("/dest", "README", exists);
		expect(out).toEqual({ ok: true, finalName: "README-1" });
	});

	it("treats dotfile as no-extension (lastIndexOf('.') === 0 falls into else)", async () => {
		// ".gitignore" exists → ".gitignore-1" (because dot === 0, condition dot > 0 is false)
		const taken = new Set(["/dest/.gitignore"]);
		const exists = vi.fn(async (p: string) => taken.has(p));
		const out = await resolveCollisionName("/dest", ".gitignore", exists);
		expect(out).toEqual({ ok: true, finalName: ".gitignore-1" });
	});

	it("returns too-many-collisions after MAX_SUFFIX_ATTEMPTS exhausted", async () => {
		// 1000+ collisions → { ok: false, reason: "too-many-collisions" }
		const exists = vi.fn(async () => true);
		const out = await resolveCollisionName("/dest", "note.md", exists);
		expect(out).toEqual({ ok: false, reason: "too-many-collisions" });
		// baseName probe + 999 suffix probes.
		expect(exists).toHaveBeenCalledTimes(1 + MAX_SUFFIX_ATTEMPTS);
	});

	it("MAX_SUFFIX_ATTEMPTS is 999 (matches SDD constant)", () => {
		expect(MAX_SUFFIX_ATTEMPTS).toBe(999);
	});

	it("probes paths in order: baseName, then -1, -2, ... (verified via call sequence)", async () => {
		// Confirms the loop body builds candidate strings exactly as the SDD reference does.
		const seen: string[] = [];
		const exists = vi.fn(async (p: string) => {
			seen.push(p);
			return p === "/dest/note.md" || p === "/dest/note-1.md";
		});
		const out = await resolveCollisionName("/dest", "note.md", exists);
		expect(out).toEqual({ ok: true, finalName: "note-2.md" });
		expect(seen).toEqual(["/dest/note.md", "/dest/note-1.md", "/dest/note-2.md"]);
	});
});

// ---------------------------------------------------------------------------
// writeFsAtomic — happy path + failure modes
// ---------------------------------------------------------------------------

describe("writeFsAtomic", () => {
	it("writes to <path>.tmp.<rand> then renames to final path; no unlink", async () => {
		const fs = makeFsStub();
		await writeFsAtomic(fs, "/dest/file.txt", "hello");

		expect(fs.writeFile).toHaveBeenCalledTimes(1);
		const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
		expect(writeCall[0]).toMatch(/^\/dest\/file\.txt\.tmp\.[\w-]+$/);
		expect(writeCall[1]).toBe("hello");

		expect(fs.rename).toHaveBeenCalledTimes(1);
		const renameCall = vi.mocked(fs.rename).mock.calls[0];
		expect(renameCall[0]).toBe(writeCall[0]); // tmp path
		expect(renameCall[1]).toBe("/dest/file.txt"); // final path

		expect(fs.unlink).not.toHaveBeenCalled();
	});

	it("on writeFile failure: unlinks tmp, re-throws original error, no rename to final", async () => {
		const original = new Error("write boom");
		const fs = makeFsStub({
			writeFile: async () => {
				throw original;
			},
		});

		await expect(writeFsAtomic(fs, "/dest/x.txt", "data")).rejects.toBe(original);

		expect(fs.rename).not.toHaveBeenCalled();
		// Cleanup attempted on the temp path.
		expect(fs.unlink).toHaveBeenCalledTimes(1);
		const unlinkCall = vi.mocked(fs.unlink).mock.calls[0];
		expect(unlinkCall[0]).toMatch(/^\/dest\/x\.txt\.tmp\.[\w-]+$/);
	});

	it("on rename failure: unlinks tmp, re-throws original error", async () => {
		const original = new Error("rename boom");
		const fs = makeFsStub({
			rename: async () => {
				throw original;
			},
		});

		await expect(writeFsAtomic(fs, "/dest/y.txt", "data")).rejects.toBe(original);

		expect(fs.writeFile).toHaveBeenCalledTimes(1);
		const tmp = vi.mocked(fs.writeFile).mock.calls[0][0];
		expect(fs.unlink).toHaveBeenCalledWith(tmp);
	});

	it("cleanup is best-effort: an unlink failure does NOT mask the original error", async () => {
		const original = new Error("write boom");
		const cleanupErr = new Error("unlink boom — should be swallowed");
		const fs = makeFsStub({
			writeFile: async () => {
				throw original;
			},
			unlink: async () => {
				throw cleanupErr;
			},
		});

		// Original write error must be the rejection reason — not the unlink error.
		await expect(writeFsAtomic(fs, "/dest/z.txt", "data")).rejects.toBe(original);
	});

	it("no half-file: under rename failure, the final destination is never written", async () => {
		// Tracks every (op, path) pair to assert no operation lands on the final path.
		const ops: Array<{ op: string; path: string }> = [];
		const original = new Error("rename boom");
		const fs = makeFsStub({
			writeFile: async (p) => {
				ops.push({ op: "writeFile", path: p });
			},
			rename: async (from, to) => {
				ops.push({ op: "rename", path: `${from}->${to}` });
				throw original;
			},
			unlink: async (p) => {
				ops.push({ op: "unlink", path: p });
			},
		});

		await expect(writeFsAtomic(fs, "/dest/final.txt", "x")).rejects.toBe(original);

		// Final destination only ever appeared as the *target* of a rename that threw.
		const writesAtFinal = ops.filter((o) => o.op === "writeFile" && o.path === "/dest/final.txt");
		expect(writesAtFinal).toHaveLength(0);
	});

	it("random suffix uniqueness: two parallel calls produce different temp names", async () => {
		const tmpsSeen: string[] = [];
		const fs = makeFsStub({
			writeFile: async (p) => {
				tmpsSeen.push(p);
			},
		});

		await Promise.all([
			writeFsAtomic(fs, "/dest/a.txt", "a"),
			writeFsAtomic(fs, "/dest/a.txt", "a"),
		]);

		expect(tmpsSeen).toHaveLength(2);
		expect(tmpsSeen[0]).not.toBe(tmpsSeen[1]);
	});
});

// ---------------------------------------------------------------------------
// writeVaultAtomic — happy path + failure modes
// ---------------------------------------------------------------------------

describe("writeVaultAtomic", () => {
	it("writes to <path>.tmp.<rand> then renameInVault to final; no removeInVault", async () => {
		const vault = makeVaultStub();
		const bytes = new ArrayBuffer(4);
		await writeVaultAtomic(vault, "Inbox/note.md", bytes);

		expect(vault.writeBinary).toHaveBeenCalledTimes(1);
		const writeCall = vi.mocked(vault.writeBinary).mock.calls[0];
		expect(writeCall[0]).toMatch(/^Inbox\/note\.md\.tmp\.[\w-]+$/);
		expect(writeCall[1]).toBe(bytes);

		expect(vault.renameInVault).toHaveBeenCalledTimes(1);
		const renameCall = vi.mocked(vault.renameInVault).mock.calls[0];
		expect(renameCall[0]).toBe(writeCall[0]);
		expect(renameCall[1]).toBe("Inbox/note.md");

		expect(vault.removeInVault).not.toHaveBeenCalled();
	});

	it("on writeBinary failure: removeInVault on tmp; re-throws original error", async () => {
		const original = new Error("vault write boom");
		const vault = makeVaultStub({
			writeBinary: async () => {
				throw original;
			},
		});

		await expect(writeVaultAtomic(vault, "Inbox/n.md", new ArrayBuffer(0))).rejects.toBe(
			original,
		);

		expect(vault.renameInVault).not.toHaveBeenCalled();
		expect(vault.removeInVault).toHaveBeenCalledTimes(1);
		const removeCall = vi.mocked(vault.removeInVault).mock.calls[0];
		expect(removeCall[0]).toMatch(/^Inbox\/n\.md\.tmp\.[\w-]+$/);
	});

	it("on renameInVault failure: removeInVault on tmp; re-throws original error", async () => {
		const original = new Error("vault rename boom");
		const vault = makeVaultStub({
			renameInVault: async () => {
				throw original;
			},
		});

		await expect(writeVaultAtomic(vault, "Inbox/n.md", new ArrayBuffer(0))).rejects.toBe(
			original,
		);

		expect(vault.writeBinary).toHaveBeenCalledTimes(1);
		const tmp = vi.mocked(vault.writeBinary).mock.calls[0][0];
		expect(vault.removeInVault).toHaveBeenCalledWith(tmp);
	});

	it("cleanup is best-effort: a removeInVault failure does NOT mask the original error", async () => {
		const original = new Error("vault write boom");
		const cleanupErr = new Error("vault remove boom — should be swallowed");
		const vault = makeVaultStub({
			writeBinary: async () => {
				throw original;
			},
			removeInVault: async () => {
				throw cleanupErr;
			},
		});

		await expect(writeVaultAtomic(vault, "Inbox/n.md", new ArrayBuffer(0))).rejects.toBe(
			original,
		);
	});

	it("no half-file: under rename failure, no rename to the final path actually committed", async () => {
		const ops: Array<{ op: string; path: string }> = [];
		const original = new Error("rename boom");
		const vault = makeVaultStub({
			writeBinary: async (p) => {
				ops.push({ op: "writeBinary", path: p });
			},
			renameInVault: async (from, to) => {
				ops.push({ op: "renameInVault", path: `${from}->${to}` });
				throw original;
			},
			removeInVault: async (p) => {
				ops.push({ op: "removeInVault", path: p });
			},
		});

		await expect(
			writeVaultAtomic(vault, "Inbox/final.md", new ArrayBuffer(0)),
		).rejects.toBe(original);

		// No write ever landed at the final path.
		const writesAtFinal = ops.filter(
			(o) => o.op === "writeBinary" && o.path === "Inbox/final.md",
		);
		expect(writesAtFinal).toHaveLength(0);
	});
});
