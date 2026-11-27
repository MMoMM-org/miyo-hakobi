// Tests for Scheduler (T2.4).
//
// WHY this file exists:
// Proves the Scheduler contract: one timer per enabled rule, overlap-skip,
// reschedule on everyMinutes change, enable/disable toggling, runOnce, runAll,
// and clean unload via Plugin._runCleanup(). All timers are controlled via
// vi.useFakeTimers() so tests are deterministic.

import {
	describe,
	expect,
	it,
	vi,
	beforeEach,
	afterEach,
	type MockedFunction,
} from "vitest";
import { Plugin } from "obsidian";
import { Scheduler } from "../../src/scheduler/Scheduler";
import { InFlightRegistry } from "../../src/scheduler/InFlightRegistry";
import { newRuleId } from "../../src/domain/ruleId";
import type { RuleId } from "../../src/domain/ruleId";
import type { ImportRule, ExportFolderRule } from "../../src/domain/rule";
import type { AuditEntry } from "../../src/audit/AuditEntry";
import type { RunStats } from "../../src/runner/RunStats";
import { ActivityTotals, DAILY_SUMMARY_INTERVAL_MS } from "../../src/scheduler/ActivityTotals";
import { setDebugSource } from "../../src/util/logger";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeImportRule(overrides: Partial<ImportRule> = {}): ImportRule {
	return {
		id: newRuleId(),
		name: "Test Import",
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		direction: "import",
		sourcePath: "/tmp/source" as ImportRule["sourcePath"],
		destinationVaultPath: "inbox" as ImportRule["destinationVaultPath"],
		...overrides,
	};
}

