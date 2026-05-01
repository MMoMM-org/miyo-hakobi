// AuditLog — NDJSON append/iterate/purge for the metadata-only audit log (T1.10).
//
// WHY this file exists:
// All filesystem traffic to the audit log flows through this single class so
// that (a) the NDJSON one-line-per-entry invariant is enforced (the closed
// serializer from T1.6 plus an explicit "\n" suffix here), and (b) concurrent
// `append` calls cannot interleave or overwrite — even when 100 entries arrive
// in parallel from a rule run. The internal Promise queue serialises every
// read-modify-write sequence so the on-disk file is always a sequence of
// well-formed lines. This is what PRD/F5 (NDJSON metadata-only) plus the
// SDD Cross-Cutting NDJSON pattern require.
//
// Path layout:
//   <pluginDataDir>/audit/YYYY-MM.ndjson
// where YYYY-MM is derived from the *entry's* timestamp (preferred — late
// entries land in their own month) and `<pluginDataDir>` is injected via
// the `getAuditDir` factory so production wires `app.vault.adapter
// .getFullPath()` into it (SDD ADR-3) without coupling this module to
// Obsidian.
//
// Pagination:
//   `iterate` reads one file at a time and yields entries newest-first within
//   each file. Internally it works with at most 50 buffered entries at a time
//   so very large logs do not pin all entries in memory simultaneously.
//
// Concurrency:
//   `this.queue = this.queue.then(...)` chains every public mutation. Even
//   under 100 parallel `append` calls, only one read-modify-write runs at a
//   time per AuditLog instance — the on-disk file therefore always grows by
//   exactly `serialize(entry) + "\n"` per call, with no torn writes.

import {
  type AuditEntry,
  parseAuditLine,
  serializeAuditEntry,
} from "./AuditEntry";
import { type RuleId } from "../domain/ruleId";
import { type NodeFs, IoNotFoundError } from "../fs/NodeFs";

// ---------------------------------------------------------------------------
// Internal pagination buffer size. Documented in the file-level header — kept
// small so each iterate() pass over a single month-file processes at most
// PAGE_SIZE entries before yielding back to the consumer.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Sentinel constants for the purge entry. Centralised so they are easy to
// audit; the `purged-by-user` decision belongs to the closed allowlist in
// AuditEntry.ts (T1.6 + T1.10 coordinated change).
// ---------------------------------------------------------------------------

const PURGE_RULE_ID = "00000000-0000-0000-0000-000000000000" as RuleId;
const PURGE_RULE_NAME = "Hakobi audit purge";

export interface AuditLogDeps {
  fs: NodeFs;
  /**
   * Returns the absolute audit-directory path. Lazy so production callers can
   * resolve `app.vault.adapter.getFullPath()` against the plugin data dir
   * once the plugin is fully loaded, without forcing AuditLog to know about
   * Obsidian.
   */
  getAuditDir: () => string;
  /**
   * Optional clock used for the purge sentinel's timestamp + filename. The
   * happy-path append uses the entry's own timestamp, so this only matters
   * for `purgeAll`.
   */
  nowFn?: () => Date;
}

export class AuditLog {
  private readonly fs: NodeFs;
  private readonly getAuditDir: () => string;
  private readonly nowFn: () => Date;

  // Concurrency queue: every mutation chains on the previous one so reads,
  // writes, and unlinks always observe a consistent file state.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: AuditLogDeps) {
    this.fs = deps.fs;
    this.getAuditDir = deps.getAuditDir;
    this.nowFn = deps.nowFn ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  async append(entry: AuditEntry): Promise<void> {
    await this.enqueue(() => this.appendInternal(entry));
  }

  private async appendInternal(entry: AuditEntry): Promise<void> {
    const dir = this.getAuditDir();
    const fileName = monthFileNameFromTimestamp(entry.timestamp, this.nowFn);
    const filePath = `${dir}/${fileName}`;
    const line = serializeAuditEntry(entry) + "\n";

    // Defense-in-depth: ensure the directory exists before any read/write.
    // NodeFs.mkdir is idempotent (recursive: true).
    await this.fs.mkdir(dir);

    const existing = await readIfExists(this.fs, filePath);
    await this.fs.writeFile(filePath, (existing ?? "") + line);
  }

  // -------------------------------------------------------------------------
  // iterate — newest-first, single-file paging
  // -------------------------------------------------------------------------

