// Tests for src/runner/ExportRunner.ts — folder/tag/note dispatch, mtime
// preservation (ADR-6), nested-tag inclusion (ADR-11), dry-run, move+delete,
// and rule-level failure paths. (T2.6)
//
// Adapter strategy: build minimal in-memory stubs for VaultIo, NodeFs,
// AuditLog, and the scope validator. Real TFile instances come from the
// obsidian mock. Each test creates its own state to avoid shared mutation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "../__mocks__/obsidian";
import type { NodeFs } from "../../src/fs/NodeFs";
import type { VaultIo } from "../../src/vault/VaultIo";
import type { AuditLog } from "../../src/audit/AuditLog";
import type { AuditEntry } from "../../src/audit/AuditEntry";
import type {
  ExportFolderRule,
  ExportTagRule,
  ExportNoteRule,
} from "../../src/domain/rule";
import type { Result } from "../../src/domain/rule";
import type { ScopeViolation } from "../../src/domain/scope";
import { ExportRunner } from "../../src/runner/ExportRunner";

// ---------------------------------------------------------------------------
// Helpers / factories
// ---------------------------------------------------------------------------

const VAULT_ROOT = "/vault";
const PLUGIN_DIR = "/vault/.obsidian/plugins/miyo-hakobi";
const DEST_DIR = "/export/dest";

/** Build a stub VaultIo whose methods are individually overrideable. */
function makeVaultStub(overrides?: {
  listFolder?: (path: string, opts: { recursive: boolean }) => Promise<TFile[]>;
  notesByTag?: (tags: string[], match: "any" | "all") => Promise<TFile[]>;
  fileByPath?: (path: string) => TFile | null;
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  deleteNote?: (file: TFile) => Promise<void>;
  existsAtVaultPath?: (path: string) => boolean;
  resolveVaultPath?: (path: string) => string;
}): VaultIo {
  const defaultListFolder = async (): Promise<TFile[]> => [];
  const defaultNotesByTag = async (): Promise<TFile[]> => [];
  const defaultFileByPath = (): TFile | null => null;
  const defaultReadBinary = async (): Promise<ArrayBuffer> => new ArrayBuffer(0);
  const defaultDeleteNote = async (): Promise<void> => {};
  const defaultExistsAtVaultPath = (): boolean => false;
  const defaultResolveVaultPath = (p: string): string => {
    const trimmed = p.replace(/^\/+/, "").replace(/\/+$/, "");
    return trimmed === "" ? VAULT_ROOT : `${VAULT_ROOT}/${trimmed}`;
  };

  return {
    listFolder: vi.fn(overrides?.listFolder ?? defaultListFolder),
    notesByTag: vi.fn(overrides?.notesByTag ?? defaultNotesByTag),
    fileByPath: vi.fn(overrides?.fileByPath ?? defaultFileByPath),
    readBinary: vi.fn(overrides?.readBinary ?? defaultReadBinary),
    deleteNote: vi.fn(overrides?.deleteNote ?? defaultDeleteNote),
    existsAtVaultPath: vi.fn(overrides?.existsAtVaultPath ?? defaultExistsAtVaultPath),
    resolveVaultPath: vi.fn(overrides?.resolveVaultPath ?? defaultResolveVaultPath),
    writeBinary: vi.fn(async () => {}),
    renameInVault: vi.fn(async () => {}),
    removeInVault: vi.fn(async () => {}),
    ensureFolder: vi.fn(async () => {}),
    getActiveFile: vi.fn(() => null),
  } as unknown as VaultIo;
}

type LStatResult = {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: number;
  size: number;
};

