// Engine smoke integration test (T2.7).
//
// WHY this file exists:
// Validates the Phase 2 engine end-to-end at the unit-integration level: a
// real InFlightRegistry + real Scheduler + real AuditLog (with an in-memory
// NodeFs adapter) + stub ImportRunner/ExportRunner. Fake timers make the
// timing deterministic. Three test cases match the T2.7 spec:
//   1. End-to-end tick — stub ImportRunner.run is called after one interval.
//   2. Overlap-skip — AuditLog captures a decision:skipped/errorCode:overlap
//      entry when a rule's second tick fires while the first is still in-flight.
//   3. Plugin unload zero timers — no runner fires after plugin._runCleanup().

import {
	describe,
	expect,
	it,
	vi,
	beforeEach,
	afterEach,
} from "vitest";
import { Plugin } from "obsidian";
import { Scheduler } from "../../src/scheduler/Scheduler";
import { InFlightRegistry } from "../../src/scheduler/InFlightRegistry";
import { AuditLog } from "../../src/audit/AuditLog";
import { newRuleId } from "../../src/domain/ruleId";
import type { ImportRule } from "../../src/domain/rule";
import type { AuditEntry } from "../../src/audit/AuditEntry";
import { IoNotFoundError } from "../../src/fs/NodeFs";

// ---------------------------------------------------------------------------
// Minimal in-memory NodeFs — only the methods AuditLog actually calls
// ---------------------------------------------------------------------------

class MemFs {
	private files: Map<string, string> = new Map();
	private dirs: Set<string> = new Set();

	async mkdir(_path: string): Promise<void> {
		this.dirs.add(_path);
	}

	async readFile(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new IoNotFoundError("readFile", path, new Error("ENOENT"));
		}
		return content;
	}

	async writeFile(path: string, data: string): Promise<void> {
		this.files.set(path, data);
	}

	async readdir(path: string): Promise<string[]> {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const names: string[] = [];
		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(prefix)) {
				const relative = filePath.slice(prefix.length);
				// Only direct children (no further slashes)
				if (!relative.includes("/")) {
					names.push(relative);
				}
			}
		}
		// Also include direct files exactly at this level from dirs
		for (const dir of this.dirs) {
			if (dir === path) {
				// It's a known directory — return the file children
			}
		}
		return names;
	}

	async unlink(path: string): Promise<void> {
		if (!this.files.has(path)) {
			throw new IoNotFoundError("unlink", path, new Error("ENOENT"));
		}
		this.files.delete(path);
	}
}

// ---------------------------------------------------------------------------
// Minimal in-memory PluginDataAdapter (for RuleStore-shaped stub)
// ---------------------------------------------------------------------------

function makeRuleStore(rules: ImportRule[]) {
	return {
		load: vi.fn(async () => ({ rules, globalSettings: {}, warnings: [] })),
		getById: vi.fn((id: ImportRule["id"]) => rules.find((r) => r.id === id)),
	};
}

// ---------------------------------------------------------------------------
// Minimal DeviceStore stub
// ---------------------------------------------------------------------------

function makeDeviceStore(enabledIds: Set<ImportRule["id"]>) {
	return {
		isEnabled: vi.fn(async (id: ImportRule["id"]) => enabledIds.has(id)),
	};
}

// ---------------------------------------------------------------------------
// Rule factory
// ---------------------------------------------------------------------------

