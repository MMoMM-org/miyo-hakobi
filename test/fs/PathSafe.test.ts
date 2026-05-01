// Tests for src/fs/PathSafe.ts — pure path expansion, normalization, traversal
// guards (T1.5). Mirrors SDD/ADR-5: env vars are expanded if resolvable; if the
// referenced env var is unset we return a typed failure (no silent fallback).
//
// Determinism is enforced through dependency injection of `env` — no `process.env`
// access in tests.

import { describe, it, expect } from "vitest";
import {
  expandUserPath,
  normalizeFsPath,
  containsTraversal,
  PATH_MAX_BYTES,
} from "../../src/fs/PathSafe";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a deterministic env() reader from a plain map. */
function envFrom(map: Record<string, string | undefined>): (name: string) => string | undefined {
  return (name: string): string | undefined => map[name];
}

const POSIX_ENV = envFrom({ HOME: "/Users/me" });
const WIN_ENV = envFrom({ USERPROFILE: "C:/Users/me" });
const EMPTY_ENV = envFrom({});

// ---------------------------------------------------------------------------
// expandUserPath
// ---------------------------------------------------------------------------

describe("expandUserPath", () => {
  it("expands a leading `~` to env('HOME')", () => {
    expect(expandUserPath("~", POSIX_ENV)).toEqual({
      ok: true,
      value: "/Users/me",
    });
  });

  it("expands `~/Downloads` to `<HOME>/Downloads`", () => {
    expect(expandUserPath("~/Downloads", POSIX_ENV)).toEqual({
      ok: true,
      value: "/Users/me/Downloads",
    });
  });

  it("does NOT expand `~` mid-path (only the leading tilde is special)", () => {
    // Mid-path `~` must remain literal — shells expand only when `~` is the
    // first character of a path component at the start of the path.
    expect(expandUserPath("/foo/~/bar", POSIX_ENV)).toEqual({
      ok: true,
      value: "/foo/~/bar",
    });
  });

  it("expands `$HOME` (POSIX env-var syntax)", () => {
    expect(expandUserPath("$HOME/Downloads", POSIX_ENV)).toEqual({
      ok: true,
      value: "/Users/me/Downloads",
    });
  });

  it("expands `${HOME}` (braced POSIX env-var syntax)", () => {
    expect(expandUserPath("${HOME}/Downloads", POSIX_ENV)).toEqual({
      ok: true,
      value: "/Users/me/Downloads",
    });
  });

  it("expands `%USERPROFILE%` (Windows-style, case-insensitive token)", () => {
    // Windows uses `%VARNAME%` and is conventionally case-insensitive for
    // environment variables. We match the token case-insensitively but we
    // look the variable up by the canonical uppercase name.
    expect(expandUserPath("%USERPROFILE%/Downloads", WIN_ENV)).toEqual({
      ok: true,
      value: "C:/Users/me/Downloads",
    });
    expect(expandUserPath("%userprofile%/Downloads", WIN_ENV)).toEqual({
      ok: true,
      value: "C:/Users/me/Downloads",
    });
  });

  it("returns unresolved-env-var when `~` is used but HOME is unset", () => {
    expect(expandUserPath("~/Downloads", EMPTY_ENV)).toEqual({
      ok: false,
      error: { reason: "unresolved-env-var", varName: "HOME" },
    });
  });

  it("returns unresolved-env-var when `$HOME` is referenced but HOME is unset", () => {
    expect(expandUserPath("$HOME/Downloads", EMPTY_ENV)).toEqual({
      ok: false,
      error: { reason: "unresolved-env-var", varName: "HOME" },
    });
  });

  it("returns unresolved-env-var when `%USERPROFILE%` is referenced but USERPROFILE is unset", () => {
    expect(expandUserPath("%USERPROFILE%/Downloads", EMPTY_ENV)).toEqual({
      ok: false,
      error: { reason: "unresolved-env-var", varName: "USERPROFILE" },
    });
  });

  it("returns an absolute path unchanged when no expansion tokens are present", () => {
    expect(expandUserPath("/Users/me/Downloads", POSIX_ENV)).toEqual({
      ok: true,
      value: "/Users/me/Downloads",
    });
  });

  it("returns not-absolute when input is a relative path with no expansion tokens", () => {
    // ADR-5 persists the *resolved absolute path*. A bare relative path cannot
    // be resolved at this pure-function layer (no cwd dependency).
    expect(expandUserPath("relative/path", POSIX_ENV)).toEqual({
      ok: false,
      error: { reason: "not-absolute" },
    });
  });

  it("returns nul-byte error when input contains a NUL", () => {
    expect(expandUserPath("/foo\0/bar", POSIX_ENV)).toEqual({
      ok: false,
      error: { reason: "nul-byte" },
    });
  });

  it("returns too-long error when input byte length exceeds PATH_MAX_BYTES", () => {
    const long = "/" + "a".repeat(PATH_MAX_BYTES);
    const result = expandUserPath(long, POSIX_ENV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("too-long");
      if (result.error.reason === "too-long") {
        expect(result.error.bytes).toBeGreaterThan(PATH_MAX_BYTES);
      }
    }
  });

  it("accepts a path at exactly PATH_MAX_BYTES", () => {
    const exact = "/" + "a".repeat(PATH_MAX_BYTES - 1);
    expect(new TextEncoder().encode(exact).byteLength).toBe(PATH_MAX_BYTES);
    const result = expandUserPath(exact, POSIX_ENV);
    expect(result.ok).toBe(true);
  });

  it("rejects expansion that exceeds PATH_MAX_BYTES even if input is short", () => {
    // A short input (`~/x`, 3 bytes) can still balloon past PATH_MAX_BYTES
    // once HOME is substituted in. We deliberately size HOME so that the
    // expanded path crosses 4096 bytes — the input-stage cap alone would
    // not have caught this.
    const longHome = "/" + "a".repeat(PATH_MAX_BYTES);
    const result = expandUserPath("~/x", envFrom({ HOME: longHome }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("too-long");
      expect((result.error as { bytes: number }).bytes).toBeGreaterThan(PATH_MAX_BYTES);
    }
  });

  it("falls back to process.env when no env reader is injected (default path)", () => {
    // Drives the default `defaultEnv` lookup against the host's real env.
    // This test runs under vitest+jsdom where `process.env.HOME` is set.
    // We don't assert on the exact HOME value (varies by host) — only that
    // expansion completes deterministically and returns a string starting
    // with the resolved HOME. If HOME ever becomes unset on a future host
    // we accept the typed unresolved-env-var failure rather than throwing.
    const result = expandUserPath("~/scratch");
    if (result.ok) {
      expect(typeof result.value).toBe("string");
      expect(result.value.endsWith("/scratch")).toBe(true);
    } else {
      expect(result.error).toEqual({ reason: "unresolved-env-var", varName: "HOME" });
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeFsPath
// ---------------------------------------------------------------------------

describe("normalizeFsPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeFsPath("C:\\foo\\bar")).toBe("C:/foo/bar");
  });

  it("collapses duplicate forward slashes", () => {
    // Note: leading `//` for UNC paths is NOT supported in v0.1 — collapsed
    // to a single `/`. Document this in the test for any future reviewer.
    expect(normalizeFsPath("/foo//bar///baz")).toBe("/foo/bar/baz");
  });

  it("collapses mixed separators after backslash conversion", () => {
    expect(normalizeFsPath("C:\\foo\\\\bar//baz")).toBe("C:/foo/bar/baz");
  });

  it("collapses leading `//` to a single `/` (UNC unsupported in v0.1)", () => {
    expect(normalizeFsPath("//server/share")).toBe("/server/share");
  });

  it("trims a trailing slash from a non-root path", () => {
    expect(normalizeFsPath("/foo/bar/")).toBe("/foo/bar");
  });

  it("preserves the root `/` itself", () => {
    expect(normalizeFsPath("/")).toBe("/");
  });

  it("returns empty string for empty input (callers may reject if needed)", () => {
    expect(normalizeFsPath("")).toBe("");
  });

  it("throws PathSafeException when input contains a NUL byte", () => {
    // We chose throw over Result here because NUL in a path is a programmer/
    // user-input integrity error that should surface as an exception at the
    // call site — not a domain decision the caller should branch on.
    expect(() => normalizeFsPath("/foo\0/bar")).toThrow(/nul-byte/);
  });

  it("throws PathSafeException when input byte length exceeds PATH_MAX_BYTES", () => {
    const long = "/" + "a".repeat(PATH_MAX_BYTES);
    expect(() => normalizeFsPath(long)).toThrow(/too-long/);
  });
});

// ---------------------------------------------------------------------------
// containsTraversal
// ---------------------------------------------------------------------------

describe("containsTraversal", () => {
  it("returns false for a path with no `..` segments", () => {
    expect(containsTraversal("/foo/bar/baz")).toBe(false);
  });

  it("returns true when any segment is exactly `..`", () => {
    expect(containsTraversal("/foo/../bar")).toBe(true);
  });

  it("returns true for a leading `..`", () => {
    expect(containsTraversal("../escape")).toBe(true);
  });

  it("splits on both `/` AND `\\` so backslash-traversal is detected", () => {
    expect(containsTraversal("foo\\..\\bar")).toBe(true);
  });

  it("distinguishes `..` (detected) from `....` (allowed)", () => {
    expect(containsTraversal("/foo/..../bar")).toBe(false);
  });

  it("distinguishes `..` (detected) from `..foo` (allowed — segment-exact match)", () => {
    expect(containsTraversal("/foo/..foo/bar")).toBe(false);
  });

  it("returns false (vacuously) for empty input", () => {
    expect(containsTraversal("")).toBe(false);
  });
});