/** Build a stub NodeFs whose methods are individually overrideable. */
function makeFsStub(overrides?: {
  lstat?: (path: string) => Promise<LStatResult>;
  mkdir?: (path: string) => Promise<void>;
  writeFileBinary?: (path: string, data: ArrayBuffer) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  utimes?: (path: string, mtimeMs: number) => Promise<void>;
  realpath?: (path: string) => Promise<string>;
}): NodeFs {
  // Default lstat: always succeeds (parent exists) but never claims isFile=true.
  // This means collision checks treating "file exists at dest" return false
  // by default. Tests that want collision behavior override lstat explicitly.
  const defaultLstat = async (_path: string): Promise<LStatResult> => ({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => false,
    mtimeMs: 1000,
    size: 100,
  });
  const defaultMkdir = async (): Promise<void> => {};
  const defaultWriteFileBinary = async (): Promise<void> => {};
  const defaultRename = async (): Promise<void> => {};
  const defaultUnlink = async (): Promise<void> => {};
  const defaultUtimes = async (): Promise<void> => {};
  const defaultRealpath = async (p: string): Promise<string> => p;

  return {
    lstat: vi.fn(overrides?.lstat ?? defaultLstat),
    mkdir: vi.fn(overrides?.mkdir ?? defaultMkdir),
    writeFileBinary: vi.fn(overrides?.writeFileBinary ?? defaultWriteFileBinary),
    rename: vi.fn(overrides?.rename ?? defaultRename),
    unlink: vi.fn(overrides?.unlink ?? defaultUnlink),
    utimes: vi.fn(overrides?.utimes ?? defaultUtimes),
    realpath: vi.fn(overrides?.realpath ?? defaultRealpath),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ""),
    readdir: vi.fn(async () => []),
  } as unknown as NodeFs;
}

/** Build an AuditLog stub that collects appended entries. */
function makeAuditStub(): AuditLog & { _entries: AuditEntry[] } {
  const _entries: AuditEntry[] = [];
  return {
    _entries,
    append: vi.fn(async (entry: AuditEntry) => {
      _entries.push(entry);
    }),
    iterate: vi.fn(async function* () {}),
    purgeAll: vi.fn(async () => {}),
  } as unknown as AuditLog & { _entries: AuditEntry[] };
}

/** Scope validator factory that always returns OK unless overridden. */
function makeScopeValidator(result: Result<void, ScopeViolation> = { ok: true, value: undefined }) {
  return vi.fn(async () => result);
}

/** A minimal export folder rule. */
function makeFolderRule(overrides?: Partial<ExportFolderRule>): ExportFolderRule {
  return {
    id: "rule-folder-1" as ReturnType<typeof String> & { readonly __brand: "RuleId" },
    name: "Export Folder",
    everyMinutes: 60,
    action: "copy",
    onCollision: "skip",
    flattenOnTarget: false,
    dryRun: false,
    direction: "export",
    sourceType: "folder",
    sourceVaultPath: "Notes" as ReturnType<typeof String> & { readonly __brand: "VaultRelativePath" },
    destinationPath: DEST_DIR as ReturnType<typeof String> & { readonly __brand: "AbsolutePath" },
    ...overrides,
  } as ExportFolderRule;
}

/** A minimal export tag rule. */
function makeTagRule(overrides?: Partial<ExportTagRule>): ExportTagRule {
  return {
    id: "rule-tag-1" as ReturnType<typeof String> & { readonly __brand: "RuleId" },
    name: "Export Tag",
    everyMinutes: 60,
    action: "copy",
    onCollision: "skip",
    flattenOnTarget: false,
    dryRun: false,
    direction: "export",
    sourceType: "tag",
    tags: ["#projects"],
    tagMatch: "any",
    destinationPath: DEST_DIR as ReturnType<typeof String> & { readonly __brand: "AbsolutePath" },
    ...overrides,
  } as ExportTagRule;
}

/** A minimal export note rule. */
function makeNoteRule(overrides?: Partial<ExportNoteRule>): ExportNoteRule {
  return {
    id: "rule-note-1" as ReturnType<typeof String> & { readonly __brand: "RuleId" },
    name: "Export Note",
    everyMinutes: 60,
    action: "copy",
    onCollision: "skip",
    flattenOnTarget: false,
    dryRun: false,
    direction: "export",
    sourceType: "note",
    sourceVaultNotePath: "Notes/MyNote.md" as ReturnType<typeof String> & { readonly __brand: "VaultRelativePath" },
    destinationPath: DEST_DIR as ReturnType<typeof String> & { readonly __brand: "AbsolutePath" },
    ...overrides,
  } as ExportNoteRule;
}

