---
title: "Phase 4: Integration, E2E, Polish"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Integration, E2E, Polish

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Quality Requirements]` — performance, security, reliability targets
- `[ref: SDD/Acceptance Criteria]` — full EARS criteria as the integration baseline
- `[ref: PRD/Constraints and Assumptions]` — deployment + assumptions
- `[ref: PRD/Risks and Mitigations]` — verify each mitigation is in place
- `PRIVACY.md` — to be updated to declare network surfaces, local data, audit-log scope
- `README.md` — to be updated with Hakobi feature documentation
- `test/Hakobi/` — the test vault used for `npm run test:live`

**Key Decisions**:
- All ADRs from Phases 1–3 must remain in force; no new architectural decisions in this phase.
- E2E tests use the test vault with a tmp source/destination directory pair under `test/tmp/` (gitignored) — no real user paths touched.
- Deviations from spec discovered during this phase get logged in the spec README's Decisions Log AND in this phase file's "Deviations" section (added on demand).

**Dependencies**:
- Phase 3 must be complete: `main.ts` rewired, all UI surfaces present, lifecycle clean.

---

## Tasks

This phase glues the engine and UI into observably-correct behavior, hardens the user-facing documentation, and verifies non-functional targets (bundle size, lint cleanliness, security posture). After this phase, v0.1 is shippable.

- [x] **T4.1 Plugin lifecycle integration test** `[activity: validate] [parallel: true]`

  1. Prime: `[ref: SDD/Quality Requirements/Reliability]`, `test/__mocks__/obsidian.ts` (`Plugin._runCleanup`), `test/CLAUDE.md`.
  2. Test: `test/lifecycle/unload.test.ts` — instantiates `HakobiPlugin` in the mock, calls `onload()`, asserts Scheduler is running and timers are registered; calls `onunload()` (or `_runCleanup()`); asserts all timers cleared, all DOM listeners removed, all command registrations released; runs the full sequence twice in a single test to assert no state leaks across reloads (relevant for hot-reload during development).
  3. Implement: the test file (`test/lifecycle/unload.test.ts`).
  4. Validate: `npm test test/lifecycle/unload.test.ts`.
  5. Success:
     - [ ] Zero active timers after `onunload` `[ref: SDD/Quality Requirements/Reliability]`
     - [ ] Two consecutive load/unload cycles leave no residual state `[ref: SDD/Implementation Gotchas]`

- [x] **T4.2 End-to-end import flow (vault-backed)** `[activity: validate] [parallel: true]`

  1. Prime: `package.json`/`vitest.live.config.ts`, `test/Hakobi/`, `[ref: PRD/F1]`, `[ref: SDD/Runtime View/Primary Flow]`.
  2. Test: under `test/live/import.live.test.ts` — set up a tmp source dir with a small file tree (including a `.DS_Store` and one Obsidian-invalid-named file); construct a real `HakobiPlugin` against the test vault; create an import rule via `RuleStore.add`; trigger `Scheduler.runOnce(rule.id)`; assert files appear in vault per `flattenOnTarget` setting; assert `.DS_Store` is skipped with `housekeeping-file`; assert Obsidian-invalid name is renamed; read back the audit NDJSON and verify entries match expectations; tear down tmp dir.
  3. Implement: `test/live/import.live.test.ts` + any small helpers under `test/live/_helpers/`.
  4. Validate: `npm run test:live -- import`.
  5. Success:
     - [ ] At least one happy path AND one failure path verified end-to-end `[ref: PRD/F1, Constitution L2 Testing]`

- [x] **T4.3 End-to-end export flow (vault-backed)** `[activity: validate] [parallel: true]`

  1. Prime: same as T4.2 plus `[ref: PRD/F2]`.
  2. Test: under `test/live/export.live.test.ts` — three sub-cases (folder export, tag export, single-note export); set up a tmp destination dir; create the matching export rule; trigger `runOnce`; assert files land at destination with correct paths under `flattenOnTarget` setting; tag rule confirms nested-tag matching (ADR-11); single-note "missing" path triggers `source-note-missing`.
  3. Implement: `test/live/export.live.test.ts`.
  4. Validate: `npm run test:live -- export`.
  5. Success:
     - [ ] All three export source-types verified end-to-end `[ref: PRD/F2]`

- [x] **T4.4 PRIVACY.md update** `[activity: documentation] [parallel: true]`

  1. Prime: `[ref: PRD/Risks and Mitigations]`, `[ref: SDD/Constraints; CON-1, CON-3, CON-4]`, current `PRIVACY.md`.
  2. Test: PRIVACY.md sections present — Network surfaces (none), Data stored locally (rule defs + per-device flags + audit), Data sent externally (none), Audit log scope (metadata-only, fields enumerated), Symlinks (refused), Cloud-sync destinations (user's responsibility), Cross-plugin readability (data dir is readable by other plugins). Linkable from README.
  3. Implement: rewrite `PRIVACY.md` to reflect v0.1 reality.
  4. Validate: spell-check pass; manual review against Constitution L1 Privacy.
  5. Success:
     - [ ] Every Constitution L1/L2 Privacy item explicitly addressed `[ref: ~/Kouzou/projects/miyo/miyo-constitution.md]`

- [x] **T4.5 README.md update** `[activity: documentation] [parallel: true]`

  1. Prime: current `README.md`, `[ref: PRD/Product Overview]`, `[ref: SDD/UI Visualization Guide]`.
  2. Test: README sections — what Hakobi does (one-liner from PRD vision), key non-features (Won't-Have list), install + first-run flow, command list (7 commands), audit-log location, settings layout (3 subtabs), per-device enablement explanation (the most-likely-to-confuse behavior), troubleshooting FAQ ("rules don't run" → check `enabledOnThisDevice`; "Show audit log" doesn't open → check OS default app for .ndjson).
  3. Implement: rewrite `README.md`.
  4. Validate: render check (preview as Obsidian community-plugin listing description). Link check.
  5. Success:
     - [x] Documents at least one piece of non-obvious behavior per `[ref: PRD/Risks and Mitigations]` row `[ref: SDD/Implementation Gotchas]`

- [x] **T4.6 Build / bundle / lint hardening** `[activity: validate]`

  Depends on all prior phases.

  1. Prime: `package.json`, `esbuild.config.mjs`, `eslint.config.mts`.
  2. Test: `npm run build` produces a single `main.js` ≤ 100 KB minified; `npm run lint` reports zero errors and zero warnings; `npm run typecheck` reports zero errors; `npm run audit` reports zero high-severity findings; bundle does not contain any of: `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `import("electron")` outside the explicit `dialog.showOpenDialog` seam (grep-based test in CI).
  3. Implement: any necessary tweaks (eslint disables removed where possible, lint rule additions for the network grep test, bundle size budget enforcement in `package.json` script).
  4. Validate: full pre-commit gate passes — `npm run typecheck && npm test && npm run lint && npm run build`.
  5. Success:
     - [x] Bundle ≤ 100 KB `[ref: SDD/Quality Requirements/Performance]`
     - [x] Zero lint errors / zero lint warnings `[ref: SDD/CON-10]`
     - [x] No network APIs in the bundle (grep-based) `[ref: SDD/CON-1, Constitution L1]`

