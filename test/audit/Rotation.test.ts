// Tests for src/audit/Rotation.ts (T1.10).
//
// What is asserted here:
//  - checkAndRotate({ maxBytes, retentionDays }, nowFn) deletes audit files
//    older than `retentionDays` (compared against nowFn() and each file's
//    mtimeMs). Files whose age <= retention are kept.
//  - When the *current* month's file (matching nowFn()'s YYYY-MM) is larger
//    than `maxBytes`, it is renamed to `YYYY-MM-rotated-<unix-ms>.ndjson`.
//    The unix-ms suffix is sortable so multiple rotations within the same
//    month order chronologically.
//  - Older months whose size exceeds maxBytes are NOT rotated — only the
//    current month is rotation-eligible. (Older months are subject to the
//    age-based purge instead.)
//  - No-op behaviour: when nothing is older than retentionDays and the
//    current file is not over maxBytes, no FS call mutates anything.
//  - Defaults: maxBytes 10485760 (10 MB), retentionDays 90.

import { describe, it, expect, vi } from "vitest";
import { Rotation } from "../../src/audit/Rotation";
import type { NodeFs } from "../../src/fs/NodeFs";
import { IoNotFoundError } from "../../src/fs/NodeFs";

// ---------------------------------------------------------------------------
// In-memory FS stub focused on the Rotation surface (readdir, lstat, unlink,
// rename). The rotated-file probe `lstat` is the only consumer of mtimeMs and
// size, so the stub returns those alongside the boolean shape probes.
// ---------------------------------------------------------------------------

interface FakeFile {
  contents: string;
  mtimeMs: number;
}

interface FakeFsState {
  files: Map<string, FakeFile>;
  dirs: Set<string>;
  unlinks: string[];
  renames: Array<{ from: string; to: string }>;
}

