// RunStats — per-rule execution summary returned by Import/ExportRunner.
//
// WHY this file exists:
// The runners have always emitted per-file decisions to the audit log, but
// callers (Scheduler, in particular) had no way to know how a run went
// without parsing the log back out. RunStats is a typed in-process summary:
// just the three counts the user cares about. Used by Scheduler to surface
// "ok (3 copied, 1 skipped)" in the DevConsole tick-end log line.
//
// "copied" is the label users recognise even though Hakobi also supports
// `action: move` (which is a copy + source-delete) and dry-run "would-write"
// — the count rolls all of these into one bucket because from the user's
// perspective they are all "files that were (or would be) transferred".

import type { Decision } from "../audit/AuditEntry";

export interface RunStats {
  /** Files written, would-be-written, or would-be-suffixed. */
  copied: number;
  /** Files skipped (collision skip in real run, would-skip in dry run). */
  skipped: number;
  /** Files that failed (per-file rejected / error). */
  failed: number;
}

export const EMPTY_STATS: RunStats = { copied: 0, skipped: 0, failed: 0 };

/** Tally a per-file decision into the stats bucket. Caller mutates `stats`. */
export function tally(stats: RunStats, decision: Decision): void {
  switch (decision) {
    case "ok":
    case "would-write":
    case "would-suffix":
      stats.copied += 1;
      return;
    case "skipped":
    case "would-skip":
      stats.skipped += 1;
      return;
    case "rejected":
    case "error":
      stats.failed += 1;
      return;
    // Rule-level decisions are never per-file — ignore.
    case "rule-ok":
    case "rule-failed":
    case "rule-partial":
    case "purged-by-user":
      return;
  }
}
