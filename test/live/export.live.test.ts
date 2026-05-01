// export.live.test.ts — vault-backed E2E export flow (T4.3).
//
// WHY this file exists:
// Phase 4 task T4.3 of spec 001-v0-1 requires an end-to-end test that runs
// HakobiPlugin against a tmp vault (source) and a tmp external destination
// dir on real disk and verifies all three export source-types (folder / tag
// / note) plus one rule-level failure path. Mirror of import.live.test.ts
// with reversed polarity:
//
//   tmp vault dir  →  ExportRunner  →  AtomicWriter  →  tmp external dir
//                                                    →  audit NDJSON
//
// Each describe block creates its own tmp vault + destination + harness so
// no inter-test state leaks. The three describe blocks are independent —
// no ordering dependency.
//
// Tag-test fixture: case 2 uses the makeNodeApp `tagFixtures` extension
// (T4.3 harness change) so VaultIo.notesByTag sees realistic frontmatter-
// equivalent tags via the metadataCache mock + getAllTags override.
//
// Refs: PRD/F2, SDD/Runtime View/Primary Flow, ADR-11 (nested-tag
// inclusion), Constitution L2 Testing.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { App } from "obsidian";

import { makeNodeApp, type TagFixtures } from "./_helpers/makeNodeApp";
import {
	mkTmpExternalDir,
	mkTmpVault,
	writeFileAt,
	readFileAt,
	fileExistsAt,
	type TmpDir,
} from "./_helpers/tmpDirs";

import type {
	ExportFolderRule,
	ExportTagRule,
	ExportNoteRule,
	ExportRule,
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
	destination: TmpDir;
	vault: TmpDir;
	auditDir: string;
	teardown: () => void;
}

/**
 * Build a HakobiPlugin instance wired against a tmp vault + tmp destination
 * dir, with an export rule pre-seeded into RuleStore. Returns once
 * `plugin.onload()` has resolved — the rule is in cache and the scheduler is
 * ready for runOnce(). Optional tag fixtures wire metadataCache for
 * tag-rule tests.
 */
