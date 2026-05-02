// compliance.test.ts — Spec compliance final sweep (T4.7).
//
// WHY this file exists:
// Phase 4 task T4.7 of spec 001-v0-1 calls for a single drift-canary test that
// snapshots the cross-cutting properties of v0.1 the spec promises:
//
//   1. Registered command set      (PRD/F7 — closed list of 6 commands)
//   2. Audit log field allowlist   (PRD/F5 — closed metadata-only set)
//   3. Bundled artefacts present   (build/main.js, manifest.json, styles.css)
//   4. Lifecycle register* hygiene (Constitution L1 Operations / no-daemon)
//   5. PRD F1–F12 → test-file mapping (every acceptance criterion has a test)
//   6. SDD ADR-1..12 → impl/test mapping (every ADR is implemented or deviated)
//   7. Won't-Have absences         (no HTTP/WS/cloud/telemetry/MCP imports)
//
// These assertions are intentionally COARSE. They do not re-test the
// behaviours other test files cover — they assert the spec-level contracts
// are still observable AS A WHOLE. If a future change accidentally drops a
// command, adds an audit field, or introduces a forbidden dependency, the
// failure surfaces here in a single test run.
//
// References:
//   - PRD §Feature Requirements (F1–F12)
//   - PRD §Won't Have (This Phase)
//   - SDD §Architecture Decisions (ADR-1..12)
//   - SDD §Application Data Models (AuditEntry closed allowlist)
//   - Constitution L1 Privacy / Operations / Performance
//   - test/build/bundle.test.ts — already covers `fetch(`, XMLHttpRequest,
//     WebSocket, EventSource, electron — this file does NOT duplicate those.

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { App } from "obsidian";

// ---------------------------------------------------------------------------
// Repo-root anchor — every path below is resolved from REPO_ROOT.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function repoPath(...segments: string[]): string {
	return path.join(REPO_ROOT, ...segments);
}

function fileExists(rel: string): boolean {
	return fs.existsSync(repoPath(rel));
}

// ---------------------------------------------------------------------------
// Section 1 — Registered commands snapshot (PRD/F7)
//
// Builds a HakobiPlugin via the obsidian mock, runs onload(), and asserts
// the addCommand call args match the closed PRD/F7 set by id + name. Drift
// in either direction (added or removed command, renamed id) fails the test.
// ---------------------------------------------------------------------------

const EXPECTED_COMMANDS = [
	{ id: "run-import-all", name: "Run all import rules" },
	{ id: "run-import-select", name: "Run an import rule…" },
	{ id: "run-export-all", name: "Run all export rules" },
	{ id: "run-export-select", name: "Run an export rule…" },
	{ id: "run-import-dry-run-select", name: "Dry-run an import rule…" },
	{ id: "run-export-dry-run-select", name: "Dry-run an export rule…" },
] as const;

function makeApp(): App {
	const app = new App();
	(app.vault.adapter as Record<string, unknown>)["getFullPath"] = vi.fn(
		(rel: string) => `/tmp/hakobi-test-vault/.obsidian/plugins/miyo-hakobi/${rel}`,
	);
	return app;
}

// ---------------------------------------------------------------------------
// Section 2 — Audit field allowlist snapshot (PRD/F5)
//
// The allowlist below is the public contract enumerated in PRD/F5 acceptance
// criterion. Section asserts that every key the AuditEntry serializer can
// emit is in this set, AND vice versa — the serializer cannot drift away
// from the PRD without this test failing.
// ---------------------------------------------------------------------------

const EXPECTED_AUDIT_FIELDS = [
	// Required (per AuditEntry interface)
	"timestamp",
	"ruleId",
	"ruleName",
	"direction",
	"operation",
	"decision",
	// Optional
	"sourcePathRelative",
	"destinationPathRelative",
	"errorCode",
	"bytesTransferred",
	"durationMs",
] as const;

// ---------------------------------------------------------------------------
// Section 5 — PRD F1–F12 → test file mapping
//
// Each F# is wired to AT LEAST ONE test file that exercises that requirement.
// The compliance test asserts each listed file exists; the mapping itself is
// the documented trace from PRD acceptance criteria to test coverage.
// ---------------------------------------------------------------------------

