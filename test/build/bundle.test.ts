// bundle.test.ts — production-bundle gate (T4.6).
//
// WHY this file exists:
// Hakobi's privacy contract (Constitution L1 — Privacy & Security; ADR-013)
// promises NO outbound network calls and NO inbound surface. This test is the
// last-line-of-defence enforcement: it builds the production bundle and asserts
//   1. size ≤ 100 KiB minified (release-budget guard);
//   2. zero forbidden network APIs in the emitted bytes —
//      `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
//      and zero `electron` references in either static (`require("electron")`)
//      or dynamic (`import("electron"`) form (electron is `external` in
//      esbuild config; the explicit `dialog.showOpenDialog` seam is loaded at
//      runtime by Obsidian, not bundled).
//
// Approach: shell out to `npm run build` once in `beforeAll`. This couples the
// assertion directly to the build pipeline that ships to users. ~2 s overhead
// is acceptable for a release-gate test that runs as part of `npm test`.
//
// If a future regression sneaks any of these tokens in, the test fails and the
// pre-commit gate (`npm run typecheck && npm test && npm run lint && npm run build`)
// blocks the merge.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "build", "main.js");
const SIZE_BUDGET_BYTES = 100 * 1024; // 100 KiB

// Forbidden network APIs — bundle must contain ZERO occurrences of each.
// Why these exact tokens:
//  - `fetch(` — call form, not the bare identifier (which appears in some
//    minified safe contexts as a property name); the `(` makes it a real call.
//  - `XMLHttpRequest`, `WebSocket`, `EventSource` — constructor identifiers,
//    no benign collisions in this codebase.
const FORBIDDEN_NETWORK_TOKENS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
] as const;

// Electron must NOT be inlined. esbuild marks it `external`, so neither
// static nor dynamic imports of `electron` should appear in the bundle.
// (The dialog.showOpenDialog seam is reached via Obsidian's runtime, not by
// importing electron from this codebase.)
const FORBIDDEN_ELECTRON_TOKENS = [
  'require("electron")',
  "require('electron')",
  'import("electron"',
  "import('electron'",
] as const;

describe("production bundle gate (T4.6)", () => {
  let bundle: string;
  let bundleBytes: number;

  beforeAll(() => {
    // Build fresh — the test's whole purpose is to assert what `npm run build`
    // emits, so we run it ourselves rather than trust a possibly-stale build/.
    // stdio:'inherit' would spam test output; pipe and surface only on failure.
    try {
      execSync("npm run build", {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `npm run build failed:\n${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message}`,
      );
    }

    if (!fs.existsSync(BUNDLE_PATH)) {
      throw new Error(
        `Production bundle missing at ${BUNDLE_PATH} after npm run build`,
      );
    }

    bundle = fs.readFileSync(BUNDLE_PATH, "utf8");
    bundleBytes = fs.statSync(BUNDLE_PATH).size;
  }, 60_000);

  it("produces build/main.js", () => {
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
    expect(bundleBytes).toBeGreaterThan(0);
  });

  it(`bundle is ≤ ${SIZE_BUDGET_BYTES} bytes (100 KiB) minified`, () => {
    expect(
      bundleBytes,
      `bundle is ${bundleBytes} bytes — over ${SIZE_BUDGET_BYTES} byte budget`,
    ).toBeLessThanOrEqual(SIZE_BUDGET_BYTES);
  });

  it.each(FORBIDDEN_NETWORK_TOKENS)(
    "bundle does NOT contain network API: %s",
    (token) => {
      expect(
        bundle.includes(token),
        `forbidden network API "${token}" found in build/main.js — Hakobi must have NO outbound network calls (Constitution L1)`,
      ).toBe(false);
    },
  );

  it.each(FORBIDDEN_ELECTRON_TOKENS)(
    "bundle does NOT inline electron: %s",
    (token) => {
      expect(
        bundle.includes(token),
        `electron import "${token}" found in build/main.js — electron is external; the dialog.showOpenDialog seam runs via Obsidian at runtime`,
      ).toBe(false);
    },
  );
});