function makeImportRule(overrides: Partial<ImportRule> = {}): ImportRule {
	return {
		id: newRuleId(),
		name: "Smoke Test Import",
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		direction: "import",
		sourcePath: "/tmp/smoke-source" as ImportRule["sourcePath"],
		destinationVaultPath: "inbox" as ImportRule["destinationVaultPath"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Status bar stub
// ---------------------------------------------------------------------------

function makeStatusBar() {
	return {
		setIdle: vi.fn(),
		setRunning: vi.fn(),
		setFailed: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Helpers for collecting AuditLog entries
// ---------------------------------------------------------------------------

async function collectAuditEntries(auditLog: AuditLog): Promise<AuditEntry[]> {
	const entries: AuditEntry[] = [];
	for await (const entry of auditLog.iterate()) {
		entries.push(entry);
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Engine smoke integration (T2.7)", () => {
	let plugin: Plugin;

	beforeEach(() => {
		vi.useFakeTimers();
		plugin = new Plugin();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Test 1: End-to-end tick
	// Configure one enabled import rule with everyMinutes: 5.
	// Start the scheduler with fake timers. Advance time by 5 minutes + 1ms.
	// Assert: stub ImportRunner.run was called exactly once with that rule.
	// -------------------------------------------------------------------------

	it("TC-1: end-to-end tick — ImportRunner.run called once after 5-minute interval", async () => {
		const rule = makeImportRule({ everyMinutes: 5 });
		const memFs = new MemFs();
		const auditLog = new AuditLog({
			fs: memFs as unknown as InstanceType<typeof import("../../src/fs/NodeFs").NodeFs>,
			getAuditDir: () => "/audit-test",
		});
		const importRunner = { run: vi.fn(async () => {}) };
		const exportRunner = { run: vi.fn(async () => {}) };
		const ruleStore = makeRuleStore([rule]);
		const deviceStore = makeDeviceStore(new Set([rule.id]));
		const inFlight = new InFlightRegistry();
		const statusBar = makeStatusBar();

		const scheduler = new Scheduler({
			plugin,
			ruleStore,
			deviceStore,
			importRunner,
			exportRunner,
			statusBar,
			auditLog,
			inFlight,
		});

		await scheduler.start();

		// Advance exactly 5 minutes + 1ms to trigger the first interval
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

		expect(importRunner.run).toHaveBeenCalledTimes(1);
		expect(importRunner.run).toHaveBeenCalledWith(rule, { dryRun: false });
		expect(exportRunner.run).not.toHaveBeenCalled();

		scheduler.stop();
	});

	// -------------------------------------------------------------------------
	// Test 2: Overlap-skip emits audit entry
	// Configure one enabled rule. Start the scheduler. Make the stub
	// ImportRunner.run return a never-resolving Promise. Advance time past two
	// intervals. Assert: the AuditLog has an entry with decision:skipped and
	// errorCode:overlap.
	// -------------------------------------------------------------------------

	it("TC-2: overlap-skip — AuditLog captures skipped/overlap entry on second tick", async () => {
		const rule = makeImportRule({ everyMinutes: 1 });
		const memFs = new MemFs();
		const auditLog = new AuditLog({
			fs: memFs as unknown as InstanceType<typeof import("../../src/fs/NodeFs").NodeFs>,
			getAuditDir: () => "/audit-test",
		});

		// Never-resolving runner keeps the rule in-flight indefinitely
		const neverResolving = vi.fn(() => new Promise<void>(() => {}));
		const importRunner = { run: neverResolving };
		const exportRunner = { run: vi.fn(async () => {}) };
		const ruleStore = makeRuleStore([rule]);
		const deviceStore = makeDeviceStore(new Set([rule.id]));
		const inFlight = new InFlightRegistry();
		const statusBar = makeStatusBar();

		const scheduler = new Scheduler({
			plugin,
			ruleStore,
			deviceStore,
			importRunner,
			exportRunner,
			statusBar,
			auditLog,
			inFlight,
		});

		await scheduler.start();

		// First tick — acquires the in-flight lock, never releases it
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

		// Second tick — should detect overlap and emit an audit entry
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

		// Collect all AuditLog entries
		const entries = await collectAuditEntries(auditLog);

		const overlapEntry = entries.find(
			(e) => e.decision === "skipped" && e.errorCode === "overlap",
		);
		expect(overlapEntry).toBeDefined();
		expect(overlapEntry!.decision).toBe("skipped");
		expect(overlapEntry!.errorCode).toBe("overlap");
		expect(overlapEntry!.ruleId).toBe(rule.id);

		scheduler.stop();
	});

	// -------------------------------------------------------------------------
	// Test 3: Plugin unload zero timers
	// Start the scheduler, then call plugin._runCleanup(). Advance fake timers
	// far past any scheduled interval. Assert the stub runner was never called
	// after the cleanup. Mirrors the T2.4 unit test at integration level —
	// the spec's "no leaked timers across the full Phase 2 surface" assertion.
	// -------------------------------------------------------------------------

	it("TC-3: plugin._runCleanup() — no runner fires after unload (no leaked timers)", async () => {
		const rule = makeImportRule({ everyMinutes: 5 });
		const memFs = new MemFs();
		const auditLog = new AuditLog({
			fs: memFs as unknown as InstanceType<typeof import("../../src/fs/NodeFs").NodeFs>,
			getAuditDir: () => "/audit-test",
		});
		const importRunner = { run: vi.fn(async () => {}) };
		const exportRunner = { run: vi.fn(async () => {}) };
		const ruleStore = makeRuleStore([rule]);
		const deviceStore = makeDeviceStore(new Set([rule.id]));
		const inFlight = new InFlightRegistry();
		const statusBar = makeStatusBar();

		const scheduler = new Scheduler({
			plugin,
			ruleStore,
			deviceStore,
			importRunner,
			exportRunner,
			statusBar,
			auditLog,
			inFlight,
		});

		await scheduler.start();

		// Simulate Obsidian plugin unload — this clears all registered intervals
		plugin._runCleanup();

		// Advance well past the 5-minute interval — runner must NOT fire
		await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

		expect(importRunner.run).not.toHaveBeenCalled();
		expect(exportRunner.run).not.toHaveBeenCalled();
	});
});