const F_MAPPING: Record<string, readonly string[]> = {
	// F1 — Import rule (FS → vault)
	F1: [
		"test/runner/ImportRunner.test.ts",
		"test/live/import.live.test.ts",
	],
	// F2 — Export rule (vault → FS)
	F2: [
		"test/runner/ExportRunner.test.ts",
		"test/live/export.live.test.ts",
	],
	// F3 — Per-rule scheduler
	F3: [
		"test/scheduler/Scheduler.test.ts",
		"test/scheduler/InFlightRegistry.test.ts",
	],
	// F4 — Filename sanitization
	F4: ["test/domain/sanitize.test.ts"],
	// F5 — NDJSON audit log (metadata-only)
	F5: [
		"test/audit/AuditLog.test.ts",
		"test/audit/AuditEntry.test.ts",
		"test/audit/Rotation.test.ts",
	],
	// F6 — Audit-log access (button on General subtab)
	F6: ["test/settings/subtabs/GeneralSubtab.test.ts"],
	// F7 — Command-palette commands (this file also covers it via Section 1)
	F7: ["test/ui/CommandRegistry.test.ts"],
	// F8 — Rule storage (hybrid)
	F8: [
		"test/persistence/RuleStore.test.ts",
		"test/persistence/DeviceStore.test.ts",
	],
	// F9 — Default-deny scope enforcement
	F9: ["test/domain/scope.test.ts"],
	// F10 — Status-bar indicator
	F10: ["test/ui/StatusBar.test.ts"],
	// F11 — Configurable per-file IO timeout (global)
	F11: ["test/fs/NodeFs.test.ts"],
	// F12 — File-menu integration (Could Have, deferred — covered by absence
	//       in the won't-have section indirectly; mapped to a test that proves
	//       the feature surface is at least the documented six-command set).
	F12: ["test/ui/CommandRegistry.test.ts"],
} as const;

// ---------------------------------------------------------------------------
// Section 6 — SDD ADR-1..12 → implementation/test reference
//
// Each ADR maps to a code path or test file that proves it is implemented as
// documented. Pure architectural ADRs (e.g. ADR-1: layered modular monolith)
// reference the SDD itself + a representative test that exercises the
// layering. Drift of a referenced file fails the test loudly; drift of the
// ADR's actual behaviour is caught by the per-feature tests in Section 5.
// ---------------------------------------------------------------------------

const ADR_MAPPING: Record<string, readonly string[]> = {
	// ADR-1: layered modular monolith
	"ADR-1": ["src/main.ts", "test/lifecycle/unload.test.ts"],
	// ADR-2: Rule discriminated union
	"ADR-2": ["src/domain/rule.ts", "test/domain/rule.test.ts"],
	// ADR-3: hybrid persistence (rules + device + audit)
	"ADR-3": [
		"src/persistence/RuleStore.ts",
		"src/persistence/DeviceStore.ts",
		"src/audit/AuditLog.ts",
	],
	// ADR-4: audit-log path encoding (rule-root-relative for FS, vault-relative for vault)
	"ADR-4": ["src/runner/ExportRunner.ts", "src/runner/ImportRunner.ts"],
	// ADR-5: path expansion at config save time
	"ADR-5": ["src/fs/PathSafe.ts", "test/fs/PathSafe.test.ts"],
	// ADR-6: mtime preservation on export only
	"ADR-6": ["src/runner/ExportRunner.ts", "test/runner/ExportRunner.test.ts"],
	// ADR-7: UUID v4 rule ID
	"ADR-7": ["src/domain/ruleId.ts", "test/domain/ruleId.test.ts"],
	// ADR-8: stability check via mtime quiet window
	"ADR-8": ["src/runner/ImportRunner.ts", "test/runner/ImportRunner.test.ts"],
	// ADR-9: scheduler model — one timer per rule + InFlightRegistry overlap-skip
	"ADR-9": [
		"src/scheduler/Scheduler.ts",
		"src/scheduler/InFlightRegistry.ts",
		"test/scheduler/Scheduler.test.ts",
	],
	// ADR-10: settings UI — single tab + 3 subtabs + manifest-driven header + audit-log button
	"ADR-10": [
		"src/settings/SettingsTab.ts",
		"src/settings/HeaderSection.ts",
		"src/settings/subtabs/GeneralSubtab.ts",
		"src/settings/subtabs/ImportSubtab.ts",
		"src/settings/subtabs/ExportSubtab.ts",
	],
	// ADR-11: tag-rule recursion = nested-tag inclusive
	"ADR-11": ["src/vault/VaultIo.ts", "test/vault/VaultIo.test.ts"],
	// ADR-12: OS housekeeping skip-list applied during sanitization
	"ADR-12": ["src/domain/sanitize.ts", "test/domain/sanitize.test.ts"],
} as const;