/** Build an ExportRunner with all defaults filled in. */
function makeRunner(opts?: {
  vault?: VaultIo;
  fs?: NodeFs;
  audit?: AuditLog & { _entries: AuditEntry[] };
  scopeValidator?: ReturnType<typeof makeScopeValidator>;
}) {
  const audit = opts?.audit ?? makeAuditStub();
  const vault = opts?.vault ?? makeVaultStub();
  const fs = opts?.fs ?? makeFsStub();
  const scopeValidator = opts?.scopeValidator ?? makeScopeValidator();

  const runner = new ExportRunner({
    auditLog: audit,
    nodeFs: fs,
    vaultIo: vault,
    validateScope: scopeValidator,
    vaultRoot: VAULT_ROOT,
    pluginDir: PLUGIN_DIR,
    nowFn: () => new Date("2026-05-01T00:00:00.000Z"),
  });

  return { runner, audit, vault, fs, scopeValidator };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("ExportRunner — construction", () => {
  it("exposes a single public run() method", () => {
    const { runner } = makeRunner();
    expect(typeof runner.run).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// sourceType: folder — enumeration
// ---------------------------------------------------------------------------

describe("ExportRunner — sourceType: folder", () => {
  it("calls vaultIo.listFolder with recursive=true", async () => {
    const vault = makeVaultStub();
    const { runner } = makeRunner({ vault });
    const rule = makeFolderRule();

    await runner.run(rule);

    expect(vault.listFolder).toHaveBeenCalledWith(
      rule.sourceVaultPath,
      { recursive: true },
    );
  });

  it("writes each file to the destination and appends ok entries", async () => {
    const file = createMockTFile({ path: "Notes/hello.md", name: "hello.md", stat: { mtime: 5000 } });
    const buf = new ArrayBuffer(8);
    const vault = makeVaultStub({
      listFolder: async () => [file],
      readBinary: async () => buf,
    });
    // Default lstat: directories everywhere, no files at destination (no collision).
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ onCollision: "skip" }));

    // A binary write happened for the file
    expect(fs.writeFileBinary).toHaveBeenCalled();
    // mtime was preserved
    expect(fs.utimes).toHaveBeenCalledWith(expect.stringContaining("hello.md"), file.stat.mtime);
    // audit has per-file + rule-level entry
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("ok");
    expect(decisions).toContain("rule-ok");
  });

  it("applies flattenOnTarget=true: writes to dest/<name> not dest/<subdir>/<name>", async () => {
    const file = createMockTFile({ path: "Notes/sub/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no collision, directories everywhere
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ flattenOnTarget: true, onCollision: "skip" }));

    // All writes go directly under DEST_DIR (no sub/ subdirectory)
    const writeCalls = vi.mocked(fs.writeFileBinary).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    // The temp file path contains the dest dir
    const tmpPath: string = writeCalls[0][0] as string;
    // There should be no intermediate "sub" segment between DEST_DIR and the name
    expect(tmpPath.startsWith(`${DEST_DIR}/note.md.tmp.`)).toBe(true);
  });

  it("applies flattenOnTarget=false: preserves subdirectory under destination", async () => {
    const file = createMockTFile({ path: "Notes/sub/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    const fs = makeFsStub({
      lstat: async (path: string) => ({
        isSymbolicLink: () => false,
        isDirectory: () => path === DEST_DIR || path === `${DEST_DIR}/sub`,
        isFile: () => false,
        mtimeMs: 1000,
        size: 100,
      }),
    });
    const { runner } = makeRunner({ vault, fs });

    await runner.run(makeFolderRule({ flattenOnTarget: false }));

    const writeCalls = vi.mocked(fs.writeFileBinary).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const tmpPath: string = writeCalls[0][0] as string;
    expect(tmpPath).toContain("sub");
  });

  it("skips on collision when onCollision=skip and file exists at destination", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Make the destination file appear to exist (lstat returns isFile=true)
    const fs = makeFsStub({
      lstat: async (path: string) => ({
        isSymbolicLink: () => false,
        isDirectory: () => path === DEST_DIR,
        isFile: () => path !== DEST_DIR,
        mtimeMs: 1000,
        size: 100,
      }),
    });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ onCollision: "skip" }));

    // No binary write should happen
    expect(fs.writeFileBinary).not.toHaveBeenCalled();
    // A skipped entry should be present
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("skipped");
  });

  it("action=move deletes vault note after successful FS write", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no collision (isFile=false everywhere)
    const fs = makeFsStub();
    const { runner } = makeRunner({ vault, fs });

    await runner.run(makeFolderRule({ action: "move", onCollision: "suffix" }));

    expect(vault.deleteNote).toHaveBeenCalledWith(file);
  });

  it("action=copy does NOT delete vault note", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no collision
    const fs = makeFsStub();
    const { runner } = makeRunner({ vault, fs });

    await runner.run(makeFolderRule({ action: "copy", onCollision: "suffix" }));

    expect(vault.deleteNote).not.toHaveBeenCalled();
  });

  it("dry-run produces would-write entries and no real writes", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no files at destination, parent exists
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ dryRun: true, onCollision: "suffix" }));

    expect(fs.writeFileBinary).not.toHaveBeenCalled();
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("would-write");
  });

  it("mtime IS preserved on export (utimes called with vault note mtime)", async () => {
    const mtime = 1_700_000_000_000;
    const file = createMockTFile({
      path: "Notes/note.md",
      name: "note.md",
      stat: { mtime },
    });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no files at destination, parent exists (no collision)
    const fs = makeFsStub();
    const { runner } = makeRunner({ vault, fs });

    await runner.run(makeFolderRule({ onCollision: "suffix" }));

    expect(fs.utimes).toHaveBeenCalledWith(
      expect.stringContaining("note.md"),
      mtime,
    );
  });
});

