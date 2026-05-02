// WHY this file exists:
// Verifies that Notices.ts centralizes all Obsidian Notice creation and that
// canonical user-facing strings live in exactly one place, satisfying the
// Constitution L2 Code Quality requirement for a single copy-editing seam.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Notice } from "../__mocks__/obsidian";
import * as Notices from "../../src/ui/Notices";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(REPO_ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers (mirrors phase-1-invariants.test.ts pattern)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Notices helper", () => {
	beforeEach(() => {
		Notice._reset();
	});

	describe("transient()", () => {
		it("creates exactly one Notice instance with the given message", () => {
			Notices.transient("hello");
			expect(Notice._instances).toHaveLength(1);
			expect(Notice._instances[0].message).toBe("hello");
		});

		it("does not pass timeout=0 (uses Obsidian default)", () => {
			Notices.transient("hello");
			const timeout = Notice._instances[0].timeout;
			// Default timeout: undefined (not passed) or any non-zero value.
			// We specifically must NOT pass 0 (which means persistent).
			expect(timeout).toBeUndefined();
		});
	});

	describe("persistent()", () => {
		it("creates a Notice with the given message and timeout=0", () => {
			Notices.persistent("warn");
			expect(Notice._instances).toHaveLength(1);
			expect(Notice._instances[0].message).toBe("warn");
			expect(Notice._instances[0].timeout).toBe(0);
		});
	});

	describe("ruleAlreadyRunning()", () => {
		it("creates a Notice with the canonical 'Rule already running' message", () => {
			Notices.ruleAlreadyRunning("Voice memos");
			expect(Notice._instances).toHaveLength(1);
			expect(Notice._instances[0].message).toBe(
				"Rule 'Voice memos' is already running",
			);
		});
	});

	describe("Constitution invariant: no inline new Notice() outside Notices.ts", () => {
		it("no *.ts file under src/ (except src/ui/Notices.ts) contains new Notice(", async () => {
			const NOTICES_TS = path.join(SRC, "ui", "Notices.ts");
			const allFiles = await walkTsFiles(SRC);
			const candidates = allFiles.filter((f) => f !== NOTICES_TS);

			const offenders: string[] = [];
			for (const file of candidates) {
				const content = await fsp.readFile(file, "utf8");
				if (content.includes("new Notice(")) {
					offenders.push(path.relative(REPO_ROOT, file));
				}
			}

			expect(offenders).toEqual([]);
		});
	});
});
