// Default-deny scope checks for Hakobi rules.
// Why this file exists: every rule in Hakobi has a declared source root and a
// declared destination root. Before any read or write happens, we must reject
// any rule whose paths violate the trust boundary — vault loops, vault-internal
// system paths (vault root, .obsidian/, plugin data dir), realpath escapes
// (symlink traps), `..` traversal, and absolute paths inside filenames.
//
// The pure helpers (isInsideRoot, isVaultPath, isForbiddenVaultPath,
// validateRuleAtSave) take only path strings — no I/O — so save-time validation
// is deterministic and unit-testable. validateRuleAtRunTime takes minimal
// FsScopeAdapter / VaultIoScopeAdapter ports to add realpath + lstat checks
// without coupling to Node fs or Obsidian. Adapters are widened by T1.7/T1.8.
//
// Refs: PRD/F9, SDD/Acceptance Criteria/Default-Deny Criteria,
//       SDD/Cross-Cutting Concepts/System-Wide Patterns/Security,
//       SDD/Quality Requirements/Security (100% line coverage).

import {
  type Rule,
  type Result,
  assertNever,
} from "./rule";

// ---------------------------------------------------------------------------
// Adapter ports (DI)
//
// Kept minimal on purpose — only what scope.ts needs. T1.7 (FsAdapter) and
// T1.8 (VaultIoAdapter) will widen these to full transfer adapters; scope.ts
// will continue to depend on the narrow shapes below.
// ---------------------------------------------------------------------------

export interface FsScopeAdapter {
  /** POSIX realpath: resolves symlinks. Throws if path does not exist. */
  realpath(p: string): Promise<string>;
  /** lstat without following symlinks; only `isSymbolicLink()` is consumed here. */
  lstat(p: string): Promise<{ isSymbolicLink(): boolean }>;
}

export interface VaultIoScopeAdapter {
  /** True if `p` (vault-relative) currently exists in the vault. */
  existsAtVaultPath(p: string): boolean;
  /** Convert a vault-relative path to an absolute filesystem path. */
  resolveVaultPath(p: string): string;
}

// ---------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------

export type ScopeViolationReason =
  | "vault-loop"            // both source and destination resolve inside the vault
  | "forbidden-path"        // vault root, .obsidian/, plugin data dir
  | "symlink"               // a symlink at rule root or enumerated child
  | "escape"                // realpath escapes the declared root
  | "traversal"             // `..` segment in a path / filename
  | "absolute-in-filename"; // an enumerated child name is itself an absolute path