  async *iterate(
    filter?: (entry: AuditEntry) => boolean,
  ): AsyncGenerator<AuditEntry> {
    const dir = this.getAuditDir();
    const ndjsonFiles = await listNdjsonFiles(this.fs, dir);

    // Newest month first. The filename pattern is `YYYY-MM.ndjson` (or the
    // rotated variant `YYYY-MM-rotated-<unix-ms>.ndjson`). Lexicographic
    // descending sort orders months newest-first; the `-rotated-<ms>` suffix
    // sorts after the bare month-file, so within a month "active" lines come
    // first, then older rotated batches.
    const sorted = [...ndjsonFiles].sort().reverse();

    for (const name of sorted) {
      const path = `${dir}/${name}`;
      const contents = await readIfExists(this.fs, path);
      if (contents === undefined) continue;

      // Reverse-line iteration with a 50-entry internal buffer.
      const lines = contents.split("\n");
      // Drop the trailing empty token from the final "\n".
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      // Walk the array in reverse, paging in PAGE_SIZE chunks so we yield to
      // the consumer regularly and never hold more than PAGE_SIZE parsed
      // entries at once.
      for (
        let pageStart = lines.length;
        pageStart > 0;
        pageStart -= PAGE_SIZE
      ) {
        const pageEnd = pageStart;
        const pageStartIdx = Math.max(0, pageStart - PAGE_SIZE);
        const buffer: AuditEntry[] = [];
        for (let i = pageEnd - 1; i >= pageStartIdx; i--) {
          const raw = lines[i];
          if (raw === undefined || raw === "") continue;
          const parsed = parseAuditLine(raw);
          if (!parsed.ok) continue; // Skip malformed lines defensively.
          buffer.push(parsed.value);
        }
        for (const entry of buffer) {
          if (filter !== undefined && !filter(entry)) continue;
          yield entry;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // purgeAll
  // -------------------------------------------------------------------------

  async purgeAll(): Promise<void> {
    await this.enqueue(() => this.purgeInternal());
  }

  private async purgeInternal(): Promise<void> {
    const dir = this.getAuditDir();
    const ndjsonFiles = await listNdjsonFiles(this.fs, dir);
    for (const name of ndjsonFiles) {
      // Best-effort unlink. If something else removed the file between
      // listing and unlink, the missing-file error is acceptable here.
      try {
        await this.fs.unlink(`${dir}/${name}`);
      } catch (e) {
        if (!(e instanceof IoNotFoundError)) throw e;
      }
    }

    // Sentinel entry written into a fresh log for the current month.
    const now = this.nowFn();
    const sentinel: AuditEntry = {
      timestamp: now.toISOString(),
      ruleId: PURGE_RULE_ID,
      ruleName: PURGE_RULE_NAME,
      direction: "import",
      operation: "skipped",
      decision: "purged-by-user",
    };
    await this.appendInternal(sentinel);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Serialize fs operations through a single Promise chain so 100 concurrent
   * append() callers cannot interleave their read-modify-write sequences.
   *
   * A rejection in the prior link does NOT block the next operation —
   * `fn` is passed as both fulfilled and rejected handler so the queue
   * remains live even after a write failure. The error propagates to the
   * original caller via `next`; the queue itself always advances.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    // Swallow rejection on the queue handle so the next chain link never sees
    // an unhandled-rejection promise; the original rejection still propagates
    // to the caller via `next`.
    this.queue = next.catch(() => undefined);
    return next;
  }
}

// ---------------------------------------------------------------------------
// Pure module-scope helpers
// ---------------------------------------------------------------------------

/** YYYY-MM filename derived from an ISO 8601 UTC timestamp. */
function monthFileNameFromTimestamp(
  timestamp: string,
  fallbackNow: () => Date,
): string {
  // The serializer always writes a real ISO 8601 string (T1.6), so the first
  // 7 characters are reliably `YYYY-MM`. If a caller hands in something
  // shorter, fall back to the current month so the entry still lands in a
  // valid file rather than being lost or producing a malformed path.
  if (typeof timestamp === "string" && /^\d{4}-\d{2}/.test(timestamp)) {
    return `${timestamp.slice(0, 7)}.ndjson`;
  }
  const d = fallbackNow();
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}.ndjson`;
}

async function readIfExists(
  fs: NodeFs,
  path: string,
): Promise<string | undefined> {
  try {
    return await fs.readFile(path);
  } catch (e) {
    if (e instanceof IoNotFoundError) return undefined;
    throw e;
  }
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
