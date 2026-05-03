// Scheduler — one timer per enabled rule, overlap-skip semantics (T2.4).
//
// WHY this module exists:
// Implements the PRD/F3 scheduled execution contract: each enabled rule fires
// via window.setInterval at its configured everyMinutes cadence. Overlap-skip
// (ADR-9) prevents a slow run from stacking on itself: if a rule's execution
// is still in-flight when the next tick arrives, the tick is skipped and a
// metadata-only audit entry is appended (decision=skipped, errorCode=overlap).
//
// The Scheduler is intentionally decoupled from Obsidian's Plugin class via
// a structural interface (SchedulerPluginShape). Real wiring happens in Phase 3
// main.ts. Stubs in tests use vi.fn() shaped objects.

import type { Rule, RuleId, ImportRule, ExportRule } from "../types/index";
import type { AuditEntry } from "../audit/AuditEntry";
import type { Direction } from "../audit/AuditEntry";
import { InFlightRegistry } from "./InFlightRegistry";

// ---------------------------------------------------------------------------
// Structural interfaces — smallest slice the Scheduler actually needs
// ---------------------------------------------------------------------------

/** Minimal structural interface for the plugin dependency. No Obsidian import. */
export interface SchedulerPluginShape {
	/** Mirrors Obsidian Plugin.registerInterval — registers an interval ID for
	 *  automatic cleanup on plugin unload. */
	registerInterval(id: number): number;
}

export interface SchedulerRuleStore {
	load(): Promise<{ rules: Rule[] }>;
	getById(id: RuleId): Rule | undefined;
}

export interface SchedulerDeviceStore {
	isEnabled(ruleId: RuleId): boolean | Promise<boolean>;
}

export interface SchedulerImportRunner {
	run(rule: ImportRule, opts?: { dryRun?: boolean }): Promise<void>;
}

export interface SchedulerExportRunner {
	run(rule: ExportRule, opts?: { dryRun?: boolean }): Promise<void>;
}

export interface SchedulerStatusBar {
	setIdle(): void;
	setRunning(name: string): void;
	setFailed(summary: string): void;
}

export interface SchedulerAuditLog {
	append(entry: AuditEntry): Promise<void>;
}

export interface SchedulerDeps {
	plugin: SchedulerPluginShape;
	ruleStore: SchedulerRuleStore;
	deviceStore: SchedulerDeviceStore;
	importRunner: SchedulerImportRunner;
	exportRunner: SchedulerExportRunner;
	statusBar: SchedulerStatusBar;
	auditLog: SchedulerAuditLog;
	inFlight: InFlightRegistry;
	nowFn?: () => Date;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
	private readonly plugin: SchedulerPluginShape;
	private readonly ruleStore: SchedulerRuleStore;
	private readonly deviceStore: SchedulerDeviceStore;
	private readonly importRunner: SchedulerImportRunner;
	private readonly exportRunner: SchedulerExportRunner;
	private readonly statusBar: SchedulerStatusBar;
	private readonly auditLog: SchedulerAuditLog;
	private readonly inFlight: InFlightRegistry;
	private readonly nowFn: () => Date;

	/** Map from RuleId to a cancel function that calls clearInterval(id). */
	private readonly cancelMap: Map<RuleId, () => void> = new Map();

	constructor(deps: SchedulerDeps) {
		this.plugin = deps.plugin;
		this.ruleStore = deps.ruleStore;
		this.deviceStore = deps.deviceStore;
		this.importRunner = deps.importRunner;
		this.exportRunner = deps.exportRunner;
		this.statusBar = deps.statusBar;
		this.auditLog = deps.auditLog;
		this.inFlight = deps.inFlight;
		this.nowFn = deps.nowFn ?? (() => new Date());
	}

	// -------------------------------------------------------------------------
	// start() — load rules and schedule timers for all enabled ones
	// -------------------------------------------------------------------------

	async start(): Promise<void> {
		const { rules } = await this.ruleStore.load();

		for (const rule of rules) {
			const enabled = await this.deviceStore.isEnabled(rule.id);
			if (enabled) {
				this.scheduleTimer(rule);
			}
		}
	}

	// -------------------------------------------------------------------------
	// runInitialRun() — fire one tick per enabled rule on plugin start, so the
	// user sees activity immediately instead of waiting a full everyMinutes
	// interval. The grace period (waiting for layout/metadata to settle) is
	// orchestrated by the caller — this method just runs the ticks once each,
	// sequentially, respecting the in-flight registry.
	//
	// Intentionally separate from start() because:
	//   1. start() must return quickly so Plugin.onload() doesn't block, but
	//      the initial run can take seconds (per-rule I/O).
	//   2. The caller (main.ts) wants to gate this behind onLayoutReady +
	//      grace period; that orchestration doesn't belong in the Scheduler.
	// -------------------------------------------------------------------------

	async runInitialRun(): Promise<void> {
		const { rules } = await this.ruleStore.load();
		for (const rule of rules) {
			const enabled = await this.deviceStore.isEnabled(rule.id);
			if (!enabled) continue;
			await this.executeTick(rule, false);
		}
	}

	// -------------------------------------------------------------------------
	// stop() — cancel all active timers
	// -------------------------------------------------------------------------

	stop(): void {
		for (const cancel of this.cancelMap.values()) {
			cancel();
		}
		this.cancelMap.clear();
	}

