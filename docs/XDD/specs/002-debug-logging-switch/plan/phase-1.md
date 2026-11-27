---
title: "Phase 1: Foundations"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Foundations

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View/Interface Specifications/Internal API Changes]`
- `[ref: SDD/Building Block View/Interface Specifications/Application Data Models]`
- `[ref: SDD/Building Block View/Interface Specifications/Data Storage Changes]`
- `[ref: SDD/Implementation Examples]`
- `[ref: PRD/Detailed Feature Specifications/Business Rules]`

**Key Decisions**:
- ADR-1: `log.debug` gated, `log.lifecycle` ungated; both `console.debug`.
- ADR-2: the logger reads a registered boolean provider; `null` restores "off".
- ADR-3: `ActivityTotals` is pure (no timers, no I/O). Timing belongs to Phase 2.
- ADR-4: `debugLogging` is a required boolean on `GlobalSettings`, default `false`.
- ADR-6: `RunStats.aborted` marks runs the runner gave up on before processing files.

**Dependencies**:
- None. T1.1, T1.3 and T1.4 touch disjoint files and can run in parallel. T1.2 uses the `RunStats` type from T1.4: run it after T1.4, or start in parallel against the agreed `aborted: boolean` field and rebase.

---

## Tasks

This phase establishes the three building blocks that the wiring in Phase 2 consumes: a gated logger, a pure activity counter, and the persisted switch.

- [x] **T1.1 Gated logger with lifecycle channel** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/util/logger.ts` and the gated-logger example `[ref: SDD/Implementation Examples/Example: Gated logger]`.
  2. Test (`test/util/logger.test.ts`, NEW):
     - `log.debug` writes nothing with no source registered.
     - It writes nothing when the source returns false.
     - It follows the source live, so flipping the backing variable changes the next call.
     - `setDebugSource(null)` restores "off".
     - `log.lifecycle` always writes `console.debug`.
     - `log.warn` and `log.error` always write their own level.
     - Reset in `afterEach`.
  3. Implement: Add `setDebugSource` and `log.lifecycle`, and gate `log.debug`. Update the header comment so the channel guidance names the four channels.
  4. Validate: 100% line coverage of `logger.ts`; lint clean; `npm run build`.
  5. Success:
     - The switch state controls `log.debug` with no reload. `[ref: PRD/AC-1.2, AC-1.3]`
     - Each channel uses the console level specified in the SDD. `[ref: PRD/AC-2.6]`

- [x] **T1.2 ActivityTotals counter and summary formatter** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `src/runner/RunStats.ts`, the traced walkthrough `[ref: SDD/Implementation Examples/Example: Traced walkthrough]`, and the PRD business rules 2–8 `[ref: PRD/Detailed Feature Specifications]`.
  2. Test (`test/scheduler/ActivityTotals.test.ts`, NEW):
     - `recordReturned` with `aborted: false`, non-dry, adds 1 to `completedRuns` and adds the file counts.
     - `recordReturned` with `aborted: false`, dry, adds only to `dryRuns`.
     - `recordReturned` with `aborted: true` (dry or not) adds 1 to `failedRuns` and no file counts.
     - `recordFailed` adds 1 to `failedRuns` with no file counts.
     - `recordOverlap` adds 1 to `overlapSkips`.
     - `takeSnapshot` returns the counts and resets them to zero.
     - Replaying the SDD walkthrough steps 1–7 gives exactly the table values.
     - `formatDailySummary` returns exactly `[Hakobi] daily summary: 2 completed, 2 failed, 1 overlap skip, 1 dry run; files 3 copied, 1 skipped, 2 failed` for the walkthrough snapshot, with singular and plural forms.
     - The all-zero line matches the SDD sample exactly.
     - The output contains no rule name or path. It is built from counts only, and the type signature enforces this.
  3. Implement: Create `src/scheduler/ActivityTotals.ts` with `ActivitySnapshot`, `ActivityTotals` (`recordReturned`, `recordFailed`, `recordOverlap`, `takeSnapshot`), `formatDailySummary` (full line, prefix included) and `DAILY_SUMMARY_INTERVAL_MS`. Start the file with a "why" comment.
  4. Validate: 100% line coverage; lint clean; types check.
  5. Success:
     - The counting rules match the PRD business rules 2–5. `[ref: PRD/AC-3.2, AC-3.3, AC-3.5]` `[ref: SDD/ADR-6]`
     - The summary contains counts only. `[ref: PRD/AC-3.6, AC-4.1]`