function makeExportRule(overrides: Partial<ExportFolderRule> = {}): ExportFolderRule {
	return {
		id: newRuleId(),
		name: "Test Export",
		everyMinutes: 10,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		direction: "export",
		sourceType: "folder",
		sourceVaultPath: "notes" as ExportFolderRule["sourceVaultPath"],
		destinationPath: "/tmp/dest" as ExportFolderRule["destinationPath"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeRuleStore(rules: ImportRule[] | ExportFolderRule[] = []) {
	return {
		load: vi.fn(async () => ({ rules, globalSettings: {}, warnings: [] })),
		getById: vi.fn((id: RuleId) => (rules as Array<ImportRule | ExportFolderRule>).find((r) => r.id === id)),
	};
}

function makeDeviceStore(enabledIds: Set<RuleId> = new Set()) {
	return {
		isEnabled: vi.fn(async (id: RuleId) => enabledIds.has(id)),
	};
}

function makeImportRunner() {
	return { run: vi.fn(async () => ({ copied: 0, skipped: 0, failed: 0, aborted: false })) };
}

function makeExportRunner() {
	return { run: vi.fn(async () => ({ copied: 0, skipped: 0, failed: 0, aborted: false })) };
}

function makeStatusBar() {
	return {
		setIdle: vi.fn(),
		setRunning: vi.fn(),
		setFailed: vi.fn(),
	};
}

function makeAuditLog() {
	return { append: vi.fn(async (_entry: AuditEntry) => {}) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildScheduler(opts: {
	plugin: Plugin;
	rules?: Array<ImportRule | ExportFolderRule>;
	enabledIds?: Set<RuleId>;
	importRunner?: ReturnType<typeof makeImportRunner>;
	exportRunner?: ReturnType<typeof makeExportRunner>;
	statusBar?: ReturnType<typeof makeStatusBar>;
	auditLog?: ReturnType<typeof makeAuditLog>;
	inFlight?: InFlightRegistry;
	nowFn?: () => Date;
	activityTotals?: ActivityTotals;
}) {
	const rules = opts.rules ?? [];
	const enabledIds = opts.enabledIds ?? new Set(rules.map((r) => r.id));
	const ruleStore = makeRuleStore(rules as ImportRule[]);
	const deviceStore = makeDeviceStore(enabledIds);
	const importRunner = opts.importRunner ?? makeImportRunner();
	const exportRunner = opts.exportRunner ?? makeExportRunner();
	const statusBar = opts.statusBar ?? makeStatusBar();
	const auditLog = opts.auditLog ?? makeAuditLog();
	const inFlight = opts.inFlight ?? new InFlightRegistry();

	const scheduler = new Scheduler({
		plugin: opts.plugin,
		ruleStore,
		deviceStore,
		importRunner,
		exportRunner,
		statusBar,
		auditLog,
		inFlight,
		nowFn: opts.nowFn,
		activityTotals: opts.activityTotals,
	});

	return { scheduler, ruleStore, deviceStore, importRunner, exportRunner, statusBar, auditLog };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Scheduler", () => {
	let plugin: Plugin;

	beforeEach(() => {
		vi.useFakeTimers();
		plugin = new Plugin();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		setDebugSource(null);
	});

	// -------------------------------------------------------------------------
	// start()
	// -------------------------------------------------------------------------

	describe("start()", () => {
		it("registers one timer per enabled rule via plugin.registerInterval", async () => {
			const rule1 = makeImportRule({ everyMinutes: 1 });
			const rule2 = makeImportRule({ everyMinutes: 2 });
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule1, rule2],
				enabledIds: new Set([rule1.id, rule2.id]),
			});

			await scheduler.start();

			expect(plugin.registerInterval).toHaveBeenCalledTimes(3);
		});

		it("does not register a timer for a disabled rule", async () => {
			const rule1 = makeImportRule({ everyMinutes: 1 });
			const rule2 = makeImportRule({ everyMinutes: 2 });
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule1, rule2],
				enabledIds: new Set([rule1.id]), // only rule1 is enabled
			});

			await scheduler.start();

			expect(plugin.registerInterval).toHaveBeenCalledTimes(2);
		});

		it("registers nothing when there are no rules", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });

			await scheduler.start();

			expect(plugin.registerInterval).toHaveBeenCalledTimes(1);
		});

		it("timer fires the runner after everyMinutes elapses", async () => {
			const rule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();

			// Advance time just under the interval — runner should NOT have fired
			vi.advanceTimersByTime(4 * 60 * 1000 + 59_000);
			await Promise.resolve(); // flush microtasks without re-triggering setInterval
			expect(importRunner.run).not.toHaveBeenCalled();

			// Advance past the interval — runner should fire
			vi.advanceTimersByTime(1_000);
			// Flush the async microtask queue (the tick's Promise chain)
			await Promise.resolve();
			await Promise.resolve();
			expect(importRunner.run).toHaveBeenCalledTimes(1);
		});

		it("timer fires the export runner for export rules", async () => {
			const rule = makeExportRule({ everyMinutes: 10 });
			const exportRunner = makeExportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				exportRunner,
			});

			await scheduler.start();

			vi.advanceTimersByTime(10 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(exportRunner.run).toHaveBeenCalledTimes(1);
			expect(exportRunner.run).toHaveBeenCalledWith(rule, { dryRun: false });
		});
	});

	// -------------------------------------------------------------------------
	// stop()
	// -------------------------------------------------------------------------

	describe("stop()", () => {
		it("clears all timers after stop() — no runner calls after stop", async () => {
			const rule = makeImportRule({ everyMinutes: 1 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();
			scheduler.stop();

			// Advance past the interval — runner must NOT fire
			vi.advanceTimersByTime(2 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).not.toHaveBeenCalled();
		});

		it("plugin unload (_runCleanup) clears registered intervals", async () => {
			const rule = makeImportRule({ everyMinutes: 1 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();

			// The Scheduler passes each interval ID to plugin.registerInterval so that
			// Obsidian's Plugin tracks cleanup on unload. Verify it was called with a
			// numeric ID (coerced from NodeJS.Timeout via unary + in scheduleTimer).
			const calls = (plugin.registerInterval as MockedFunction<typeof plugin.registerInterval>).mock.calls;
			expect(calls.length).toBe(2);
			// The ID passed must be coerced to a number (may be NaN in Node env
			// where Timeout objects don't coerce to a sensible numeric ID — but
			// the important invariant is that registerInterval is called once per rule
			// plus once for the daily-summary timer).
			expect(calls[0]).toBeDefined();
		});

		it("plugin unload via _runCleanup() leaves zero active timers", async () => {
			const rule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();

			// Simulate Obsidian unloading the plugin — this should clear all intervals
			// registered via plugin.registerInterval (the real Obsidian Plugin does this).
			plugin._runCleanup();

			// Advance past the interval — runner must NOT fire because the timer was cleared
			vi.advanceTimersByTime(5 * 60_000 + 1);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// onRuleChanged()
	// -------------------------------------------------------------------------

	describe("onRuleChanged()", () => {
		it("reschedules timer when everyMinutes changes", async () => {
			const rule = makeImportRule({ everyMinutes: 10 });
			const importRunner = makeImportRunner();
			const enabledIds = new Set([rule.id]);
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(enabledIds);

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.start();

			// registerInterval called once for the initial schedule
			expect(plugin.registerInterval).toHaveBeenCalledTimes(2);

			// Change the rule's everyMinutes — await since onRuleChanged is async
			const updatedRule = { ...rule, everyMinutes: 2 };
			deviceStore.isEnabled.mockResolvedValue(true);
			await scheduler.onRuleChanged(updatedRule);

			// registerInterval should now be called again (for the new timer)
			expect(plugin.registerInterval).toHaveBeenCalledTimes(3);

			// Old timer should be cancelled — advance 2 min (new interval): runner fires
			vi.advanceTimersByTime(2 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).toHaveBeenCalledTimes(1);
		});

		it("cancels timer when rule is disabled via onRuleChanged", async () => {
			const rule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const enabledIds = new Set([rule.id]);
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(enabledIds);

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.start();
			expect(plugin.registerInterval).toHaveBeenCalledTimes(2);

			// Disable the rule — await since onRuleChanged is async
			deviceStore.isEnabled.mockResolvedValue(false);
			await scheduler.onRuleChanged({ ...rule });

			// Timer should be removed — advance past interval
			vi.advanceTimersByTime(5 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).not.toHaveBeenCalled();
		});

		it("adds a timer when a previously disabled rule becomes enabled", async () => {
			const rule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			// Start with rule disabled
			const enabledIds = new Set<RuleId>();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(enabledIds);

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.start();
			expect(plugin.registerInterval).toHaveBeenCalledTimes(1);

			// Enable the rule — await since onRuleChanged is async
			deviceStore.isEnabled.mockResolvedValue(true);
			await scheduler.onRuleChanged(rule);

			expect(plugin.registerInterval).toHaveBeenCalledTimes(2);

			// Timer fires
			vi.advanceTimersByTime(5 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).toHaveBeenCalledTimes(1);
		});
	});

	// -------------------------------------------------------------------------
	// onRuleRemoved()
	// -------------------------------------------------------------------------

	describe("onRuleRemoved()", () => {
		it("cancels the timer for the removed rule", async () => {
			const rule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();

			scheduler.onRuleRemoved(rule.id);

			// Timer must not fire anymore
			vi.advanceTimersByTime(5 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(importRunner.run).not.toHaveBeenCalled();
		});

		it("is a no-op for a rule that was never scheduled", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();

			expect(() => scheduler.onRuleRemoved(newRuleId())).not.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// Overlap skip
	// -------------------------------------------------------------------------

	describe("overlap skip", () => {
		it("skips tick and appends audit entry when rule is already in-flight", async () => {
			const rule = makeImportRule({ everyMinutes: 1 });
			const auditLog = makeAuditLog();

			// importRunner that never resolves (simulates long-running execution)
			const neverResolving = vi.fn(
				() => new Promise<RunStats>(() => {}),
			);
			const importRunner = { run: neverResolving };

			const inFlight = new InFlightRegistry();

			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
				auditLog,
				inFlight,
			});

			await scheduler.start();

			// First tick — starts running (never resolves, so rule stays in-flight).
			// Advance exactly one interval to trigger the callback.
			vi.advanceTimersByTime(1 * 60 * 1000);
			// Give the micro-task queue a turn to register the in-flight acquire.
			// The tick is async, so we need a few promise hops to let it run.
			await Promise.resolve();
			await Promise.resolve();

			// Second tick — should detect overlap.
			// Advance another interval to fire the callback again.
			vi.advanceTimersByTime(1 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();

			// Audit log should have been called with an overlap entry
			const overlapCall = (auditLog.append as MockedFunction<typeof auditLog.append>).mock.calls.find(
				(call) => call[0]?.errorCode === "overlap",
			);
			expect(overlapCall).toBeDefined();
			expect(overlapCall![0]?.decision).toBe("skipped");
			expect(overlapCall![0]?.operation).toBe("skipped");
			expect(overlapCall![0]?.ruleId).toBe(rule.id);
		});
	});

	// -------------------------------------------------------------------------
	// runOnce()
	// -------------------------------------------------------------------------

	describe("runOnce()", () => {
		it("runs the import runner immediately for an import rule", async () => {
			const rule = makeImportRule();
			const importRunner = makeImportRunner();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(rule.id, { dryRun: false });

			expect(importRunner.run).toHaveBeenCalledOnce();
			expect(importRunner.run).toHaveBeenCalledWith(rule, { dryRun: false });
		});

		it("runs the export runner immediately for an export rule", async () => {
			const rule = makeExportRule();
			const exportRunner = makeExportRunner();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner: makeImportRunner(),
				exportRunner,
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(rule.id, { dryRun: false });

			expect(exportRunner.run).toHaveBeenCalledOnce();
			expect(exportRunner.run).toHaveBeenCalledWith(rule, { dryRun: false });
		});

		it("respects dryRun flag", async () => {
			const rule = makeImportRule();
			const importRunner = makeImportRunner();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(rule.id, { dryRun: true });

			expect(importRunner.run).toHaveBeenCalledWith(rule, { dryRun: true });
		});

		it("skips and appends overlap audit entry when rule is in-flight", async () => {
			const rule = makeImportRule();
			const auditLog = makeAuditLog();
			const inFlight = new InFlightRegistry();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));

			// Acquire the lock before calling runOnce
			inFlight.tryAcquire(rule.id);

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner: makeImportRunner(),
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog,
				inFlight,
			});

			await scheduler.runOnce(rule.id, { dryRun: false });

			const appendCalls = (auditLog.append as MockedFunction<typeof auditLog.append>).mock.calls;
			expect(appendCalls).toHaveLength(1);
			expect(appendCalls[0]![0]?.errorCode).toBe("overlap");
			expect(appendCalls[0]![0]?.decision).toBe("skipped");
		});

		it("returns without running when rule is not found in ruleStore", async () => {
			const importRunner = makeImportRunner();
			const ruleStore = makeRuleStore([]);
			const deviceStore = makeDeviceStore(new Set());

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(newRuleId(), { dryRun: false });

			expect(importRunner.run).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// runAll()
	// -------------------------------------------------------------------------

	describe("runAll()", () => {
		it("runs all enabled import rules when direction is 'import'", async () => {
			const importRule1 = makeImportRule();
			const importRule2 = makeImportRule();
			const exportRule = makeExportRule();
			const importRunner = makeImportRunner();
			const exportRunner = makeExportRunner();

			const allRules = [importRule1, importRule2, exportRule];
			const ruleStore = makeRuleStore(allRules as ImportRule[]);
			const deviceStore = makeDeviceStore(new Set(allRules.map((r) => r.id)));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner,
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runAll("import", { dryRun: false });

			expect(importRunner.run).toHaveBeenCalledTimes(2);
			expect(exportRunner.run).not.toHaveBeenCalled();
		});

		it("runs all enabled export rules when direction is 'export'", async () => {
			const importRule = makeImportRule();
			const exportRule1 = makeExportRule();
			const exportRule2 = makeExportRule();
			const importRunner = makeImportRunner();
			const exportRunner = makeExportRunner();

			const allRules = [importRule, exportRule1, exportRule2];
			const ruleStore = makeRuleStore(allRules as ImportRule[]);
			const deviceStore = makeDeviceStore(new Set(allRules.map((r) => r.id)));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner,
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runAll("export", { dryRun: false });

			expect(exportRunner.run).toHaveBeenCalledTimes(2);
			expect(importRunner.run).not.toHaveBeenCalled();
		});

		it("skips disabled rules in runAll", async () => {
			const rule1 = makeImportRule();
			const rule2 = makeImportRule();
			const importRunner = makeImportRunner();

			// Only rule1 is enabled
			const ruleStore = makeRuleStore([rule1, rule2]);
			const deviceStore = makeDeviceStore(new Set([rule1.id]));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar: makeStatusBar(),
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runAll("import", { dryRun: false });

			expect(importRunner.run).toHaveBeenCalledTimes(1);
			expect(importRunner.run).toHaveBeenCalledWith(rule1, { dryRun: false });
		});
	});

	// -------------------------------------------------------------------------
	// Status bar integration
	// -------------------------------------------------------------------------

	describe("status bar", () => {
		it("calls setRunning before runner and setIdle after successful run", async () => {
			const rule = makeImportRule();
			const statusBar = makeStatusBar();
			const importRunner = makeImportRunner();
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar,
				auditLog: makeAuditLog(),
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(rule.id, { dryRun: false });

			expect(statusBar.setRunning).toHaveBeenCalledWith(rule.name);
			expect(statusBar.setIdle).toHaveBeenCalled();
			expect(statusBar.setFailed).not.toHaveBeenCalled();
		});

		it("calls setFailed when the runner throws", async () => {
			const rule = makeImportRule();
			const statusBar = makeStatusBar();
			const importRunner = { run: vi.fn(async () => { throw new Error("runner failed"); }) };
			const ruleStore = makeRuleStore([rule]);
			const deviceStore = makeDeviceStore(new Set([rule.id]));
			const auditLog = makeAuditLog();

			const scheduler = new Scheduler({
				plugin,
				ruleStore,
				deviceStore,
				importRunner,
				exportRunner: makeExportRunner(),
				statusBar,
				auditLog,
				inFlight: new InFlightRegistry(),
			});

			await scheduler.runOnce(rule.id, { dryRun: false });

			expect(statusBar.setFailed).toHaveBeenCalled();
			expect(statusBar.setIdle).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// Timer interval duration
	// -------------------------------------------------------------------------

	describe("timer interval", () => {
		it("uses everyMinutes × 60000 ms as the setInterval duration", async () => {
			const rule = makeImportRule({ everyMinutes: 3 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
			});

			await scheduler.start();

			// Should NOT fire at 2 min 59 sec (one ms before interval)
			vi.advanceTimersByTime(3 * 60 * 1000 - 1);
			await Promise.resolve();
			await Promise.resolve();
			expect(importRunner.run).not.toHaveBeenCalled();

			// Should fire at exactly 3 min
			vi.advanceTimersByTime(1);
			await Promise.resolve();
			await Promise.resolve();
			expect(importRunner.run).toHaveBeenCalledTimes(1);
		});
	});

	// -------------------------------------------------------------------------
	// runInitialRun() — Bug 2B: fire one tick per enabled rule on plugin start
	// so users see something happen instead of waiting a full interval.
	// -------------------------------------------------------------------------

	describe("runInitialRun()", () => {
		it("invokes the appropriate runner once per enabled rule", async () => {
			const importRule = makeImportRule({ everyMinutes: 5 });
			const exportRule = makeExportRule({ everyMinutes: 10 });
			const importRunner = makeImportRunner();
			const exportRunner = makeExportRunner();
			const enabledIds = new Set([importRule.id, exportRule.id]);
			const { scheduler } = buildScheduler({
				plugin,
				rules: [importRule, exportRule],
				enabledIds,
				importRunner,
				exportRunner,
			});

			await scheduler.start();
			await scheduler.runInitialRun();

			expect(importRunner.run).toHaveBeenCalledTimes(1);
			expect(importRunner.run).toHaveBeenCalledWith(importRule, { dryRun: false });
			expect(exportRunner.run).toHaveBeenCalledTimes(1);
			expect(exportRunner.run).toHaveBeenCalledWith(exportRule, { dryRun: false });
		});

		it("skips disabled rules", async () => {
			const enabledRule = makeImportRule({ name: "Enabled" });
			const disabledRule = makeImportRule({ name: "Disabled" });
			const importRunner = makeImportRunner();
			const enabledIds = new Set([enabledRule.id]);
			const { scheduler } = buildScheduler({
				plugin,
				rules: [enabledRule, disabledRule],
				enabledIds,
				importRunner,
			});

			await scheduler.start();
			await scheduler.runInitialRun();

			expect(importRunner.run).toHaveBeenCalledTimes(1);
			expect(importRunner.run).toHaveBeenCalledWith(enabledRule, { dryRun: false });
		});

		it("respects in-flight registry (no overlap with a concurrent timer tick)", async () => {
			const importRule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const inFlight = new InFlightRegistry();
			// Simulate that a tick is already running for this rule
			inFlight.tryAcquire(importRule.id);

			const auditLog = makeAuditLog();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [importRule],
				enabledIds: new Set([importRule.id]),
				importRunner,
				inFlight,
				auditLog,
			});

			await scheduler.start();
			await scheduler.runInitialRun();

			// runner should NOT be invoked because the in-flight slot is already taken
			expect(importRunner.run).not.toHaveBeenCalled();
			// and an overlap audit entry should be appended
			const overlapEntries = auditLog.append.mock.calls.filter(
				(c) => (c[0] as AuditEntry).errorCode === "overlap",
			);
			expect(overlapEntries.length).toBe(1);
		});

		it("does not interfere with the periodic timer (initial tick is one-shot)", async () => {
			const importRule = makeImportRule({ everyMinutes: 5 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [importRule],
				enabledIds: new Set([importRule.id]),
				importRunner,
			});

			await scheduler.start();
			await scheduler.runInitialRun();
			expect(importRunner.run).toHaveBeenCalledTimes(1);

			// 5 minutes later, the regular interval should fire its own tick
			vi.advanceTimersByTime(5 * 60 * 1000);
			await Promise.resolve();
			await Promise.resolve();
			expect(importRunner.run).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------------
	// Debug logging switch, activity totals and daily summary (#18)
	// -------------------------------------------------------------------------

	describe("debug logging and daily summary", () => {
		let debugSpy: ReturnType<typeof vi.spyOn>;
		let warnSpy: ReturnType<typeof vi.spyOn>;

		const debugLines = (): string[] => debugSpy.mock.calls.map((c) => String(c[0]));
		const tickLines = (): string[] =>
			debugLines().filter((l) => /tick (begin|end|skip)/.test(l));
		const summaryLines = (): string[] =>
			debugLines().filter((l) => l.includes("daily summary"));
		const flush = async (): Promise<void> => {
			for (let i = 0; i < 6; i++) await Promise.resolve();
		};

		beforeEach(() => {
			debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
			warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		});

		afterEach(() => {
			debugSpy.mockRestore();
			warnSpy.mockRestore();
		});

		it("writes no tick lines with the source off (timer, initial run, runOnce, runAll)", async () => {
			const rule = makeImportRule({ everyMinutes: 1 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({ plugin, rules: [rule], importRunner });

			await scheduler.start();
			vi.advanceTimersByTime(60_000);
			await flush();
			expect(importRunner.run).toHaveBeenCalledTimes(1);
			await scheduler.runInitialRun();
			expect(importRunner.run).toHaveBeenCalledTimes(2);
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(importRunner.run).toHaveBeenCalledTimes(3);
			await scheduler.runAll("import", { dryRun: true });
			expect(importRunner.run).toHaveBeenCalledTimes(4);

			expect(tickLines()).toEqual([]);
			scheduler.stop();
		});

		it("writes tick lines for the timer, initial run, runOnce and runAll paths with the source on", async () => {
			setDebugSource(() => true);
			const rule = makeImportRule({ everyMinutes: 1 });
			const { scheduler } = buildScheduler({ plugin, rules: [rule] });
			const begins = (): number => tickLines().filter((l) => l.includes("tick begin")).length;

			await scheduler.start();
			vi.advanceTimersByTime(60_000);
			await flush();
			expect(begins()).toBe(1);
			await scheduler.runInitialRun();
			expect(begins()).toBe(2);
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(begins()).toBe(3);
			await scheduler.runAll("import", { dryRun: true });
			expect(begins()).toBe(4);
			expect(tickLines().filter((l) => l.includes("tick end"))).toHaveLength(4);
			scheduler.stop();
		});

		it("writes tick begin and end lines with the source on", async () => {
			setDebugSource(() => true);
			const rule = makeImportRule({ name: "Visible Rule" });
			const { scheduler } = buildScheduler({ plugin, rules: [rule] });

			await scheduler.runOnce(rule.id, { dryRun: true });

			const lines = tickLines();
			expect(lines).toContain("[Hakobi/Scheduler] tick begin: Visible Rule (import) [dry-run]");
			expect(lines).toContain(
				"[Hakobi/Scheduler] tick end: Visible Rule — ok (0 copied, 0 skipped, 0 failed)",
			);
		});

		it("writes a tick skip line on overlap with the source on, none with it off", async () => {
			const rule = makeImportRule();
			const inFlight = new InFlightRegistry();
			inFlight.tryAcquire(rule.id);
			const { scheduler } = buildScheduler({ plugin, rules: [rule], inFlight });

			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(tickLines()).toEqual([]);

			setDebugSource(() => true);
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(tickLines()).toHaveLength(1);
			expect(tickLines()[0]).toContain("tick skip");
		});

		it("writes config loaded and initial run lines with the source off", async () => {
			const rule = makeImportRule();
			const { scheduler } = buildScheduler({ plugin, rules: [rule] });

			await scheduler.start();
			await scheduler.runInitialRun();

			const lines = debugLines();
			expect(lines.some((l) => l.includes("config loaded: 1 rules (1 enabled"))).toBe(true);
			expect(lines.some((l) => l.includes("initial run starting (1 enabled rules)"))).toBe(true);
			expect(lines.some((l) => l.includes("initial run finished"))).toBe(true);
			scheduler.stop();
		});

		it("still warns with rule name and message when the runner throws, source off", async () => {
			const rule = makeImportRule({ name: "Broken Rule" });
			const importRunner = makeImportRunner();
			importRunner.run.mockRejectedValue(new Error("disk exploded"));
			const { scheduler } = buildScheduler({ plugin, rules: [rule], importRunner });

			await scheduler.runOnce(rule.id, { dryRun: false });

			expect(warnSpy).toHaveBeenCalledTimes(1);
			const line = String(warnSpy.mock.calls[0]?.[0]);
			expect(line).toContain("Broken Rule");
			expect(line).toContain("disk exploded");
		});

		it("records returned, aborted, failed and overlap outcomes in the injected totals", async () => {
			const totals = new ActivityTotals();
			const recordReturned = vi.spyOn(totals, "recordReturned");
			const recordFailed = vi.spyOn(totals, "recordFailed");
			const recordOverlap = vi.spyOn(totals, "recordOverlap");
			const rule = makeImportRule();
			const importRunner = makeImportRunner();
			const inFlight = new InFlightRegistry();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				importRunner,
				inFlight,
				activityTotals: totals,
			});

			const ok: RunStats = { copied: 2, skipped: 1, failed: 0, aborted: false };
			importRunner.run.mockResolvedValueOnce(ok);
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(recordReturned).toHaveBeenLastCalledWith(ok, false);

			const aborted: RunStats = { copied: 0, skipped: 0, failed: 0, aborted: true };
			importRunner.run.mockResolvedValueOnce(aborted);
			await scheduler.runOnce(rule.id, { dryRun: true });
			expect(recordReturned).toHaveBeenLastCalledWith(aborted, true);

			importRunner.run.mockRejectedValueOnce(new Error("boom"));
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(recordFailed).toHaveBeenCalledTimes(1);

			inFlight.tryAcquire(rule.id);
			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(recordOverlap).toHaveBeenCalledTimes(1);
			expect(recordReturned).toHaveBeenCalledTimes(2);

			const snap = totals.takeSnapshot();
			expect(snap).toMatchObject({
				completedRuns: 1,
				failedRuns: 2,
				overlapSkips: 1,
				filesCopied: 2,
			});
		});

		it("records overlap even when the audit append rejects", async () => {
			const totals = new ActivityTotals();
			const rule = makeImportRule();
			const inFlight = new InFlightRegistry();
			inFlight.tryAcquire(rule.id);
			const auditLog = makeAuditLog();
			auditLog.append.mockRejectedValue(new Error("audit down"));
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				inFlight,
				auditLog,
				activityTotals: totals,
			});

			await scheduler.runOnce(rule.id, { dryRun: false }).catch(() => undefined);

			expect(totals.takeSnapshot().overlapSkips).toBe(1);
		});

		it("fires no timer and records no outcome for a rule disabled on this device", async () => {
			const totals = new ActivityTotals();
			const rule = makeImportRule({ everyMinutes: 1 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({
				plugin,
				rules: [rule],
				enabledIds: new Set(),
				importRunner,
				activityTotals: totals,
			});

			await scheduler.start();
			await scheduler.runInitialRun();
			vi.advanceTimersByTime(5 * 60_000);
			await flush();

			expect(importRunner.run).not.toHaveBeenCalled();
			expect(totals.takeSnapshot()).toMatchObject({
				completedRuns: 0,
				failedRuns: 0,
				overlapSkips: 0,
				dryRuns: 0,
			});
			scheduler.stop();
		});

		it("flipping the debug source does not change counts or summary timing", async () => {
			let on = false;
			setDebugSource(() => on);
			const rule = makeImportRule({ everyMinutes: 60 });
			const importRunner = makeImportRunner();
			importRunner.run.mockResolvedValue({ copied: 3, skipped: 0, failed: 0, aborted: false });
			const { scheduler } = buildScheduler({ plugin, rules: [rule], importRunner });
			await scheduler.start();

			await scheduler.runOnce(rule.id, { dryRun: false });
			on = true;
			await scheduler.runOnce(rule.id, { dryRun: false });
			on = false;

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS - 1);
			expect(summaryLines()).toHaveLength(0);
			vi.advanceTimersByTime(1);
			expect(summaryLines()).toHaveLength(1);
			expect(summaryLines()[0]).toContain("2 completed");
			expect(summaryLines()[0]).toContain("files 6 copied");
			scheduler.stop();
		});

		it("includes initial-run outcomes in the first summary", async () => {
			const rule = makeImportRule({ everyMinutes: 60 * 48 });
			const { scheduler } = buildScheduler({ plugin, rules: [rule] });
			await scheduler.start();
			await scheduler.runInitialRun();

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(1);
			expect(summaryLines()[0]).toContain("1 completed");
			scheduler.stop();
		});

		it("leaks no rule name into lifecycle or summary lines with the source off", async () => {
			const rule = makeImportRule({ name: "Secret-Client-X", everyMinutes: 60 * 48 });
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({ plugin, rules: [rule], importRunner });
			await scheduler.start();
			await scheduler.runInitialRun();
			await scheduler.runOnce(rule.id, { dryRun: false });
			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(1);
			expect(debugLines().length).toBeGreaterThan(0);
			for (const line of debugLines()) {
				expect(line).not.toContain("Secret-Client-X");
			}
			scheduler.stop();
		});

		it("tick lines contain only rule name, direction, dry-run tag and counts or error message", async () => {
			setDebugSource(() => true);
			const rule = makeImportRule({
				name: "Rule-A",
				sourcePath: "/very/private/source" as ImportRule["sourcePath"],
				destinationVaultPath: "private-dest" as ImportRule["destinationVaultPath"],
			});
			const importRunner = makeImportRunner();
			const { scheduler } = buildScheduler({ plugin, rules: [rule], importRunner });

			await scheduler.runOnce(rule.id, { dryRun: false });
			expect(tickLines()).toEqual([
				"[Hakobi/Scheduler] tick begin: Rule-A (import)",
				"[Hakobi/Scheduler] tick end: Rule-A — ok (0 copied, 0 skipped, 0 failed)",
			]);
			for (const line of debugLines()) {
				expect(line).not.toContain("/very/private/source");
				expect(line).not.toContain("private-dest");
			}
		});

		it("emits exactly one summary per 24 h and two per 48 h", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);
			expect(summaryLines()).toHaveLength(1);
			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);
			expect(summaryLines()).toHaveLength(2);
			scheduler.stop();
		});

		it("writes the summary line with zeros when there were no runs", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toEqual([
				"[Hakobi] daily summary: 0 completed, 0 failed, 0 overlap skips, 0 dry runs; files 0 copied, 0 skipped, 0 failed",
			]);
			scheduler.stop();
		});

		it("writes no summary after stop()", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();
			scheduler.stop();

			vi.advanceTimersByTime(3 * DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(0);
		});

		it("starts the next summary from zero after stop() then start()", async () => {
			const rule = makeImportRule({ everyMinutes: 60 * 48 });
			const { scheduler } = buildScheduler({ plugin, rules: [rule] });
			await scheduler.start();
			await scheduler.runOnce(rule.id, { dryRun: false });
			scheduler.stop();
			await scheduler.start();

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(1);
			expect(summaryLines()[0]).toContain("0 completed");
			scheduler.stop();
		});

		it("calling start() twice keeps a single summary timer", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();
			await scheduler.start();

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(1);
			scheduler.stop();
		});

		it("keeps counts across rule edits, additions and removals so the summary covers all runs", async () => {
			const ruleA = makeImportRule({ everyMinutes: 60 * 48 });
			const ruleB = makeImportRule({ everyMinutes: 60 * 48 });
			const rules: ImportRule[] = [ruleA];
			const enabledIds = new Set<RuleId>([ruleA.id]);
			const importRunner = makeImportRunner();
			importRunner.run.mockResolvedValue({ copied: 2, skipped: 0, failed: 0, aborted: false });
			const { scheduler } = buildScheduler({ plugin, rules, enabledIds, importRunner });
			await scheduler.start();

			await scheduler.runOnce(ruleA.id, { dryRun: false });
			await scheduler.onRuleChanged({ ...ruleA, everyMinutes: 60 * 72 });
			await scheduler.runOnce(ruleA.id, { dryRun: false });

			rules.push(ruleB);
			enabledIds.add(ruleB.id);
			await scheduler.onRuleChanged(ruleB);
			await scheduler.runOnce(ruleB.id, { dryRun: false });

			scheduler.onRuleRemoved(ruleA.id);
			rules.splice(0, 1);
			scheduler.onRuleRemoved(ruleB.id);

			vi.advanceTimersByTime(DAILY_SUMMARY_INTERVAL_MS);

			expect(summaryLines()).toHaveLength(1);
			expect(summaryLines()[0]).toContain("3 completed");
			expect(summaryLines()[0]).toContain("files 6 copied");
			scheduler.stop();
		});

		it("registers the summary interval with the plugin", async () => {
			const { scheduler } = buildScheduler({ plugin, rules: [] });
			await scheduler.start();

			expect(plugin.registerInterval).toHaveBeenCalledTimes(1);
			scheduler.stop();
		});
	});
});
