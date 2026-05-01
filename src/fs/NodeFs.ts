// NodeFs — time-bounded `node:fs/promises` adapter (T1.7).
//
// WHY this file exists:
// All filesystem operations executed by Hakobi flow through this single adapter
// so they can be (a) time-bounded per PRD/F11 — every per-file IO call races
// against `perFileTimeoutMs` so a stalling cloud-sync placeholder cannot freeze
// a rule run, and (b) mapped to a closed `errorCode` domain (a strict subset of
// ERROR_CODE_VALUES from src/audit/AuditEntry.ts) so audit entries never leak
// raw error strings or `errno` constants. Constitution L1 Privacy & Security
// (audit metadata only) and L2 Code Quality (separation of domain logic from
// FS concerns, testable without the OS) both apply.
//
// Design notes:
//  - The constructor takes a `timeoutMs: () => number` factory. Reading the
//    timeout fresh on every call lets the global setting change at runtime
//    (e.g. user updates Settings → next IO call sees the new value) without
//    ever reaching into singletons or globals.
//  - A single `runWithTimeout` helper races each `fs/promises` call against a
//    timer. The timer is always cleared on settle — including the timeout
//    branch — so we never leak a Node.js timer beyond the operation.
//  - `mapError` translates `NodeJS.ErrnoException.code` into one of four
//    typed exceptions (per T1.7 spec): IoTimeoutError, IoNotFoundError,
//    IoPermissionError, IoUnknownError. Anything we do not recognise becomes
//    IoUnknownError rather than escaping; this is the load-bearing invariant
//    that lets higher layers serialize errorCode safely. ENOSPC is carried as
//    IoUnknownError with errorCode='disk-full' — the closed errorCode set
//    keeps disk-full distinguishable without adding a fifth class.
//  - `lstat` returns the real `fs.Stats` object — its `isSymbolicLink`,
//    `isDirectory`, and `isFile` methods are exactly what scope.ts and the
//    transfer engines need (`FsScopeAdapter['lstat']`).
//  - POSIX paths only at this layer; T1.5 PathSafe handles cross-OS
//    normalisation upstream.
//  - T2.6 ExportRunner additions:
//    `writeFileBinary(path, ArrayBuffer)` — writes a binary buffer (vault
//    notes are binary in Obsidian's API). Needed because `writeFile` only
//    accepts string in v0.1; adding a narrow binary variant avoids converting
//    ArrayBuffer through a string encoding (which would corrupt non-ASCII
//    bytes on certain platforms).
//    `utimes(path, mtimeMs)` — preserves vault note mtime on the FS
//    destination after an atomic write, per ADR-6. The write itself resets
//    mtime; this call restores it so consumers that rely on mtime (e.g.
//    cloud-sync delta scanners) see the vault's original modification time.

import * as fsp from "node:fs/promises";

// ---------------------------------------------------------------------------
// Closed error-code domain.
//
// audit alignment: every member of IoErrorCode MUST also be a member of
// ERROR_CODE_VALUES in src/audit/AuditEntry.ts. The NodeFs test suite has a
// runtime guard that asserts this — any drift breaks tests immediately.
// ---------------------------------------------------------------------------

export type IoErrorCode =
  | "io-timeout"
  | "source-not-found"
  | "permission-denied"
  | "disk-full"
  | "unknown";

// ---------------------------------------------------------------------------
// IoError hierarchy
//
// Every public method in NodeFs rejects with one of these classes — never a
// raw `Error`. Callers can pattern-match by class (e.g. `instanceof
// IoTimeoutError`) for control flow, and read the closed `errorCode` for the
// audit log.
// ---------------------------------------------------------------------------

export class IoError extends Error {
  public readonly errorCode: IoErrorCode;
  public readonly opName: string;
  public readonly path: string;
  public readonly cause?: unknown;

