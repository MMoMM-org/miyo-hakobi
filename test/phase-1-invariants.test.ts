// Phase 1 invariant tests (T1.11).
//
// WHY this file exists:
// Static, grep-based guards that hold the Phase 1 architecture invariants
// the spec README and constitution declare:
//   1. `src/domain/` is dependency-free of Obsidian and Node `fs`/`path`
//      so the domain logic stays portable, testable without a runtime,
//      and free of side-effect imports.
//   2. No Phase 1 source file performs network IO. Constitution L1
//      (Privacy & Security) forbids silent network surfaces; this test
//      catches a network-call CALLSITE — `fetch(`, `XMLHttpRequest`,
//      `WebSocket(` — slipping into a domain/audit/fs/vault/runner
//      module. URL-literal patterns (`http://`, `https://`) are
//      deliberately not scanned: any real network call still needs one
//      of the callsite primitives above, and a quote-aware scanner to
//      separate URL literals from line comments would add complexity
//      without protection.
//
// The walks use Node's `fs/promises`, which is fine in tests but would be
// disallowed inside the modules we are scanning.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(REPO_ROOT, "src");
const PHASE_1_DIRS = ["domain", "fs", "audit", "vault", "runner", "types"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function walkTsFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const entries = await fsp.readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const abs = path.join(root, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await walkTsFiles(abs)));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			out.push(abs);
		}
	}
	return out;
}

/** Returns `source` with line-comments and block-comments stripped, so the
 *  caller can grep for forbidden patterns without false-positives from
 *  documentation links inside comments. Strips conservatively:
 *    - lines whose trimmed form starts with `//` are removed entirely
 *    - lines whose trimmed form starts with `*` (mid-block-comment lines) are
 *      removed entirely
 *    - block comments (`/* ... *​/`) are removed across line boundaries
 */
function stripComments(source: string): string {
	// Remove block comments first (greedy across newlines).
	const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const lines = noBlock.split("\n");
	const kept: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("//")) continue;
		if (trimmed.startsWith("*")) continue;
		// Strip a trailing line-comment; keep the code prefix.
		const idx = line.indexOf("//");
		if (idx >= 0) {
			kept.push(line.slice(0, idx));
		} else {
			kept.push(line);
		}
	}
	return kept.join("\n");
}

/** Extracts the module specifiers of every top-level `import ... from "..."`
 *  or bare `import "..."` statement. Comments are stripped first so a
 *  documentation example mentioning "obsidian" cannot trip the check. */
function importSpecifiers(source: string): string[] {
	const stripped = stripComments(source);
	const specifiers: string[] = [];
	const re = /(?:^|[\n;])\s*import\b[^;]*?from\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(stripped)) !== null) {
		const spec = m[1] ?? m[2];
		if (spec) specifiers.push(spec);
	}
	return specifiers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 1 invariants", () => {
	describe("src/domain/ is dependency-free", () => {
		it("imports nothing from 'obsidian'", async () => {
			const files = await walkTsFiles(path.join(SRC, "domain"));
			expect(files.length).toBeGreaterThan(0);
			const offenders: string[] = [];
			for (const file of files) {
				const src = await fsp.readFile(file, "utf8");
				for (const spec of importSpecifiers(src)) {
					if (spec === "obsidian" || spec.startsWith("obsidian/")) {
						offenders.push(`${path.relative(REPO_ROOT, file)} imports '${spec}'`);
					}
				}
			}
			expect(offenders).toEqual([]);
		});

		it("imports no Node fs / path modules", async () => {
			const banned = new Set([
				"fs",
				"node:fs",
				"fs/promises",
				"node:fs/promises",
				"path",
				"node:path",
			]);
			const files = await walkTsFiles(path.join(SRC, "domain"));
			expect(files.length).toBeGreaterThan(0);
			const offenders: string[] = [];
			for (const file of files) {
				const src = await fsp.readFile(file, "utf8");
				for (const spec of importSpecifiers(src)) {
					if (banned.has(spec)) {
						offenders.push(`${path.relative(REPO_ROOT, file)} imports '${spec}'`);
					}
				}
			}
			expect(offenders).toEqual([]);
		});
	});

	describe("Phase 1 source has no network-call callsites", () => {
		// Pre-collect the files once for the grep test.
		const collectFiles = async (): Promise<string[]> => {
			const all: string[] = [];
			for (const dir of PHASE_1_DIRS) {
				const root = path.join(SRC, dir);
				try {
					const found = await walkTsFiles(root);
					all.push(...found);
				} catch (e) {
					// Phase 1 dir missing is itself a failure — surface it.
					throw new Error(`Phase 1 directory missing: ${root}: ${(e as Error).message}`);
				}
			}
			return all;
		};

		it("contains no fetch( / XMLHttpRequest / WebSocket( in non-comment code", async () => {
			const files = await collectFiles();
			expect(files.length).toBeGreaterThan(0);
			// Only network-call CALLSITES are scanned. URL literals
			// (`http://`, `https://`) are intentionally excluded — they
			// cannot perform IO on their own and would require a
			// quote-aware scanner to distinguish from line comments
			// (the trailing `//` clip in `stripComments` collapses
			// `"https://..."` to `"https:"` and makes URL patterns
			// pass vacuously). Any real network IO still hits one of
			// the callsite primitives below.
			const patterns: { name: string; re: RegExp }[] = [
				{ name: "fetch(", re: /\bfetch\s*\(/ },
				{ name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
				{ name: "WebSocket(", re: /\bWebSocket\s*\(/ },
			];
			const offenders: string[] = [];
			for (const file of files) {
				const src = await fsp.readFile(file, "utf8");
				const codeOnly = stripComments(src);
				for (const { name, re } of patterns) {
					if (re.test(codeOnly)) {
						offenders.push(`${path.relative(REPO_ROOT, file)} contains ${name}`);
					}
				}
			}
			expect(offenders).toEqual([]);
		});
	});
});
