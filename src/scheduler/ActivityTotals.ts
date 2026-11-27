// In-memory activity counters and the daily summary line.
//
// WHY this module exists:
// With debug logging off, the user still wants a once-a-day heartbeat that
// shows Hakobi is alive and what it did. ActivityTotals is the pure counting
// core: the Scheduler reports run outcomes, a timer takes a snapshot every
// DAILY_SUMMARY_INTERVAL_MS, and formatDailySummary turns it into one line.
// Counting rules live here so they are testable without timers or Obsidian
// (SDD/ADR-6). The formatter accepts counts only, so a rule name or path can
// never reach the line (PRD rule 8).

import type { RunStats } from "../runner/RunStats";

export const DAILY_SUMMARY_INTERVAL_MS = 86_400_000;

export interface ActivitySnapshot {
	/** Non-dry runs that returned RunStats with aborted = false. */
	completedRuns: number;
	/** Runs whose runner threw, or returned aborted = true (dry or not). */
	failedRuns: number;
	/** Ticks refused by the in-flight lock. */
	overlapSkips: number;
	/** Dry runs that returned RunStats with aborted = false. */
	dryRuns: number;
	/** Sum of RunStats.copied over completedRuns. */
	filesCopied: number;
	/** Sum of RunStats.skipped over completedRuns. */
	filesSkipped: number;
	/** Sum of RunStats.failed over completedRuns. */
	filesFailed: number;
}

function zeroed(): ActivitySnapshot {
	return {
		completedRuns: 0,
		failedRuns: 0,
		overlapSkips: 0,
		dryRuns: 0,
		filesCopied: 0,
		filesSkipped: 0,
		filesFailed: 0,
	};
}

export class ActivityTotals {
	private counts: ActivitySnapshot = zeroed();

	/** A run returned stats. Aborted runs count as failed; dry runs never add file totals. */
	recordReturned(stats: RunStats, dryRun: boolean): void {
		if (stats.aborted) {
			this.counts.failedRuns += 1;
			return;
		}
		if (dryRun) {
			this.counts.dryRuns += 1;
			return;
		}
		this.counts.completedRuns += 1;
		this.counts.filesCopied += stats.copied;
		this.counts.filesSkipped += stats.skipped;
		this.counts.filesFailed += stats.failed;
	}

	/** The runner threw. */
	recordFailed(): void {
		this.counts.failedRuns += 1;
	}

	/** A tick was refused because the rule was still running. */
	recordOverlap(): void {
		this.counts.overlapSkips += 1;
	}

	/** Return the current counts and reset them to zero. */
	takeSnapshot(): ActivitySnapshot {
		const snapshot = this.counts;
		this.counts = zeroed();
		return snapshot;
	}
}

function plural(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Full daily summary line, "[Hakobi]" prefix included. Counts only. */
export function formatDailySummary(s: ActivitySnapshot): string {
	return (
		`[Hakobi] daily summary: ${s.completedRuns} completed, ${s.failedRuns} failed, ` +
		`${plural(s.overlapSkips, "overlap skip")}, ${plural(s.dryRuns, "dry run")}; ` +
		`files ${s.filesCopied} copied, ${s.filesSkipped} skipped, ${s.filesFailed} failed`
	);
}