	// -------------------------------------------------------------------------
	// onRuleChanged() — called when a rule's fields change (e.g. everyMinutes,
	// enabledOnThisDevice). Cancels any existing timer for the rule, then either
	// schedules a new one (if enabled) or leaves it cleared (if disabled).
	// Returns a Promise so callers can await the enable-check if needed.
	// -------------------------------------------------------------------------

	async onRuleChanged(rule: Rule): Promise<void> {
		// Cancel any existing timer for this rule first
		this.cancelTimer(rule.id);

		// Re-check enable status — await regardless of sync/async return
		const enabled = await this.deviceStore.isEnabled(rule.id);
		if (enabled) {
			this.scheduleTimer(rule);
		}
	}

	// -------------------------------------------------------------------------
	// onRuleRemoved() — cancel and remove the timer for a deleted rule
	// -------------------------------------------------------------------------

	onRuleRemoved(ruleId: RuleId): void {
		this.cancelTimer(ruleId);
	}

	// -------------------------------------------------------------------------
	// runOnce() — manually trigger one rule's execution pipeline.
	// Respects the in-flight registry (overlap-skip). dryRun is passed through.
	// -------------------------------------------------------------------------

	async runOnce(ruleId: RuleId, opts: { dryRun: boolean }): Promise<void> {
		const rule = this.ruleStore.getById(ruleId);
		if (rule === undefined) {
			return;
		}

		await this.executeTick(rule, opts.dryRun);
	}

	// -------------------------------------------------------------------------
	// runAll() — run all enabled rules in the given direction, sequentially.
	// -------------------------------------------------------------------------

	async runAll(direction: Direction, opts: { dryRun: boolean }): Promise<void> {
		const { rules } = await this.ruleStore.load();

		for (const rule of rules) {
			if (rule.direction !== direction) continue;

			const enabled = await this.deviceStore.isEnabled(rule.id);
			if (!enabled) continue;

			await this.executeTick(rule, opts.dryRun);
		}
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/** Register a repeating interval timer for a single rule. Stores a cancel
	 *  function in cancelMap and registers the interval ID with the plugin so
	 *  Obsidian handles cleanup on unload. */
	private scheduleTimer(rule: Rule): void {
		const intervalMs = rule.everyMinutes * 60_000;

		// setInterval may return NodeJS.Timeout (object) in Node/vitest environments.
		// Coerce to number with the unary plus so plugin.registerInterval always
		// receives a plain number — matching Obsidian's Plugin.registerInterval(id: number)
		// signature and the mock contract. clearInterval accepts both forms.
		//
		// We intentionally use the global setInterval/clearInterval rather than
		// activeWindow.setInterval so that vi.useFakeTimers() in tests can intercept
		// these calls. NodeFs.ts uses the same pattern for the same reason.
		// eslint-disable-next-line obsidianmd/prefer-active-window-timers -- fake timers need global setInterval
		const rawId = setInterval(() => {
			// Fire-and-forget the async tick; catch any uncaught rejection to
			// prevent an unhandled rejection from killing the timer chain.
			this.executeTick(rule, false).catch((err: unknown) => {
				console.error("[Scheduler] Uncaught error in timer tick:", err);
			});
		}, intervalMs);

		const numericId = +rawId;
		this.plugin.registerInterval(numericId);
		// eslint-disable-next-line obsidianmd/prefer-active-window-timers -- pairs with setInterval above
		this.cancelMap.set(rule.id, () => clearInterval(rawId));
	}

	/** Cancel and remove the timer for a rule if one exists. */
	private cancelTimer(ruleId: RuleId): void {
		const cancel = this.cancelMap.get(ruleId);
		if (cancel !== undefined) {
			cancel();
			this.cancelMap.delete(ruleId);
		}
	}

	/** Core execution pipeline: acquire in-flight lock → run runner → release.
	 *  On overlap: append audit entry and return. On runner error: setFailed +
	 *  append audit entry. Sets status bar throughout. */
	private async executeTick(rule: Rule, dryRun: boolean): Promise<void> {
		const acquired = this.inFlight.tryAcquire(rule.id);

		if (!acquired) {
			// Overlap — append audit entry and bail out
			await this.auditLog.append({
				timestamp: this.nowFn().toISOString(),
				ruleId: rule.id,
				ruleName: rule.name,
				direction: rule.direction,
				operation: "skipped",
				decision: "skipped",
				errorCode: "overlap",
			});
			return;
		}

		this.statusBar.setRunning(rule.name);

		try {
			await this.dispatchRunner(rule, dryRun);
			this.statusBar.setIdle();
		} catch (err: unknown) {
			const summary = err instanceof Error ? err.message : "unknown error";
			this.statusBar.setFailed(summary);
			// Append a rule-failed audit entry
			await this.auditLog.append({
				timestamp: this.nowFn().toISOString(),
				ruleId: rule.id,
				ruleName: rule.name,
				direction: rule.direction,
				operation: "error",
				decision: "rule-failed",
				errorCode: "unknown",
			}).catch(() => undefined);
		} finally {
			this.inFlight.release(rule.id);
		}
	}

	/** Dispatch to the correct runner based on the rule's direction. */
	private async dispatchRunner(rule: Rule, dryRun: boolean): Promise<void> {
		if (rule.direction === "import") {
			await this.importRunner.run(rule, { dryRun });
		} else {
			await this.exportRunner.run(rule, { dryRun });
		}
	}
}