- [x] **T4.7 Spec compliance final sweep** `[activity: validate]`

  Depends on T4.1–T4.6.

  1. Prime: full PRD + full SDD.
  2. Test: every PRD acceptance criterion has a corresponding test (table in this task references each F# → test file path); every SDD ADR is implemented as documented (or has a recorded deviation in the spec README); every constitution L1 rule has a code or test enforcement; every "Won't have" item from the PRD has been verified absent (e.g. no MCP server starts, no HTTP listener binds, no telemetry call exists).
  3. Implement: a single `test/spec/compliance.test.ts` that snapshots: list of registered commands, list of audit log fields, list of bundled files, presence of the `register*` cleanups in main.ts. Snapshot prevents accidental drift.
  4. Validate: full gate.
  5. Success:
     - [x] PRD F1–F12 each map to ≥ 1 passing test `[ref: PRD]`
     - [x] SDD ADR-1..12 each verified or deviation-logged `[ref: SDD]`

  Outcomes (2026-05-01):
   - Defect A (T4.3) FIXED: ExportRunner.run pre-checks note existence before scope validation; the typed `errorCode: source-not-found` now flows through to the audit log instead of `unknown` for missing-source export-note rules. Live test (`test/live/export.live.test.ts`) updated.
   - Defect B (T4.5) DEFERRED to v0.2 with a Decisions Log entry in the spec README and a troubleshooting note in `README.md`. The `Export this note` command remains a registered no-op in v0.1 (safer than wrong-rule routing).
   - PRD/F2 wording reconciled to the canonical `source-not-found` ErrorCode (was `source-note-missing` in PRD draft); SDD acceptance criterion updated in step.
   - Compliance test: `test/spec/compliance.test.ts` (60 tests) — 7 sections covering registered commands, audit field allowlist, bundled files, register* discipline, F#→test mapping, ADR→impl mapping, and won't-have absences.

- [x] **T4.8 Phase 4 Validation & ship-ready check** `[activity: validate]`

  - Run the full pre-commit gate: `npm run typecheck && npm test && npm run lint && npm run build`.
  - Run `npm run test:live` (manually, requires Obsidian) — verify happy paths in the test vault.
  - Update `manifest.json` version from `0.0.0` to `0.1.0` (semantic-release will handle this in CI; this step is a sanity check that the local config is correct).
  - Update spec README phase: PLAN → completed; spec status: ready-for-implement.
  - Update plan README phases checklist to mark all phases complete.
  - Open a PR titled "Hakobi v0.1 implementation" referencing spec ID `001-v0-1` in the description.
