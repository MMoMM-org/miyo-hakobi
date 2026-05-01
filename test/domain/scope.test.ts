// Tests for src/domain/scope.ts — default-deny scope checks (T1.2).
// Covers PRD/F9 acceptance criteria and SDD/Default-Deny Criteria:
//  - rule cannot loop (vault-internal source AND destination)
//  - vault-root / .obsidian / plugin-data-dir refusal
//  - realpath escape (symlink trap, `..` chain)
//  - symlink at rule root or enumerated child
//  - absolute paths / `..` segments inside filenames
//  - 100% line coverage required by SDD/Quality Requirements/Security.

import { describe, it, expect } from "vitest";
import {
  isInsideRoot,
  isVaultPath,
  isForbiddenVaultPath,
  validateRuleAtSave,
  validateRuleAtRunTime,
  type FsScopeAdapter,
  type VaultIoScopeAdapter,
  type ScopeViolation,
} from "../../src/domain/scope";
import {
  type AbsolutePath,
  type ImportRule,
  type ExportFolderRule,
  type ExportTagRule,
  type ExportNoteRule,
  type RuleId,
  type VaultRelativePath,
} from "../../src/domain/rule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VAULT_ROOT = "/Users/me/Vault" as AbsolutePath;
const PLUGIN_DIR = "/Users/me/Vault/.obsidian/plugins/miyo-hakobi" as AbsolutePath;

const RULE_BASE = {
  id: "550e8400-e29b-41d4-a716-446655440000" as RuleId,
  name: "My rule",
  everyMinutes: 5,
  action: "copy" as const,
  onCollision: "skip" as const,
  flattenOnTarget: false,
  dryRun: false,
};

const importRule = (
  overrides: Partial<ImportRule> = {},
): ImportRule => ({
  ...RULE_BASE,
  direction: "import",
  sourcePath: "/Users/me/Downloads" as AbsolutePath,
  destinationVaultPath: "Inbox" as VaultRelativePath,
  ...overrides,
});

const exportFolderRule = (
  overrides: Partial<ExportFolderRule> = {},
): ExportFolderRule => ({
  ...RULE_BASE,
  direction: "export",
  sourceType: "folder",
  sourceVaultPath: "Projects" as VaultRelativePath,
  destinationPath: "/Users/me/Backup/Projects" as AbsolutePath,
  ...overrides,
});

const exportTagRule = (
  overrides: Partial<ExportTagRule> = {},
): ExportTagRule => ({
  ...RULE_BASE,
  direction: "export",
  sourceType: "tag",
  tags: ["#projects"],
  tagMatch: "any",
  destinationPath: "/Users/me/Backup/Tags" as AbsolutePath,
  ...overrides,
});

const exportNoteRule = (
  overrides: Partial<ExportNoteRule> = {},
): ExportNoteRule => ({
  ...RULE_BASE,
  direction: "export",
  sourceType: "note",
  sourceVaultNotePath: "Daily/2026-04-30.md" as VaultRelativePath,
  destinationPath: "/Users/me/Backup/Daily" as AbsolutePath,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isInsideRoot", () => {
  it("returns true when path is strictly inside root", () => {
    expect(isInsideRoot("/Users/me/Vault/Inbox/file.md", "/Users/me/Vault")).toBe(true);
  });

  it("returns true when path is deeply nested under root", () => {
    expect(
      isInsideRoot("/Users/me/Vault/a/b/c/d/file.md", "/Users/me/Vault"),
    ).toBe(true);
  });

  it("returns false when path equals root (not strictly inside)", () => {
    expect(isInsideRoot("/Users/me/Vault", "/Users/me/Vault")).toBe(false);
  });

  it("returns false for sibling sharing the same string prefix", () => {
    // /foo/bar2 is NOT inside /foo/bar — must use a path-segment boundary, not raw startsWith.
    expect(isInsideRoot("/foo/bar2/file", "/foo/bar")).toBe(false);
  });

  it("returns false when input contains a `..` segment", () => {
    expect(isInsideRoot("/Users/me/Vault/../Other/file", "/Users/me/Vault")).toBe(false);
  });

  it("returns false when path is completely outside root", () => {
    expect(isInsideRoot("/etc/passwd", "/Users/me/Vault")).toBe(false);
  });

  it("normalizes a trailing slash on root", () => {
    expect(isInsideRoot("/Users/me/Vault/Inbox", "/Users/me/Vault/")).toBe(true);
  });
});

