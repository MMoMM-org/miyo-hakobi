// Tests for src/audit/AuditLog.ts (T1.10).
//
// What is asserted here:
//  - append(entry) writes a single serialized line + "\n" to the
//    `<auditDir>/YYYY-MM.ndjson` file derived from the entry's timestamp.
//  - Successive appends extend the file (no overwrite); each line round-trips
//    through parseAuditLine.
//  - 100 parallel appends produce exactly 100 well-formed lines (concurrency
//    queue serialises read-modify-write).
//  - iterate(filter) yields entries newest-first across all *.ndjson files
//    in the audit directory; an optional predicate trims the stream.
//  - purgeAll() unlinks every *.ndjson file under auditDir, then writes ONE
//    sentinel entry with decision: "purged-by-user" to a fresh log.
//  - Metadata-only invariant: nothing on disk contains an absolute path
//    prefix like "/Users/" or "/home/" (defense in depth — the closed-list
//    serializer already prevents it, but this re-asserts at the AuditLog
//    boundary).
//
// Adapter strategy: a tiny in-memory FS stub implements only the NodeFs
// methods AuditLog touches (mkdir, readFile, writeFile, readdir, unlink).
// This keeps the test focused on AuditLog's behaviour rather than the
// adapter's.

import { describe, it, expect } from "vitest";
import { AuditLog } from "../../src/audit/AuditLog";
import {
  type AuditEntry,
  parseAuditLine,
  serializeAuditEntry,
} from "../../src/audit/AuditEntry";
import type { NodeFs } from "../../src/fs/NodeFs";
import type { RuleId } from "../../src/domain/ruleId";
import { IoNotFoundError } from "../../src/fs/NodeFs";

// ---------------------------------------------------------------------------
// In-memory FS stub
// ---------------------------------------------------------------------------

interface FakeFile {
  contents: string;
  mtimeMs: number;
}

interface FakeFsState {
  /** path → file contents (and metadata). Directories are implicit. */
  files: Map<string, FakeFile>;
  /** explicitly created directories (so readdir on a missing dir throws). */
  dirs: Set<string>;
}

function makeFakeFs(): { fs: NodeFs; state: FakeFsState } {
  const state: FakeFsState = {
    files: new Map(),
    dirs: new Set(),
  };

  const fs = {
    async mkdir(path: string): Promise<void> {
      state.dirs.add(path);
    },
    async readFile(path: string): Promise<string> {
      const entry = state.files.get(path);
      if (entry === undefined) {
        // Mimic NodeFs's typed exception for ENOENT-style missing reads.
        throw new IoNotFoundError("readFile", path, undefined);
      }
      return entry.contents;
    },
    async writeFile(path: string, data: string): Promise<void> {
      const prev = state.files.get(path);
      state.files.set(path, {
        contents: data,
        mtimeMs: prev?.mtimeMs ?? Date.now(),
      });
    },
    async readdir(path: string): Promise<string[]> {
      if (!state.dirs.has(path)) {
        throw new IoNotFoundError("readdir", path, undefined);
      }
      const prefix = path.endsWith("/") ? path : path + "/";
      const out: string[] = [];
      for (const f of state.files.keys()) {
        if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
          out.push(f.slice(prefix.length));
        }
      }
      return out;
    },
    async unlink(path: string): Promise<void> {
      if (!state.files.delete(path)) {
        throw new IoNotFoundError("unlink", path, undefined);
      }
    },
  };

  return { fs: fs as unknown as NodeFs, state };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RULE_ID = "550e8400-e29b-41d4-a716-446655440000" as RuleId;
const AUDIT_DIR = "/fake/plugin/audit";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-05-01T12:00:00.000Z",
    ruleId: RULE_ID,
    ruleName: "Voice memos",
    direction: "import",
    operation: "copy",
    decision: "ok",
    ...overrides,
  };
}

