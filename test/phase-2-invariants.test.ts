// Phase 2 invariant tests (T2.7).
//
// WHY this file exists:
// Static, grep-based guards that hold the Phase 2 architecture invariants
// declared by ADR-1 layering rules:
//   - Scheduler depends only on structural interfaces (not concrete runner classes).
//   - Scheduler does not import from persistence/ directly.
//   - Runners do not cross-depend on each other.
//   - Persistence (RuleStore, DeviceStore) does not import from scheduler/ or runner/.
//   - Scheduler does not import 'obsidian' directly (test/runtime decoupling).
//
// The walks use Node's `fs/promises`, which is fine in tests but would be
// disallowed inside the modules we are scanning.
//
// If any assertion here fails, the failing import indicates real architectural
// drift that must be addressed as a separate fix-up — do not suppress
// assertions to make the suite green.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(REPO_ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers (mirrors phase-1-invariants.test.ts for consistency)
// ---------------------------------------------------------------------------

/** Returns `source` with line-comments and block-comments stripped. */
function stripComments(source: string): string {
	const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const lines = noBlock.split("\n");
	const kept: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("//")) continue;
		if (trimmed.startsWith("*")) continue;
		const idx = line.indexOf("//");
		if (idx >= 0) {
			kept.push(line.slice(0, idx));
		} else {
			kept.push(line);
		}
	}
	return kept.join("\n");
}

/** Reads a file and strips comments, returning only executable code lines. */
async function readCode(filePath: string): Promise<string> {
	const raw = await fsp.readFile(filePath, "utf8");
	return stripComments(raw);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 2 invariants", () => {
	// -------------------------------------------------------------------------
	// Scheduler import discipline
	// -------------------------------------------------------------------------

	describe("src/scheduler/Scheduler.ts import discipline", () => {
		it("does NOT import concrete ImportRunner class", async () => {
			const code = await readCode(path.join(SRC, "scheduler", "Scheduler.ts"));
			// Catches both: from "../runner/ImportRunner" and from "./runner/ImportRunner"
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/ImportRunner["']/);
		});

		it("does NOT import concrete ExportRunner class", async () => {
			const code = await readCode(path.join(SRC, "scheduler", "Scheduler.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/ExportRunner["']/);
		});

		it("does NOT import from src/persistence/ directly", async () => {
			const code = await readCode(path.join(SRC, "scheduler", "Scheduler.ts"));
			// Catches both: from "../persistence/..." and from "./persistence/..."
			expect(code).not.toMatch(/from\s+["'][^"']*persistence\/[^"']+["']/);
		});

		it("does NOT import 'obsidian' directly (uses structural SchedulerPluginShape instead)", async () => {
			const code = await readCode(path.join(SRC, "scheduler", "Scheduler.ts"));
			// Must not have `from "obsidian"` or `from 'obsidian'`
			expect(code).not.toMatch(/from\s+["']obsidian["']/);
		});
	});

	// -------------------------------------------------------------------------
	// Runner cross-dependency discipline
	// -------------------------------------------------------------------------

	describe("runner cross-import discipline", () => {
		it("src/runner/ImportRunner.ts does NOT import from ExportRunner", async () => {
			const code = await readCode(path.join(SRC, "runner", "ImportRunner.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/ExportRunner["']/);
		});

		it("src/runner/ExportRunner.ts does NOT import from ImportRunner", async () => {
			const code = await readCode(path.join(SRC, "runner", "ExportRunner.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/ImportRunner["']/);
		});
	});

	// -------------------------------------------------------------------------
	// Persistence layer — downward-only dependencies
	// -------------------------------------------------------------------------

	describe("src/persistence/ downward-only dependency discipline", () => {
		it("RuleStore.ts does NOT import from src/scheduler/", async () => {
			const code = await readCode(path.join(SRC, "persistence", "RuleStore.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*scheduler\/[^"']+["']/);
		});

		it("RuleStore.ts does NOT import from src/runner/", async () => {
			const code = await readCode(path.join(SRC, "persistence", "RuleStore.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/[^"']+["']/);
		});

		it("DeviceStore.ts does NOT import from src/scheduler/", async () => {
			const code = await readCode(path.join(SRC, "persistence", "DeviceStore.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*scheduler\/[^"']+["']/);
		});

		it("DeviceStore.ts does NOT import from src/runner/", async () => {
			const code = await readCode(path.join(SRC, "persistence", "DeviceStore.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/[^"']+["']/);
		});
	});

	// -------------------------------------------------------------------------
	// InFlightRegistry — no upward imports
	// -------------------------------------------------------------------------

	describe("src/scheduler/InFlightRegistry.ts isolation", () => {
		it("does NOT import from runner/ or persistence/", async () => {
			const code = await readCode(path.join(SRC, "scheduler", "InFlightRegistry.ts"));
			expect(code).not.toMatch(/from\s+["'][^"']*runner\/[^"']+["']/);
			expect(code).not.toMatch(/from\s+["'][^"']*persistence\/[^"']+["']/);
		});
	});
});
