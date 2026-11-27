import { describe, expect, it } from "vitest";
import {
	ActivityTotals,
	DAILY_SUMMARY_INTERVAL_MS,
	formatDailySummary,
	type ActivitySnapshot,
} from "../../src/scheduler/ActivityTotals";
import type { RunStats } from "../../src/runner/RunStats";

const ZERO: ActivitySnapshot = {
	completedRuns: 0,
	failedRuns: 0,
	overlapSkips: 0,
	dryRuns: 0,
	filesCopied: 0,
	filesSkipped: 0,
	filesFailed: 0,
};

function stats(copied: number, skipped: number, failed: number, aborted = false): RunStats {
	return { copied, skipped, failed, aborted };
}

describe("ActivityTotals", () => {
	it("starts at zero", () => {
		expect(new ActivityTotals().takeSnapshot()).toEqual(ZERO);
	});

	it("recordReturned (non-dry, not aborted) counts a completed run and adds file counts", () => {
		const totals = new ActivityTotals();
		totals.recordReturned(stats(3, 1, 2), false);
		expect(totals.takeSnapshot()).toEqual({
			...ZERO,
			completedRuns: 1,
			filesCopied: 3,
			filesSkipped: 1,
			filesFailed: 2,
		});
	});

	it("recordReturned (dry, not aborted) counts only a dry run", () => {
		const totals = new ActivityTotals();
		totals.recordReturned(stats(5, 2, 1), true);
		expect(totals.takeSnapshot()).toEqual({ ...ZERO, dryRuns: 1 });
	});

	it.each([false, true])("recordReturned aborted (dryRun=%s) counts a failed run and no files", (dry) => {
		const totals = new ActivityTotals();
		totals.recordReturned(stats(1, 1, 1, true), dry);
		expect(totals.takeSnapshot()).toEqual({ ...ZERO, failedRuns: 1 });
	});

	it("recordFailed counts a failed run without file counts", () => {
		const totals = new ActivityTotals();
		totals.recordFailed();
		expect(totals.takeSnapshot()).toEqual({ ...ZERO, failedRuns: 1 });
	});

	it("recordOverlap counts an overlap skip", () => {
		const totals = new ActivityTotals();
		totals.recordOverlap();
		expect(totals.takeSnapshot()).toEqual({ ...ZERO, overlapSkips: 1 });
	});

	it("takeSnapshot returns the counts and resets them to zero", () => {
		const totals = new ActivityTotals();
		totals.recordReturned(stats(2, 0, 0), false);
		totals.recordOverlap();

		const first = totals.takeSnapshot();
		const second = totals.takeSnapshot();

		expect(first).toEqual({ ...ZERO, completedRuns: 1, filesCopied: 2, overlapSkips: 1 });
		expect(second).toEqual(ZERO);
	});

	it("takeSnapshot returns a copy unaffected by later recording", () => {
		const totals = new ActivityTotals();
		const snap = totals.takeSnapshot();
		totals.recordOverlap();
		expect(snap).toEqual(ZERO);
	});

	it("replays the SDD walkthrough steps 1-7", () => {
		const steps: Array<(t: ActivityTotals) => void> = [
			(t) => t.recordReturned(stats(3, 1, 0), false), // 1 rule A ok
			(t) => t.recordReturned(stats(0, 0, 2), false), // 2 rule B per-file failures
			(t) => t.recordReturned(stats(5, 0, 0), true), // 3 rule B dry run
			() => undefined, // 4 rule A starts, nothing recorded yet
			(t) => t.recordOverlap(), // 5 overlap
			(t) => t.recordFailed(), // 6 step-4 run throws
			(t) => t.recordReturned(stats(0, 0, 0, true), false), // 7 rule C aborted
		];
		// [completed, failed, overlap, dry, copied, skipped, failedFiles]
		const expected = [
			[1, 0, 0, 0, 3, 1, 0],
			[2, 0, 0, 0, 3, 1, 2],
			[2, 0, 0, 1, 3, 1, 2],
			[2, 0, 0, 1, 3, 1, 2],
			[2, 0, 1, 1, 3, 1, 2],
			[2, 1, 1, 1, 3, 1, 2],
			[2, 2, 1, 1, 3, 1, 2],
		];
		const row = (s: ActivitySnapshot): number[] => [
			s.completedRuns, s.failedRuns, s.overlapSkips, s.dryRuns,
			s.filesCopied, s.filesSkipped, s.filesFailed,
		];

		steps.forEach((_, i) => {
			const t = new ActivityTotals();
			steps.slice(0, i + 1).forEach((step) => step(t));
			expect(row(t.takeSnapshot())).toEqual(expected[i]);
		});

		const t = new ActivityTotals();
		steps.forEach((step) => step(t));
		expect(formatDailySummary(t.takeSnapshot())).toBe(
			"[Hakobi] daily summary: 2 completed, 2 failed, 1 overlap skip, 1 dry run; files 3 copied, 1 skipped, 2 failed",
		);
		expect(t.takeSnapshot()).toEqual(ZERO); // 8: reset
	});
});

describe("formatDailySummary", () => {
	it("formats the all-zero line exactly", () => {
		expect(formatDailySummary(ZERO)).toBe(
			"[Hakobi] daily summary: 0 completed, 0 failed, 0 overlap skips, 0 dry runs; files 0 copied, 0 skipped, 0 failed",
		);
	});

	it("uses singular forms for 1 and plural for other counts", () => {
		expect(formatDailySummary({ ...ZERO, overlapSkips: 1, dryRuns: 1 })).toContain(
			"1 overlap skip, 1 dry run;",
		);
		expect(formatDailySummary({ ...ZERO, overlapSkips: 2, dryRuns: 3 })).toContain(
			"2 overlap skips, 3 dry runs;",
		);
	});

	it("is built from counts only and never contains a rule name or path", () => {
		const line = formatDailySummary({ ...ZERO, completedRuns: 4, filesCopied: 9 });
		expect(line).toBe(
			"[Hakobi] daily summary: 4 completed, 0 failed, 0 overlap skips, 0 dry runs; files 9 copied, 0 skipped, 0 failed",
		);
		expect(line).not.toMatch(/[\\/]/);
	});
});

describe("DAILY_SUMMARY_INTERVAL_MS", () => {
	it("is 24 hours", () => {
		expect(DAILY_SUMMARY_INTERVAL_MS).toBe(86_400_000);
	});
});
