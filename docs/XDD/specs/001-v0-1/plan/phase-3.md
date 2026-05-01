---
title: "Phase 3: UI & Lifecycle Wiring"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: UI & Lifecycle Wiring

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` — IA, design system, interaction design
- `[ref: SDD/Cross-Cutting Concepts/UI Visualization Guide]` — ASCII wireframes for empty state and Import subtab
- `[ref: SDD/ADR-10]` — 3-subtab IA + inline rule editor + audit-log launch button
- `[ref: SDD/Acceptance Criteria/Status Bar Criteria, Audit Access Criteria, Command Palette Criteria]`
- `[ref: PRD/F6]` — Audit-log access (button)
- `[ref: PRD/F7]` — Command palette
- `[ref: PRD/F10]` — Status-bar indicator
- `[ref: PRD/F11]` — Per-file IO timeout (global setting; surfaced in General subtab)

**Key Decisions**:
- ADR-10 (3 subtabs + manifest-driven header + inline editor + audit-log launch button).
- ADR-9 (timer cleanup via `register*`) — main.ts wiring must respect this.
- Status-bar visual: kanji 運 with color states + hover tooltip (PRD F10 review decision).

**Dependencies**:
- Phase 2 must be complete: T2.1 (RuleStore), T2.2 (DeviceStore), T2.4 (Scheduler), T2.5 (ImportRunner), T2.6 (ExportRunner).

---

## Tasks

This phase delivers all user-visible surfaces and the `main.ts` lifecycle wiring that ties everything together. Subtab and editor tasks can run in parallel; the SettingsTab orchestrator and `main.ts` rewire come last.

- [x] **T3.1 Notices helper** `[activity: frontend-ui] [parallel: true]`

  1. Prime: `[ref: SDD/Cross-Cutting Concepts/User Interface & UX/Interaction Design]`.
  2. Test: `transient(message)` creates a Notice with default timeout; `persistent(message)` creates one with `timeout: 0`; `noActiveNote()` shows the canonical "No active note" message; `ruleAlreadyRunning(name)` shows the canonical "Rule already running" message.
  3. Implement: `src/ui/Notices.ts` — thin wrappers around Obsidian's `Notice`. Centralizes user-facing copy (Constitution L2 Code Quality / file-level intent comments).
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Notice text is centralized in this module (no inline `new Notice(...)` elsewhere — grep test) `[ref: SDD/Cross-Cutting Concepts]`

- [x] **T3.2 StatusBar** `[activity: frontend-ui] [parallel: true]`

  1. Prime: `[ref: PRD/F10]`, `[ref: SDD/UI Visualization Guide; status bar three states]`, `[ref: SDD/State machine]`.
  2. Test: render produces a single status-bar element containing kanji `運`; state transitions (idle → running → idle/failed → next-running → idle); color class changes per state (`mod-idle` / `mod-running` / `mod-failed` or equivalent token names); tooltip text matches the SDD examples; `aria-label` matches tooltip; click handler invokes `openSettings('general')`; failed state persists until next successful run OR user click.
  3. Implement: `src/ui/StatusBar.ts` — class taking `(plugin, openSettings)`. Wraps the result of `plugin.addStatusBarItem()`. Internal state machine with `setIdle(lastSummary?)`, `setRunning(ruleName)`, `setFailed(summary)`.
  4. Validate: lint + typecheck. Test asserts `aria-label` and tooltip match (no color-only signal).
  5. Success:
     - [ ] All F10 criteria covered by tests `[ref: PRD/F10]`
     - [ ] Click target = General subtab `[ref: PRD/F10 reviewed AC]`

- [x] **T3.3 CommandRegistry (7 commands)** `[activity: frontend-ui] [parallel: true]`

  Depends on T2.4 (Scheduler) for action wiring (test stubs OK in this phase).

  1. Prime: `[ref: PRD/F7]`, `[ref: SDD/Acceptance Criteria/Command Palette Criteria]`.
  2. Test: exactly 7 commands registered with IDs (no `Hakobi:` prefix in the registered ID; Obsidian adds it automatically): `run-import-all`, `run-import-select`, `run-export-all`, `run-export-select`, `export-this-note`, `run-import-dry-run-select`, `run-export-dry-run-select`; "select rule" command shows fuzzy suggester populated from RuleStore; "Export this note" with no active note shows Notice "No active note" and does not invoke the runner; "Run … select" with already-running rule shows Notice "Rule already running"; commands are disposed via `register*` on unload.
  3. Implement: `src/ui/CommandRegistry.ts` — class taking `(plugin, scheduler, ruleStore, vaultIo, notices)`. Method `registerAll()` is called once from `main.ts.onload`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] All 7 commands match `[ref: PRD/F7]` AC
     - [ ] No double-prefix in command name (review-time invariant from PRD note)

- [x] **T3.4 HeaderSection** `[activity: frontend-ui] [parallel: true]`

  1. Prime: `[ref: SDD/UI Visualization Guide; settings tab empty state]`, `manifest.json`, `[ref: SDD/ADR-10]`.
  2. Test: renders plugin name and tagline from `manifest.name` / `manifest.description`; renders `manifest.author` (mmomm.org) as a link; renders GitHub repo link (hardcoded `https://github.com/MMoMM-org/miyo-hakobi`); renders all `manifest.fundingUrl` entries as links (Buy Me a Coffee + GitHub Sponsors); links open in new tab/external browser (Obsidian default for `<a>` with `external-link` class); no link uses `innerHTML` (Obsidian plugin guideline).
  3. Implement: `src/settings/HeaderSection.ts` — class taking `(plugin, containerEl)`. Method `render()` populates `containerEl`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] All header text/URLs sourced from `manifest.json` (no hard-coded plugin name/tagline) `[ref: SDD/ADR-10]`