- [x] **T1.3 Persisted debugLogging setting** `[activity: data-architecture]` `[parallel: true]`

  1. Prime: Read `src/types/index.ts:53-58`, `src/persistence/RuleStore.ts:51-56,279-298` and `src/main.ts:59-64` `[ref: SDD/Data Storage Changes]` `[ref: SDD/Technical Debt]`.
  2. Test:
     - In RuleStore tests, a missing `debugLogging` loads as `false`.
     - A non-boolean `debugLogging` (`"yes"`, `1`) loads as `false`.
     - `true` round-trips through save and load.
     - The other four fields are unaffected.
     - Update the 7 typed `GlobalSettings` fixture sites: `test/example.test.ts:14`, `test/types/index.test.ts:55,80` (and rename the "four documented fields" test title at L54), `test/persistence/RuleStore.test.ts:33,423,451`, `test/settings/subtabs/GeneralSubtab.test.ts:36`.
     - The untyped raw `loadData` fixtures (`test/spec/compliance.test.ts:289-297`, `test/live/import.live.test.ts:86-93`, `test/live/export.live.test.ts:97-105`) keep working through the merge default; updating them is optional.
  3. Implement:
     - Add `debugLogging: boolean` to `GlobalSettings`.
     - Add the default `false` to `DEFAULT_GLOBAL_SETTINGS`.
     - Add a boolean check in `_mergeSettings`.
     - Export `DEFAULT_GLOBAL_SETTINGS` from `RuleStore.ts` (it is a non-exported `const` at L51 today), import it in `main.ts`, and replace the duplicated literal at `main.ts:59-64` with `{ ...DEFAULT_GLOBAL_SETTINGS }`.
  4. Validate: full `npm test` green (fixtures compile); `npm run build`.
  5. Success:
     - The value persists across reloads. `[ref: PRD/AC-1.4]`
     - It is stored in `data.json` `globalSettings`. `[ref: PRD/AC-1.5]`
     - Missing or invalid values default to off. `[ref: PRD/AC-1.1]`

- [x] **T1.4 Runner abort flag on RunStats** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/runner/RunStats.ts`, `src/runner/ImportRunner.ts:136-161` and the early-return paths in `src/runner/ExportRunner.ts:119-156` `[ref: SDD/Architecture Decisions/ADR-6]` `[ref: SDD/Internal API Changes]`.
  2. Test:
     - In ImportRunner tests, a scope refusal and a missing source return `aborted: true` and empty counts, and the existing audit entries are unchanged.
     - A normal import (including an all-skipped one) returns `aborted: false`.
     - In ExportRunner tests, every early-return path that writes `rule-failed` before processing files returns `aborted: true`; normal and per-file-failure runs return `aborted: false`.
     - Update existing `RunStats` expectations (`toEqual` on `{copied, skipped, failed}`) to include `aborted`.
  3. Implement: Add `aborted: boolean` to `RunStats` (`EMPTY_STATS.aborted = false`), set it on the abort paths, and make `outcomesToStats` / the export stats literal default it to `false`. Do not change any audit entry or per-file behaviour.
  4. Validate: runner tests green; full `npm test`; `npm run build`.
  5. Success: Aborted runs are distinguishable from completed runs. `[ref: PRD/AC-3.2]` `[ref: PRD/Detailed Feature Specifications/Business Rules/Rule 3]`

- [x] **T1.5 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests. Verify them against the SDD interfaces and PRD business rules. `npm test`, `npm run lint` and `npm run build` pass.
