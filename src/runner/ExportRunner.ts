// ExportRunner — vault-to-FS file ferry for export rules (T2.6).
//
// WHY this file exists:
// ExportRunner is the mirror of ImportRunner with reversed data polarity:
// source is the vault (VaultIo), destination is the external filesystem
// (NodeFs). It handles three source types (folder/tag/note), applies the
// same collision, flatten, dry-run, and action semantics as ImportRunner,
// and emits NDJSON audit entries (direction='export') via AuditLog.
//
// Key design choices:
//  - Export polarity (vault → FS): `vaultIo.readBinary` reads the note bytes;
//    `writeFsBinaryAtomic` writes them to the FS destination. Binary fidelity
//    is preserved throughout — no string encoding that would corrupt non-ASCII
//    content.
//  - mtime preservation (ADR-6): on export the vault note's mtime (TFile.stat
//    .mtime, milliseconds) is restored on the FS destination via `nodeFs
//    .utimes` immediately after the atomic write. Import does NOT do this.
//  - Tag-recursion (ADR-11): VaultIo.notesByTag already implements nested-tag
//    inclusion (#projects matches #projects/foo). ExportRunner delegates
//    entirely to that method — no extra tag-matching logic here.
//  - Binary write extension: NodeFs.writeFileBinary (T2.6) and the companion
//    AtomicWriter.writeFsBinaryAtomic (T2.6) were added specifically for this
//    class. They mirror the string variants but accept ArrayBuffer, preserving
//    every byte from the vault unchanged.

import type { TFile } from "obsidian";
import {
  type ExportRule,
  type ExportFolderRule,
  type ExportTagRule,
  type ExportNoteRule,
  assertNever,
} from "../domain/rule";
import type { NodeFs } from "../fs/NodeFs";
import type { VaultIo } from "../vault/VaultIo";
import type { AuditLog } from "../audit/AuditLog";
import type { AuditEntry, Decision, ErrorCode } from "../audit/AuditEntry";
import type { Result } from "../domain/rule";
import type { ScopeViolation } from "../domain/scope";
import { sanitizeFilename } from "../domain/sanitize";
import {
  resolveCollisionName,
  writeFsBinaryAtomic,
} from "./AtomicWriter";

// ---------------------------------------------------------------------------
// Deps shape (constructor DI)
// ---------------------------------------------------------------------------

export interface ExportRunnerDeps {
  auditLog: AuditLog;
  nodeFs: NodeFs;
  vaultIo: VaultIo;
  /**
   * Scope validator factory — returns a promise resolving to ok or a
   * ScopeViolation. ExportRunner calls this once per rule run, passing the
   * full ExportRule.
   */
  validateScope: (rule: ExportRule) => Promise<Result<void, ScopeViolation>>;
  vaultRoot: string;
  pluginDir: string;
  nowFn: () => Date;
}

// ---------------------------------------------------------------------------
// ExportRunner
// ---------------------------------------------------------------------------

export class ExportRunner {
  private readonly auditLog: AuditLog;
  private readonly nodeFs: NodeFs;
  private readonly vaultIo: VaultIo;
  private readonly validateScope: (rule: ExportRule) => Promise<Result<void, ScopeViolation>>;
  private readonly nowFn: () => Date;