async function makeHarness(opts: {
	rule: ExportRule;
	destination: TmpDir;
	vault: TmpDir;
	tagFixtures?: TagFixtures;
}): Promise<Harness> {
	// Pre-create the plugin data dir so AuditLog's mkdir-p has somewhere to
	// land and DeviceStore's first read/write has a valid parent.
	await fs.mkdir(path.join(opts.vault.path, PLUGIN_DATA_DIR_REL), {
		recursive: true,
	});

	const { app, teardown } = makeNodeApp(opts.vault.path, {
		tagFixtures: opts.tagFixtures,
	});

	const { default: HakobiPlugin } = await import("../../src/main");
	const plugin = new HakobiPlugin(app as App);
	Object.assign(plugin.manifest, {
		id: "miyo-hakobi",
		name: "MiYo Hakobi",
		version: "0.0.0",
		dir: PLUGIN_DATA_DIR_REL,
	});

	const persistedData = {
		schemaVersion: 1,
		rules: [opts.rule],
		globalSettings: {
			perFileTimeoutMs: 10_000,
			auditRetentionDays: 90,
			auditMaxBytes: 10_485_760,
			stabilityCheckMs: 0,
		},
	};
	(plugin as unknown as { loadData: () => Promise<unknown> }).loadData =
		async () => persistedData;
	(plugin as unknown as { saveData: (d: unknown) => Promise<void> }).saveData =
		async () => undefined;

	await plugin.onload();

	return {
		plugin,
		destination: opts.destination,
		vault: opts.vault,
		auditDir: path.join(opts.vault.path, PLUGIN_DATA_DIR_REL, "audit"),
		teardown,
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
	try {
		h.teardown();
	} catch {
		// best-effort — restoring module-level mocks must not mask test errors.
	}
	await h.destination.cleanup().catch(() => undefined);
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
// Rule factories
// ---------------------------------------------------------------------------

function makeFolderRule(opts: {
	id: string;
	name: string;
	sourceVaultPath: string;
	destinationPath: string;
	flattenOnTarget: boolean;
}): ExportFolderRule {
	return {
		id: opts.id as RuleId,
		name: opts.name,
		direction: "export",
		sourceType: "folder",
		sourceVaultPath: opts.sourceVaultPath as VaultRelativePath,
		destinationPath: opts.destinationPath as AbsolutePath,
		everyMinutes: 60,
		action: "copy",
		onCollision: "suffix",
		flattenOnTarget: opts.flattenOnTarget,
		dryRun: false,
	};
}

function makeTagRule(opts: {
	id: string;
	name: string;
	tags: string[];
	tagMatch: "any" | "all";
	destinationPath: string;
	flattenOnTarget: boolean;
}): ExportTagRule {
	return {
		id: opts.id as RuleId,
		name: opts.name,
		direction: "export",
		sourceType: "tag",
		tags: opts.tags,
		tagMatch: opts.tagMatch,
		destinationPath: opts.destinationPath as AbsolutePath,
		everyMinutes: 60,
		action: "copy",
		onCollision: "suffix",
		flattenOnTarget: opts.flattenOnTarget,
		dryRun: false,
	};
}

function makeNoteRule(opts: {
	id: string;
	name: string;
	sourceVaultNotePath: string;
	destinationPath: string;
}): ExportNoteRule {
	return {
		id: opts.id as RuleId,
		name: opts.name,
		direction: "export",
		sourceType: "note",
		sourceVaultNotePath: opts.sourceVaultNotePath as VaultRelativePath,
		destinationPath: opts.destinationPath as AbsolutePath,
		everyMinutes: 60,
		action: "copy",
		onCollision: "suffix",
		// flattenOnTarget irrelevant for single-note rules but required by schema.
		flattenOnTarget: false,
		dryRun: false,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("export.live — vault-backed E2E", () => {
	// -------------------------------------------------------------------------
	// Folder export: 3 vault notes preserved with subfolder structure.
	// -------------------------------------------------------------------------

	describe("folder export: 3 notes, flattenOnTarget=false", () => {
		let harness: Harness | undefined;
		let rule: ExportFolderRule;

		// Vault contents under "Public/" — asserted post-run at the destination.
		const VAULT_CONTENTS: Record<string, string> = {
			"Public/note-a.md": "alpha\n",
			"Public/note-b.md": "beta\n",
			"Public/sub/note-c.md": "gamma\n",
		};

		beforeAll(async () => {
			const destination = await mkTmpExternalDir();
			const vault = await mkTmpVault();

			// Seed the vault with the source notes. mtimes don't matter for
			// export (no stability window), but we set a known value so any
			// future ADR-6 mtime-preservation assertion has a reference.
			const knownMtime = Date.now() - 60_000;
			for (const [rel, content] of Object.entries(VAULT_CONTENTS)) {
				await writeFileAt(vault.path, rel, content, knownMtime);
			}

			rule = makeFolderRule({
				id: "33333333-3333-4333-8333-333333333333",
				name: "Live Export Folder",
				sourceVaultPath: "Public",
				destinationPath: destination.path,
				flattenOnTarget: false,
			});

			harness = await makeHarness({ rule, destination, vault });
		});

		afterAll(async () => {
			await tearDown(harness);
		});

		it("exports 3 vault notes preserving subfolder structure and emits matching audit entries", async () => {
			if (!harness) throw new Error("harness not initialized");
			await runOnce(harness.plugin, rule.id);

			// ---- Destination FS state ----
			expect(await fileExistsAt(harness.destination.path, "note-a.md")).toBe(true);
			expect(await fileExistsAt(harness.destination.path, "note-b.md")).toBe(true);
			expect(await fileExistsAt(harness.destination.path, "sub/note-c.md")).toBe(true);

			// ---- File contents (S2): bytes round-trip through the vault →
			// ArrayBuffer → fs pipeline unchanged.
			expect(await readFileAt(harness.destination.path, "note-a.md")).toBe("alpha\n");
			expect(await readFileAt(harness.destination.path, "note-b.md")).toBe("beta\n");
			expect(await readFileAt(harness.destination.path, "sub/note-c.md")).toBe("gamma\n");

			// ---- Audit NDJSON ----
			const entries = await readAuditEntries(harness.auditDir);

			const fileEntries = entries.filter((e) => e.decision === "ok");
			expect(fileEntries).toHaveLength(3);
			for (const e of fileEntries) {
				expect(e.direction).toBe("export");
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

			// Source paths are vault-relative-to-rule (no "Public/" prefix —
			// see ExportRunner.computeSourceRelPath for folder rules).
			const srcPaths = new Set(fileEntries.map((e) => e.sourcePathRelative));
			expect(srcPaths).toEqual(new Set(["note-a.md", "note-b.md", "sub/note-c.md"]));

			const summaries = entries.filter(
				(e) =>
					e.decision === "rule-ok" ||
					e.decision === "rule-partial" ||
					e.decision === "rule-failed",
			);
			expect(summaries).toHaveLength(1);
			expect(summaries[0].decision).toBe("rule-ok");
			expect(summaries[0].direction).toBe("export");
		});
	});

	// -------------------------------------------------------------------------
	// Tag export with nested-tag matching (ADR-11):
	// `#projects` matches `#projects/foo` but NOT `#other`.
	// -------------------------------------------------------------------------

	describe("tag export: nested-tag inclusion (ADR-11)", () => {
		let harness: Harness | undefined;
		let rule: ExportTagRule;

		// Three notes, each with a different tag set. The rule selects on
		// `#projects`; per ADR-11, both `#projects` and `#projects/foo` must
		// match while `#other` must NOT.
		const VAULT_NOTES: Array<{ path: string; content: string; tags: string[] }> = [
			{ path: "Notes/exact.md", content: "exact-projects\n", tags: ["#projects"] },
			{ path: "Notes/nested.md", content: "nested-projects\n", tags: ["#projects/foo"] },
			{ path: "Notes/other.md", content: "other-tag\n", tags: ["#other"] },
		];

		beforeAll(async () => {
			const destination = await mkTmpExternalDir();
			const vault = await mkTmpVault();

			const knownMtime = Date.now() - 60_000;
			for (const note of VAULT_NOTES) {
				await writeFileAt(vault.path, note.path, note.content, knownMtime);
			}

			rule = makeTagRule({
				id: "44444444-4444-4444-8444-444444444444",
				name: "Live Export Tag",
				tags: ["#projects"],
				tagMatch: "any",
				destinationPath: destination.path,
				// flatten=true so destination shape is solely a function of which
				// notes matched — keeps the assertion focused on tag selection
				// rather than path arithmetic.
				flattenOnTarget: true,
			});

			const tagFixtures: TagFixtures = new Map(
				VAULT_NOTES.map((n) => [n.path, n.tags]),
			);

			harness = await makeHarness({ rule, destination, vault, tagFixtures });
		});

		afterAll(async () => {
			await tearDown(harness);
		});

		it("exports only notes whose tags match (incl. nested) and excludes the unrelated tag", async () => {
			if (!harness) throw new Error("harness not initialized");
			await runOnce(harness.plugin, rule.id);

			// ---- Destination FS state ----
			// flattenOnTarget=true → both matching notes land at destination root
			// under their basenames; the unrelated note must NOT appear.
			expect(await fileExistsAt(harness.destination.path, "exact.md")).toBe(true);
			expect(await fileExistsAt(harness.destination.path, "nested.md")).toBe(true);
			expect(await fileExistsAt(harness.destination.path, "other.md")).toBe(false);

			// Confirm bytes for the matching pair.
			expect(await readFileAt(harness.destination.path, "exact.md")).toBe("exact-projects\n");
			expect(await readFileAt(harness.destination.path, "nested.md")).toBe("nested-projects\n");

			// ---- Audit NDJSON ----
			const entries = await readAuditEntries(harness.auditDir);

			const fileEntries = entries.filter((e) => e.decision === "ok");
			expect(fileEntries).toHaveLength(2);
			for (const e of fileEntries) {
				expect(e.direction).toBe("export");
				expect(e.operation).toBe("copy");
				expect(e.ruleId).toBe(rule.id);
			}

			// For tag rules sourcePathRelative is the FULL vault path (see
			// ExportRunner.computeSourceRelPath). The unrelated note must not
			// appear in any successful entry.
			const srcPaths = new Set(fileEntries.map((e) => e.sourcePathRelative));
			expect(srcPaths).toEqual(new Set(["Notes/exact.md", "Notes/nested.md"]));
			expect(srcPaths.has("Notes/other.md")).toBe(false);

			const summaries = entries.filter(
				(e) =>
					e.decision === "rule-ok" ||
					e.decision === "rule-partial" ||
					e.decision === "rule-failed",
			);
			expect(summaries).toHaveLength(1);
			expect(summaries[0].decision).toBe("rule-ok");
		});
	});

	// -------------------------------------------------------------------------
	// Single-note export — missing source → rule-failed.
	//
	// Spec (PRD/F2) calls the failure `source-note-missing`. The closed
	// ErrorCode enum has `source-not-found` and ExportRunner.enumerateNote
	// emits exactly that on a missing note.
	//
	// Defect (reported for T4.7 / spec compliance sweep):
	//   `validateRuleAtRunTime` (src/domain/scope.ts) calls `fs.lstat` on the
	//   resolved source root BEFORE ExportRunner.enumerateNote runs. For an
	//   export-note rule whose `sourceVaultNotePath` does not exist, that
	//   lstat throws IoNotFoundError; the error escapes ExportRunner.run
	//   uncaught, and Scheduler.executeTick's catch-all emits a generic
	//   `errorCode: "unknown"` rule-failed entry — not the typed
	//   `source-not-found` (let alone the spec-named `source-note-missing`).
	//   The user-facing F2 acceptance criterion ("rule-level failure with
	//   reason source-note-missing") is therefore not observable today.
	//
	// The assertion below pins the CURRENT behaviour so we have a regression
	// test the day production is fixed; once the runner is updated to emit
	// `source-not-found` (or the enum is expanded to `source-note-missing`),
	// flip the expected value here as part of the fix commit.
	// -------------------------------------------------------------------------

	describe("single-note export: missing source path → rule-failed", () => {
		let harness: Harness | undefined;
		let rule: ExportNoteRule;

		beforeAll(async () => {
			const destination = await mkTmpExternalDir();
			const vault = await mkTmpVault();

			// Vault is empty of the configured note path. Seed an unrelated note
			// so the vault has SOMETHING in it (closer to real use); the rule's
			// `sourceVaultNotePath` still points at a non-existent file.
			await writeFileAt(vault.path, "Other/note.md", "irrelevant\n");

			rule = makeNoteRule({
				id: "55555555-5555-4555-8555-555555555555",
				name: "Live Export Note Missing",
				sourceVaultNotePath: "Missing/does-not-exist.md",
				destinationPath: destination.path,
			});

			harness = await makeHarness({ rule, destination, vault });
		});

		afterAll(async () => {
			await tearDown(harness);
		});

		it("emits a single rule-failed audit entry and writes nothing (current behaviour: errorCode=unknown — see header)", async () => {
			if (!harness) throw new Error("harness not initialized");
			await runOnce(harness.plugin, rule.id);

			// ---- Destination FS state ----
			// Nothing should land at the destination — neither the missing note
			// nor any orphaned tmp file from a partial atomic write.
			let destEntries: string[];
			try {
				destEntries = await fs.readdir(harness.destination.path);
			} catch {
				destEntries = [];
			}
			expect(destEntries).toEqual([]);

			// ---- Audit NDJSON ----
			const entries = await readAuditEntries(harness.auditDir);

			// Exactly one rule-level failure entry; no per-file entries.
			expect(entries).toHaveLength(1);
			const ruleEntry = entries[0];
			expect(ruleEntry.direction).toBe("export");
			expect(ruleEntry.decision).toBe("rule-failed");
			// CURRENT behaviour: scope validation throws on the missing source
			// before ExportRunner.enumerateNote runs, so the runner never gets
			// to emit `source-not-found`; Scheduler's catch-all converts the
			// throw into `errorCode: "unknown"`. See file-level header for the
			// defect note (T4.7 follow-up).
			expect(ruleEntry.errorCode).toBe("unknown");
			expect(ruleEntry.ruleId).toBe(rule.id);
			expect(ruleEntry.ruleName).toBe(rule.name);
		});
	});
});
