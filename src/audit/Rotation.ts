// Rotation — age + size caps for the audit log (T1.10).
//
// WHY this file exists:
// Without rotation the audit log grows unbounded and a long-lived install can
// accumulate hundreds of MB of NDJSON. PRD/F5 specifies two complementary
// caps:
//   - Time-based retention: files older than `retentionDays` (default 90)
//     get unlinked.
//   - Size-based rotation: when the *current* month's file grows past
//     `maxBytes` (default 10 MB), it is renamed out of the way as
//     `YYYY-MM-rotated-<unix-ms>.ndjson` so subsequent appends start a fresh
//     file. The unix-ms suffix preserves a sortable rotation history within
//     the same month.
//
// Why current-month-only rotation:
//   Older months are subject to the age-based purge instead. Rotating an old
//   month would just shuffle bytes around without buying us anything — the
//   age cap will catch it later. Keeping the rotation eligibility narrow
//   makes the rule trivial to reason about.
//
// Adapter contract:
//   Reads (`readdir`, `lstat`) and mutations (`unlink`, `rename`) all flow
//   through the injected NodeFs adapter, never through `node:fs` directly,
//   so this module remains testable without the OS and obeys the same
//   timeout/error-mapping invariants as every other Hakobi FS surface (T1.7).

import { type NodeFs, IoNotFoundError } from "../fs/NodeFs";

// ---------------------------------------------------------------------------
// PRD/F5 defaults — kept here so callers that omit opts still get the
// documented behaviour without a separate settings module.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const DEFAULT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RotationDeps {
  fs: NodeFs;
  /** Returns the absolute audit-directory path. */
  getAuditDir: () => string;
}

export interface CheckAndRotateOpts {
  maxBytes?: number;
  retentionDays?: number;
}

export class Rotation {
  private readonly fs: NodeFs;
  private readonly getAuditDir: () => string;

  constructor(deps: RotationDeps) {
    this.fs = deps.fs;
    this.getAuditDir = deps.getAuditDir;
  }

  /**
   * Apply both caps in a single sweep:
   *   1. List every `*.ndjson` file in the audit dir (skip non-ndjson).
   *   2. Delete files whose mtime is more than `retentionDays` ago.
   *   3. If the current-month file (matching `now`'s YYYY-MM) survives
   *      retention and its size exceeds `maxBytes`, rename it out of the
   *      way as `YYYY-MM-rotated-<unix-ms>.ndjson`.
   *
   * No-op when the audit directory does not exist yet (first run before any
   * append). All FS calls flow through NodeFs so timeouts/error-mapping are
   * uniform with the rest of Hakobi.
   */
  async checkAndRotate(
    opts: CheckAndRotateOpts = {},
    nowFn: () => Date = () => new Date(),
  ): Promise<void> {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const now = nowFn();
    const dir = this.getAuditDir();

    const files = await listNdjsonFiles(this.fs, dir);
    if (files.length === 0) return;

    const retentionCutoffMs = now.getTime() - retentionDays * DAY_MS;
    const currentMonthName = monthFileName(now);

    // Pass 1: age-based purge.
    const survivors: string[] = [];
    for (const name of files) {
      const path = `${dir}/${name}`;
      const stat = await safeLstat(this.fs, path);
      if (stat === undefined) continue; // raced — file disappeared.
      if (stat.mtimeMs < retentionCutoffMs) {
        try {
          await this.fs.unlink(path);
        } catch (e) {
          if (!(e instanceof IoNotFoundError)) throw e;
        }
      } else {
        survivors.push(name);
      }
    }

    // Pass 2: size-based rotation, current-month only.
    if (!survivors.includes(currentMonthName)) return;

    const currentPath = `${dir}/${currentMonthName}`;
    const currentStat = await safeLstat(this.fs, currentPath);
    if (currentStat === undefined) return;
    if (currentStat.size <= maxBytes) return;

    const rotatedName = currentMonthName.replace(
      /\.ndjson$/,
      `-rotated-${now.getTime()}.ndjson`,
    );
    await this.fs.rename(currentPath, `${dir}/${rotatedName}`);
  }
}

// ---------------------------------------------------------------------------
// Pure module-scope helpers
// ---------------------------------------------------------------------------

function monthFileName(d: Date): string {
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}.ndjson`;
}

async function listNdjsonFiles(fs: NodeFs, dir: string): Promise<string[]> {
  try {
    const all = await fs.readdir(dir);
    return all.filter((n) => n.endsWith(".ndjson"));
  } catch (e) {
    if (e instanceof IoNotFoundError) return [];
    throw e;
  }
}

async function safeLstat(
  fs: NodeFs,
  path: string,
): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const s = await fs.lstat(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch (e) {
    if (e instanceof IoNotFoundError) return undefined;
    throw e;
  }
}