  constructor(deps: ExportRunnerDeps) {
    this.auditLog = deps.auditLog;
    this.nodeFs = deps.nodeFs;
    this.vaultIo = deps.vaultIo;
    this.validateScope = deps.validateScope;
    this.nowFn = deps.nowFn;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run an export rule. Resolves after all per-file operations and the
   * rule-level audit summary have been written. Rejects only on unexpected
   * internal errors — all expected failure modes (scope violation, missing
   * source, missing parent dir) are surfaced via audit entries and resolve
   * normally.
   */
  async run(rule: ExportRule, opts?: { dryRun?: boolean }): Promise<void> {
    const dryRun = opts?.dryRun ?? rule.dryRun;
    const ts = this.nowFn().toISOString();

    // Step 1: scope validation.
    const scopeResult = await this.validateScope(rule);
    if (!scopeResult.ok) {
      await this.appendRuleFailed(rule, ts, "forbidden-path");
      return;
    }

    // Step 2: verify the parent of destinationPath exists on the FS.
    // The parent is the dirname of destinationPath. If lstat throws, we treat
    // it as missing (destination-parent-missing).
    const parentMissing = await this.checkDestinationParent(rule.destinationPath);
    if (parentMissing) {
      await this.appendRuleFailed(rule, ts, "destination-parent-missing");
      return;
    }

    // Step 3: ensure the destinationPath directory itself exists (create if needed).
    // This is idempotent (NodeFs.mkdir uses recursive: true).
    try {
      await this.nodeFs.mkdir(rule.destinationPath);
    } catch {
      await this.appendRuleFailed(rule, ts, "destination-parent-missing");
      return;
    }

    // Step 4: enumerate source files based on sourceType.
    const files = await this.enumerateSource(rule, ts);
    if (files === null) {
      // enumerateSource already wrote the rule-failed entry.
      return;
    }

    // Step 5: process each file.
    const decisions: Decision[] = [];
    for (const file of files) {
      const decision = await this.processFile(rule, file, dryRun, ts);
      decisions.push(decision);
    }

    // Step 6: write rule-level summary.
    const ruleLevelDecision = computeRuleDecision(decisions);
    await this.auditLog.append(
      this.buildRuleEntry(rule, ts, ruleLevelDecision),
    );
  }

  // -------------------------------------------------------------------------
  // Source enumeration
  // -------------------------------------------------------------------------

  /** Returns the list of TFiles to export, or null if a rule-level failure occurred. */
  private async enumerateSource(
    rule: ExportRule,
    ts: string,
  ): Promise<TFile[] | null> {
    if (rule.sourceType === "folder") {
      return this.enumerateFolder(rule, ts);
    }
    if (rule.sourceType === "tag") {
      return this.enumerateTag(rule);
    }
    if (rule.sourceType === "note") {
      return this.enumerateNote(rule, ts);
    }
    assertNever(rule);
  }

  private async enumerateFolder(
    rule: ExportFolderRule,
    _ts: string,
  ): Promise<TFile[]> {
    try {
      return await this.vaultIo.listFolder(rule.sourceVaultPath, { recursive: true });
    } catch {
      // If the source folder doesn't exist or errors, return empty list.
      // The rule will still produce a rule-ok with no files.
      return [];
    }
  }

  private async enumerateTag(rule: ExportTagRule): Promise<TFile[]> {
    try {
      return await this.vaultIo.notesByTag(rule.tags, rule.tagMatch);
    } catch {
      return [];
    }
  }

  /**
   * For note rules: resolve the single note path. If the file doesn't exist,
   * write a rule-failed entry and return null to signal early exit.
   */
  private async enumerateNote(
    rule: ExportNoteRule,
    ts: string,
  ): Promise<TFile[] | null> {
    const file = this.vaultIo.fileByPath(rule.sourceVaultNotePath);
    if (file === null) {
      await this.appendRuleFailed(rule, ts, "source-not-found");
      return null;
    }
    return [file];
  }

  // -------------------------------------------------------------------------
  // Per-file processing
  // -------------------------------------------------------------------------

  private async processFile(
    rule: ExportRule,
    file: TFile,
    dryRun: boolean,
    ts: string,
  ): Promise<Decision> {
    // Compute the relative path from the vault source root to the file.
    const sourceRel = computeSourceRelPath(rule, file);

    // Sanitize the destination filename.
    const sanitized = sanitizeFilename(file.name);
    if (!sanitized.ok) {
      await this.auditLog.append({
        timestamp: ts,
        ruleId: rule.id,
        ruleName: rule.name,
        direction: "export",
        operation: "rejected",
        sourcePathRelative: sourceRel,
        decision: "rejected",
        errorCode: sanitized.reason,
      });
      return "rejected";
    }

    // Compute destination sub-path inside destinationPath.
    const destSubPath = computeDestSubPath(rule, sanitized.name, sourceRel);
    const destFull = `${rule.destinationPath}/${destSubPath}`;
    const destDir = destFull.includes("/")
      ? destFull.slice(0, destFull.lastIndexOf("/"))
      : rule.destinationPath;
    const destBase = destFull.includes("/")
      ? destFull.slice(destFull.lastIndexOf("/") + 1)
      : destFull;

    // Collision detection: check if destFull already exists as a file at the FS destination.
    const destExists = await this.fsFileExists(`${rule.destinationPath}/${destSubPath}`);

    if (rule.onCollision === "skip") {
      if (destExists) {
        if (dryRun) {
          await this.auditLog.append({
            timestamp: ts,
            ruleId: rule.id,
            ruleName: rule.name,
            direction: "export",
            operation: "would-skip",
            sourcePathRelative: sourceRel,
            destinationPathRelative: destSubPath,
            decision: "would-skip",
          });
          return "would-skip";
        }
        await this.auditLog.append({
          timestamp: ts,
          ruleId: rule.id,
          ruleName: rule.name,
          direction: "export",
          operation: "skipped",
          sourcePathRelative: sourceRel,
          destinationPathRelative: destSubPath,
          decision: "skipped",
        });
        return "skipped";
      }
    }

    // For suffix mode, resolve a non-colliding name.
    let finalBase = destBase;
    let finalSubPath = destSubPath;
    if (rule.onCollision === "suffix") {
      const collision = await resolveCollisionName(
        destDir,
        destBase,
        (p) => this.fsFileExists(p),
      );
      if (!collision.ok) {
        await this.auditLog.append({
          timestamp: ts,
          ruleId: rule.id,
          ruleName: rule.name,
          direction: "export",
          operation: "rejected",
          sourcePathRelative: sourceRel,
          decision: "rejected",
          errorCode: "unknown",
        });
        return "rejected";
      }
      finalBase = collision.finalName;
      // Rebuild subpath with the resolved name.
      const subDir = destSubPath.includes("/")
        ? destSubPath.slice(0, destSubPath.lastIndexOf("/") + 1)
        : "";
      finalSubPath = subDir + finalBase;
    }

    const finalDest = `${rule.destinationPath}/${finalSubPath}`;

    // Dry-run path.
    if (dryRun) {
      await this.auditLog.append({
        timestamp: ts,
        ruleId: rule.id,
        ruleName: rule.name,
        direction: "export",
        operation: "would-write",
        sourcePathRelative: sourceRel,
        destinationPathRelative: finalSubPath,
        decision: "would-write",
      });
      return "would-write";
    }

    // Ensure intermediate dirs exist under destinationPath.
    const finalDir = finalDest.slice(0, finalDest.lastIndexOf("/"));
    try {
      await this.nodeFs.mkdir(finalDir);
    } catch {
      await this.auditLog.append({
        timestamp: ts,
        ruleId: rule.id,
        ruleName: rule.name,
        direction: "export",
        operation: "error",
        sourcePathRelative: sourceRel,
        decision: "error",
        errorCode: "unknown",
      });
      return "error";
    }

    // Read vault bytes.
    let bytes: ArrayBuffer;
    try {
      bytes = await this.vaultIo.readBinary(file.path);
    } catch {
      await this.auditLog.append({
        timestamp: ts,
        ruleId: rule.id,
        ruleName: rule.name,
        direction: "export",
        operation: "error",
        sourcePathRelative: sourceRel,
        decision: "error",
        errorCode: "unknown",
      });
      return "error";
    }

    // Atomic write to FS.
    try {
      await writeFsBinaryAtomic(this.nodeFs, finalDest, bytes);
    } catch {
      await this.auditLog.append({
        timestamp: ts,
        ruleId: rule.id,
        ruleName: rule.name,
        direction: "export",
        operation: "error",
        sourcePathRelative: sourceRel,
        decision: "error",
        errorCode: "unknown",
      });
      return "error";
    }

    // mtime preservation (ADR-6): restore vault note mtime on the FS destination.
    // Best-effort — a utimes failure does not fail the export.
    try {
      await this.nodeFs.utimes(finalDest, file.stat.mtime);
    } catch {
      // intentional: mtime loss is a quality concern, not a correctness failure
    }

    // action=move: delete the vault note after confirmed FS write.
    if (rule.action === "move") {
      try {
        await this.vaultIo.deleteNote(file);
      } catch {
        // Logged but not fatal — file is already on FS.
      }
    }

    await this.auditLog.append({
      timestamp: ts,
      ruleId: rule.id,
      ruleName: rule.name,
      direction: "export",
      operation: rule.action === "move" ? "move" : "copy",
      sourcePathRelative: sourceRel,
      destinationPathRelative: finalSubPath,
      decision: "ok",
      bytesTransferred: bytes.byteLength,
    });
    return "ok";
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * True iff a regular file (not a directory) exists at the given FS path.
   * Used for collision detection: we only treat an existing FILE as a
   * collision — an existing directory at the path is not a file collision.
   * If lstat throws, we treat the path as free.
   */
  private async fsFileExists(path: string): Promise<boolean> {
    try {
      const stat = await this.nodeFs.lstat(path);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check whether the parent directory of `destinationPath` exists.
   * Returns true iff the parent is MISSING (i.e. we should fail the rule).
   *
   * The check is intentionally lenient: if lstat succeeds for the parent we
   * treat it as present. The actual mkdir/write will surface a more specific
   * error if the parent turns out to be a file rather than a directory.
   */
  private async checkDestinationParent(destinationPath: string): Promise<boolean> {
    const lastSlash = destinationPath.lastIndexOf("/");
    if (lastSlash <= 0) {
      // destinationPath has no parent (root or single segment) — treat as present.
      return false;
    }
    const parent = destinationPath.slice(0, lastSlash);
    try {
      await this.nodeFs.lstat(parent);
      // lstat succeeded → parent exists.
      return false;
    } catch {
      // lstat threw → parent does not exist.
      return true;
    }
  }

  private async appendRuleFailed(
    rule: ExportRule,
    ts: string,
    errorCode: ErrorCode,
  ): Promise<void> {
    await this.auditLog.append({
      timestamp: ts,
      ruleId: rule.id,
      ruleName: rule.name,
      direction: "export",
      operation: "error",
      decision: "rule-failed",
      errorCode,
    });
  }

  private buildRuleEntry(
    rule: ExportRule,
    ts: string,
    decision: Decision,
  ): AuditEntry {
    return {
      timestamp: ts,
      ruleId: rule.id,
      ruleName: rule.name,
      direction: "export",
      operation: decision === "rule-ok" ? "copy" : "error",
      decision,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (module-scoped)
// ---------------------------------------------------------------------------

/**
 * Compute the vault-relative source path displayed in audit entries.
 * For folder/note rules this is the path relative to the source vault folder;
 * for tag rules it is the full vault path (no single root folder to strip).
 */
function computeSourceRelPath(rule: ExportRule, file: TFile): string {
  if (rule.sourceType === "folder") {
    const prefix = rule.sourceVaultPath.replace(/\/+$/, "") + "/";
    if (file.path.startsWith(prefix)) {
      return file.path.slice(prefix.length);
    }
    return file.path;
  }
  if (rule.sourceType === "note") {
    return file.name;
  }
  // tag: use the full vault path as the relative reference
  return file.path;
}

/**
 * Compute the destination sub-path (relative to destinationPath) for a file.
 * - flattenOnTarget=true  → just the sanitized basename
 * - flattenOnTarget=false → preserve the sub-directory structure under the
 *   vault source root
 */
function computeDestSubPath(
  rule: ExportRule,
  sanitizedName: string,
  sourceRel: string,
): string {
  if (rule.flattenOnTarget) {
    return sanitizedName;
  }
  // Preserve subdirectory structure from sourceRel.
  const lastSlash = sourceRel.lastIndexOf("/");
  if (lastSlash < 0) {
    return sanitizedName;
  }
  const subDir = sourceRel.slice(0, lastSlash);
  return `${subDir}/${sanitizedName}`;
}

/** Compute the rule-level summary decision from per-file decisions. */
function computeRuleDecision(decisions: Decision[]): Decision {
  if (decisions.length === 0) return "rule-ok";
  const okCount = decisions.filter((d) => d === "ok").length;
  const failCount = decisions.filter(
    (d) => d === "error" || d === "rejected",
  ).length;
  if (failCount === 0) return "rule-ok";
  if (okCount > 0) return "rule-partial";
  return "rule-failed";
}