// ---------------------------------------------------------------------------
// sourceType: tag — tag dispatch and nested-tag inclusion (ADR-11)
// ---------------------------------------------------------------------------

describe("ExportRunner — sourceType: tag", () => {
  it("calls vaultIo.notesByTag with the rule's tags and tagMatch", async () => {
    const vault = makeVaultStub();
    const { runner } = makeRunner({ vault });
    const rule = makeTagRule({ tags: ["#projects"], tagMatch: "any" });

    await runner.run(rule);

    expect(vault.notesByTag).toHaveBeenCalledWith(["#projects"], "any");
  });

  it("tag rule with tagMatch=all passes both tags to notesByTag", async () => {
    const vault = makeVaultStub();
    const { runner } = makeRunner({ vault });
    const rule = makeTagRule({ tags: ["#projects", "#work"], tagMatch: "all" });

    await runner.run(rule);

    expect(vault.notesByTag).toHaveBeenCalledWith(["#projects", "#work"], "all");
  });

  it("exports files returned by notesByTag and appends ok entries", async () => {
    const file = createMockTFile({ path: "Projects/task.md", name: "task.md", stat: { mtime: 3000 } });
    const vault = makeVaultStub({ notesByTag: async () => [file] });
    // Default lstat: no files at destination (no collision)
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeTagRule({ onCollision: "suffix" }));

    expect(fs.writeFileBinary).toHaveBeenCalled();
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("ok");
    expect(decisions).toContain("rule-ok");
  });

  it("nested tags: #projects matches #projects/foo (delegated to notesByTag per ADR-11)", async () => {
    // The nested-tag logic lives inside VaultIo.notesByTag — here we just verify
    // ExportRunner passes through the tags/tagMatch so the delegation is correct.
    const file = createMockTFile({ path: "Projects/foo.md", name: "foo.md" });
    const vault = makeVaultStub({
      // Simulates VaultIo returning a file whose tag is #projects/foo
      notesByTag: async () => [file],
    });
    // Default lstat: no files at destination (no collision)
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeTagRule({ tags: ["#projects"], tagMatch: "any", onCollision: "suffix" }));

    // The file from the nested tag was exported
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("ok");
  });

  it("empty tag result still appends rule-ok", async () => {
    const vault = makeVaultStub({ notesByTag: async () => [] });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, audit });

    await runner.run(makeTagRule());

    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("rule-ok");
    expect(decisions).not.toContain("ok");
  });
});

// ---------------------------------------------------------------------------
// sourceType: note — single-note dispatch
// ---------------------------------------------------------------------------

