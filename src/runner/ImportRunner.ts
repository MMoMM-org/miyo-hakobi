// ImportRunner — import side of the Hakobi file ferry (T2.5).
//
// WHY this file exists:
// Executes a single ImportRule: walks the source filesystem subtree, applies
// sanitization and scope/symlink checks, resolves collisions, and writes files
// atomically into the Obsidian vault. Produces NDJSON audit entries for every
// per-file decision and a single rule-level summary. References:
//   SDD §Runtime View/Complex Logic/ImportRunner.run
//   PRD/F1, PRD/F4, PRD/F9
//   SDD/Acceptance Criteria/Main Flow Criteria; Import
//
// BINARY I/O CAVEAT (v0.1):
// NodeFs.readFile returns a UTF-8 string (not raw bytes). We convert via
// TextEncoder().encode(str).buffer to produce an ArrayBuffer for the Vault API.
// This round-trip is lossless for valid UTF-8 text files (markdown, txt, etc.)
// but WILL corrupt true binary files (voice memos, images, PDFs). v0.1 scope is
// text-import only; a future task should extend NodeFs with a binary readFile
// (e.g. readBinary(): Promise<Buffer>) and update the write path here accordingly.

import { sanitizeFilename } from "../domain/sanitize";
import { type ImportRule } from "../domain/rule";
import type { Result } from "../domain/rule";
import {
  type ScopeViolation,
  type FsScopeAdapter,
  type VaultIoScopeAdapter,
} from "../domain/scope";
import {
  type NodeFs,
  IoNotFoundError,
  IoPermissionError,
  IoTimeoutError,
  IoUnknownError,
} from "../fs/NodeFs";
import type { VaultIo } from "../vault/VaultIo";
import { resolveCollisionName, writeVaultAtomic } from "./AtomicWriter";
import { mapScopeViolationToErrorCode } from "./errorCodeMapping";
import { type RunStats, EMPTY_STATS, tally } from "./RunStats";
import type { AuditLog } from "../audit/AuditLog";
import type { AuditEntry, ErrorCode } from "../audit/AuditEntry";

// ---------------------------------------------------------------------------
// Dependency injection surface
// ---------------------------------------------------------------------------

/** Scope validator injected into ImportRunner — wraps validateRuleAtRunTime. */
export type ScopeValidator = (
  rule: ImportRule,
  fs: FsScopeAdapter,
  vault: VaultIoScopeAdapter,
) => Promise<Result<void, ScopeViolation>>;

export interface ImportRunnerDeps {
  auditLog: AuditLog;
  nodeFs: NodeFs;
  vaultIo: VaultIo;
  validateScope: ScopeValidator;
  vaultRoot: string;
  pluginDir: string;
  nowFn: () => Date;
  // stabilityCheckMs is a closure so that live settings changes are picked up
  // on each run without restarting the plugin (symmetric with NodeFs.timeoutMs).
  globalSettings: { stabilityCheckMs: () => number };
}

// ---------------------------------------------------------------------------
// Internal enumeration result
// ---------------------------------------------------------------------------

/** A regular file found during source-tree enumeration. */
type FileEntry = { kind: "file"; absPath: string; relPath: string };

/** A symlinked subdirectory — must be rejected before traversal. */
type SymlinkEntry = { kind: "symlink"; absPath: string; relPath: string };

/** An entry whose lstat call failed during enumeration — emits a per-file audit entry. */
type LstatErrorEntry = { kind: "lstat-error"; absPath: string; relPath: string; error: unknown };

type TreeEntry = FileEntry | SymlinkEntry | LstatErrorEntry;

// Per-file outcome for rule-level summary
type FileOutcome = "ok" | "skipped" | "rejected" | "error";

const ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// ImportRunner
// ---------------------------------------------------------------------------

export class ImportRunner {
  private readonly deps: ImportRunnerDeps;

  constructor(deps: ImportRunnerDeps) {
    this.deps = deps;
  }

