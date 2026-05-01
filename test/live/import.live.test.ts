// import.live.test.ts — vault-backed E2E import flow (T4.2).
//
// WHY this file exists:
// Phase 4 task T4.2 of spec 001-v0-1 requires an end-to-end test that runs
// HakobiPlugin against a tmp source dir and a tmp vault on real disk and
// verifies one happy path AND one failure/skip path. This test wires a real
// HakobiPlugin against a NodeFS-backed App (via test/live/_helpers/makeNodeApp)
// and exercises the full pipeline:
//   tmp source dir  →  ImportRunner  →  AtomicWriter  →  Vault  →  audit NDJSON
//
// Both tests verify both vault contents AND audit NDJSON entries — the audit
// log is the user's only window into ferry behaviour, so its shape is part of
// the contract under test.
//
// Refs: PRD/F1, SDD/Runtime View/Primary Flow, Constitution L2 Testing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { App } from "obsidian";

import { makeNodeApp } from "./_helpers/makeNodeApp";
import {
	mkTmpSource,
	mkTmpVault,
	writeFileAt,
	fileExistsAt,
	type TmpDir,
} from "./_helpers/tmpDirs";

import type {
	ImportRule,
	AbsolutePath,
	VaultRelativePath,
	RuleId,
} from "../../src/types";
import { parseAuditLine, type AuditEntry } from "../../src/audit/AuditEntry";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const PLUGIN_DATA_DIR_REL = ".obsidian/plugins/miyo-hakobi";

interface Harness {
	plugin: import("../../src/main").default;
	source: TmpDir;
	vault: TmpDir;
	auditDir: string;
}

/**
 * Build a HakobiPlugin instance wired against tmp source + vault dirs and
 * pre-seeded data. Returns once `plugin.onload()` has resolved — the rule is
 * already in RuleStore's cache and the scheduler is ready for runOnce().
 */
async function makeHarness(opts: {
	rule: ImportRule;
	source: TmpDir;
	vault: TmpDir;
	stabilityCheckMs?: number;
}): Promise<Harness> {
	// Pre-create the plugin data dir so AuditLog's mkdir-p has somewhere to
	// land and DeviceStore's first read/write has a valid parent.
	await fs.mkdir(path.join(opts.vault.path, PLUGIN_DATA_DIR_REL), {
		recursive: true,
	});

	const { app } = makeNodeApp(opts.vault.path);

	const { default: HakobiPlugin } = await import("../../src/main");
	const plugin = new HakobiPlugin(app as App);
	Object.assign(plugin.manifest, {
		id: "miyo-hakobi",
		name: "MiYo Hakobi",
		version: "0.0.0",
		dir: PLUGIN_DATA_DIR_REL,
	});

	// Pre-seed plugin data: the rule plus stabilityCheckMs short enough for
	// just-written test files to qualify as "stable" (default 0).
	const persistedData = {
		schemaVersion: 1,
		rules: [opts.rule],
		globalSettings: {
			perFileTimeoutMs: 10_000,
			auditRetentionDays: 90,
			auditMaxBytes: 10_485_760,
			stabilityCheckMs: opts.stabilityCheckMs ?? 0,
		},
	};
	(plugin as unknown as { loadData: () => Promise<unknown> }).loadData =
		async () => persistedData;
	(plugin as unknown as { saveData: (d: unknown) => Promise<void> }).saveData =
		async () => undefined;

	await plugin.onload();

	return {
		plugin,
		source: opts.source,
		vault: opts.vault,
		auditDir: path.join(opts.vault.path, PLUGIN_DATA_DIR_REL, "audit"),
	};
}

/** Tear down a harness — onunload + cleanup of both tmp dirs (best-effort). */
async function tearDown(h: Harness | undefined): Promise<void> {
	if (h === undefined) return;
	try {
		h.plugin.onunload();
	} catch {
		// best-effort
	}
	await h.source.cleanup().catch(() => undefined);
	await h.vault.cleanup().catch(() => undefined);
}