- [x] **T3.5 GeneralSubtab** `[activity: frontend-ui] [parallel: true]`

  Depends on T3.1 (Notices) and conceptually on T1.10 (AuditLog) for the "Show audit log" button wiring.

  1. Prime: `[ref: SDD/UI Visualization Guide; settings tab General empty state]`, `[ref: PRD/F6]`, `[ref: PRD/F11]`.
  2. Test: renders the four global settings (`perFileTimeoutMs`, `auditRetentionDays`, `auditMaxBytes`, `stabilityCheckMs`) as numeric inputs with current values; changing a value calls `RuleStore.saveGlobalSettings`; "Show audit log" button calls `app.openWithDefaultApp(currentMonthAuditPath)` (or Electron `shell.openPath` fallback) when the file exists; when file does not exist, shows Notice "No audit log entries yet" and does not attempt launch; "Purge audit log now" opens a confirm dialog (a tiny `Modal` subclass or `confirm()`-style); on confirm, calls `AuditLog.purgeAll()` and shows Notice "Audit log purged."
  3. Implement: `src/settings/subtabs/GeneralSubtab.ts` — class with `render(containerEl)`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] All F6 acceptance criteria covered `[ref: PRD/F6]`
     - [ ] Global IO timeout default is 10000 and persists `[ref: PRD/F11]`

- [x] **T3.6 ImportRuleEditor (inline)** `[activity: frontend-ui] [parallel: true]`

  Depends on T1.4 (rule schema), T1.5 (PathSafe), T1.2 (scope), T2.1 (RuleStore).

  1. Prime: `[ref: PRD/F1]`, `[ref: SDD/UI Visualization Guide; Import subtab]`.
  2. Test: renders all import-rule fields (name, source FS path with OS folder picker, vault destination with Obsidian folder suggester, `everyMinutes`, `action: copy | move`, `onCollision: skip | suffix`, `flattenOnTarget`, `dryRun`); save validates via `validateRule` and `scope.validateRuleAtSave` — invalid rules disable Save and show inline field errors; on save, calls `RuleStore.add(newRule)` and `DeviceStore.setEnabled(ruleId, true)`; cancel closes editor without persisting; OS folder picker is mockable (uses Electron `dialog.showOpenDialog` behind a single seam).
  3. Implement: `src/settings/editor/ImportRuleEditor.ts` — class with `renderForCreate(containerEl, onDone)` and `renderForEdit(containerEl, rule, onDone)`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Save-blocked-on-invalid invariant covered `[ref: PRD/F9 save-time]`
     - [ ] Loop / forbidden-path detection at save time `[ref: SDD/F9]`

- [x] **T3.7 ExportRuleEditor (inline)** `[activity: frontend-ui] [parallel: true]`

  Depends on T1.4, T1.5, T1.2, T2.1, T1.8 (VaultIo for tag/folder suggesters).

  1. Prime: `[ref: PRD/F2]`.
  2. Test: source-type radio (folder | tag | note); the picker below changes per radio (vault folder picker / tag picker / note picker); tag picker accepts multiple tags + `tagMatch: any | all` toggle; FS destination path input + OS folder picker; `flattenOnTarget` toggle visible for folder and tag types, hidden for note; same validation/save/cancel semantics as ImportRuleEditor.
  3. Implement: `src/settings/editor/ExportRuleEditor.ts` — class with same shape as ImportRuleEditor.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] All three source-type variants editable `[ref: PRD/F2]`
     - [ ] `flattenOnTarget` correctly hidden for `note` type `[ref: SDD/F2 AC]`

