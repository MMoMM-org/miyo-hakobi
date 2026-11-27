---
title: "Phase 3: Documentation and end-to-end validation"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Documentation and end-to-end validation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: PRD/Feature 4, Feature 5]`
- `[ref: SDD/Directory Map]` (docs subtree)
- `[ref: SDD/Architecture Decisions/ADR-5]`
- `[ref: SDD/Risks and Technical Debt/Known Technical Issues]`

**Key Decisions**:
- ADR-5: spec 001's console rule gets a "Superseded by spec 002" note and is not rewritten.
- `docs/audit-log.md` drift stays out of scope (separate issue).

**Dependencies**:
- Phase 2 complete. T3.1 depends only on the finalized behaviour, so it can run in parallel with T3.2.

---

## Tasks

This phase documents the behaviour for users and proves the whole feature end to end inside a loaded plugin.

- [ ] **T3.1 User and spec documentation** `[activity: documentation]` `[parallel: true]`

  1. Prime:
     - Read Kado's `docs/debug-logging.md`.
     - Read Hakobi's `docs/troubleshooting.md:80-95`, `docs/configuration.md:13-20` and `PRIVACY.md`.
     - Read the README docs index.
     - Read spec 001's `solution.md` Logging/Auditing section.
  2. Test: There is no code. A checklist review covers it:
     - Every PRD AC-4.4 and AC-5.x point is present.
     - The example lines match the real output from Phase 2 tests.
     - The per-OS shortcuts are correct.
     - The configuration table units and labels match the UI.
  3. Implement:
     - NEW `docs/debug-logging.md`, covering the switch, Verbose, the lines in each state with examples, how to turn it off, and that the summary is not an audit record.
     - Update `docs/troubleshooting.md`: Verbose, the switch, `Cmd+Option+I` / `Ctrl+Shift+I`, and add "debug log excerpt" to the bug-report checklist.
     - Update `docs/configuration.md`: a new row, and fix the seconds/label drift.
     - Add a developer-console section to `PRIVACY.md`.
     - Add the docs link in `README.md`.
     - Add the superseded-by note in `docs/XDD/specs/001-v0-1/solution.md` (rule at L1068 and L1074-1077).
     - Note in the hand-back that `assets/hakobi_general_settings.png` (embedded at `docs/configuration.md:10`) needs a fresh screenshot by the maintainer; do not fabricate one.
  4. Validate: Links resolve; `npm run lint` (no doc linting, sanity); proofread.
  5. Success:
     - PRIVACY.md documents the console. `[ref: PRD/AC-4.4]`
     - The debug page, troubleshooting and configuration docs are updated. `[ref: PRD/AC-5.1, AC-5.2, AC-5.3]`

- [ ] **T3.2 End-to-end plugin test** `[activity: test-strategy]` `[parallel: true]`

  1. Prime: Read `test/main.test.ts` and `test/main.scope-wiring.test.ts` (plugin harness) and the SDD acceptance criteria `[ref: SDD/Acceptance Criteria]`.
  2. Test (`test/debug-logging.e2e.test.ts`, NEW), against a loaded `HakobiPlugin` with one enabled import rule (fake runner returning `{copied 1, skipped 0, failed 0, aborted false}`) and fake timers, using `vi.advanceTimersByTime` only:
     - With the switch off, the initial run and one timer run write no tick lines, but the load lines are present.
     - Toggling on through the captured General save wrapper (pattern from `test/main.scope-wiring.test.ts`) makes the next run write tick lines.
     - Advancing to the 24 h mark gives exactly one line `[Hakobi] daily summary: N completed, 0 failed, 0 overlap skips, 0 dry runs; files N copied, 0 skipped, 0 failed`, where N is the number of runs the test dispatched (initial run + timer runs), and no rule name.
     - `plugin.onunload()` then `_runCleanup()` clears the summary timer and the debug source: no active intervals remain and `log.debug` is silent.
  3. Implement: Test-only. Fix any wiring defect found as a regression in the owning Phase 2 task's file.
  4. Validate: The full suite is green.
  5. Success: The end-to-end behaviour satisfies PRD F1–F4 together. `[ref: PRD/Feature 1–4]` `[ref: SDD/Acceptance Criteria]`

- [ ] **T3.3 Final Validation** `[activity: validate]`

  - Run `npm test`, `npm run lint` and `npm run build`.
  - Confirm every row of the AC → Task table in `plan/README.md` is satisfied.
  - Confirm no `log.debug` call site remains for a load or unload line: grep `log.debug(` in `src/main.ts` and `src/scheduler/Scheduler.ts` and check that only tick lines remain.