/** Read all audit entries from `auditDir` across any month files present. */
async function readAuditEntries(auditDir: string): Promise<AuditEntry[]> {
	let names: string[];
	try {
		names = await fs.readdir(auditDir);
	} catch {
		return [];
	}
	const ndjson = names.filter((n) => n.endsWith(".ndjson")).sort();
	const entries: AuditEntry[] = [];
	for (const name of ndjson) {
		const raw = await fs.readFile(path.join(auditDir, name), "utf8");
		for (const line of raw.split("\n")) {
			if (line === "") continue;
			const parsed = parseAuditLine(line);
			if (parsed.ok) entries.push(parsed.value);
		}
	}
	return entries;
}

/** Trigger runOnce for the given rule by reaching into the plugin's scheduler. */
async function runOnce(
	plugin: import("../../src/main").default,
	ruleId: RuleId,
): Promise<void> {
	const scheduler = (plugin as unknown as {
		scheduler: import("../../src/scheduler/Scheduler").Scheduler;
	}).scheduler;
	await scheduler.runOnce(ruleId, { dryRun: false });
}

// ---------------------------------------------------------------------------
// Rule factory
// ---------------------------------------------------------------------------

function makeRule(opts: {
	id: string;
	name: string;
	sourcePath: string;
	destinationVaultPath: string;
	flattenOnTarget: boolean;
}): ImportRule {
	return {
		id: opts.id as RuleId,
		name: opts.name,
		direction: "import",
		sourcePath: opts.sourcePath as AbsolutePath,
		destinationVaultPath: opts.destinationVaultPath as VaultRelativePath,
		everyMinutes: 60,
		action: "copy",
		onCollision: "suffix",
		flattenOnTarget: opts.flattenOnTarget,
		dryRun: false,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import.live — vault-backed E2E", () => {
	// -------------------------------------------------------------------------
	// Happy path: 3 normal files, flattenOnTarget=false
	// -------------------------------------------------------------------------

	describe("happy path: 3 normal files, flattenOnTarget=false", () => {
		let harness: Harness | undefined;
		let rule: ImportRule;

		beforeAll(async () => {
			const source = await mkTmpSource();
			const vault = await mkTmpVault();

			// Backdate mtimes so files are "stable" against any stabilityCheckMs ≥ 0.
			const oldMtime = Date.now() - 60_000;
			await writeFileAt(source.path, "note-a.md", "alpha\n", oldMtime);
			await writeFileAt(source.path, "note-b.md", "beta\n", oldMtime);
			await writeFileAt(source.path, "sub/note-c.md", "gamma\n", oldMtime);

			rule = makeRule({
				id: "11111111-1111-4111-8111-111111111111",
				name: "Live Import Happy",
				sourcePath: source.path,
				destinationVaultPath: "Inbox",
				flattenOnTarget: false,
			});

			harness = await makeHarness({ rule, source, vault });
		});

		afterAll(async () => {
			await tearDown(harness);
		});

		it("copies all 3 files into the vault preserving subfolder structure", async () => {
			if (!harness) throw new Error("harness not initialized");
			await runOnce(harness.plugin, rule.id);

			expect(await fileExistsAt(harness.vault.path, "Inbox/note-a.md")).toBe(true);
			expect(await fileExistsAt(harness.vault.path, "Inbox/note-b.md")).toBe(true);
			expect(await fileExistsAt(harness.vault.path, "Inbox/sub/note-c.md")).toBe(true);
		});

		it("emits 3 file-level ok entries + 1 rule-level rule-ok entry", async () => {
			if (!harness) throw new Error("harness not initialized");
			const entries = await readAuditEntries(harness.auditDir);

			const fileEntries = entries.filter((e) => e.decision === "ok");
			expect(fileEntries).toHaveLength(3);
			for (const e of fileEntries) {
				expect(e.direction).toBe("import");
				expect(e.operation).toBe("copy");
				expect(e.ruleId).toBe(rule.id);
				expect(e.ruleName).toBe(rule.name);
				expect(e.sourcePathRelative).toBeDefined();
				expect(e.destinationPathRelative).toBeDefined();
				// Per-file paths are RELATIVE to the rule roots — never absolute
				// (Constitution L2 Privacy: audit metadata only).
				expect(e.sourcePathRelative?.startsWith("/")).toBe(false);
				expect(e.destinationPathRelative?.startsWith("/")).toBe(false);
			}

			const summaries = entries.filter(
				(e) =>
					e.decision === "rule-ok" ||
					e.decision === "rule-partial" ||
					e.decision === "rule-failed",
			);
			expect(summaries).toHaveLength(1);
			expect(summaries[0].decision).toBe("rule-ok");
			expect(summaries[0].direction).toBe("import");
		});
	});

	// -------------------------------------------------------------------------
	// Failure / skip path: .DS_Store rejected, invalid name renamed
	// -------------------------------------------------------------------------

	describe("failure/skip path: .DS_Store rejected, invalid name renamed", () => {
		let harness: Harness | undefined;
		let rule: ImportRule;

		beforeAll(async () => {
			const source = await mkTmpSource();
			const vault = await mkTmpVault();

			const oldMtime = Date.now() - 60_000;
			// Housekeeping file — must be rejected with errorCode=housekeeping-file.
			await writeFileAt(source.path, ".DS_Store", "junk\n", oldMtime);
			// Obsidian-invalid name — `:` is invalid; sanitize → `_`.
			await writeFileAt(source.path, "bad:name.md", "payload\n", oldMtime);

			rule = makeRule({
				id: "22222222-2222-4222-8222-222222222222",
				name: "Live Import Skip+Rename",
				sourcePath: source.path,
				destinationVaultPath: "Inbox2",
				flattenOnTarget: true,
			});

			harness = await makeHarness({ rule, source, vault });
		});

		afterAll(async () => {
			await tearDown(harness);
		});

		it("rejects .DS_Store and lands the sanitized invalid-named file in the vault", async () => {
			if (!harness) throw new Error("harness not initialized");
			await runOnce(harness.plugin, rule.id);

			// .DS_Store must NOT appear in the vault.
			expect(await fileExistsAt(harness.vault.path, "Inbox2/.DS_Store")).toBe(false);

			// `bad:name.md` should land as `bad_name.md` (sanitization: `:` → `_`).
			expect(await fileExistsAt(harness.vault.path, "Inbox2/bad_name.md")).toBe(true);
		});

		it("emits a housekeeping-file rejection and an ok copy entry, plus a rule-partial summary", async () => {
			if (!harness) throw new Error("harness not initialized");
			const entries = await readAuditEntries(harness.auditDir);

			// Housekeeping rejection — `.DS_Store` fails sanitizeFilename with
			// reason `housekeeping-file`, so ImportRunner emits decision=rejected
			// (not "skipped" — the latter is reserved for stability-window misses,
			// onCollision=skip, and overlap).
			const housekeeping = entries.filter(
				(e) => e.errorCode === "housekeeping-file",
			);
			expect(housekeeping).toHaveLength(1);
			expect(housekeeping[0].decision).toBe("rejected");
			expect(housekeeping[0].operation).toBe("rejected");
			expect(housekeeping[0].sourcePathRelative).toBe(".DS_Store");
			expect(housekeeping[0].direction).toBe("import");

			// Successful copy of the sanitized file.
			const copied = entries.filter((e) => e.decision === "ok");
			expect(copied).toHaveLength(1);
			expect(copied[0].sourcePathRelative).toBe("bad:name.md");
			expect(copied[0].destinationPathRelative).toBe("Inbox2/bad_name.md");
			expect(copied[0].operation).toBe("copy");

			// Rule-level summary: one ok + one rejected → rule-partial per
			// ImportRunner aggregation (hasOk && hasNonOk where non-OK includes
			// "rejected").
			const summaries = entries.filter(
				(e) =>
					e.decision === "rule-ok" ||
					e.decision === "rule-partial" ||
					e.decision === "rule-failed",
			);
			expect(summaries).toHaveLength(1);
			expect(summaries[0].decision).toBe("rule-partial");
		});
	});
});