export interface ScopeViolation {
  reason: ScopeViolationReason;
  path: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Pure path helpers
// ---------------------------------------------------------------------------

/** Strip a trailing slash (but keep the root "/"). POSIX-only at this layer. */
function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function hasTraversalSegment(p: string): boolean {
  // Any segment equal to ".." anywhere in the path.
  return p.split(/[/\\]/).some((seg) => seg === "..");
}

/**
 * True iff `p` is strictly nested under `root` after path-segment-aware
 * comparison. `p === root` returns false (not strictly inside). Inputs with
 * `..` segments always return false — the caller must reject before relying
 * on this check, but we defend in depth.
 */
export function isInsideRoot(p: string, root: string): boolean {
  if (hasTraversalSegment(p)) return false;
  const a = stripTrailingSlash(p);
  const b = stripTrailingSlash(root);
  if (a === b) return false;
  return a.startsWith(`${b}/`);
}

/**
 * True iff `p` is the vault root or strictly inside the vault root.
 * Vault root itself is INCLUDED — isForbiddenVaultPath handles the refusal
 * for callers that need to refuse the root.
 */
export function isVaultPath(p: string, vaultRoot: string): boolean {
  if (hasTraversalSegment(p)) return false;
  const a = stripTrailingSlash(p);
  const b = stripTrailingSlash(vaultRoot);
  if (a === b) return true;
  return a.startsWith(`${b}/`);
}

/**
 * True iff `p` resolves to the vault root, the Obsidian config directory (or
 * any subpath thereof), or the plugin's data directory (or any subpath).
 *
 * The Obsidian config directory is derived from `pluginDir` — by convention
 * `pluginDir` is `<vault>/<configDir>/plugins/<id>` (Obsidian's `Vault#configDir`
 * defaults to `.obsidian` but is user-configurable, so we never hard-code it).
 * We compute the configDir as the grandparent of pluginDir relative to
 * vaultRoot; if the layout does not match the convention we fall back to
 * checking pluginDir alone.
 *
 * Paths outside the vault always return false — they are not "vault paths"
 * to forbid, they are simply non-vault.
 */
export function isForbiddenVaultPath(
  p: string,
  vaultRoot: string,
  pluginDir: string,
): boolean {
  if (hasTraversalSegment(p)) return true; // defence-in-depth
  const a = stripTrailingSlash(p);
  const v = stripTrailingSlash(vaultRoot);
  const plug = stripTrailingSlash(pluginDir);

  if (a === v) return true;
  if (a === plug || a.startsWith(`${plug}/`)) return true;

  // Try to derive the Obsidian config dir from the plugin dir convention:
  //   <vault>/<configDir>/plugins/<id>
  // grandparent(pluginDir) === <vault>/<configDir>.
  const parent = parentOf(plug);
  const grandparent = parent === null ? null : parentOf(parent);
  if (grandparent !== null && isInsideRoot(grandparent, v)) {
    if (a === grandparent || a.startsWith(`${grandparent}/`)) return true;
  }
  return false;
}

/** Return the parent directory of an absolute POSIX path, or null if at root. */
function parentOf(p: string): string | null {
  const stripped = stripTrailingSlash(p);
  const idx = stripped.lastIndexOf("/");
  if (idx <= 0) return null;
  return stripped.slice(0, idx);
}

// ---------------------------------------------------------------------------
// validateRuleAtSave
// ---------------------------------------------------------------------------

function violation(
  reason: ScopeViolationReason,
  path: string,
  detail?: string,
): Result<void, ScopeViolation> {
  return { ok: false, errors: { reason, path, detail } };
}

const OK: Result<void, ScopeViolation> = { ok: true, value: undefined };

function isAbsolutePosix(p: string): boolean {
  return p.startsWith("/");
}

/**
 * Checks a vault-relative path: must NOT start with `/` and must NOT contain
 * `..` segments. Empty string is allowed by callers that explicitly forbid it
 * separately (vault root case).
 */
function checkVaultRelative(p: string): Result<void, ScopeViolation> {
  if (isAbsolutePosix(p)) return violation("traversal", p, "vault-relative path must not be absolute");
  if (hasTraversalSegment(p)) return violation("traversal", p, "`..` segment in vault-relative path");
  return OK;
}

function checkAbsolute(p: string): Result<void, ScopeViolation> {
  if (!isAbsolutePosix(p)) return violation("traversal", p, "filesystem path must be absolute");
  if (hasTraversalSegment(p)) return violation("traversal", p, "`..` segment in absolute path");
  return OK;
}

/**
 * Reject a vault-relative path that resolves to the vault root, .obsidian/,
 * or plugin dir. Empty string === vault root.
 */
function checkVaultRelativeNotForbidden(
  vrel: string,
  vaultRoot: string,
  pluginDir: string,
): Result<void, ScopeViolation> {
  const trimmed = vrel.replace(/^\/+/, "").replace(/\/+$/, "");
  const abs =
    trimmed === ""
      ? stripTrailingSlash(vaultRoot)
      : `${stripTrailingSlash(vaultRoot)}/${trimmed}`;
  if (isForbiddenVaultPath(abs, vaultRoot, pluginDir)) {
    return violation(
      "forbidden-path",
      vrel,
      "resolves to vault root, Obsidian config dir, or plugin data dir",
    );
  }
  return OK;
}

/**
 * Save-time scope check.
 *
 * Pure function: only inspects the rule's declared paths (no FS, no Vault).
 * Catches the cheap, deterministic violations:
 *  - vault-loop (both source and destination inside the vault)
 *  - forbidden vault paths (root, .obsidian/, plugin dir)
 *  - traversal segments / absolute paths in the wrong shape
 *
 * Run-time validation (validateRuleAtRunTime) re-runs this and adds
 * realpath/lstat checks.
 */
export function validateRuleAtSave(
  rule: Rule,
  vaultRoot: string,
  pluginDir: string,
): Result<void, ScopeViolation> {
  if (rule.direction === "import") {
    // Source is FS, destination is vault.
    const srcCheck = checkAbsolute(rule.sourcePath);
    if (!srcCheck.ok) return srcCheck;

    const destShape = checkVaultRelative(rule.destinationVaultPath);
    if (!destShape.ok) return destShape;

    const destForbidden = checkVaultRelativeNotForbidden(
      rule.destinationVaultPath,
      vaultRoot,
      pluginDir,
    );
    if (!destForbidden.ok) return destForbidden;

    // Vault-loop: an FS source that resolves into the vault.
    if (isVaultPath(rule.sourcePath, vaultRoot)) {
      return violation(
        "vault-loop",
        rule.sourcePath,
        "import sourcePath resolves inside the vault",
      );
    }
    return OK;
  }

  if (rule.direction === "export") {
    if (rule.sourceType === "folder") {
      const vrelShape = checkVaultRelative(rule.sourceVaultPath);
      if (!vrelShape.ok) return vrelShape;

      const srcForbidden = checkVaultRelativeNotForbidden(
        rule.sourceVaultPath,
        vaultRoot,
        pluginDir,
      );
      if (!srcForbidden.ok) return srcForbidden;

      const destShape = checkAbsolute(rule.destinationPath);
      if (!destShape.ok) return destShape;

      if (isVaultPath(rule.destinationPath, vaultRoot)) {
        return violation(
          "vault-loop",
          rule.destinationPath,
          "export destinationPath resolves inside the vault",
        );
      }
      return OK;
    }

    if (rule.sourceType === "tag") {
      const destShape = checkAbsolute(rule.destinationPath);
      if (!destShape.ok) return destShape;

      if (isVaultPath(rule.destinationPath, vaultRoot)) {
        return violation(
          "vault-loop",
          rule.destinationPath,
          "export destinationPath resolves inside the vault",
        );
      }
      return OK;
    }

    if (rule.sourceType === "note") {
      const vrelShape = checkVaultRelative(rule.sourceVaultNotePath);
      if (!vrelShape.ok) return vrelShape;

      const srcForbidden = checkVaultRelativeNotForbidden(
        rule.sourceVaultNotePath,
        vaultRoot,
        pluginDir,
      );
      if (!srcForbidden.ok) return srcForbidden;

      const destShape = checkAbsolute(rule.destinationPath);
      if (!destShape.ok) return destShape;

      if (isVaultPath(rule.destinationPath, vaultRoot)) {
        return violation(
          "vault-loop",
          rule.destinationPath,
          "export destinationPath resolves inside the vault",
        );
      }
      return OK;
    }

    // Exhaustiveness: an unknown sourceType is a compile-time error.
    return assertNever(rule);
  }

  return assertNever(rule);
}

// ---------------------------------------------------------------------------
// validateRuleAtRunTime
// ---------------------------------------------------------------------------

export interface RunTimeOptions {
  /** Optional already-enumerated child paths (absolute) under the source root. */
  children?: readonly string[];
  /**
   * Optional child names (basenames or sub-paths under the source root) that
   * the caller intends to use. Each entry must NOT be absolute and must NOT
   * contain a `..` segment — defensive check before any path join.
   */
  childNames?: readonly string[];
}

/**
 * Run-time scope check.
 *
 * Re-runs save-time checks (defence-in-depth) and additionally:
 *  - lstat on the rule's source root (refuse if it is a symlink)
 *  - realpath on the rule's source root (refuse if it escapes the declared root)
 *  - realpath on the rule's external destination (refuse if it escapes into the vault)
 *  - lstat on every enumerated child (refuse symlinks)
 *  - realpath on every enumerated child (refuse escapes from source root)
 *  - shape-validate every child name (no absolute paths, no `..` segments)
 *
 * Determinism: given the same rule, vaultRoot, pluginDir, and adapter responses,
 * the result is identical (no clock, no env, no globals).
 */
export async function validateRuleAtRunTime(
  rule: Rule,
  fs: FsScopeAdapter,
  vault: VaultIoScopeAdapter,
  vaultRoot: string,
  pluginDir: string,
  options: RunTimeOptions = {},
): Promise<Result<void, ScopeViolation>> {
  // 1. Save-time rules first — cheap and stops obviously broken rules early.
  const saveCheck = validateRuleAtSave(rule, vaultRoot, pluginDir);
  if (!saveCheck.ok) return saveCheck;

  // 2. Determine the source root (FS or vault) and the external destination
  //    (FS, if any) that needs realpath/lstat checks.
  const sourceRootAbs = resolveSourceRootAbs(rule, vault);
  const externalDestAbs = resolveExternalDestAbs(rule);

  // 3. Symlink check at source root.
  const srcLstat = await fs.lstat(sourceRootAbs);
  if (srcLstat.isSymbolicLink()) {
    return violation("symlink", sourceRootAbs, "rule source root is a symlink");
  }

  // 4. Realpath escape check on source root.
  const realSrc = await fs.realpath(sourceRootAbs);
  if (realSrc !== sourceRootAbs && !isInsideRoot(realSrc, sourceRootAbs)) {
    return violation(
      "escape",
      sourceRootAbs,
      `realpath ${realSrc} escapes declared source root`,
    );
  }

  // 5. Realpath check on external destination — refuse if it lands in the vault.
  if (externalDestAbs !== null) {
    const realDest = await fs.realpath(externalDestAbs);
    if (isVaultPath(realDest, vaultRoot)) {
      return violation(
        "vault-loop",
        externalDestAbs,
        `destination realpath ${realDest} resolves inside the vault`,
      );
    }
  }

  // 6. Validate enumerated child name shapes (defensive — caller-supplied).
  if (options.childNames !== undefined) {
    for (const name of options.childNames) {
      if (isAbsolutePosix(name)) {
        return violation("absolute-in-filename", name, "child name is an absolute path");
      }
      if (hasTraversalSegment(name)) {
        return violation("traversal", name, "child name contains `..`");
      }
    }
  }

  // 7. Validate enumerated child paths (symlink + realpath escape).
  if (options.children !== undefined) {
    for (const child of options.children) {
      const childLstat = await fs.lstat(child);
      if (childLstat.isSymbolicLink()) {
        return violation("symlink", child, "enumerated child is a symlink");
      }
      const realChild = await fs.realpath(child);
      if (realChild !== child && !isInsideRoot(realChild, sourceRootAbs)) {
        return violation(
          "escape",
          child,
          `realpath ${realChild} escapes source root ${sourceRootAbs}`,
        );
      }
    }
  }

  return OK;
}

function resolveSourceRootAbs(rule: Rule, vault: VaultIoScopeAdapter): string {
  if (rule.direction === "import") return rule.sourcePath;
  if (rule.sourceType === "folder") return vault.resolveVaultPath(rule.sourceVaultPath);
  if (rule.sourceType === "note") return vault.resolveVaultPath(rule.sourceVaultNotePath);
  // tag rules don't have a single FS source root — use vault root for the
  // symlink/realpath check (the vault root is never a symlink under Obsidian's
  // assumptions, but we still check it for defence-in-depth).
  return vault.resolveVaultPath("");
}

function resolveExternalDestAbs(rule: Rule): string | null {
  if (rule.direction === "import") return null;
  return rule.destinationPath;
}
