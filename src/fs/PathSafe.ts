// Pure path safety helpers for Hakobi (T1.5).
//
// Why this file exists: rules carry user-supplied filesystem paths. Before any
// disk I/O happens, we need to (1) expand the user's home references in a way
// that is *deterministic given env vars* (SDD/ADR-5), (2) normalize separator
// quirks across OSes so downstream code only ever sees forward-slash paths,
// and (3) reject `..` traversal segments that could let a path escape its
// declared root. Doing this in a single, dependency-free, side-effect-free
// module keeps RuleEditor save-time validation cheap and unit-testable.
//
// Constraints:
//  - No `node:fs` import. No `obsidian` import. The module is pure — env
//    access is dependency-injected so tests are deterministic and the module
//    can run in any JS host (Electron renderer, Node, jsdom).
//  - All resolution is *syntactic*: we do not check whether the resulting
//    path exists. Existence is checked separately at the FsAdapter layer
//    (T1.7) and during scope.ts run-time validation.
//  - 4096 bytes is the cap (POSIX PATH_MAX). Windows MAX_PATH is 260 by default
//    but with the `\\?\` prefix can reach 32767 — we deliberately pick the
//    POSIX limit for consistency since Hakobi targets desktop users on
//    macOS (primary), Linux, and Windows.
//
// Note on Result shape: the existing `Result<T, E>` in domain/rule.ts uses an
// `errors` plural field tuned for collected validation errors. PathSafe deals
// in single, terminal failures, so we use a local `PathSafeResult<T>` with an
// `error` (singular) discriminant instead — see the type below.
//
// Refs: SDD/ADR-5 (path expansion deterministic given env), SDD/OS Filesystem
//       Boundary, SDD/Implementation Gotchas (TextEncoder for byte length).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** POSIX PATH_MAX. Used as the byte-length cap for any path the user enters. */
export const PATH_MAX_BYTES = 4096;

const ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Error + Result types
// ---------------------------------------------------------------------------

export type PathSafeError =
  | { reason: "unresolved-env-var"; varName: string }
  | { reason: "nul-byte" }
  | { reason: "too-long"; bytes: number }
  | { reason: "not-absolute" }
  | { reason: "traversal"; segment: string };

/** Single-failure Result for PathSafe. (See note in file header.) */
export type PathSafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PathSafeError };

/** Thrown by `normalizeFsPath` when it cannot return a normalized string —
 *  NUL byte present or input exceeds the byte cap. We throw rather than return
 *  a Result here because both conditions are integrity errors, not domain
 *  branches the caller should reason about. */
export class PathSafeException extends Error {
  public readonly error: PathSafeError;
  constructor(error: PathSafeError) {
    super(`PathSafe: ${error.reason}`);
    this.name = "PathSafeException";
    this.error = error;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read the host process's environment. Tests inject a fake. */
function defaultEnv(name: string): string | undefined {
  // `process` is available in Electron renderers (Obsidian) and in Node tests.
  // We guard for the rare case where it might be absent (e.g. browser-only).
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}

function byteLength(s: string): number {
  return ENCODER.encode(s).byteLength;
}

function isAbsolute(p: string): boolean {
  // POSIX: leading `/`. Windows: drive letter like `C:/` or `C:\`. We test
  // both because expandUserPath returns drive paths under Windows.
  if (p.startsWith("/")) return true;
  if (/^[A-Za-z]:[/\\]/.test(p)) return true;
  return false;
}

function success<T>(value: T): PathSafeResult<T> {
  return { ok: true, value };
}

function failure<T = never>(error: PathSafeError): PathSafeResult<T> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// expandUserPath
// ---------------------------------------------------------------------------

/**
 * Expand `~`, `$HOME`, `${HOME}`, and `%USERPROFILE%` references against an
 * environment lookup. Returns the absolute path on success; on failure returns
 * a discriminated PathSafeError.
 *
 * Determinism: given the same `input` and `env`, the result is identical —
 * no clock, no globals, no side effects.
 */
export function expandUserPath(
  input: string,
  env: (name: string) => string | undefined = defaultEnv,
): PathSafeResult<string> {
  // 1. Reject NUL anywhere up front.
  if (input.includes("\0")) {
    return failure({ reason: "nul-byte" });
  }

  // 2. Byte-length cap on the original input.
  const inputBytes = byteLength(input);
  if (inputBytes > PATH_MAX_BYTES) {
    return failure({ reason: "too-long", bytes: inputBytes });
  }

  // 3. Detect and expand the supported reference forms.
  let expanded = input;

  // Leading `~` (only at position 0, only if followed by `/` or end of string).
  if (expanded.startsWith("~") && (expanded.length === 1 || expanded[1] === "/")) {
    const home = env("HOME");
    if (home === undefined) {
      return failure({ reason: "unresolved-env-var", varName: "HOME" });
    }
    expanded = home + expanded.slice(1);
  }

  // `$HOME` and `${HOME}` — POSIX-style env-var refs. We deliberately only
  // support HOME here (not arbitrary env vars) to keep the trust surface
  // small; users who need other env vars can pre-expand outside Hakobi.
  if (expanded.includes("$HOME") || expanded.includes("${HOME}")) {
    const home = env("HOME");
    if (home === undefined) {
      return failure({ reason: "unresolved-env-var", varName: "HOME" });
    }
    expanded = expanded.split("${HOME}").join(home).split("$HOME").join(home);
  }

  // `%USERPROFILE%` — Windows-style, conventionally case-insensitive token.
  if (/%USERPROFILE%/i.test(expanded)) {
    const userProfile = env("USERPROFILE");
    if (userProfile === undefined) {
      return failure({ reason: "unresolved-env-var", varName: "USERPROFILE" });
    }
    expanded = expanded.replace(/%USERPROFILE%/gi, userProfile);
  }

  // 4. Result must be absolute (ADR-5: persist *resolved absolute path*).
  if (!isAbsolute(expanded)) {
    return failure({ reason: "not-absolute" });
  }

  return success(expanded);
}

// ---------------------------------------------------------------------------
// normalizeFsPath
// ---------------------------------------------------------------------------

/**
 * Normalize a filesystem path string:
 *  - convert `\` to `/`
 *  - collapse runs of `/` to a single `/` (UNC `\\server` paths are NOT
 *    supported in v0.1; the leading `//` collapses to `/`)
 *  - trim trailing `/` from non-root paths
 *
 * Throws `PathSafeException` for NUL bytes and over-cap inputs (integrity
 * errors). Returns the empty string unchanged so callers can reject empty
 * input on their own terms.
 */
export function normalizeFsPath(input: string): string {
  if (input === "") return "";

  if (input.includes("\0")) {
    throw new PathSafeException({ reason: "nul-byte" });
  }

  const bytes = byteLength(input);
  if (bytes > PATH_MAX_BYTES) {
    throw new PathSafeException({ reason: "too-long", bytes });
  }

  let out = input.replace(/\\/g, "/");
  out = out.replace(/\/+/g, "/");

  // Trim trailing `/` from non-root paths.
  if (out.length > 1 && out.endsWith("/")) {
    out = out.slice(0, -1);
  }

  return out;
}

// ---------------------------------------------------------------------------
// assertNoTraversal
// ---------------------------------------------------------------------------

/**
 * True iff `input` contains no `..` traversal segment after splitting on both
 * `/` and `\`. Empty input returns true vacuously. The check is segment-exact:
 * `....` and `..foo` are allowed, only the literal `..` segment is rejected.
 */
export function assertNoTraversal(input: string): boolean {
  if (input === "") return true;
  const segments = input.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "..") return false;
  }
  return true;
}