- [x] **T3.8 ImportSubtab** `[activity: frontend-ui]`

  Depends on T3.6 (ImportRuleEditor).

  1. Prime: `[ref: SDD/UI Visualization Guide; Import subtab one-rule example]`.
  2. Test: empty-state shows the description + single "+ Add import rule" button; clicking "Add" inserts the inline editor (T3.6) into the subtab body; rule list renders one compact row per rule with name, source → destination summary, schedule + action + collision + flatten badge, `[ ⋯ ]` overflow menu (Edit / Run now / Run dry-run / Delete), and per-device enable toggle; toggle calls `DeviceStore.setEnabled(ruleId, !current)`; "Run now" calls `Scheduler.runOnce(ruleId, { dryRun: false })`; "Delete" prompts confirm, then `RuleStore.remove(ruleId)` + `DeviceStore.removeRule(ruleId)`.
  3. Implement: `src/settings/subtabs/ImportSubtab.ts` — class with `render(containerEl)`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Empty state and populated list both covered `[ref: PRD/F1]`
     - [ ] Toggle / Run / Delete wired correctly `[ref: PRD/F8]`

- [x] **T3.9 ExportSubtab** `[activity: frontend-ui]`

  Depends on T3.7 (ExportRuleEditor).

  1. Prime: `[ref: PRD/F2]`.
  2. Test: same shape as ImportSubtab; rule rows show source-type-specific summary (folder path / tag list / note path); Run/Delete/Toggle behavior identical to import side.
  3. Implement: `src/settings/subtabs/ExportSubtab.ts`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Same coverage as Import side `[ref: PRD/F2]`

- [x] **T3.10 SettingsTab orchestrator** `[activity: frontend-ui]`

  Depends on T3.4 (HeaderSection), T3.5 (GeneralSubtab), T3.8 (ImportSubtab), T3.9 (ExportSubtab).

  1. Prime: `[ref: SDD/ADR-10]`, `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]`.
  2. Test: `display()` clears the container and renders header + subtab row + active-subtab body; subtab row has 3 buttons (General / Import / Export) with `mod-cta` on the active one; clicking another subtab swaps the body content without re-rendering the header; `display(initialSubtab)` accepts an initial subtab argument so status-bar click can deep-link to General; subtab swap render time stays under 50 ms (asserted as a perf budget test against simple synthetic rule lists).
  3. Implement: `src/settings/SettingsTab.ts` — replaces the current placeholder. Class extends `PluginSettingTab`.
  4. Validate: lint + typecheck. The existing `test/__mocks__/obsidian.ts` covers everything needed.
  5. Success:
     - [ ] 3 subtabs + manifest-driven header `[ref: SDD/ADR-10]`
     - [ ] Subtab swap under 50ms perf budget `[ref: SDD/Quality Requirements/Performance]`

- [x] **T3.11 main.ts rewire (HakobiPlugin lifecycle)** `[activity: backend-api]`

  Depends on every prior task in Phases 1–3.

  1. Prime: existing `src/main.ts`, `src/CLAUDE.md` (lifecycle rules), `[ref: SDD/Building Block View/Components]`.
  2. Test: `onload()` instantiates RuleStore, DeviceStore, AuditLog (with Rotation), Scheduler (with InFlight), ImportRunner, ExportRunner, StatusBar, CommandRegistry, SettingsTab; calls Scheduler.start; `onunload()` calls Scheduler.stop and any explicit teardown; `Plugin._runCleanup()` confirms zero leaked timers and zero leaked DOM listeners; rename class `MyPlugin` → `HakobiPlugin`; manifest unchanged (id + isDesktopOnly preserved).
  3. Implement: rewrite `src/main.ts`. Update `src/types/index.ts` to re-export the domain types (Rule, AuditEntry, GlobalSettings, DeviceState, RuleId).
  4. Validate: lint + typecheck. `npm run build` produces a single bundle ≤ 100 KB minified.
  5. Success:
     - [x] Lifecycle clean (no leaks) `[ref: SDD/Quality Requirements/Reliability]`
     - [x] All wiring follows downward-only dependency direction `[ref: SDD/ADR-1]`

- [x] **T3.12 Phase 3 Validation** `[activity: validate]`

  - Run `npm run typecheck && npm test && npm run lint && npm run build`.
  - Bundle size check: `ls -la build/main.js` ≤ 100 KB.
  - Verify `addCommand` calls do not double-prefix `Hakobi:`.
  - Manual smoke (optional, requires `npm run dev` + the test vault `test/Hakobi/`): create one import rule, observe a tick, verify status bar transitions, click "Show audit log" and confirm the NDJSON file opens.