describe("isVaultPath", () => {
  it("returns true for an absolute path inside the vault", () => {
    expect(isVaultPath("/Users/me/Vault/Inbox/file.md", VAULT_ROOT)).toBe(true);
  });

  it("returns false for an absolute path outside the vault", () => {
    expect(isVaultPath("/Users/me/Downloads/file.md", VAULT_ROOT)).toBe(false);
  });

  it("returns true when the path equals the vault root itself", () => {
    expect(isVaultPath("/Users/me/Vault", VAULT_ROOT)).toBe(true);
  });

  it("returns false for any path containing a `..` segment (defence-in-depth)", () => {
    expect(isVaultPath("/Users/me/Vault/../Other", VAULT_ROOT)).toBe(false);
  });
});

describe("isForbiddenVaultPath", () => {
  it("returns true for the vault root itself", () => {
    expect(isForbiddenVaultPath(VAULT_ROOT, VAULT_ROOT, PLUGIN_DIR)).toBe(true);
  });

  it("returns true for the .obsidian directory", () => {
    expect(isForbiddenVaultPath("/Users/me/Vault/.obsidian", VAULT_ROOT, PLUGIN_DIR)).toBe(true);
  });

  it("returns true for any subpath under .obsidian", () => {
    expect(
      isForbiddenVaultPath(
        "/Users/me/Vault/.obsidian/plugins/other/data.json",
        VAULT_ROOT,
        PLUGIN_DIR,
      ),
    ).toBe(true);
  });

  it("returns true for the plugin data directory itself", () => {
    expect(isForbiddenVaultPath(PLUGIN_DIR, VAULT_ROOT, PLUGIN_DIR)).toBe(true);
  });

  it("returns true for any subpath under the plugin data directory", () => {
    expect(
      isForbiddenVaultPath(
        "/Users/me/Vault/.obsidian/plugins/miyo-hakobi/data.json",
        VAULT_ROOT,
        PLUGIN_DIR,
      ),
    ).toBe(true);
  });

  it("returns false for a normal vault folder", () => {
    expect(
      isForbiddenVaultPath("/Users/me/Vault/Inbox", VAULT_ROOT, PLUGIN_DIR),
    ).toBe(false);
  });

  it("returns false for a path completely outside the vault", () => {
    expect(
      isForbiddenVaultPath("/etc/passwd", VAULT_ROOT, PLUGIN_DIR),
    ).toBe(false);
  });

  it("returns true for any path containing a `..` segment (defence-in-depth)", () => {
    expect(
      isForbiddenVaultPath("/Users/me/Vault/Inbox/../.obsidian", VAULT_ROOT, PLUGIN_DIR),
    ).toBe(true);
  });

  it("returns false when pluginDir is at filesystem root and grandparent cannot be derived", () => {
    // Edge case: a degenerate pluginDir like "/x" has no usable grandparent.
    // Should still safely return false for paths outside the configured fences.
    expect(
      isForbiddenVaultPath("/Users/me/Vault/Inbox", VAULT_ROOT, "/x" as AbsolutePath),
    ).toBe(false);
  });

  it("returns false when pluginDir's grandparent is not inside the vault", () => {
    // pluginDir set entirely outside the vault — grandparent derivation must
    // not extend the forbidden fence outside the vault.
    expect(
      isForbiddenVaultPath(
        "/Users/me/Vault/Inbox",
        VAULT_ROOT,
        "/elsewhere/plugins/p" as AbsolutePath,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRuleAtSave
// ---------------------------------------------------------------------------

describe("validateRuleAtSave", () => {
  it("accepts a well-formed ImportRule (FS source, vault destination)", () => {
    const result = validateRuleAtSave(importRule(), VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed ExportFolderRule (vault source, FS destination)", () => {
    const result = validateRuleAtSave(exportFolderRule(), VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed ExportTagRule (FS destination)", () => {
    const result = validateRuleAtSave(exportTagRule(), VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed ExportNoteRule (vault note source, FS destination)", () => {
    const result = validateRuleAtSave(exportNoteRule(), VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  // ── Vault-loop refusal (PRD F9 — both source and destination inside vault) ──

  it("rejects an ImportRule whose external source resolves inside the vault (vault-loop)", () => {
    const rule = importRule({
      sourcePath: "/Users/me/Vault/SomeFolder" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("vault-loop");
    }
  });

  it("rejects an ExportFolderRule whose external destination resolves inside the vault", () => {
    const rule = exportFolderRule({
      destinationPath: "/Users/me/Vault/Backup" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("vault-loop");
    }
  });

  it("rejects an ExportTagRule whose external destination resolves inside the vault", () => {
    const rule = exportTagRule({
      destinationPath: "/Users/me/Vault/TagBackup" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("vault-loop");
    }
  });

  it("rejects an ExportNoteRule whose external destination resolves inside the vault", () => {
    const rule = exportNoteRule({
      destinationPath: "/Users/me/Vault/NoteBackup" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("vault-loop");
    }
  });

  // ── Forbidden-path refusal (vault root, .obsidian/, plugin dir) ─────────────

  it("rejects an ImportRule whose destinationVaultPath is the vault root", () => {
    const rule = importRule({ destinationVaultPath: "" as VaultRelativePath });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  it("rejects an ImportRule whose destinationVaultPath is .obsidian", () => {
    const rule = importRule({ destinationVaultPath: ".obsidian" as VaultRelativePath });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  it("rejects an ImportRule whose destinationVaultPath is inside .obsidian", () => {
    const rule = importRule({
      destinationVaultPath: ".obsidian/plugins/miyo-hakobi" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  it("rejects an ExportFolderRule whose sourceVaultPath is the vault root", () => {
    const rule = exportFolderRule({ sourceVaultPath: "" as VaultRelativePath });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  it("rejects an ExportFolderRule whose sourceVaultPath is .obsidian", () => {
    const rule = exportFolderRule({
      sourceVaultPath: ".obsidian" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  it("rejects an ExportNoteRule whose sourceVaultNotePath points to the plugin data dir", () => {
    const rule = exportNoteRule({
      sourceVaultNotePath: ".obsidian/plugins/miyo-hakobi/data.json" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("forbidden-path");
    }
  });

  // ── Traversal refusal (`..` segments and absolute paths in vault paths) ─────

  it("rejects an ImportRule whose destinationVaultPath contains `..`", () => {
    const rule = importRule({
      destinationVaultPath: "Inbox/../.obsidian" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ExportFolderRule whose sourceVaultPath contains `..`", () => {
    const rule = exportFolderRule({
      sourceVaultPath: "Projects/../.obsidian" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ImportRule whose sourcePath contains `..`", () => {
    const rule = importRule({
      sourcePath: "/Users/me/Downloads/../../etc" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ExportFolderRule whose destinationPath contains `..`", () => {
    const rule = exportFolderRule({
      destinationPath: "/Users/me/Backup/../../etc" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects a vault-relative path that starts with `/` (absolute-in-vault-path is wrong shape)", () => {
    const rule = importRule({
      destinationVaultPath: "/absolute/in/vault" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects a sourcePath that is not absolute (relative FS path)", () => {
    const rule = importRule({
      sourcePath: "relative/path" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ExportTagRule whose destinationPath is not absolute", () => {
    const rule = exportTagRule({
      destinationPath: "relative/backup" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ExportNoteRule whose sourceVaultNotePath contains `..`", () => {
    const rule = exportNoteRule({
      sourceVaultNotePath: "Daily/../escape.md" as VaultRelativePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });

  it("rejects an ExportNoteRule whose destinationPath is not absolute", () => {
    const rule = exportNoteRule({
      destinationPath: "relative/backup" as AbsolutePath,
    });
    const result = validateRuleAtSave(rule, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("traversal");
    }
  });
});

// ---------------------------------------------------------------------------
// validateRuleAtRunTime — DI fakes
// ---------------------------------------------------------------------------

interface FsFakeOptions {
  realpaths?: Record<string, string>;
  symlinks?: Set<string>;
  // throw on missing entries to make tests explicit
  strict?: boolean;
}

function makeFs(opts: FsFakeOptions = {}): FsScopeAdapter {
  const realpaths = opts.realpaths ?? {};
  const symlinks = opts.symlinks ?? new Set<string>();
  return {
    realpath: async (p: string): Promise<string> => {
      if (p in realpaths) return realpaths[p] as string;
      if (opts.strict) throw new Error(`realpath: unexpected path ${p}`);
      return p;
    },
    lstat: async (p: string): Promise<{ isSymbolicLink(): boolean }> => {
      const isLink = symlinks.has(p);
      return { isSymbolicLink: () => isLink };
    },
  };
}

function makeVaultIo(
  vaultRoot: string,
  existing: Set<string> = new Set(),
): VaultIoScopeAdapter {
  return {
    existsAtVaultPath: (p: string): boolean => existing.has(p),
    resolveVaultPath: (p: string): string => {
      const trimmed = p.replace(/^\/+/, "");
      return trimmed === "" ? vaultRoot : `${vaultRoot}/${trimmed}`;
    },
  };
}

describe("validateRuleAtRunTime", () => {
  it("accepts a happy-path ImportRule (no symlinks, realpath identity)", async () => {
    const rule = importRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a happy-path ExportFolderRule (vault source not symlinked, destination outside vault)", async () => {
    const rule = exportFolderRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a happy-path ExportNoteRule (resolves vault note path through adapter)", async () => {
    const rule = exportNoteRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("accepts a happy-path ExportTagRule (no FS source root; only checks vault-loop on destination)", async () => {
    const rule = exportTagRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(true);
  });

  it("rejects an ImportRule when realpath(sourcePath) escapes the declared root (symlink trap)", async () => {
    const rule = importRule({
      sourcePath: "/Users/me/Downloads/symlinked-folder" as AbsolutePath,
    });
    const fs = makeFs({
      realpaths: {
        "/Users/me/Downloads/symlinked-folder": "/etc",
      },
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("escape");
    }
  });

  it("rejects an ImportRule whose sourcePath is itself a symlink (lstat reports symlink)", async () => {
    const rule = importRule({
      sourcePath: "/Users/me/Downloads/voice-link" as AbsolutePath,
    });
    const fs = makeFs({
      symlinks: new Set(["/Users/me/Downloads/voice-link"]),
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("symlink");
    }
  });

  it("rejects an ExportFolderRule whose vault source folder is a symlink", async () => {
    const rule = exportFolderRule({
      sourceVaultPath: "Projects" as VaultRelativePath,
    });
    const fs = makeFs({
      symlinks: new Set(["/Users/me/Vault/Projects"]),
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const result = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.reason).toBe("symlink");
    }
  });

  it("rejects when an enumerated child path is a symlink", async () => {
    const rule = importRule();
    const fs = makeFs({
      symlinks: new Set(["/Users/me/Downloads/leaked.lnk"]),
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const violation: ScopeViolation | null = await (async () => {
      const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
        children: ["/Users/me/Downloads/leaked.lnk"],
      });
      return r.ok ? null : r.errors;
    })();
    expect(violation).not.toBeNull();
    expect(violation?.reason).toBe("symlink");
    expect(violation?.path).toBe("/Users/me/Downloads/leaked.lnk");
  });

  it("rejects when a child path realpath-escapes the source root", async () => {
    const rule = importRule();
    const fs = makeFs({
      realpaths: {
        "/Users/me/Downloads/cousin": "/etc/passwd",
      },
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
      children: ["/Users/me/Downloads/cousin"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBe("escape");
    }
  });

  it("rejects when an enumerated child name contains an absolute path (defensive)", async () => {
    const rule = importRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
      childNames: ["/etc/passwd"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBe("absolute-in-filename");
    }
  });

  it("rejects when an enumerated child name contains a `..` segment (defensive)", async () => {
    const rule = importRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
      childNames: ["../../escape.txt"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBe("traversal");
    }
  });

  it("re-runs save-time scope checks at runtime (defence-in-depth)", async () => {
    // Source / dest configured benignly at save time, but we re-validate at run.
    // Here the destination resolves inside the vault — must be caught.
    const rule = exportFolderRule({
      destinationPath: "/Users/me/Vault/Sneaky" as AbsolutePath,
    });
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBe("vault-loop");
    }
  });

  it("rejects an ExportTagRule when its FS destination resolves into the vault via realpath", async () => {
    const rule = exportTagRule({
      destinationPath: "/Users/me/Backup/TagsLink" as AbsolutePath,
    });
    const fs = makeFs({
      realpaths: {
        "/Users/me/Backup/TagsLink": "/Users/me/Vault/Hidden",
      },
    });
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.reason).toBe("vault-loop");
    }
  });

  it("accepts when all childNames are well-formed (happy path covers loop closure)", async () => {
    const rule = importRule();
    const fs = makeFs();
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
      childNames: ["a.txt", "sub/b.txt"],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts when all enumerated children are not symlinks and stay inside root (happy path)", async () => {
    const rule = importRule();
    const fs = makeFs(); // realpath identity, no symlinks
    const vault = makeVaultIo(VAULT_ROOT);
    const r = await validateRuleAtRunTime(rule, fs, vault, VAULT_ROOT, PLUGIN_DIR, {
      children: [
        "/Users/me/Downloads/a.txt",
        "/Users/me/Downloads/sub/b.txt",
      ],
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defensive exhaustiveness (assertNever)
// ---------------------------------------------------------------------------

describe("validateRuleAtSave — defensive exhaustiveness", () => {
  it("throws when given a malformed export rule with an unknown sourceType", () => {
    // Force an invalid rule through the type system to verify the assertNever
    // guard fires at runtime — defensive code that should never run in normal use.
    const malformedExport = {
      ...RULE_BASE,
      direction: "export",
      sourceType: "INVALID",
      destinationPath: "/Users/me/Backup",
    } as unknown as Parameters<typeof validateRuleAtSave>[0];
    expect(() => validateRuleAtSave(malformedExport, VAULT_ROOT, PLUGIN_DIR)).toThrow();
  });

  it("throws when given a malformed rule with an unknown direction", () => {
    const malformed = {
      ...RULE_BASE,
      direction: "INVALID",
    } as unknown as Parameters<typeof validateRuleAtSave>[0];
    expect(() => validateRuleAtSave(malformed, VAULT_ROOT, PLUGIN_DIR)).toThrow();
  });
});