function expectedFileName(timestamp: string): string {
  // `YYYY-MM` derived from the entry's ISO 8601 timestamp.
  return `${timestamp.slice(0, 7)}.ndjson`;
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe("AuditLog.append", () => {
  it("writes a single serialized line + newline to <auditDir>/YYYY-MM.ndjson", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    const e = entry({ timestamp: "2026-05-01T12:00:00.000Z" });
    await log.append(e);

    const filePath = `${AUDIT_DIR}/${expectedFileName(e.timestamp)}`;
    const stored = state.files.get(filePath);
    expect(stored).toBeDefined();
    expect(stored?.contents).toBe(serializeAuditEntry(e) + "\n");
  });

  it("file path matches the YYYY-MM regex", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });
    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z" }));

    const paths = Array.from(state.files.keys());
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/\/audit\/\d{4}-\d{2}\.ndjson$/);
  });

  it("creates the audit directory before writing (mkdir is idempotent)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });
    await log.append(entry());
    expect(state.dirs.has(AUDIT_DIR)).toBe(true);
  });

  it("successive appends extend the file (no overwrite)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    const e1 = entry({ timestamp: "2026-05-01T12:00:00.000Z" });
    const e2 = entry({ timestamp: "2026-05-01T12:00:01.000Z" });
    await log.append(e1);
    await log.append(e2);

    const filePath = `${AUDIT_DIR}/2026-05.ndjson`;
    const stored = state.files.get(filePath);
    const lines = stored?.contents.split("\n").filter((l) => l !== "") ?? [];
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = parseAuditLine(line);
      expect(parsed.ok).toBe(true);
    }
    expect(stored?.contents.endsWith("\n")).toBe(true);
  });

  it("never produces two entries on one line (each entry ends with exactly one \\n)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    for (let i = 0; i < 5; i++) {
      await log.append(entry({ timestamp: `2026-05-01T12:00:0${i}.000Z` }));
    }

    const stored = state.files.get(`${AUDIT_DIR}/2026-05.ndjson`);
    expect(stored).toBeDefined();
    // One trailing newline per entry; no embedded newline within an entry.
    const lines = stored!.contents.split("\n");
    // Five entries → five non-empty lines + one empty trailing element.
    expect(lines.filter((l) => l !== "")).toHaveLength(5);
    for (const line of lines) {
      // serializeAuditEntry never emits "\n", so any non-empty token must
      // round-trip through parseAuditLine.
      if (line === "") continue;
      const parsed = parseAuditLine(line);
      expect(parsed.ok).toBe(true);
    }
  });

  it("groups entries by the timestamp's YYYY-MM (late-arriving entries go to their own month)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z" }));
    await log.append(entry({ timestamp: "2026-04-30T23:59:00.000Z" }));

    expect(state.files.has(`${AUDIT_DIR}/2026-05.ndjson`)).toBe(true);
    expect(state.files.has(`${AUDIT_DIR}/2026-04.ndjson`)).toBe(true);
  });

  it("100 parallel appends produce exactly 100 well-formed lines (concurrency queue)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    // All entries go to the same month so concurrent writes contend on the
    // same file. The internal queue must serialize read-modify-write so no
    // line is dropped, truncated, or interleaved.
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < 100; i++) {
      // Pad seq into a fixed-width string so ordering is observable in the
      // serialized output via the ruleName.
      const seq = String(i).padStart(3, "0");
      promises.push(
        log.append(
          entry({
            timestamp: `2026-05-01T12:00:00.000Z`,
            ruleName: `parallel-${seq}`,
          }),
        ),
      );
    }
    await Promise.all(promises);

    const stored = state.files.get(`${AUDIT_DIR}/2026-05.ndjson`);
    expect(stored).toBeDefined();
    const lines = stored!.contents.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(100);

    const seen = new Set<string>();
    for (const line of lines) {
      const parsed = parseAuditLine(line);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        seen.add(parsed.value.ruleName);
      }
    }
    // Every parallel call's distinct ruleName landed exactly once.
    expect(seen.size).toBe(100);
  });

  it("metadata-only invariant: written content never contains absolute path prefixes", async () => {
    // PRD/F5 + Constitution L2: audit files must record metadata only. The
    // closed-list serializer already prevents content/frontmatter/absolute
    // paths from leaking into the JSON, but T1.10 re-asserts at the writer
    // boundary as defense-in-depth.
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    await log.append(
      entry({
        sourcePathRelative: "Inbox/note.md",
        destinationPathRelative: "Archive/note.md",
      }),
    );

    for (const file of state.files.values()) {
      expect(file.contents).not.toContain("/Users/");
      expect(file.contents).not.toContain("/home/");
    }
  });
});

// ---------------------------------------------------------------------------
// iterate
// ---------------------------------------------------------------------------