describe("ExportRunner — sourceType: note", () => {
  it("resolves the note path via vaultIo.fileByPath", async () => {
    const vault = makeVaultStub();
    const { runner } = makeRunner({ vault });
    const rule = makeNoteRule();

    await runner.run(rule);

    expect(vault.fileByPath).toHaveBeenCalledWith(rule.sourceVaultNotePath);
  });

  it("exports the resolved note and appends ok entry", async () => {
    const file = createMockTFile({ path: "Notes/MyNote.md", name: "MyNote.md", stat: { mtime: 9000 } });
    const buf = new ArrayBuffer(16);
    const vault = makeVaultStub({
      fileByPath: () => file,
      readBinary: async () => buf,
    });
    // Default lstat: no files at destination (no collision), parent exists
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeNoteRule({ onCollision: "suffix" }));

    expect(fs.writeFileBinary).toHaveBeenCalled();
    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("ok");
    expect(decisions).toContain("rule-ok");
  });

  it("fails with source-not-found when fileByPath returns null", async () => {
    const vault = makeVaultStub({ fileByPath: () => null });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, audit });

    await runner.run(makeNoteRule());

    const failures = audit._entries.filter((e) => e.errorCode === "source-not-found");
    expect(failures).toHaveLength(1);
    expect(failures[0].decision).toBe("rule-failed");
  });

  it("source-not-found produces no per-file entries — only rule-level failure", async () => {
    const vault = makeVaultStub({ fileByPath: () => null });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, audit });

    await runner.run(makeNoteRule());

    // Only one entry: the rule-level failure
    expect(audit._entries).toHaveLength(1);
    expect(audit._entries[0].decision).toBe("rule-failed");
  });

  it("action=move deletes the note after successful write", async () => {
    const file = createMockTFile({ path: "Notes/MyNote.md", name: "MyNote.md" });
    const vault = makeVaultStub({
      fileByPath: () => file,
      readBinary: async () => new ArrayBuffer(8),
    });
    // Default lstat: no files at destination (no collision)
    const fs = makeFsStub();
    const { runner } = makeRunner({ vault, fs });

    await runner.run(makeNoteRule({ action: "move", onCollision: "suffix" }));

    expect(vault.deleteNote).toHaveBeenCalledWith(file);
  });
});

// ---------------------------------------------------------------------------
// destination-parent-missing
// ---------------------------------------------------------------------------

describe("ExportRunner — destination-parent-missing", () => {
  it("fails rule with destination-parent-missing when parent dir of destinationPath does not exist", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Parent dir lstat throws (not found)
    const fs = makeFsStub({
      lstat: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule());

    const failures = audit._entries.filter((e) => e.errorCode === "destination-parent-missing");
    expect(failures).toHaveLength(1);
    expect(failures[0].decision).toBe("rule-failed");
  });

  it("destination-parent-missing produces no per-file entries", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    const fs = makeFsStub({
      lstat: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule());

    expect(audit._entries).toHaveLength(1);
    expect(audit._entries[0].decision).toBe("rule-failed");
  });
});

// ---------------------------------------------------------------------------
// Scope validation failure
// ---------------------------------------------------------------------------

describe("ExportRunner — scope validation", () => {
  it("fails rule when scope validator rejects", async () => {
    const violation: ScopeViolation = {
      reason: "vault-loop",
      path: DEST_DIR,
      detail: "destination inside vault",
    };
    const scopeValidator = makeScopeValidator({ ok: false, errors: violation });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ scopeValidator, audit });

    await runner.run(makeFolderRule());

    const failures = audit._entries.filter((e) => e.decision === "rule-failed");
    expect(failures.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// rule-level summary decisions
// ---------------------------------------------------------------------------

describe("ExportRunner — rule-level summary", () => {
  it("appends rule-ok when all files exported successfully", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no files at destination (no collision)
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ onCollision: "suffix" }));

    const last = audit._entries.at(-1);
    expect(last?.decision).toBe("rule-ok");
  });

  it("appends rule-ok for an empty folder (no files = no failures)", async () => {
    const vault = makeVaultStub({ listFolder: async () => [] });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, audit });

    await runner.run(makeFolderRule());

    const last = audit._entries.at(-1);
    expect(last?.decision).toBe("rule-ok");
  });

  it("audit entries carry direction=export", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    // Default lstat: no files at destination (no collision)
    const fs = makeFsStub();
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ onCollision: "suffix" }));

    for (const entry of audit._entries) {
      expect(entry.direction).toBe("export");
    }
  });

  it("dry-run with skipped file produces would-skip entry", async () => {
    const file = createMockTFile({ path: "Notes/note.md", name: "note.md" });
    const vault = makeVaultStub({ listFolder: async () => [file] });
    const fs = makeFsStub({
      lstat: async (path: string) => ({
        isSymbolicLink: () => false,
        isDirectory: () => path === DEST_DIR,
        isFile: () => path !== DEST_DIR, // destination file already exists
        mtimeMs: 1000,
        size: 100,
      }),
    });
    const audit = makeAuditStub();
    const { runner } = makeRunner({ vault, fs, audit });

    await runner.run(makeFolderRule({ dryRun: true, onCollision: "skip" }));

    const decisions = audit._entries.map((e) => e.decision);
    expect(decisions).toContain("would-skip");
  });
});