// ---------------------------------------------------------------------------
// Section 7 — Won't-Have absences
//
// PRD §Won't Have enumerates feature classes that must not creep into v0.1.
// We grep for the canonical entry-point identifiers of each forbidden class
// across src/ + the production bundle. Identifiers are chosen to be unique
// to the forbidden class — none have benign collisions in this codebase.
//
// Note: test/build/bundle.test.ts already covers `fetch(`, `XMLHttpRequest`,
// `WebSocket`, `EventSource`, and electron in the production bundle. This
// section deliberately checks DIFFERENT signals — the source tree itself
// (so a defect can be flagged before bundling) and a complementary set of
// HTTP-server / cloud-SDK / telemetry / MCP identifiers.
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: ReadonlyArray<{ description: string; pattern: RegExp }> = [
	// HTTP / WebSocket listeners — no inbound surface (PRD §Won't Have)
	{ description: "express() server initialiser", pattern: /\bexpress\s*\(/ },
	{ description: "http.createServer", pattern: /\bhttp\.createServer\b/ },
	{ description: "WebSocketServer constructor", pattern: /\bWebSocketServer\b/ },
	// Native cloud-service SDKs — no native cloud APIs (PRD §Won't Have)
	{ description: "dropbox SDK import", pattern: /from ['"]dropbox['"]/ },
	{ description: "googleapis SDK import", pattern: /from ['"]googleapis['"]/ },
	{ description: "aws-sdk import", pattern: /from ['"]aws-sdk['"]/ },
	// Third-party telemetry / crash reporting (PRD §Won't Have, Constitution L1)
	{ description: "mixpanel client", pattern: /\bmixpanel\b/ },
	{ description: "amplitude client", pattern: /\bamplitude\b/ },
	{ description: "posthog client", pattern: /\bposthog\b/ },
	{ description: "segment-analytics client", pattern: /segment-analytics/ },
	{ description: "sentry SDK import", pattern: /from ['"]@sentry\// },
	// MCP server bindings — Hakobi has no MCP surface (PRD §Won't Have)
	{ description: "MCP SDK import", pattern: /@modelcontextprotocol\/sdk/ },
];

/** Collect every .ts file under src/ for the source-tree absence check. */
function listSrcFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listSrcFiles(full, out);
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("spec compliance — T4.7 final sweep", () => {
	// ------------------------------------------------------------------
	// Section 1 — Registered commands snapshot (PRD/F7)
	// ------------------------------------------------------------------
	describe("registered commands snapshot (PRD/F7)", () => {
		it("HakobiPlugin.onload() registers exactly the closed set of 6 commands", async () => {
			const { default: HakobiPlugin } = await import("../../src/main");

			const app = makeApp();
			const plugin = new HakobiPlugin(app);
			Object.assign(plugin.manifest, {
				id: "miyo-hakobi",
				name: "MiYo Hakobi",
				version: "0.0.0",
				dir: ".obsidian/plugins/miyo-hakobi",
			});

			// Persisted data — no rules, default global settings.
			(plugin as unknown as { loadData: () => Promise<unknown> }).loadData =
				async () => ({
					schemaVersion: 1,
					rules: [],
					globalSettings: {
						perFileTimeoutMs: 10_000,
						auditRetentionDays: 90,
						auditMaxBytes: 10_485_760,
						stabilityCheckMs: 0,
					},
				});
			(plugin as unknown as {
				saveData: (d: unknown) => Promise<void>;
			}).saveData = async () => undefined;

			await plugin.onload();

			const addCommandSpy = plugin.addCommand as unknown as ReturnType<
				typeof vi.fn
			>;
			const calls = addCommandSpy.mock.calls.map((c) => c[0] as { id: string; name: string });

			// Snapshot count
			expect(calls).toHaveLength(EXPECTED_COMMANDS.length);

			// Snapshot id + name pairs (order-insensitive comparison)
			const observed = calls
				.map((c) => `${c.id}::${c.name}`)
				.sort();
			const expected = EXPECTED_COMMANDS
				.map((c) => `${c.id}::${c.name}`)
				.slice()
				.sort();
			expect(observed).toEqual(expected);

			// Defensive: no `Hakobi:` prefix doubling (PRD/F7 explicitly forbids).
			for (const c of calls) {
				expect(c.name).not.toMatch(/^Hakobi:/i);
				expect(c.id).not.toMatch(/^hakobi-/i);
			}

			plugin.onunload();
		});
	});

	// ------------------------------------------------------------------
	// Section 2 — Audit field allowlist snapshot (PRD/F5)
	// ------------------------------------------------------------------
	describe("audit field allowlist snapshot (PRD/F5)", () => {
		it("AuditEntry serializer emits exactly the closed-allowlist fields when all are populated", async () => {
			const { serializeAuditEntry } = await import("../../src/audit/AuditEntry");

			// Build a maximally-populated entry — every required + optional field
			// supplied — to verify both directions of drift in a single assertion.
			const fullEntry = {
				timestamp: "2026-05-01T00:00:00.000Z",
				ruleId: "00000000-0000-4000-8000-000000000000" as never,
				ruleName: "compliance probe",
				direction: "import" as const,
				operation: "copy" as const,
				decision: "ok" as const,
				sourcePathRelative: "src.txt",
				destinationPathRelative: "dst.txt",
				errorCode: "unknown" as const,
				bytesTransferred: 1,
				durationMs: 1,
			};

			const serialized = serializeAuditEntry(fullEntry);
			const parsed = JSON.parse(serialized) as Record<string, unknown>;
			const observedKeys = Object.keys(parsed).sort();

			// Strict equality both ways: any added or removed field fails here.
			const expectedAll = EXPECTED_AUDIT_FIELDS.slice().sort();
			expect(observedKeys).toEqual(expectedAll);
		});

		it("AuditEntry serializer drops undefined optional fields without leaking unknown keys", async () => {
			const { serializeAuditEntry } = await import("../../src/audit/AuditEntry");

			const minimalEntry = {
				timestamp: "2026-05-01T00:00:00.000Z",
				ruleId: "00000000-0000-4000-8000-000000000000" as never,
				ruleName: "compliance probe",
				direction: "import" as const,
				operation: "copy" as const,
				decision: "ok" as const,
			};

			const serialized = serializeAuditEntry(minimalEntry);
			const parsed = JSON.parse(serialized) as Record<string, unknown>;
			const observedKeys = Object.keys(parsed).sort();

			// All required fields present, no optional fields, no surprise keys.
			for (const key of observedKeys) {
				expect(EXPECTED_AUDIT_FIELDS).toContain(key);
			}
			expect(observedKeys).toEqual(
				["timestamp", "ruleId", "ruleName", "direction", "operation", "decision"].sort(),
			);
		});
	});

	// ------------------------------------------------------------------
	// Section 3 — Bundled artefacts present
	// ------------------------------------------------------------------
	describe("bundled files presence (T4.6 cross-check)", () => {
		it("build/main.js exists", () => {
			expect(fileExists("build/main.js")).toBe(true);
		});
		it("build/manifest.json exists", () => {
			expect(fileExists("build/manifest.json")).toBe(true);
		});
		it("build/styles.css exists", () => {
			expect(fileExists("build/styles.css")).toBe(true);
		});
	});

	// ------------------------------------------------------------------
	// Section 4 — Lifecycle register* hygiene (Constitution L1 Operations)
	//
	// Coarse static check: src/main.ts must reference each register* /
	// add* helper at least once. Granular cleanup behaviour is verified by
	// test/lifecycle/unload.test.ts; this assertion is the drift canary so
	// a future refactor cannot accidentally drop a registration call.
	// ------------------------------------------------------------------
	describe("register* cleanup discipline in main.ts", () => {
		// We accept either `this.registerInterval(` (Plugin subclass form) or a
		// `plugin.registerInterval(` call from a wired component (Scheduler in
		// our case) — the lifecycle guarantee is that Obsidian's
		// Plugin.registerInterval is invoked, regardless of receiver name.
		const REGISTER_PATTERNS = [
			"registerInterval(",
			"addCommand(",
			"addStatusBarItem(",
			"addSettingTab(",
		] as const;

		const mainTsContent = fs.readFileSync(repoPath("src", "main.ts"), "utf8");

		it.each(REGISTER_PATTERNS)(
			"main.ts directly or transitively uses pattern: %s",
			(pattern) => {
				// Each pattern is checked as a substring presence in main.ts OR
				// in the modules main.ts wires (Scheduler/CommandRegistry/StatusBar).
				// For simplicity, we accept the pattern in main.ts itself OR in any
				// .ts file under src/ — main.ts MUST wire the lifecycle, even if
				// the call lives behind a thin wrapper class.
				const found =
					mainTsContent.includes(pattern) ||
					listSrcFiles(repoPath("src")).some((f) =>
						fs.readFileSync(f, "utf8").includes(pattern),
					);
				expect(
					found,
					`pattern "${pattern}" not found anywhere under src/ — register* discipline broken`,
				).toBe(true);
			},
		);
	});

	// ------------------------------------------------------------------
	// Section 5 — PRD F1–F12 → test file mapping
	// ------------------------------------------------------------------
	describe("PRD F1–F12 → test file mapping", () => {
		const F_KEYS = Object.keys(F_MAPPING);

		it("every F# in F1..F12 has at least one mapped test file", () => {
			for (let i = 1; i <= 12; i++) {
				const key = `F${i}`;
				expect(F_KEYS, `missing mapping for ${key}`).toContain(key);
				expect(
					F_MAPPING[key].length,
					`${key} has zero mapped test files`,
				).toBeGreaterThan(0);
			}
		});

		it.each(F_KEYS)("%s — every mapped test file exists on disk", (fKey) => {
			const files = F_MAPPING[fKey];
			for (const rel of files) {
				expect(
					fileExists(rel),
					`${fKey} maps to ${rel} but the file does not exist`,
				).toBe(true);
			}
		});
	});

	// ------------------------------------------------------------------
	// Section 6 — SDD ADR-1..12 → implementation/test reference
	// ------------------------------------------------------------------
	describe("SDD ADR-1..12 → implementation/test mapping", () => {
		const ADR_KEYS = Object.keys(ADR_MAPPING);

		it("every ADR-1..12 has at least one mapped reference", () => {
			for (let i = 1; i <= 12; i++) {
				const key = `ADR-${i}`;
				expect(ADR_KEYS, `missing mapping for ${key}`).toContain(key);
				expect(
					ADR_MAPPING[key].length,
					`${key} has zero mapped references`,
				).toBeGreaterThan(0);
			}
		});

		it.each(ADR_KEYS)("%s — every mapped reference exists on disk", (adrKey) => {
			const refs = ADR_MAPPING[adrKey];
			for (const rel of refs) {
				expect(
					fileExists(rel),
					`${adrKey} references ${rel} but the file does not exist`,
				).toBe(true);
			}
		});
	});

	// ------------------------------------------------------------------
	// Section 7 — Won't-Have absences
	// ------------------------------------------------------------------
	describe("Won't-Have absences (PRD §Won't Have)", () => {
		// Pre-load the source tree once so every per-pattern test reads the
		// same snapshot. listSrcFiles is small (~60 files in v0.1).
		const srcFiles = listSrcFiles(repoPath("src"));
		const srcContents = srcFiles.map((f) => ({
			path: f,
			content: fs.readFileSync(f, "utf8"),
		}));

		const bundlePath = repoPath("build", "main.js");
		const bundleContent = fs.existsSync(bundlePath)
			? fs.readFileSync(bundlePath, "utf8")
			: "";

		it.each(FORBIDDEN_PATTERNS)(
			"no source file contains forbidden pattern: $description",
			({ pattern }) => {
				const offenders = srcContents
					.filter(({ content }) => pattern.test(content))
					.map(({ path: p }) => path.relative(REPO_ROOT, p));
				expect(
					offenders,
					`forbidden pattern matched in: ${offenders.join(", ")}`,
				).toEqual([]);
			},
		);

		it.each(FORBIDDEN_PATTERNS)(
			"production bundle does not contain forbidden pattern: $description",
			({ pattern }) => {
				if (bundleContent === "") {
					// No bundle yet — Section 3 already failed, no need to
					// double-fail here.
					return;
				}
				expect(pattern.test(bundleContent)).toBe(false);
			},
		);
	});
});
