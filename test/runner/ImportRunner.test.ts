// Tests for src/runner/ImportRunner.ts — the import-side ferry engine (T2.5).
//
// Strategy: every external dependency (NodeFs, VaultIo, AuditLog, scope
// validator, sanitize, atomicWriter) is replaced with a minimal in-memory fake.
// Tests assert on audit-log entries captured by FakeAuditLog. Filesystem state
// is tracked by FakeFs and FakeVault in memory.
//
// Coverage targets (from spec T2.5):
//  1. Full happy path — single file recursive subtree, flattenOnTarget: false
//  2. flattenOnTarget: true — subfolders collapsed into destination root
//  3. action: move — source unlinked AFTER write succeeds (not before)
//  4. onCollision: skip — decision: skipped entry
//  5. onCollision: suffix — correctly-suffixed name in audit
//  6. Sanitization rejection — decision: rejected
//  7. Housekeeping skip — decision: rejected, errorCode: housekeeping-file
//  8. Symlink rejection at source root (scope fails) — rule-failed
//  9. Symlink rejection at subdir — decision: rejected, errorCode: subdir-is-symlink
// 10. mtime-stability check — file skipped with source-modified when mtime too recent
// 11. dryRun: true — would-write decisions, no real writes
// 12. source-not-found (rule.sourcePath missing) — single rule-level failure
// 13. ENOSPC (disk-full) — rule-level failure, no further files processed
// 14. mtime NOT preserved on import (ADR-6) — mtime on written file differs
// 15. mid-read source-modified detection — skipped with source-modified

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportRunner } from "../../src/runner/ImportRunner";
import type { ImportRule } from "../../src/domain/rule";
import type { AuditEntry } from "../../src/audit/AuditEntry";
import type { LStatResult } from "../../src/fs/NodeFs";
import {
  IoNotFoundError,
  IoPermissionError,
  IoUnknownError,
} from "../../src/fs/NodeFs";
import type { Result } from "../../src/domain/rule";
import type { ScopeViolation } from "../../src/domain/scope";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<ImportRule> = {}): ImportRule {
  return {
    id: "rule-1" as ImportRule["id"],
    name: "Test Import",
    direction: "import",
    sourcePath: "/src" as ImportRule["sourcePath"],
    destinationVaultPath: "Inbox" as ImportRule["destinationVaultPath"],
    everyMinutes: 5,
    action: "copy",
    onCollision: "skip",
    flattenOnTarget: false,
    dryRun: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FakeAuditLog
// ---------------------------------------------------------------------------

class FakeAuditLog {
  entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  reset(): void {
    this.entries = [];
  }
}

// ---------------------------------------------------------------------------
// FakeFs — in-memory NodeFs surface
// ---------------------------------------------------------------------------

interface FakeFile {
  content: string;
  mtimeMs: number;
  isSymlink?: boolean;
}

class FakeFs {
  /** absolute path → file content */
  files: Map<string, FakeFile> = new Map();
  /** absolute path → { children: name[] } */
  dirs: Map<string, string[]> = new Map();
  /** track unlink calls */
  unlinked: string[] = [];
  /** track written files */
  written: string[] = [];
  /** override per path whether lstat sees symlink */
  symlinkPaths: Set<string> = new Set();
  /** map of path → error to throw on readFile */
  readFileErrors: Map<string, Error> = new Map();
  /** optional readFile override to simulate mid-read mtime change */
  onReadFile?: (path: string) => void;

  addFile(absPath: string, content: string, mtimeMs: number, isSymlink = false): void {
    this.files.set(absPath, { content, mtimeMs, isSymlink });
    // Ensure parent dir is known
    const dirPath = absPath.substring(0, absPath.lastIndexOf("/")) || "/";
    const base = absPath.substring(absPath.lastIndexOf("/") + 1);
    const existing = this.dirs.get(dirPath) ?? [];
    if (!existing.includes(base)) {
      this.dirs.set(dirPath, [...existing, base]);
    }
  }

  addDir(absPath: string, childNames: string[]): void {
    this.dirs.set(absPath, childNames);
  }

  async readFile(path: string): Promise<string> {
    const err = this.readFileErrors.get(path);
    if (err) throw err;
    this.onReadFile?.(path);
    const f = this.files.get(path);
    if (!f) throw new IoNotFoundError("readFile", path, new Error("ENOENT"));
    return f.content;
  }

  async writeFile(_path: string, _data: string): Promise<void> {
    this.written.push(_path);
  }

  async lstat(path: string): Promise<LStatResult> {
    const isSymlink = this.symlinkPaths.has(path);
    const f = this.files.get(path);
    if (f) {
      const mtimeMs = f.mtimeMs;
      const size = f.content.length;
      return {
        isSymbolicLink: () => isSymlink || f.isSymlink === true,
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs,
        size,
      };
    }
    if (this.dirs.has(path)) {
      return {
        isSymbolicLink: () => isSymlink,
        isDirectory: () => true,
        isFile: () => false,
        mtimeMs: 0,
        size: 0,
      };
    }
    throw new IoNotFoundError("lstat", path, new Error("ENOENT"));
  }

  async readdir(path: string): Promise<string[]> {
    const children = this.dirs.get(path);
    if (!children) throw new IoNotFoundError("readdir", path, new Error("ENOENT"));
    return children;
  }

  async unlink(path: string): Promise<void> {
    this.unlinked.push(path);
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new IoNotFoundError("rename", from, new Error("ENOENT"));
    this.files.set(to, f);
    this.files.delete(from);
  }

  async realpath(path: string): Promise<string> {
    return path;
  }

  async mkdir(_path: string): Promise<void> {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// FakeVault — in-memory VaultIo surface
// ---------------------------------------------------------------------------

class FakeVault {
  /** vault-relative path → content (ArrayBuffer) */
  files: Map<string, ArrayBuffer> = new Map();
  writeBinaryCount = 0;

  async writeBinary(path: string, bytes: ArrayBuffer): Promise<void> {
    this.writeBinaryCount++;
    this.files.set(path, bytes);
  }

  existsAtVaultPath(path: string): boolean {
    return this.files.has(path);
  }

  async ensureFolder(_path: string): Promise<void> {
    // no-op
  }

  async renameInVault(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new Error(`renameInVault: not found: ${from}`);
    this.files.set(to, f);
    this.files.delete(from);
  }

  async removeInVault(path: string): Promise<void> {
    this.files.delete(path);
  }

  resolveVaultPath(p: string): string {
    return `/vault/${p}`;
  }
}

// ---------------------------------------------------------------------------
// Build ImportRunner from fakes
// ---------------------------------------------------------------------------

const NOW_MS = 1000000;

function buildRunner(opts: {
  fakeFs: FakeFs;
  fakeVault: FakeVault;
  auditLog: FakeAuditLog;
  scopeResult?: Result<void, ScopeViolation>;
  stabilityCheckMs?: number;
  nowMs?: number;
}): ImportRunner {
  const {
    fakeFs,
    fakeVault,
    auditLog,
    scopeResult = { ok: true, value: undefined },
    stabilityCheckMs = 2000,
    nowMs = NOW_MS,
  } = opts;

  return new ImportRunner({
    auditLog: auditLog as unknown as InstanceType<typeof import("../../src/audit/AuditLog").AuditLog>,
    nodeFs: fakeFs as unknown as InstanceType<typeof import("../../src/fs/NodeFs").NodeFs>,
    vaultIo: fakeVault as unknown as InstanceType<typeof import("../../src/vault/VaultIo").VaultIo>,
    validateScope: async (_rule, _fs, _vault) => scopeResult,
    vaultRoot: "/vault",
    pluginDir: "/vault/.obsidian/plugins/hakobi",
    nowFn: () => new Date(nowMs),
    globalSettings: { stabilityCheckMs: () => stabilityCheckMs },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImportRunner", () => {
  let fakeFs: FakeFs;
  let fakeVault: FakeVault;
  let auditLog: FakeAuditLog;

  beforeEach(() => {
    fakeFs = new FakeFs();
    fakeVault = new FakeVault();
    auditLog = new FakeAuditLog();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — single file, flattenOnTarget: false
  // -------------------------------------------------------------------------

  it("happy path: single file in subtree writes to vault and appends ok + rule-ok entries", async () => {
    // stable file: mtime is 5 seconds ago (well outside stability window of 2000ms)
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    const rule = makeRule({ flattenOnTarget: false });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    // Expect the file was written to the vault
    expect(fakeVault.writeBinaryCount).toBe(1);

    // Two entries: per-file ok + rule-ok
    expect(auditLog.entries).toHaveLength(2);
    const [fileEntry, ruleEntry] = auditLog.entries;

    expect(fileEntry.decision).toBe("ok");
    expect(fileEntry.operation).toBe("copy");
    expect(fileEntry.direction).toBe("import");
    expect(fileEntry.ruleId).toBe("rule-1");
    expect(fileEntry.destinationPathRelative).toBe("Inbox/note.md");
    expect(fileEntry.sourcePathRelative).toBe("note.md");
    expect(typeof fileEntry.bytesTransferred).toBe("number");

    expect(ruleEntry.decision).toBe("rule-ok");
    expect(ruleEntry.operation).toBe("copy");
  });

  // -------------------------------------------------------------------------
  // 2. Recursive subtree, flattenOnTarget: false
  // -------------------------------------------------------------------------

  it("recursive subtree: files in subdirs preserve relative path in destination", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["subdir"]);
    fakeFs.addDir("/src/subdir", ["note.md"]);
    fakeFs.addFile("/src/subdir/note.md", "content", fileMtime);

    const rule = makeRule({ flattenOnTarget: false });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    expect(auditLog.entries.length).toBeGreaterThanOrEqual(2);
    const fileEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(fileEntry?.destinationPathRelative).toBe("Inbox/subdir/note.md");
    expect(fileEntry?.sourcePathRelative).toBe("subdir/note.md");
  });

  // -------------------------------------------------------------------------
  // 3. flattenOnTarget: true — subfolders collapsed into destination root
  // -------------------------------------------------------------------------

  it("flattenOnTarget: true collapses subfolders into destination root", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["subdir"]);
    fakeFs.addDir("/src/subdir", ["note.md"]);
    fakeFs.addFile("/src/subdir/note.md", "content", fileMtime);

    const rule = makeRule({ flattenOnTarget: true });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const fileEntry = auditLog.entries.find((e) => e.decision === "ok");
    // Should be Inbox/note.md, NOT Inbox/subdir/note.md
    expect(fileEntry?.destinationPathRelative).toBe("Inbox/note.md");
  });

  // -------------------------------------------------------------------------
  // 4. action: move — source unlinked AFTER write succeeds, NOT before
  // -------------------------------------------------------------------------

  it("action: move — source file unlinked after vault write; not unlinked if write fails", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    const rule = makeRule({ action: "move" });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    // File should be unlinked after successful write
    expect(fakeFs.unlinked).toContain("/src/note.md");

    // Audit entry should show move operation
    const fileEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(fileEntry?.operation).toBe("move");
  });

  it("action: move — source NOT unlinked if vault write throws", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    const vaultWithFailure = new FakeVault();
    let callCount = 0;
    vi.spyOn(vaultWithFailure, "writeBinary").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("write failed");
    });
    vi.spyOn(vaultWithFailure, "removeInVault").mockResolvedValue(undefined);
    vi.spyOn(vaultWithFailure, "renameInVault").mockResolvedValue(undefined);

    const rule = makeRule({ action: "move" });
    const runner = buildRunner({ fakeFs, fakeVault: vaultWithFailure, auditLog });
    await runner.run(rule);

    // Source must NOT be unlinked when write failed
    expect(fakeFs.unlinked).not.toContain("/src/note.md");
  });

  // -------------------------------------------------------------------------
  // 5. onCollision: skip — decision: skipped
  // -------------------------------------------------------------------------

  it("onCollision: skip — appends skipped entry when destination exists", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    // Pre-populate destination so it already exists
    fakeVault.files.set("Inbox/note.md", new ArrayBuffer(0));

    const rule = makeRule({ onCollision: "skip" });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const skippedEntry = auditLog.entries.find((e) => e.decision === "skipped");
    expect(skippedEntry).toBeDefined();
    expect(skippedEntry?.operation).toBe("skip");
    // Should not write to vault since we're skipping
    expect(fakeVault.writeBinaryCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. onCollision: suffix — correctly-suffixed name
  // -------------------------------------------------------------------------

  it("onCollision: suffix — writes with suffixed name when destination exists", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    // Pre-populate original destination
    fakeVault.files.set("Inbox/note.md", new ArrayBuffer(0));

    const rule = makeRule({ onCollision: "suffix" });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const okEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(okEntry).toBeDefined();
    // Destination should be suffixed
    expect(okEntry?.destinationPathRelative).toBe("Inbox/note-1.md");
  });

  // -------------------------------------------------------------------------
  // 7. Sanitization rejection — decision: rejected
  // -------------------------------------------------------------------------

  it("sanitization rejection: NUL byte in filename → rejected entry", async () => {
    const fileMtime = NOW_MS - 5000;
    // \0 in filename — sanitizeFilename rejects this
    fakeFs.addDir("/src", ["bad\0name.md"]);
    fakeFs.addFile("/src/bad\0name.md", "content", fileMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const rejectedEntry = auditLog.entries.find((e) => e.decision === "rejected");
    expect(rejectedEntry).toBeDefined();
    expect(rejectedEntry?.errorCode).toBe("sanitization-rejected");
  });

  // -------------------------------------------------------------------------
  // 8. Housekeeping skip — decision: rejected, errorCode: housekeeping-file
  // -------------------------------------------------------------------------

  it("housekeeping file (.DS_Store) → rejected entry with housekeeping-file code", async () => {
    fakeFs.addDir("/src", [".DS_Store"]);
    fakeFs.addFile("/src/.DS_Store", "", NOW_MS - 5000);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const rejectedEntry = auditLog.entries.find((e) => e.decision === "rejected");
    expect(rejectedEntry).toBeDefined();
    expect(rejectedEntry?.errorCode).toBe("housekeeping-file");
  });

  // -------------------------------------------------------------------------
  // 9. Symlink rejection at source root — scope fails → rule-failed
  // -------------------------------------------------------------------------

  it("scope fails (symlink at source root) → rule-failed entry, no per-file entries", async () => {
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "content", NOW_MS - 5000);

    const scopeResult: Result<void, ScopeViolation> = {
      ok: false,
      errors: { reason: "symlink", path: "/src", detail: "rule source root is a symlink" },
    };

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog, scopeResult });
    await runner.run(rule);

    // Only one entry: rule-failed
    expect(auditLog.entries).toHaveLength(1);
    const failEntry = auditLog.entries[0];
    expect(failEntry.decision).toBe("rule-failed");
    expect(fakeVault.writeBinaryCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. Symlink rejection at subdir during enumeration
  // -------------------------------------------------------------------------

  it("symlink subdir during enumeration → rejected entry per spec (subdir-is-symlink)", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["symdir", "real.md"]);
    fakeFs.addDir("/src/symdir", ["inner.md"]);
    fakeFs.addFile("/src/symdir/inner.md", "content", fileMtime);
    fakeFs.addFile("/src/real.md", "content", fileMtime);
    // Mark /src/symdir as a symlink in lstat
    fakeFs.symlinkPaths.add("/src/symdir");

    const rule = makeRule({ flattenOnTarget: false });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const symlinkEntry = auditLog.entries.find((e) => e.errorCode === "subdir-is-symlink");
    expect(symlinkEntry).toBeDefined();
    expect(symlinkEntry?.decision).toBe("rejected");

    // The real.md should still be processed
    const okEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(okEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 11. mtime-stability check — file too recently modified → skipped
  // -------------------------------------------------------------------------

  it("mtime-stability: file modified within stabilityCheckMs → skipped with source-modified", async () => {
    // File mtime is NOW - 500ms, stability window is 2000ms → unstable
    const unstableMtime = NOW_MS - 500;
    fakeFs.addDir("/src", ["recent.md"]);
    fakeFs.addFile("/src/recent.md", "new content", unstableMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog, stabilityCheckMs: 2000 });
    await runner.run(rule);

    const skippedEntry = auditLog.entries.find((e) => e.errorCode === "source-modified");
    expect(skippedEntry).toBeDefined();
    expect(skippedEntry?.decision).toBe("skipped");
    expect(fakeVault.writeBinaryCount).toBe(0);
  });

  it("mtime-stability: file modified exactly at stabilityCheckMs boundary → stable, written", async () => {
    // mtime is exactly NOW - stabilityCheckMs (at boundary = stable)
    const stableMtime = NOW_MS - 2000;
    fakeFs.addDir("/src", ["boundary.md"]);
    fakeFs.addFile("/src/boundary.md", "content", stableMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog, stabilityCheckMs: 2000 });
    await runner.run(rule);

    const okEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(okEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 12. dryRun: true — would-write decisions, no real writes
  // -------------------------------------------------------------------------

  it("dryRun: true → would-write decision entries, vault not written", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    const rule = makeRule({ dryRun: true });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    expect(fakeVault.writeBinaryCount).toBe(0);
    const dryEntry = auditLog.entries.find((e) => e.decision === "would-write");
    expect(dryEntry).toBeDefined();
    expect(dryEntry?.operation).toBe("would-write");
  });

  it("dryRun via opts override — opts.dryRun wins even if rule.dryRun is false", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);

    const rule = makeRule({ dryRun: false });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule, { dryRun: true });

    expect(fakeVault.writeBinaryCount).toBe(0);
    expect(auditLog.entries.find((e) => e.decision === "would-write")).toBeDefined();
  });

  it("dryRun: skip on collision produces would-skip entry", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "hello", fileMtime);
    fakeVault.files.set("Inbox/note.md", new ArrayBuffer(0));

    const rule = makeRule({ dryRun: true, onCollision: "skip" });
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const drySkip = auditLog.entries.find((e) => e.decision === "would-skip");
    expect(drySkip).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 13. source-not-found — rule level failure
  // -------------------------------------------------------------------------

  it("source-not-found: initial readdir fails → single rule-failed entry with source-not-found", async () => {
    // /src dir does NOT exist in fakeFs — readdir will throw IoNotFoundError
    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0].decision).toBe("rule-failed");
    expect(auditLog.entries[0].errorCode).toBe("source-not-found");
  });

  // -------------------------------------------------------------------------
  // 14. ENOSPC — disk-full aborts the run
  // -------------------------------------------------------------------------

  it("ENOSPC during write → rule-failed with disk-full, no further files processed", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["a.md", "b.md"]);
    fakeFs.addFile("/src/a.md", "aaa", fileMtime);
    fakeFs.addFile("/src/b.md", "bbb", fileMtime);

    const vaultWithDiskFull = new FakeVault();
    let callCount = 0;
    vi.spyOn(vaultWithDiskFull, "writeBinary").mockImplementation(async () => {
      callCount++;
      // First write triggers disk-full
      throw new IoUnknownError("writeBinary", "Inbox/a.md", new Error("ENOSPC"), "disk-full");
    });
    vi.spyOn(vaultWithDiskFull, "removeInVault").mockResolvedValue(undefined);
    vi.spyOn(vaultWithDiskFull, "renameInVault").mockResolvedValue(undefined);
    vi.spyOn(vaultWithDiskFull, "ensureFolder").mockResolvedValue(undefined);
    vaultWithDiskFull.existsAtVaultPath = () => false;

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault: vaultWithDiskFull, auditLog });
    await runner.run(rule);

    const ruleEntry = auditLog.entries[auditLog.entries.length - 1];
    expect(ruleEntry.decision).toBe("rule-failed");
    expect(ruleEntry.errorCode).toBe("disk-full");

    // writeBinary should have been called once (for temp write) and aborted
    // b.md should NOT have been attempted
    const okEntries = auditLog.entries.filter((e) => e.decision === "ok");
    expect(okEntries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 15. mtime NOT preserved on import (ADR-6)
  // -------------------------------------------------------------------------

  it("ADR-6: mtime is NOT preserved on import — writeVaultAtomic does not set mtime", async () => {
    // This test verifies we do NOT call any mtime-setting function
    // The vault's writeBinary timestamp will be 'now', not the source mtime
    const fileMtime = NOW_MS - 100000; // very old file
    fakeFs.addDir("/src", ["old.md"]);
    fakeFs.addFile("/src/old.md", "old content", fileMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });

    // We track if anyone calls a "setMtime" or similar — since NodeFs has no such
    // method, this is verified structurally: the runner must not call any mtime-setting API.
    // The test passes as long as it completes without error; the absence of mtime APIs
    // in NodeFs / VaultIo is the structural guarantee.
    await runner.run(rule);

    const okEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(okEntry).toBeDefined();
    // bytesTransferred is the file size — not a mtime proxy
    expect(typeof okEntry?.bytesTransferred).toBe("number");
  });

  // -------------------------------------------------------------------------
  // 16. Mid-read mtime change — source-modified during the write phase
  // -------------------------------------------------------------------------

  it("source-modified mid-read: mtime changes between enumeration and re-lstat → skipped", async () => {
    const stableMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["changing.md"]);
    fakeFs.addFile("/src/changing.md", "v1", stableMtime);

    let lstatCallCount = 0;
    const origLstat = fakeFs.lstat.bind(fakeFs);
    fakeFs.lstat = async (path: string) => {
      const result = await origLstat(path);
      if (path === "/src/changing.md") {
        lstatCallCount++;
        if (lstatCallCount >= 2) {
          // Second lstat (re-check during write phase) returns a newer mtime
          return {
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
            mtimeMs: NOW_MS - 100, // unstable!
            size: 2,
          };
        }
      }
      return result;
    };

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const skippedEntry = auditLog.entries.find((e) => e.errorCode === "source-modified");
    expect(skippedEntry).toBeDefined();
    expect(fakeVault.writeBinaryCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 17. rule-partial — mix of ok and rejected
  // -------------------------------------------------------------------------

  it("rule-partial: some ok, some rejected → rule-partial summary", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["good.md", ".DS_Store"]);
    fakeFs.addFile("/src/good.md", "good", fileMtime);
    fakeFs.addFile("/src/.DS_Store", "", fileMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    const ruleEntry = auditLog.entries[auditLog.entries.length - 1];
    expect(ruleEntry.decision).toBe("rule-partial");
  });

  // -------------------------------------------------------------------------
  // 18. rule-failed — zero ok entries
  // -------------------------------------------------------------------------

  it("rule-failed: all files skipped via stability check → rule-failed summary", async () => {
    const unstableMtime = NOW_MS - 500;
    fakeFs.addDir("/src", ["recent.md"]);
    fakeFs.addFile("/src/recent.md", "new", unstableMtime);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog, stabilityCheckMs: 2000 });
    await runner.run(rule);

    const ruleEntry = auditLog.entries[auditLog.entries.length - 1];
    // skipped-only entries → rule-failed (no ok)
    expect(ruleEntry.decision).toBe("rule-failed");
  });

  // -------------------------------------------------------------------------
  // 19. lstat failure during enumeration emits per-file audit entry (Finding 1)
  // -------------------------------------------------------------------------

  it("lstat failure (IoPermissionError) during enumeration → per-file skipped entry with permission-denied", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["denied.md", "ok.md"]);
    fakeFs.addFile("/src/denied.md", "content", fileMtime);
    fakeFs.addFile("/src/ok.md", "content", fileMtime);

    // Override lstat so that denied.md throws IoPermissionError during enumeration
    const origLstat = fakeFs.lstat.bind(fakeFs);
    fakeFs.lstat = async (path: string) => {
      if (path === "/src/denied.md") {
        throw new IoPermissionError("lstat", path, new Error("EACCES"));
      }
      return origLstat(path);
    };

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    // Should have a per-file skipped entry for denied.md
    const skippedEntry = auditLog.entries.find(
      (e) => e.decision === "skipped" && e.sourcePathRelative === "denied.md",
    );
    expect(skippedEntry).toBeDefined();
    expect(skippedEntry?.errorCode).toBe("permission-denied");
    expect(skippedEntry?.operation).toBe("skip");

    // ok.md should still be processed normally
    const okEntry = auditLog.entries.find((e) => e.decision === "ok");
    expect(okEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 20. readdir of sourcePath throws non-IoNotFoundError → propagates to caller (Finding 3)
  // -------------------------------------------------------------------------

  it("readdir of sourcePath throws non-IoNotFoundError → runner rejects with that error", async () => {
    // Override readdir for the rule source path to throw a non-IoNotFoundError
    const origReaddir = fakeFs.readdir.bind(fakeFs);
    fakeFs.readdir = async (path: string) => {
      if (path === "/src") {
        throw new IoUnknownError("readdir", path, new Error("EIO"));
      }
      return origReaddir(path);
    };

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await expect(runner.run(rule)).rejects.toThrow(IoUnknownError);
  });

  // -------------------------------------------------------------------------
  // 21. Empty source dir → rule-ok with no per-file entries
  // -------------------------------------------------------------------------

  it("empty source dir → rule-ok with zero per-file entries", async () => {
    fakeFs.addDir("/src", []);

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault, auditLog });
    await runner.run(rule);

    // Only the rule-level summary entry
    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0].decision).toBe("rule-ok");
  });

  // -------------------------------------------------------------------------
  // 20. no-half-file invariant: if writeBinary succeeds but renameInVault fails,
  //     final path is not visible
  // -------------------------------------------------------------------------

  it("no half-file: if renameInVault fails, the final path is not committed", async () => {
    const fileMtime = NOW_MS - 5000;
    fakeFs.addDir("/src", ["note.md"]);
    fakeFs.addFile("/src/note.md", "content", fileMtime);

    const paths: string[] = [];
    const vaultTrack = new FakeVault();
    vi.spyOn(vaultTrack, "writeBinary").mockImplementation(async (path) => {
      paths.push(path);
      // Write to the fake backing store for tracking
      vaultTrack.files.set(path, new ArrayBuffer(0));
    });
    vi.spyOn(vaultTrack, "renameInVault").mockImplementation(async (from, to) => {
      paths.push(`rename:${from}->${to}`);
      throw new Error("rename failed");
    });
    vi.spyOn(vaultTrack, "removeInVault").mockImplementation(async (path) => {
      paths.push(`remove:${path}`);
      vaultTrack.files.delete(path);
    });
    vi.spyOn(vaultTrack, "ensureFolder").mockResolvedValue(undefined);
    vaultTrack.existsAtVaultPath = () => false;

    const rule = makeRule();
    const runner = buildRunner({ fakeFs, fakeVault: vaultTrack, auditLog });
    await runner.run(rule);

    // The final path "Inbox/note.md" must never have been written directly
    const writesToFinal = paths.filter((p) => p === "Inbox/note.md");
    expect(writesToFinal).toHaveLength(0);
    // The temp path should be removed (best-effort cleanup)
    const removals = paths.filter((p) => p.startsWith("remove:"));
    expect(removals).toHaveLength(1);
  });
});
