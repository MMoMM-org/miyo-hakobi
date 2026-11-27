---
title: "Phase 2: Wiring and settings UI"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Wiring and settings UI

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example: Recording outcomes in executeTick]`
- `[ref: SDD/Runtime View]`
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]`
- `[ref: SDD/Risks and Technical Debt/Implementation Gotchas]`

**Key Decisions**:
- ADR-1: the load lines move to `log.lifecycle`. The tick lines stay `log.debug` and become gated automatically. Failure lines are unchanged.
- ADR-2: `main.ts` registers and clears the debug source.
- ADR-3: the Scheduler records outcomes and owns the summary interval.

**Dependencies**:
- Phase 1 complete. T2.1 needs T1.1, T1.2 and T1.4. T2.2 needs T1.1 and T1.3. T2.3 needs T1.3.
- T2.1, T2.2 and T2.3 touch disjoint files (`Scheduler.ts`, `main.ts`, `GeneralSubtab.ts`) and can run in parallel. T2.2's tests do not depend on T2.1 or T2.3: they drive the save wrapper through captured constructor deps (not the UI) and leave the interval-leak check to T3.2.

---

## Tasks

This phase connects the building blocks: run outcomes reach the counter, the daily summary fires, load lines stay visible, the switch gates the per-run detail live, and the user can toggle it.

- [x] **T2.1 Scheduler: outcome recording, daily summary, lifecycle lines** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/scheduler/Scheduler.ts` (`start`, `runInitialRun`, `stop`, `scheduleTimer`, `executeTick`) and the SDD complex-logic algorithm `[ref: SDD/Runtime View/Complex Logic]`.
  2. Test (`test/scheduler/Scheduler.test.ts`):
     - With the debug source off, no `console.debug` call contains "tick begin", "tick end" or "tick skip". Cover timer, `runInitialRun`, `runOnce` and `runAll`.
     - With the source on, those lines appear with today's text.
     - The "config loaded" and "initial run starting/finished" lines appear with the source off.
     - A failing runner still produces `console.warn` with the rule name and message.
     - An injected `ActivityTotals` receives `recordReturned(stats, dryRun)` (including a runner that returns `aborted: true`), `recordFailed()` and `recordOverlap()`. Assert overlap is recorded before the early return.
     - A rule disabled on this device fires no timer and records no outcome (Rule 7).
     - Flipping the debug source during a period changes neither the counts nor the next summary time (Edge 3).
     - The initial run's outcomes appear in the first summary.
     - With a rule named distinctively (for example `Secret-Client-X`), no lifecycle line and no summary line contains that name, with the source off (AC-4.1).
     - With the source on, tick lines contain only the rule name, direction, dry-run tag and counts or the error message (AC-4.3).
     - With fake timers, advancing `DAILY_SUMMARY_INTERVAL_MS` gives exactly one summary line, and 48 h gives two.
     - With no runs, the summary line is still written with zeros.
     - After `stop()`, advancing time writes no summary; after `stop()` then `start()`, the next summary starts from zero.
     - `registerInterval` is called for the summary interval.
     - Update the existing `registerInterval` call-count assertions after `start()` (`Scheduler.test.ts` L173, 187, 195, 282, 339, 347, 376, 410, 416): +1 each, or filter by delay.
     - Use `vi.advanceTimersByTime`, never `vi.runAllTimers*`, with a real Scheduler.
  3. Implement:
     - Add the optional `activityTotals` dep.
     - Record outcomes in the three `executeTick` branches.
     - Switch `start()` and `runInitialRun()` to `log.lifecycle`.
     - Schedule the summary interval once in `start()`. In `stop()`, cancel it and call `takeSnapshot()`, dropping the result.
  4. Validate: Scheduler tests green; no timer leak; lint; types.
  5. Success:
     - Per-run lines are gated. `[ref: PRD/AC-2.1, AC-2.5]`
     - Scheduler load lines are always shown. `[ref: PRD/AC-2.2]`
     - Failures are visible and name the rule. `[ref: PRD/AC-2.4, AC-4.2]`
     - The daily cadence, the zero line, and stop/reload all behave as specified. `[ref: PRD/AC-3.1, AC-3.4, AC-3.7]`

- [x] **T2.2 main.ts wiring: debug source and lifecycle lines** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read `src/main.ts` (onload L67, save wrapper L373-397, scheduler start L471, onunload L504-510) and the integration points `[ref: SDD/Integration Points]`.
  2. Test (new `test/main.debug-logging.test.ts`):
     - Capture the `GeneralSubtab` constructor deps with the `vi.mock` pattern from `test/main.scope-wiring.test.ts:17-40`.
     - After `onload()`, `log.debug` writes when `globalSettings.debugLogging` is true and stays silent when false.
     - After calling the captured `ruleStore.saveGlobalSettings({ ...current, debugLogging: true })`, the next `log.debug` writes, with no reload.
     - "plugin loading" and "plugin loaded" appear with the switch off, and "plugin unloading" appears on unload.
     - After `plugin.onunload()` (the mock's `_runCleanup()` does not call it), the source is cleared and `log.debug` is silent.
  3. Implement:
     - Call `setDebugSource(() => this.globalSettings.debugLogging)` early in onload.
     - Call `setDebugSource(null)` in onunload.
     - Switch the three lifecycle lines to `log.lifecycle`.
  4. Validate: main tests green; lint; types. (The interval-leak check is in T3.2.)
  5. Success:
     - The switch takes effect live. `[ref: PRD/AC-1.2, AC-1.3]`
     - Load and unload lines are always shown. `[ref: PRD/AC-2.2, AC-2.3]`

- [x] **T2.3 General settings: Developer heading and Debug logging toggle** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime:
     - Read `src/settings/subtabs/GeneralSubtab.ts`.
     - Read the toggle convention in `src/settings/editor/ImportRuleEditor.ts:349-358`.
     - Read Kado's `GeneralTab.ts:289-310` for wording, and the SDD toggle copy `[ref: SDD/User Interface & UX/Design System]`.
     - Read the UX section `[ref: SDD/User Interface & UX]`.
  2. Test (`test/settings/subtabs/GeneralSubtab.test.ts`):
     - A "Developer" heading renders after "Audit log".
     - A toggle with `data-field="debugLogging"` reflects the stored value.
     - Its description equals the SDD copy (states "off by default" and mentions Verbose).
     - Flipping it calls `saveGlobalSettings` with `{ ...current, debugLogging: true }` and leaves the other fields unchanged.
     - The numeric fields still work.
  3. Implement:
     - Add the Developer section and toggle.
     - Narrow the `_addNumericSetting` field type to numeric keys of `GlobalSettings`.
  4. Validate: GeneralSubtab tests green; lint (obsidianmd UI-text rules, sentence case); types.
  5. Success:
     - The toggle is under the "Developer" heading and off by default. `[ref: PRD/AC-1.1]`
     - The description states the default and the Verbose requirement. `[ref: PRD/AC-1.6]`

- [x] **T2.4 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests. Check the three changed files against the SDD Runtime View and the UX section. `npm test`, `npm run lint` and `npm run build` pass.
