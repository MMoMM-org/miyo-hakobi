---
title: "Phase 2: Engine — Persistence, Scheduler, Runners"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Engine — Persistence, Scheduler, Runners

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View/Components]` — engine components and dependencies
- `[ref: SDD/Runtime View/Primary Flow]` — scheduler tick → runner → atomic write → audit sequence
- `[ref: SDD/Application Data Models; PluginData, DeviceState]`
- `[ref: SDD/Acceptance Criteria]` — EARS criteria for F1, F2, F3, F8, F9
- `[ref: PRD/F1]` — Import rule
- `[ref: PRD/F2]` — Export rule
- `[ref: PRD/F3]` — Per-rule scheduler
- `[ref: PRD/F8]` — Hybrid rule storage
- `[ref: PRD/F9]` — Default-deny scope enforcement (run-time half)

**Key Decisions**:
- ADR-3 (hybrid persistence — `data.json` rules + sibling `device.json` per-device flags + sibling `audit/`).
- ADR-9 (one `registerInterval` timer per enabled rule + in-memory `InFlightRegistry` for overlap-skip).
- ADR-6 (mtime preserve on export, not on import) — implemented in runners.
- ADR-8 (mtime-stable window for import pickup) — implemented in `ImportRunner`.

**Dependencies**:
- Phase 1 must be complete: T1.1 (sanitize), T1.2 (scope), T1.3 (ruleId), T1.4 (rule schema), T1.6 (audit entry), T1.7 (NodeFs), T1.8 (VaultIo), T1.9 (AtomicWriter), T1.10 (AuditLog).

---

## Tasks

This phase delivers the engine that takes rules and turns them into ferry actions. RuleStore + DeviceStore own persistence; Scheduler + InFlightRegistry own timing; Runners own per-tick execution. After this phase, the engine is fully functional and testable in isolation — the only thing missing is a UI to drive it.

- [x] **T2.1 RuleStore (`data.json` persistence)** `[activity: data-architecture] [parallel: true]`

  1. Prime: `[ref: SDD/ADR-3]`, `[ref: SDD/Data Storage Changes]`, `[ref: PRD/F8]`.
  2. Test: `load()` returns empty list on first run; rules round-trip through save/load; schema version mismatch triggers a migration hook (no actual migration needed at v1, but the seam exists); add/update/remove operations are immutable (return new state, do not mutate); rule validation runs on load (invalid persisted rules surface as errors, not silent corruption); credential-shaped strings are NOT persisted (smoke test: ensure no field looks like `password`/`token`/`apiKey`).
  3. Implement: `src/persistence/RuleStore.ts` — class wrapping `plugin.loadData()` / `plugin.saveData()`. Exposes `load()`, `save(rules)`, `add(rule)`, `update(id, partial)`, `remove(id)`, `getById(id)`, plus `loadGlobalSettings()` / `saveGlobalSettings(settings)`.
  4. Validate: lint + typecheck. Test ensures no fetch / network calls in this module.
  5. Success:
     - [ ] Rules persist in `data.json` only (Sync-replicated when user enables Sync) `[ref: PRD/F8]`
     - [ ] No credentials in `data.json` (asserted via field-name allowlist) `[ref: SDD/CON-2 / Constitution L2]`

- [x] **T2.2 DeviceStore (`device.json` per-device flags)** `[activity: data-architecture] [parallel: true]`

  1. Prime: `[ref: SDD/ADR-3]`, `[ref: PRD/F8]`.
  2. Test: First run generates a stable device UUID and persists it; rule enable flag defaults to `false` for newly Synced rules (rule exists in `RuleStore` but not yet in `device.json.ruleEnablement` → `enabledOnThisDevice` resolves to `false`); rule explicitly created on this device defaults to `true`; toggling enable persists; `device.json` is at `<pluginDataDir>/device.json` (NOT inside `data.json`); reading back works after save.
  3. Implement: `src/persistence/DeviceStore.ts` — class using `app.vault.adapter.read` / `write` / `exists` against `<pluginDataDir>/device.json`. Exposes `getDeviceId()`, `isEnabled(ruleId)`, `setEnabled(ruleId, enabled)`, `removeRule(ruleId)`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Newly Synced rule defaults to `enabledOnThisDevice: false` on this device `[ref: PRD/F8]`
     - [ ] `device.json` lives outside `data.json` (asserted via path) `[ref: SDD/ADR-3]`

- [x] **T2.3 InFlightRegistry** `[activity: domain-modeling] [parallel: true]`

  1. Prime: `[ref: SDD/ADR-9]`, `[ref: PRD/F3]`.
  2. Test: `tryAcquire(ruleId)` returns `true` on first call, `false` on second; `release(ruleId)` allows re-acquire; concurrent `tryAcquire` calls (simulated via interleaving) return `true` exactly once; size bounded only by enabled rule count.
  3. Implement: `src/scheduler/InFlightRegistry.ts` — `Map<RuleId, true>` wrapped in a minimal class. JS event loop guarantees `tryAcquire`/`release` are atomic; no Mutex needed.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Overlap-skip semantics match `[ref: PRD/F3]` AC: "If a rule's previous run is still in flight, the new tick is skipped."

- [x] **T2.4 Scheduler** `[activity: backend-api]`

  Depends on T2.1 (RuleStore), T2.2 (DeviceStore), T2.3 (InFlightRegistry).

  1. Prime: `[ref: SDD/ADR-9]`, `[ref: SDD/Runtime View]`, `[ref: PRD/F3]`.
  2. Test: `start()` creates one timer per enabled rule via `plugin.registerInterval`; `stop()` clears all timers (asserted by `Plugin._runCleanup()`); changing a rule's `everyMinutes` cancels and reschedules its timer; toggling `enabledOnThisDevice` adds/removes the timer; rule with previous run in-flight skips next tick and appends `decision: skipped, errorCode: overlap`; manual `runOnce(ruleId)` bypasses the scheduler but respects the in-flight registry; timers fire in test via `vi.useFakeTimers()`.
  3. Implement: `src/scheduler/Scheduler.ts` — class taking `(plugin, ruleStore, deviceStore, importRunner, exportRunner, statusBar, auditLog, inFlight)`. Exposes `start()`, `stop()`, `onRuleChanged(rule)`, `onRuleRemoved(ruleId)`, `runOnce(ruleId, { dryRun })`, `runAll(direction, { dryRun })`. Internally maintains `Map<RuleId, () => void>` of cancel functions returned by `registerInterval`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Plugin unload leaves zero active timers (asserted via `_runCleanup()`) `[ref: PRD/F3, SDD/Quality Requirements/Reliability]`
     - [ ] Reschedule on `everyMinutes` change without plugin restart `[ref: PRD/F3]`

- [x] **T2.5 ImportRunner** `[activity: backend-api]`

  Depends on T1.9 (AtomicWriter), T1.10 (AuditLog), T2.3 (InFlightRegistry).

  1. Prime: `[ref: SDD/Runtime View/Complex Logic; ImportRunner.run]`, `[ref: PRD/F1]`, `[ref: PRD/F4]`, `[ref: PRD/F9]`, `[ref: SDD/Acceptance Criteria/Main Flow Criteria; Import]`.
  2. Test: full happy path (single file recursive subtree → vault, with `flattenOnTarget: false`); `flattenOnTarget: true` collapses subfolders into destination root; `action: move` deletes source after destination write succeeds AND not before; `onCollision: skip` produces one `decision: skipped` entry; `onCollision: suffix` produces correctly-suffixed name; sanitization rejection produces `decision: rejected` entry; symlink rejection at root and at subdir; OS housekeeping skip; mtime-stability check (file modified within `stabilityCheckMs` is skipped on this tick); `dryRun: true` produces `would-write` decisions and writes nothing; source-not-found produces single rule-level failure; ENOSPC produces rule-level failure with `errorCode: disk-full`; mtime is NOT preserved on import (per ADR-6).
  3. Implement: `src/runner/ImportRunner.ts` — class with single `async run(rule: ImportRule): Promise<void>`. Composes Phase 1 modules. All side effects: AuditLog appends + (if not dryRun) FS/Vault writes.
  4. Validate: lint + typecheck. Coverage on the run-flow's branches.
  5. Success:
     - [ ] Every PRD/F1 acceptance criterion covered by tests `[ref: PRD/F1]`
     - [ ] Every PRD/F9 run-time criterion covered (symlink, scope, traversal) `[ref: PRD/F9]`
     - [ ] No half-files in destination on simulated mid-write crash `[ref: SDD/BR3]`

- [x] **T2.6 ExportRunner (folder/tag/note dispatch)** `[activity: backend-api]`

  Depends on T1.8 (VaultIo), T1.9 (AtomicWriter), T1.10 (AuditLog).

  1. Prime: `[ref: SDD/Runtime View/Complex Logic; ExportRunner sketch]`, `[ref: PRD/F2]`, `[ref: SDD/Acceptance Criteria/Main Flow Criteria; Export]`.
  2. Test: `sourceType: folder` enumerates vault subtree recursively; `sourceType: tag` selects via metadata cache with `tagMatch: any | all`; tag rule matches nested tags (`#projects` ⊇ `#projects/foo`, ADR-11); `sourceType: note` exports exactly that note or fails with `source-note-missing`; destination dir is created if parent exists, else `destination-parent-missing` fails the run; `flattenOnTarget` true/false behaves symmetrically with import; `action: move` deletes vault note via Vault API after FS write confirmed; mtime IS preserved on export (per ADR-6); dry-run produces `would-write` decisions.
  3. Implement: `src/runner/ExportRunner.ts` — class with `async run(rule: ExportRule): Promise<void>`. Internally dispatches on `rule.sourceType`.
  4. Validate: lint + typecheck. Coverage on each dispatch branch.
  5. Success:
     - [ ] Every PRD/F2 acceptance criterion covered `[ref: PRD/F2]`
     - [ ] Tag-rule recursion matches Obsidian's UI `[ref: SDD/ADR-11]`
     - [ ] mtime preserved on export only `[ref: SDD/ADR-6]`

- [x] **T2.7 Phase 2 Validation** `[activity: validate]`

  - Run `npm run typecheck && npm test && npm run lint && npm run build`.
  - Confirm `Plugin._runCleanup()` test passes (no leaked timers across the full Phase 2 surface).
  - Smoke-test the engine end-to-end via a wired-up integration test that constructs a `Scheduler` with stub Runners, fires fake timers, and asserts AuditLog entries (this is a unit-level smoke; full E2E is Phase 4).
  - Verify all engine modules import only from Phase 1 modules + Obsidian (no cross-engine import cycles).