  constructor(
    errorCode: IoErrorCode,
    opName: string,
    path: string,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.errorCode = errorCode;
    this.opName = opName;
    this.path = path;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class IoTimeoutError extends IoError {
  constructor(opName: string, path: string, timeoutMs: number) {
    super(
      "io-timeout",
      opName,
      path,
      `${opName}(${path}) timed out after ${timeoutMs}ms`,
    );
  }
}

export class IoNotFoundError extends IoError {
  constructor(opName: string, path: string, cause: unknown) {
    super("source-not-found", opName, path, `${opName}(${path}) not found`, cause);
  }
}

export class IoPermissionError extends IoError {
  constructor(opName: string, path: string, cause: unknown) {
    super(
      "permission-denied",
      opName,
      path,
      `${opName}(${path}) permission denied`,
      cause,
    );
  }
}

export class IoUnknownError extends IoError {
  constructor(
    opName: string,
    path: string,
    cause: unknown,
    errorCode: IoErrorCode = "unknown",
  ) {
    super(errorCode, opName, path, `${opName}(${path}) failed`, cause);
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of Node's `fs.Stats` that NodeFs publicly exposes through `lstat`.
 * Structurally compatible with `FsScopeAdapter['lstat']` from src/domain/scope.ts.
 *
 * `mtimeMs` and `size` are exposed (alongside the boolean shape probes) so
 * Rotation (T1.10) can compute file age and current size for retention/size
 * caps without a second stat-style API. Both fields are present on the real
 * `fs.Stats` object returned by `fsp.lstat`; declaring them here just lets
 * structurally-typed callers see them.
 */
export interface LStatResult {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: number;
  size: number;
}

export interface NodeFsOptions {
  /**
   * Returns the per-file IO timeout in milliseconds. Read FRESH on every call
   * so changes to the global setting are observed without reconstructing the
   * adapter.
   */
  timeoutMs: () => number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class NodeFs {
  private readonly timeoutMsFn: () => number;

  constructor(options: NodeFsOptions) {
    this.timeoutMsFn = options.timeoutMs;
  }

  // -------------------------------------------------------------------------
  // Public methods — each is a thin wrapper that delegates to fs/promises
  // through `runWithTimeout`.
  // -------------------------------------------------------------------------

  readFile(path: string): Promise<string> {
    return this.runWithTimeout("readFile", path, () => fsp.readFile(path, "utf8"));
  }

  writeFile(path: string, data: string): Promise<void> {
    return this.runWithTimeout("writeFile", path, () => fsp.writeFile(path, data));
  }

  lstat(path: string): Promise<LStatResult> {
    return this.runWithTimeout("lstat", path, () => fsp.lstat(path));
  }

  rename(from: string, to: string): Promise<void> {
    // The path used in error messages and audit attribution is the source —
    // it is the operand the user authored most directly.
    return this.runWithTimeout("rename", from, () => fsp.rename(from, to));
  }

  unlink(path: string): Promise<void> {
    return this.runWithTimeout("unlink", path, () => fsp.unlink(path));
  }

  readdir(path: string): Promise<string[]> {
    return this.runWithTimeout("readdir", path, () => fsp.readdir(path));
  }

  realpath(path: string): Promise<string> {
    return this.runWithTimeout("realpath", path, () => fsp.realpath(path));
  }

  mkdir(path: string): Promise<void> {
    // `recursive: true` makes mkdir idempotent and eliminates EEXIST as a
    // success-meaning-failure case for parent-creation use sites in T1.7+.
    // `fsp.mkdir` returns `string | undefined` with `recursive: true`; we
    // discard the return value to keep the surface simple.
    return this.runWithTimeout("mkdir", path, async () => {
      await fsp.mkdir(path, { recursive: true });
    });
  }

  /**
   * Write a binary buffer to the filesystem path. Needed by ExportRunner
   * (T2.6) — vault notes are ArrayBuffer from the Obsidian Vault API, and
   * encoding through a string would corrupt non-ASCII bytes. The Node.js
   * Buffer constructor accepts ArrayBuffer directly.
   */
  writeFileBinary(path: string, data: ArrayBuffer): Promise<void> {
    return this.runWithTimeout("writeFileBinary", path, () =>
      fsp.writeFile(path, Buffer.from(data)),
    );
  }

  /**
   * Set the access and modification times of a file at `path`. Used by
   * ExportRunner (T2.6) after an atomic write to restore the vault note's
   * original mtime on the FS destination (ADR-6: mtime preserved on export).
   * The second argument is a Unix epoch milliseconds value (TFile.stat.mtime).
   * `atime` is set equal to `mtimeMs` — only mtime semantics matter here.
   */
  utimes(path: string, mtimeMs: number): Promise<void> {
    const t = new Date(mtimeMs);
    return this.runWithTimeout("utimes", path, () => fsp.utimes(path, t, t));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async runWithTimeout<T>(
    opName: string,
    path: string,
    op: () => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.timeoutMsFn();

    // We use the global `setTimeout`/`clearTimeout` (Node + DOM lib) rather
    // than `activeWindow.setTimeout` here on purpose: NodeFs is the filesystem
    // adapter, invoked by the scheduler from a non-UI code path. It must not
    // couple to any popout window's lifecycle — the timer's job is to bound
    // a Node fs/promises call, not a UI animation. Cleanup is explicit via
    // the `finally` block below, so popout-close timer leakage (which is what
    // the obsidianmd rule guards against) cannot occur here.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      // eslint-disable-next-line obsidianmd/prefer-active-window-timers -- adapter is non-UI; see comment above.
      timeoutHandle = setTimeout(() => {
        reject(new IoTimeoutError(opName, path, timeoutMs));
      }, timeoutMs);
    });

    try {
      // Wrap the underlying op so any rejection can be mapped to an IoError
      // before reaching `Promise.race`'s consumer.
      const wrapped = op().catch((err: unknown) => {
        // Already an IoError? Surface it unchanged (defence-in-depth — the
        // op should not normally throw IoError, but if it ever does we must
        // not double-wrap.)
        if (err instanceof IoError) throw err;
        throw mapError(opName, path, err);
      });

      return await Promise.race([wrapped, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        // eslint-disable-next-line obsidianmd/prefer-active-window-timers -- pairs with setTimeout above.
        clearTimeout(timeoutHandle);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Error mapping helper (module-scoped — pure, easy to test indirectly via
// the adapter's mapping tests).
// ---------------------------------------------------------------------------

function mapError(opName: string, path: string, err: unknown): IoError {
  // Pattern-match on `NodeJS.ErrnoException.code`. Anything that is not a
  // plain object with a string `code` field falls through to the unknown
  // branch — including non-Error throws like strings or numbers.
  const code = extractErrnoCode(err);

  switch (code) {
    case "ENOENT":
      return new IoNotFoundError(opName, path, err);
    case "EACCES":
    case "EPERM":
      return new IoPermissionError(opName, path, err);
    case "ENOSPC":
      // disk-full carried as IoUnknownError per T1.7 spec; class hierarchy stays at 4 exported classes.
      return new IoUnknownError(opName, path, err, "disk-full");
    default:
      return new IoUnknownError(opName, path, err);
  }
}

function extractErrnoCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const candidate = (err as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}