describe("AuditLog.iterate", () => {
  it("yields entries newest-first across all *.ndjson files in the audit dir", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    // Order of writes:
    //   2026-04 file: e1 (12:00), e2 (12:01)
    //   2026-05 file: e3 (12:00), e4 (12:01)
    // Expected newest-first output (by month desc, within file reverse line):
    //   e4, e3, e2, e1
    const e1 = entry({ timestamp: "2026-04-30T12:00:00.000Z", ruleName: "e1" });
    const e2 = entry({ timestamp: "2026-04-30T12:01:00.000Z", ruleName: "e2" });
    const e3 = entry({ timestamp: "2026-05-01T12:00:00.000Z", ruleName: "e3" });
    const e4 = entry({ timestamp: "2026-05-01T12:01:00.000Z", ruleName: "e4" });
    await log.append(e1);
    await log.append(e2);
    await log.append(e3);
    await log.append(e4);

    // Sanity: both files exist.
    expect(state.files.has(`${AUDIT_DIR}/2026-04.ndjson`)).toBe(true);
    expect(state.files.has(`${AUDIT_DIR}/2026-05.ndjson`)).toBe(true);

    const seen: string[] = [];
    for await (const e of log.iterate()) {
      seen.push(e.ruleName);
    }
    expect(seen).toEqual(["e4", "e3", "e2", "e1"]);
  });

  it("returns nothing when the audit directory does not exist yet", async () => {
    const { fs } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    const seen: AuditEntry[] = [];
    for await (const e of log.iterate()) {
      seen.push(e);
    }
    expect(seen).toEqual([]);
  });

  it("ignores non-ndjson siblings in the audit directory", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z" }));
    // Drop a stray non-ndjson file in the audit dir; iterate must skip it.
    state.files.set(`${AUDIT_DIR}/README.txt`, { contents: "n/a", mtimeMs: 0 });

    const seen: AuditEntry[] = [];
    for await (const e of log.iterate()) {
      seen.push(e);
    }
    expect(seen).toHaveLength(1);
  });

  it("applies an optional filter predicate", async () => {
    const { fs } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z", decision: "ok" }));
    await log.append(entry({ timestamp: "2026-05-01T12:00:01.000Z", decision: "rejected" }));
    await log.append(entry({ timestamp: "2026-05-01T12:00:02.000Z", decision: "ok" }));

    const seen: string[] = [];
    for await (const e of log.iterate((x) => x.decision === "rejected")) {
      seen.push(e.decision);
    }
    expect(seen).toEqual(["rejected"]);
  });

  it("skips malformed lines without aborting the iterator", async () => {
    // Defense in depth: a tampered or truncated line should not stop the
    // iterator from yielding the well-formed entries before/after it.
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({ fs, getAuditDir: () => AUDIT_DIR });

    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z", ruleName: "good-1" }));
    // Inject a bad line into the existing file.
    const path = `${AUDIT_DIR}/2026-05.ndjson`;
    const existing = state.files.get(path)!.contents;
    state.files.set(path, {
      contents: existing + "{ not-json\n",
      mtimeMs: Date.now(),
    });
    await log.append(entry({ timestamp: "2026-05-01T12:00:01.000Z", ruleName: "good-2" }));

    const seen: string[] = [];
    for await (const e of log.iterate()) {
      seen.push(e.ruleName);
    }
    expect(seen).toEqual(["good-2", "good-1"]);
  });
});

// ---------------------------------------------------------------------------
// purgeAll
// ---------------------------------------------------------------------------

describe("AuditLog.purgeAll", () => {
  it("deletes every *.ndjson file under audit/ and writes one purged-by-user entry", async () => {
    const { fs, state } = makeFakeFs();
    const fixedNow = new Date("2026-05-02T00:00:00.000Z");
    const log = new AuditLog({
      fs,
      getAuditDir: () => AUDIT_DIR,
      nowFn: () => fixedNow,
    });

    // Seed two existing audit files.
    await log.append(entry({ timestamp: "2026-04-30T12:00:00.000Z" }));
    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z" }));
    expect(state.files.has(`${AUDIT_DIR}/2026-04.ndjson`)).toBe(true);
    expect(state.files.has(`${AUDIT_DIR}/2026-05.ndjson`)).toBe(true);

    await log.purgeAll();

    // The April file is gone (it does not get the sentinel).
    expect(state.files.has(`${AUDIT_DIR}/2026-04.ndjson`)).toBe(false);

    // The current month file exists and contains exactly the sentinel.
    const sentinelFile = state.files.get(`${AUDIT_DIR}/2026-05.ndjson`);
    expect(sentinelFile).toBeDefined();
    const lines = sentinelFile!.contents
      .split("\n")
      .filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const parsed = parseAuditLine(lines[0]!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe("purged-by-user");
    }
  });

  it("ignores non-ndjson siblings during purge (does not unlink them)", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({
      fs,
      getAuditDir: () => AUDIT_DIR,
      nowFn: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    await log.append(entry({ timestamp: "2026-05-01T12:00:00.000Z" }));
    state.files.set(`${AUDIT_DIR}/README.txt`, { contents: "keep", mtimeMs: 0 });

    await log.purgeAll();

    expect(state.files.get(`${AUDIT_DIR}/README.txt`)?.contents).toBe("keep");
  });

  it("is a no-op (apart from the sentinel) when no audit files exist yet", async () => {
    const { fs, state } = makeFakeFs();
    const log = new AuditLog({
      fs,
      getAuditDir: () => AUDIT_DIR,
      nowFn: () => new Date("2026-05-01T12:00:00.000Z"),
    });

    await log.purgeAll();

    const sentinelFile = state.files.get(`${AUDIT_DIR}/2026-05.ndjson`);
    expect(sentinelFile).toBeDefined();
    const parsed = parseAuditLine(sentinelFile!.contents.trimEnd());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe("purged-by-user");
    }
  });
});