function makeFakeFs(initial?: { dirs?: string[]; files?: Record<string, FakeFile> }): {
  fs: NodeFs;
  state: FakeFsState;
} {
  const state: FakeFsState = {
    files: new Map(Object.entries(initial?.files ?? {})),
    dirs: new Set(initial?.dirs ?? []),
    unlinks: [],
    renames: [],
  };

  const fs = {
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
    async lstat(path: string): Promise<{
      isSymbolicLink(): boolean;
      isDirectory(): boolean;
      isFile(): boolean;
      mtimeMs: number;
      size: number;
    }> {
      const file = state.files.get(path);
      if (file === undefined) {
        throw new IoNotFoundError("lstat", path, undefined);
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: file.mtimeMs,
        size: Buffer.byteLength(file.contents, "utf8"),
      };
    },
    async unlink(path: string): Promise<void> {
      if (!state.files.delete(path)) {
        throw new IoNotFoundError("unlink", path, undefined);
      }
      state.unlinks.push(path);
    },
    async rename(from: string, to: string): Promise<void> {
      const file = state.files.get(from);
      if (file === undefined) {
        throw new IoNotFoundError("rename", from, undefined);
      }
      state.files.delete(from);
      state.files.set(to, file);
      state.renames.push({ from, to });
    },
  };

  return { fs: fs as unknown as NodeFs, state };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUDIT_DIR = "/fake/plugin/audit";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixed "now" reference used across the suite. */
const NOW = new Date("2026-05-01T12:00:00.000Z");

function ms(d: Date): number {
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Age-based purge
// ---------------------------------------------------------------------------

describe("Rotation.checkAndRotate — age-based purge", () => {
  it("deletes files whose mtime is older than retentionDays", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2025-01.ndjson`]: {
          contents: "old",
          mtimeMs: ms(NOW) - 200 * DAY_MS, // way past 90-day retention
        },
        [`${AUDIT_DIR}/2026-04.ndjson`]: {
          contents: "fresh",
          mtimeMs: ms(NOW) - 5 * DAY_MS,
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate(
      { maxBytes: 10_000_000, retentionDays: 90 },
      () => NOW,
    );

    expect(state.unlinks).toContain(`${AUDIT_DIR}/2025-01.ndjson`);
    expect(state.files.has(`${AUDIT_DIR}/2025-01.ndjson`)).toBe(false);
    expect(state.files.has(`${AUDIT_DIR}/2026-04.ndjson`)).toBe(true);
  });

  it("does NOT delete files exactly at the retention boundary (age <= retentionDays kept)", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2026-02.ndjson`]: {
          contents: "boundary",
          mtimeMs: ms(NOW) - 90 * DAY_MS, // exactly at retention
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate(
      { maxBytes: 10_000_000, retentionDays: 90 },
      () => NOW,
    );

    expect(state.unlinks).toEqual([]);
    expect(state.files.has(`${AUDIT_DIR}/2026-02.ndjson`)).toBe(true);
  });

  it("ignores non-ndjson files in the audit dir (does not delete them)", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/README.txt`]: {
          contents: "keep me",
          mtimeMs: ms(NOW) - 999 * DAY_MS, // ancient
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate(
      { maxBytes: 10_000_000, retentionDays: 90 },
      () => NOW,
    );

    expect(state.unlinks).toEqual([]);
    expect(state.files.has(`${AUDIT_DIR}/README.txt`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size-based rotation (current month)
// ---------------------------------------------------------------------------

describe("Rotation.checkAndRotate — size-based rotation", () => {
  it("rotates the current-month file when its size exceeds maxBytes", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2026-05.ndjson`]: {
          contents: "x".repeat(2000), // > maxBytes below
          mtimeMs: ms(NOW),
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate({ maxBytes: 1000, retentionDays: 90 }, () => NOW);

    expect(state.renames).toHaveLength(1);
    const rename = state.renames[0]!;
    expect(rename.from).toBe(`${AUDIT_DIR}/2026-05.ndjson`);
    expect(rename.to).toMatch(
      /^\/fake\/plugin\/audit\/2026-05-rotated-\d+\.ndjson$/,
    );
    // The unix-ms suffix derives from nowFn()'s timestamp.
    expect(rename.to).toContain(`-${ms(NOW)}.ndjson`);
  });

  it("does NOT rotate when the current file is smaller than maxBytes", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2026-05.ndjson`]: {
          contents: "x".repeat(500),
          mtimeMs: ms(NOW),
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate({ maxBytes: 1000, retentionDays: 90 }, () => NOW);
    expect(state.renames).toEqual([]);
  });

  it("rotates only the current month — older months over maxBytes are left for age-purge", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2026-05.ndjson`]: {
          contents: "small",
          mtimeMs: ms(NOW),
        },
        [`${AUDIT_DIR}/2026-04.ndjson`]: {
          contents: "x".repeat(5000),
          mtimeMs: ms(NOW) - 5 * DAY_MS,
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate({ maxBytes: 1000, retentionDays: 90 }, () => NOW);
    expect(state.renames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No-op + missing dir behaviour
// ---------------------------------------------------------------------------

describe("Rotation.checkAndRotate — no-op cases", () => {
  it("is a no-op when nothing is over the size cap and nothing is past retention", async () => {
    const { fs, state } = makeFakeFs({
      dirs: [AUDIT_DIR],
      files: {
        [`${AUDIT_DIR}/2026-05.ndjson`]: {
          contents: "tiny",
          mtimeMs: ms(NOW),
        },
        [`${AUDIT_DIR}/2026-04.ndjson`]: {
          contents: "tiny",
          mtimeMs: ms(NOW) - 5 * DAY_MS,
        },
      },
    });
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
    await rot.checkAndRotate(
      { maxBytes: 10_000_000, retentionDays: 90 },
      () => NOW,
    );
    expect(state.unlinks).toEqual([]);
    expect(state.renames).toEqual([]);
  });

  it("is a no-op when the audit directory does not exist yet", async () => {
    const { fs, state } = makeFakeFs(); // no dirs, no files
    const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });

    await expect(
      rot.checkAndRotate(
        { maxBytes: 10_000_000, retentionDays: 90 },
        () => NOW,
      ),
    ).resolves.toBeUndefined();
    expect(state.unlinks).toEqual([]);
    expect(state.renames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("Rotation.checkAndRotate — defaults", () => {
  it("uses maxBytes=10485760 and retentionDays=90 when no opts are passed", async () => {
    // Spy on Date.now via vi.useFakeTimers so the default clock branch is
    // exercised. The retention default is 90 days, so a 91-day-old file must
    // be deleted, and a brand-new 11 MB file must be rotated.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const ELEVEN_MB = "x".repeat(11 * 1024 * 1024);
      const { fs, state } = makeFakeFs({
        dirs: [AUDIT_DIR],
        files: {
          [`${AUDIT_DIR}/2025-12.ndjson`]: {
            contents: "stale",
            mtimeMs: ms(NOW) - 200 * DAY_MS,
          },
          [`${AUDIT_DIR}/2026-05.ndjson`]: {
            contents: ELEVEN_MB,
            mtimeMs: ms(NOW),
          },
        },
      });
      const rot = new Rotation({ fs, getAuditDir: () => AUDIT_DIR });
      await rot.checkAndRotate();
      expect(state.unlinks).toContain(`${AUDIT_DIR}/2025-12.ndjson`);
      expect(state.renames).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