  /**
   * Execute an import rule.
   *
   * @param rule The import rule to execute.
   * @param opts Optional per-invocation overrides. opts.dryRun wins over rule.dryRun.
   */
  async run(rule: ImportRule, opts?: { dryRun?: boolean }): Promise<RunStats> {
    const auditLog = this.deps.auditLog;
    const nodeFs = this.deps.nodeFs;
    const vaultIo = this.deps.vaultIo;
    const validateScope = this.deps.validateScope;
    const nowFn = this.deps.nowFn;
    const globalSettings = this.deps.globalSettings;

    const isDryRun = (opts?.dryRun === true) || rule.dryRun;
    const now = nowFn();
    const ts = now.toISOString();
    const nowMs = now.getTime();
    const stabilityCheckMs = globalSettings.stabilityCheckMs();

    // Helper: base fields for any audit entry in this rule run
    const base = (): Pick<AuditEntry, "timestamp" | "ruleId" | "ruleName" | "direction"> => ({
      timestamp: ts,
      ruleId: rule.id,
      ruleName: rule.name,
      direction: "import",
    });

    // -----------------------------------------------------------------------
    // Step 1: validate scope at run time
    // -----------------------------------------------------------------------

    const fsScopeAdapter = nodeFs as unknown as FsScopeAdapter;
    const vaultScopeAdapter: VaultIoScopeAdapter = {
      existsAtVaultPath: (p: string) => vaultIo.existsAtVaultPath(p),
      resolveVaultPath: (p: string) => `${this.deps.vaultRoot}/${p}`,
    };

    const scopeResult = await validateScope(rule, fsScopeAdapter, vaultScopeAdapter);
    if (!scopeResult.ok) {
      await auditLog.append({
        ...base(),
        operation: "error",
        decision: "rule-failed",
        errorCode: mapScopeViolationToErrorCode(scopeResult.errors.reason),
      });
      return { ...EMPTY_STATS };
    }

    // -----------------------------------------------------------------------
    // Step 2: enumerate source subtree recursively
    // -----------------------------------------------------------------------

    let treeEntries: TreeEntry[];
    try {
      treeEntries = await enumerateSourceTree(nodeFs, rule.sourcePath, "");
    } catch (err) {
      if (err instanceof IoNotFoundError) {
        await auditLog.append({
          ...base(),
          operation: "error",
          decision: "rule-failed",
          errorCode: "source-not-found",
        });
        return { ...EMPTY_STATS };
      }
      throw err;
    }

    // -----------------------------------------------------------------------
    // Step 3: process each entry
    // -----------------------------------------------------------------------

    const outcomes: FileOutcome[] = [];

    for (const entry of treeEntries) {
      // -----------------------------------------------------------------
      // lstat failure during enumeration — emit per-file audit entry
      // -----------------------------------------------------------------
      if (entry.kind === "lstat-error") {
        const errorCode: ErrorCode =
          entry.error instanceof IoTimeoutError   ? "io-timeout"
          : entry.error instanceof IoPermissionError ? "permission-denied"
          : entry.error instanceof IoNotFoundError   ? "source-vanished"
          : "unknown";
        await auditLog.append({
          ...base(),
          operation: "skip",
          decision: "skipped",
          sourcePathRelative: entry.relPath,
          errorCode,
        });
        outcomes.push("skipped");
        continue;
      }

      // -----------------------------------------------------------------
      // Symlinked subdirectory — reject without traversal
      // -----------------------------------------------------------------
      if (entry.kind === "symlink") {
        await auditLog.append({
          ...base(),
          operation: "rejected",
          decision: "rejected",
          sourcePathRelative: entry.relPath,
          errorCode: "subdir-is-symlink",
        });
        outcomes.push("rejected");
        continue;
      }

      const { absPath, relPath } = entry;

      // -----------------------------------------------------------------
      // Stability check — file must have been stable for >= stabilityCheckMs
      // -----------------------------------------------------------------
      let stat: Awaited<ReturnType<NodeFs["lstat"]>>;
      try {
        stat = await nodeFs.lstat(absPath);
      } catch {
        await auditLog.append({
          ...base(),
          operation: "skip",
          decision: "skipped",
          sourcePathRelative: relPath,
          errorCode: "source-modified",
        });
        outcomes.push("skipped");
        continue;
      }

      const mtimeMs = stat.mtimeMs;
      // A file is unstable if its mtime is MORE RECENT than (now - stabilityCheckMs).
      // Boundary: mtime === now - stabilityCheckMs is considered stable.
      if (mtimeMs > nowMs - stabilityCheckMs) {
        await auditLog.append({
          ...base(),
          operation: "skip",
          decision: "skipped",
          sourcePathRelative: relPath,
          errorCode: "source-modified",
        });
        outcomes.push("skipped");
        continue;
      }

      // -----------------------------------------------------------------
      // Step 3a: sanitize basename
      // -----------------------------------------------------------------
      const baseName = extractBasename(absPath);
      const sanitizeResult = sanitizeFilename(baseName);
      if (!sanitizeResult.ok) {
        const errorCode: ErrorCode = sanitizeResult.reason;
        await auditLog.append({
          ...base(),
          operation: "rejected",
          decision: "rejected",
          sourcePathRelative: relPath,
          errorCode,
        });
        outcomes.push("rejected");
        continue;
      }

      const sanitizedName = sanitizeResult.name;

      // -----------------------------------------------------------------
      // Step 3b: compute destination subpath
      // -----------------------------------------------------------------
      const destSubpath = buildDestSubpath(
        rule.destinationVaultPath,
        relPath,
        sanitizedName,
        rule.flattenOnTarget,
      );

      // -----------------------------------------------------------------
      // Step 3c: resolve collision
      // -----------------------------------------------------------------
      let finalDestSubpath = destSubpath;
      let collisionHandled = false;

      if (rule.onCollision === "skip") {
        if (vaultIo.existsAtVaultPath(destSubpath)) {
          if (isDryRun) {
            await auditLog.append({
              ...base(),
              operation: "would-skip",
              decision: "would-skip",
              sourcePathRelative: relPath,
              destinationPathRelative: destSubpath,
            });
          } else {
            await auditLog.append({
              ...base(),
              operation: "skip",
              decision: "skipped",
              sourcePathRelative: relPath,
              destinationPathRelative: destSubpath,
            });
          }
          outcomes.push("skipped");
          collisionHandled = true;
        }
      } else {
        // onCollision === "suffix"
        const destDir = extractParent(destSubpath);
        const destBase = extractBasename(destSubpath);
        const collisionResult = await resolveCollisionName(
          // resolveCollisionName takes a dir and joins with "/" internally
          // For vault paths, the "dir" might be empty if at root
          destDir === "" ? "" : destDir,
          destBase,
          (p: string) => Promise.resolve(vaultIo.existsAtVaultPath(p)),
        );
        if (!collisionResult.ok) {
          await auditLog.append({
            ...base(),
            operation: "error",
            decision: "error",
            sourcePathRelative: relPath,
            destinationPathRelative: destSubpath,
            errorCode: "unknown",
          });
          outcomes.push("error");
          collisionHandled = true;
        } else {
          // Build the full vault-relative destination path
          finalDestSubpath =
            destDir === ""
              ? collisionResult.finalName
              : `${destDir}/${collisionResult.finalName}`;
        }
      }

      if (collisionHandled) continue;

      // -----------------------------------------------------------------
      // Step 3d: dryRun path
      // -----------------------------------------------------------------
      if (isDryRun) {
        await auditLog.append({
          ...base(),
          operation: "would-write",
          decision: "would-write",
          sourcePathRelative: relPath,
          destinationPathRelative: finalDestSubpath,
        });
        outcomes.push("ok");
        continue;
      }

      // -----------------------------------------------------------------
      // Step 3e: read source bytes
      // -----------------------------------------------------------------
      let content: string;
      try {
        content = await nodeFs.readFile(absPath);
      } catch (err) {
        if (err instanceof IoNotFoundError) {
          // File vanished between enumeration and read
          await auditLog.append({
            ...base(),
            operation: "skip",
            decision: "skipped",
            sourcePathRelative: relPath,
            errorCode: "source-modified",
          });
          outcomes.push("skipped");
          continue;
        }
        const ioErr = err instanceof IoUnknownError ? err : null;
        const errorCode = ioErr?.errorCode ?? "unknown";
        if (errorCode === "disk-full") {
          await auditLog.append({
            ...base(),
            operation: "error",
            decision: "rule-failed",
            sourcePathRelative: relPath,
            errorCode: "disk-full",
          });
          return outcomesToStats(outcomes);
        }
        await auditLog.append({
          ...base(),
          operation: "error",
          decision: "error",
          sourcePathRelative: relPath,
          errorCode: mapIoErrorCode(errorCode),
        });
        outcomes.push("error");
        continue;
      }

      // -----------------------------------------------------------------
      // Re-check mtime after read (source-modified detection)
      // -----------------------------------------------------------------
      try {
        const restat = await nodeFs.lstat(absPath);
        if (restat.mtimeMs > nowMs - stabilityCheckMs) {
          await auditLog.append({
            ...base(),
            operation: "skip",
            decision: "skipped",
            sourcePathRelative: relPath,
            errorCode: "source-modified",
          });
          outcomes.push("skipped");
          continue;
        }
      } catch {
        // File vanished mid-read
        await auditLog.append({
          ...base(),
          operation: "skip",
          decision: "skipped",
          sourcePathRelative: relPath,
          errorCode: "source-modified",
        });
        outcomes.push("skipped");
        continue;
      }

      // -----------------------------------------------------------------
      // Convert to ArrayBuffer (v0.1 text-only; see file header caveat)
      // -----------------------------------------------------------------
      const bytes: ArrayBuffer = ENCODER.encode(content).buffer;
      const bytesTransferred = bytes.byteLength;

      // -----------------------------------------------------------------
      // Ensure vault parent folder exists
      // -----------------------------------------------------------------
      const destParent = extractParent(finalDestSubpath);
      if (destParent !== "") {
        try {
          await vaultIo.ensureFolder(destParent);
        } catch {
          await auditLog.append({
            ...base(),
            operation: "error",
            decision: "error",
            sourcePathRelative: relPath,
            destinationPathRelative: finalDestSubpath,
            errorCode: "destination-parent-missing",
          });
          outcomes.push("error");
          continue;
        }
      }

      // -----------------------------------------------------------------
      // Atomic vault write
      // -----------------------------------------------------------------
      try {
        await writeVaultAtomic(vaultIo, finalDestSubpath, bytes);
      } catch (err) {
        const ioErr = err instanceof IoUnknownError ? err : null;
        const errorCode = ioErr?.errorCode ?? "unknown";
        if (errorCode === "disk-full") {
          await auditLog.append({
            ...base(),
            operation: "error",
            decision: "rule-failed",
            sourcePathRelative: relPath,
            destinationPathRelative: finalDestSubpath,
            errorCode: "disk-full",
          });
          return outcomesToStats(outcomes);
        }
        await auditLog.append({
          ...base(),
          operation: "error",
          decision: "error",
          sourcePathRelative: relPath,
          destinationPathRelative: finalDestSubpath,
          errorCode: mapIoErrorCode(errorCode),
        });
        outcomes.push("error");
        continue;
      }

      // -----------------------------------------------------------------
      // Emit ok entry
      // -----------------------------------------------------------------
      const fileOperation = rule.action === "move" ? "move" : "copy";
      await auditLog.append({
        ...base(),
        operation: fileOperation,
        decision: "ok",
        sourcePathRelative: relPath,
        destinationPathRelative: finalDestSubpath,
        bytesTransferred,
      });
      outcomes.push("ok");

      // -----------------------------------------------------------------
      // Step 3f: action=move — unlink source after successful write
      // -----------------------------------------------------------------
      if (rule.action === "move") {
        try {
          await nodeFs.unlink(absPath);
        } catch {
          // Best-effort: unlink failure is non-fatal; the file is already in vault
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: rule-level summary
    // -----------------------------------------------------------------------
    const ruleOperation = rule.action === "move" ? "move" : "copy";
    const hasOk = outcomes.includes("ok");
    const hasNonOk = outcomes.some((o) => o !== "ok" && o !== "skipped");
    const allEmpty = outcomes.length === 0;

    let ruleDecision: AuditEntry["decision"];
    if (allEmpty) {
      ruleDecision = "rule-ok";
    } else if (hasOk && !hasNonOk) {
      ruleDecision = "rule-ok";
    } else if (hasOk && hasNonOk) {
      ruleDecision = "rule-partial";
    } else {
      // No ok entries — all were skipped/rejected/error
      ruleDecision = "rule-failed";
    }

    if (ruleDecision === "rule-failed") {
      await auditLog.append({
        ...base(),
        operation: "error",
        decision: "rule-failed",
      });
    } else {
      await auditLog.append({
        ...base(),
        operation: ruleOperation,
        decision: ruleDecision,
      });
    }

    return outcomesToStats(outcomes);
  }
}

/** Tally per-file outcomes into a RunStats object. FileOutcome is a strict
 *  subset of Decision so the shared `tally` helper applies directly. */
function outcomesToStats(outcomes: FileOutcome[]): RunStats {
  const stats: RunStats = { copied: 0, skipped: 0, failed: 0 };
  for (const o of outcomes) tally(stats, o);
  return stats;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Recursively enumerate files under `rootPath`, walking only real directories.
 * Returns a flat list of TreeEntry items. Symlinked subdirectories are returned
 * as { kind: "symlink" } so the caller can emit audit entries and skip them.
 */
async function enumerateSourceTree(
  fs: NodeFs,
  dirPath: string,
  relPrefix: string,
): Promise<TreeEntry[]> {
  const names = await fs.readdir(dirPath);
  const result: TreeEntry[] = [];

  for (const name of names) {
    const absPath = `${dirPath}/${name}`;
    const relPath = relPrefix === "" ? name : `${relPrefix}/${name}`;

    let stat: Awaited<ReturnType<NodeFs["lstat"]>>;
    try {
      stat = await fs.lstat(absPath);
    } catch (err) {
      // Return a lstat-error entry so the caller can emit an audit record.
      // Silent loss is the wrong default — the audit log is the user's
      // visibility into ferry behaviour.
      result.push({ kind: "lstat-error", absPath, relPath, error: err });
      continue;
    }

    if (stat.isSymbolicLink()) {
      // Both symlinked files and symlinked directories are rejected
      result.push({ kind: "symlink", absPath, relPath });
      continue;
    }

    if (stat.isDirectory()) {
      const children = await enumerateSourceTree(fs, absPath, relPath);
      result.push(...children);
    } else if (stat.isFile()) {
      result.push({ kind: "file", absPath, relPath });
    }
  }

  return result;
}

function extractBasename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function extractParent(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : "";
}

function buildDestSubpath(
  destVaultPath: string,
  sourceRel: string,
  sanitizedName: string,
  flattenOnTarget: boolean,
): string {
  const dest = destVaultPath.replace(/\/$/, "");
  if (flattenOnTarget) {
    return `${dest}/${sanitizedName}`;
  }
  const sourceRelDir = extractParent(sourceRel);
  if (sourceRelDir === "") {
    return `${dest}/${sanitizedName}`;
  }
  return `${dest}/${sourceRelDir}/${sanitizedName}`;
}

function mapIoErrorCode(code: string): ErrorCode {
  switch (code) {
    case "io-timeout": return "io-timeout";
    case "source-not-found": return "source-not-found";
    case "permission-denied": return "permission-denied";
    case "disk-full": return "disk-full";
    default: return "unknown";
  }
}
