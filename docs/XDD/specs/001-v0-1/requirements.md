---
title: "Hakobi v0.1 — Scheduled File Ferry"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (Kokoro ADR-013 charter, MiYo Constitution L1/L2 rules, owner workflow audit)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events (or explicit "no telemetry" justification)
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Output Schema

### PRD Status Report

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| sections | SectionStatus[] | Yes | Status of each PRD section |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |
| acceptanceCriteria | number | Yes | Total testable acceptance criteria defined |
| openQuestions | string[] | No | Unresolved items requiring stakeholder input |

### SectionStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Section name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| detail | string | No | What clarification is needed or what's in progress |

---

## Product Overview

### Vision
Make ferrying files between local filesystem locations and the Obsidian vault feel as automatic and trustworthy as Obsidian Sync — without inviting any of the same trade-offs (no cloud APIs, no daemon, no telemetry, no inbound surface).

### Problem Statement
Vault owners regularly capture material outside the vault (voice memos, screenshots, downloads, scratch notes from other apps) and offload material from the vault (folders to backup paths, tag-based collections, single-note shares). Today they do this manually — drag-and-drop, ad-hoc shell scripts, third-party sync tools, or one-off Hazel/Keyboard Maestro recipes. The manual approach costs daily attention; the scripted approach drifts and fails silently. Existing Obsidian plugins either focus on inside-vault operations only, or pull cloud-service APIs (Dropbox HTTP, Google Drive REST) that conflict with MiYo's local-first / no-network charter (MiYo Constitution L1 Privacy & Security). Concretely: the project owner currently spends ~10–15 minutes per day moving capture material into the vault inbox, with no audit trail of what landed where.

### Value Proposition
Hakobi gives the vault owner a small set of named import/export rules with simple `everyMinutes` schedules. Rule creation is the only approval moment; after that, ferrying happens silently, audit-logged with metadata-only entries, and within strict default-deny boundaries. No cloud-service APIs, no telemetry, no inbound surface — just the user's own filesystem and their vault. The user gains confidence (full audit trail), reclaimed time (no manual drag-and-drop), and a single tool that handles both directions.

## User Personas

### Primary Persona: Vault Owner
- **Demographics:** Technically comfortable, runs Obsidian on macOS desktop primarily (Linux secondary, Windows tertiary), 25–55, works in roles where personal knowledge management matters (researcher, software/creative professional, consultant, clinician, lawyer). Comfortable editing JSON-ish settings if needed but expects a settings UI for routine work. Privacy-conscious — the MiYo audience self-selects for this.
- **Goals:** Reliable, low-friction ingestion of captured material into the vault inbox; confident export of selected vault content to external local paths; full visibility into what was moved when; absolute confidence that nothing is being sent off-machine.
- **Pain Points:** Manual drag-and-drop is forgettable; ad-hoc shell scripts drift and lack audit trails; cloud-API plugins violate the local-first contract; existing tools blend "import" and "sync" semantics in ways that risk content loss; scheduled tools without per-device control fire from every device when the user has Obsidian Sync enabled, causing conflict storms in shared destinations.

### Secondary Personas
None in v0.1. Hakobi is single-operator. No multi-user, shared-vault, or admin-vs-user role separation exists in the MiYo system at this stage.

## User Journey Maps

### Primary User Journey: Configuring and operating an import rule
1. **Awareness:** User notices their voice-memo / screenshot / scratch folder is filling up and they keep manually dragging files into their vault inbox.
2. **Consideration:** Evaluates Hazel rules, shell scripts, third-party sync apps, and other Obsidian plugins. Picks Hakobi because (a) it's local-first and audited, (b) Obsidian-native UX, (c) no API token setup, (d) no daemon to manage.
3. **Adoption:** Installs Hakobi from Community Plugins, opens Settings → Hakobi, reads the empty-state intro, clicks "Add import rule".
4. **Usage:** Names the rule "Voice memos", picks the source FS folder, picks the destination vault folder, sets `every 15 minutes`, picks `action: copy`, optionally enables dry-run for the first day, saves. From now on, files appear in the inbox automatically. Failures surface via status bar + audit log.
5. **Retention:** User adds more rules over time; trust grows because every action is audit-logged with metadata-only entries.

### Secondary User Journey: Exporting selected vault content
1. **Awareness:** User wants to make a vault folder ("Public/") visible to a partner via a shared cloud-synced folder, or wants to export tagged research notes to a backup location nightly.
2. **Consideration:** Same alternatives, same reasoning as above.
3. **Adoption:** Opens Hakobi settings, clicks "Add export rule".
4. **Usage:** Names the rule, chooses folder/tag/note source, picks destination FS path, schedule, `action: copy | move`, collision policy. Optionally invokes "Hakobi: Export this note" via command palette to force a one-shot export of the active note via that rule.
5. **Retention:** Audit log + status bar make failures discoverable; `move` action with clear audit trail builds trust; per-device enable flag prevents Sync-induced conflict storms.

## Feature Requirements

### Must Have Features

#### F1: Import rule (FS → vault)
- **User Story:** As a vault owner, I want to define a named import rule that ferries files from a local FS folder (and its subfolders) into a vault folder on a schedule, so that captured material reaches my inbox without manual copying.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a valid import rule (name, source FS path, vault destination, `everyMinutes ≥ 1`, `action: copy | move`, `onCollision: skip | suffix`, `flattenOnTarget: true | false`, `enabledOnThisDevice: true`), When the scheduler tick fires, Then every regular file recursively under the source subtree that is not a symlink and is not a stalled cloud-sync placeholder is transferred to the destination vault folder via the Vault API with a sanitized filename.
  - [ ] Given an import rule with `flattenOnTarget: true`, When a file deep in the source subtree is transferred, Then the file is written directly into the destination vault folder root (subfolder hierarchy collapsed); collisions follow `onCollision`.
  - [ ] Given an import rule with `flattenOnTarget: false`, When a file deep in the source subtree is transferred, Then the source-relative subfolder path is mirrored under the destination vault folder; missing intermediate vault folders are created via the Vault API.
  - [ ] Given an import rule with `action: move`, When a file is successfully transferred, Then the source file is deleted only after the destination write is confirmed (atomic write-temp-then-rename, then source delete). Empty source subdirectories left after a `move` run are NOT removed in v0.1.
  - [ ] Given an import rule with `onCollision: skip`, When the destination already contains a file with the same sanitized name (and same target subpath if `flattenOnTarget: false`), Then the file is skipped and exactly one audit entry per skip is recorded.
  - [ ] Given an import rule with `onCollision: suffix`, When the destination already contains a file with the same sanitized name, Then the new file is written as `name-1.ext`, `name-2.ext`, etc. with the lowest available numeric suffix.
  - [ ] Given an import rule whose source path does not exist or is not readable at run time, Then the run is recorded as a single rule-level failure entry; no per-file entries are emitted; the scheduler continues firing future ticks.
  - [ ] Given an import rule with `enabledOnThisDevice: false`, When a scheduler tick would have fired, Then no work happens and no audit entry is written for that tick.
  - [ ] Given an import rule with `dryRun: true`, When a tick fires, Then the audit log records `would-write` / `would-skip` / `would-suffix` decisions, but no file is created, modified, or deleted.

#### F2: Export rule (vault → FS)
- **User Story:** As a vault owner, I want to define a named export rule that pushes a vault folder (recursively), a tag-selected note set, or a single note to an external local FS path on a schedule, so that I can ferry selected vault content to backup, sharing, or sync locations.
- **Acceptance Criteria:**
  - [ ] Given a valid export rule (name, source-selector of exactly one type — folder / tag / note —, destination FS path, `everyMinutes ≥ 1`, `action: copy | move`, `onCollision: skip | suffix`, `flattenOnTarget: true | false`, `enabledOnThisDevice: true`), When the scheduler tick fires, Then every matching note is read via the Vault API and written to the destination FS path via raw `fs`, using atomic write-temp-then-rename.
  - [ ] Given an export rule of type `folder`, When the source folder is enumerated, Then files are selected from the declared vault subtree recursively; symlinks (if Obsidian reports any) are refused.
  - [ ] Given an export rule with `flattenOnTarget: true`, When a note from a nested vault subfolder is exported, Then it is written directly into the destination FS path root (vault subfolder structure collapsed); collisions follow `onCollision`.
  - [ ] Given an export rule with `flattenOnTarget: false`, When a note from a nested vault subfolder is exported, Then the source-relative subfolder path is mirrored under the destination FS path; missing intermediate FS directories are created with default OS permissions.
  - [ ] Given an export rule of type `tag`, When the rule fires, Then notes are selected via Obsidian's metadata cache; the `tagMatch: any | all` flag controls union vs intersection when multiple tags are listed; with `flattenOnTarget: false`, the destination subpath mirrors the note's vault path.
  - [ ] Given an export rule of type `note`, When the rule fires, Then exactly the configured note path is exported if it still exists; otherwise the run is recorded as a rule-level failure with `reason: source-note-missing`. (`flattenOnTarget` is irrelevant for single-note rules.)
  - [ ] Given any export rule, When the destination directory does not exist but its parent does, Then it is created with default OS permissions; if the parent does not exist, the run fails with `reason: destination-parent-missing`.
  - [ ] Given an export rule with `action: move`, When a note is successfully exported, Then the source note is deleted from the vault (via Vault API) only after the destination write is confirmed.
  - [ ] Same dry-run, collision, and per-device-enable behavior as F1.

#### F3: Per-rule scheduler
- **User Story:** As a vault owner, I want each rule to run automatically every N minutes while Obsidian is open, so that I don't have to remember to trigger transfers.
- **Acceptance Criteria:**
  - [ ] Given a rule with `everyMinutes: N` and `enabledOnThisDevice: true`, When Obsidian is open and the plugin is loaded, Then the rule fires every N minutes using a timer registered for cleanup on plugin unload.
  - [ ] Given the plugin is unloaded (Obsidian quit, plugin disabled, vault closed), When unload completes, Then no scheduler timer remains active.
  - [ ] Given a rule whose `everyMinutes` is changed in settings, When the change is saved, Then the existing timer is cancelled and a new timer is started without restarting Obsidian.
  - [ ] Given a rule whose previous run is still in flight when its next tick fires, Then the new tick is skipped (not queued) and an audit entry with `decision: skipped, reason: overlap` is appended.
  - [ ] Given the user's machine has been asleep or Obsidian was closed for hours, When Obsidian reopens, Then no missed ticks are made up; the next regularly scheduled tick fires normally.

#### F4: Filename sanitization on import
- **User Story:** As a vault owner, I want imported filenames sanitized before they enter my vault, so that exotic OS filenames don't break my vault paths or expose path-traversal risks.
- **Acceptance Criteria:**
  - [ ] Given an incoming filename, When sanitization runs, Then it is reduced to basename only; control chars (0x00–0x1F, 0x7F) are stripped; NUL bytes reject the file outright; `..`, `/`, `\` are stripped (basename only); Obsidian-invalid characters (`*` `"` `\` `/` `<` `>` `:` `|` `?`) are replaced with `_` so the file lands with a vault-legal name; leading/trailing dots and spaces are trimmed; OS-reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive) are renamed by suffixing `-file`; segment length is capped at 255 UTF-8 bytes; total path length is capped at 1024 bytes.
  - [ ] Given a sanitization rejection (NUL byte, attempted path traversal), Then the file is not transferred and an audit entry with `decision: rejected, reason: sanitization` is recorded.
  - [ ] Given a sanitized name that collides with an existing destination file, Then the rule's `onCollision` policy applies.

#### F5: NDJSON audit log (metadata-only)
- **User Story:** As a vault owner, I want a complete metadata-only audit log of every run, so that I can verify the ferry is doing what I expect and diagnose failures.
- **Acceptance Criteria:**
  - [ ] Given any rule run, When it executes, Then exactly one rule-level audit entry per run plus zero or more per-file entries are appended to the audit log as NDJSON.
  - [ ] Given any audit entry, Then the only allowed fields are: `timestamp`, `ruleId`, `ruleName`, `direction` (`import|export`), `operation` (`copy|move|skip|suffix|rejected|error|would-write|would-skip|would-suffix|skipped`), `sourcePathRelative` (relative to the rule's source root), `destinationPathRelative` (relative to the rule's destination root), `decision`, `errorCode` (closed enum, never raw exception strings), `bytesTransferred` (number, never bytes themselves), `durationMs`. **Forbidden:** file bytes, frontmatter values, absolute home-directory paths, full vault-root paths.
  - [ ] Given the audit log file location, Then it lives in the plugin data directory (NOT inside the vault, NOT replicated by Obsidian Sync) at `<pluginDataDir>/audit/YYYY-MM.ndjson`, rotated monthly.
  - [ ] Given an audit log file that exceeds 10 MB OR is older than 90 days, When the next rotation check runs, Then the file is rotated/purged according to the configured retention policy (defaults: 10 MB size cap, 90 day age cap, both user-overridable).
  - [ ] Given the user clicks "Purge audit log now" in settings, Then all NDJSON files under `<pluginDataDir>/audit/` are deleted; one final entry is written to a fresh log file confirming the purge.

#### F6: Audit-log access (button on General subtab)
- **User Story:** As a vault owner, I want to open the audit log file in my OS default app from inside Hakobi's settings, so that I can inspect recent runs with whatever tool I prefer (text editor, grep, jq).
- **Acceptance Criteria:**
  - [ ] Given the General subtab is open, Then a "Show audit log" button is visible.
  - [ ] Given the user clicks "Show audit log" and the current month's NDJSON file exists, Then Hakobi launches that file in the OS default app for `.ndjson`.
  - [ ] Given the user clicks "Show audit log" but no audit log file has been created yet, Then a Notice "No audit log entries yet" appears and no launch is attempted.
  - [ ] Given the user clicks "Purge audit log now", Then a confirm dialog requires explicit acknowledgment before purge proceeds; on confirm, all NDJSON files under `<pluginDataDir>/audit/` are deleted and a single new entry is written confirming the purge.
  - [ ] Given v0.1, Then there is no in-tab audit-log viewer, no pagination UI, no filter bar — file inspection is delegated to the OS default app.

#### F7: Command-palette commands
- **User Story:** As a vault owner, I want command-palette commands for triggering and running rules manually, so that I can force a transfer without waiting for the next tick.
- **Acceptance Criteria:**
  - [ ] Given the plugin is loaded, Then exactly these commands are registered: `Run import (all rules)`, `Run import (select rule)`, `Run export (all rules)`, `Run export (select rule)`, `Export this note`, `Run import (dry run, select rule)`, `Run export (dry run, select rule)`. (Obsidian prefixes registered commands with the plugin name automatically; the `Hakobi:` prefix must NOT be added in code.)
  - [ ] Given the user invokes `Run import/export (select rule)`, Then a fuzzy-suggest list of import/export rule names is presented; selecting one runs that rule once immediately.
  - [ ] Given the user invokes `Export this note` while a note is active in the editor, Then a fuzzy-suggest list of export rules is presented; selecting one exports the active note via that rule's destination + collision policy. If no note is active, a Notice "No active note" appears and no command is run.
  - [ ] Given the user invokes any "Run …" command while the same rule is already in flight, Then the command is no-op'd and a Notice "Rule already running" appears.

#### F8: Rule storage (hybrid)
- **User Story:** As a vault owner with multiple devices, I want my rules to be portable across devices via Obsidian Sync, but I want each device to independently control whether it runs them, so that I don't have conflict storms when multiple devices fire the same export to a shared cloud-synced destination.
- **Acceptance Criteria:**
  - [ ] Given the user creates a rule, Then the rule definition is persisted to `data.json` (replicated by Obsidian Sync if the user has Sync enabled for plugin settings).
  - [ ] Given any rule, Then a per-device `enabledOnThisDevice` flag is stored in a sibling file `<pluginDataDir>/device.json` (NOT replicated by Obsidian Sync).
  - [ ] Given a newly Synced rule that did not originate on this device, Then `enabledOnThisDevice` defaults to `false`; the user must explicitly enable it on this device for it to run.
  - [ ] Given the user toggles `enabledOnThisDevice` for a rule, Then the change is per-device-only and never propagates via Sync.
  - [ ] Given multiple devices have `enabledOnThisDevice: true` for the same rule, Then Hakobi does NOT detect, coordinate, or warn about this — multi-device enablement is the user's explicit responsibility. No cross-device locking, leader-election, or last-writer-wins logic exists in v0.1; the user is expected to enable each rule on exactly one device unless they specifically want concurrent runs.
  - [ ] Given v0.1, Then no credentials of any kind are stored in `data.json` or anywhere else, because v0.1 has no remote services. (This invariant must survive into future versions per Constitution L2.)

#### F9: Default-deny scope enforcement
- **User Story:** As a vault owner, I want strong default-deny boundaries so that a rule cannot accidentally read or write outside its declared subtree, so that I never have to worry about a runaway rule.
- **Acceptance Criteria:**
  - [ ] Given a rule with declared source root S and destination root D, When the rule fires, Then no read happens from a real path that is not strictly under S (after symlink resolution); no write happens to a real path that is not strictly under D.
  - [ ] Given a rule definition where the source root is inside the vault AND the destination root is inside the vault, When the user attempts to save, Then save is refused with a validation error explaining the loop risk.
  - [ ] Given a rule definition where source or destination resolves to the vault root, `.obsidian/`, or the plugin's own data directory, When the user attempts to save, Then save is refused.
  - [ ] Given a rule whose source root or any resolved path inside it is a symlink, When the rule fires, Then symlink files are refused with `decision: rejected, reason: symlink`.
  - [ ] Given a per-file IO operation that does not complete within the rule's `perFileTimeoutMs` (default 10000), Then the file is skipped with `decision: skipped, reason: io-timeout`.
  - [ ] Given any path manipulation, Then absolute paths and `..` segments in filenames are rejected (path-traversal defence).

#### F10: Status-bar indicator
- **User Story:** As a vault owner, I want a small status-bar indicator showing what Hakobi is doing, so that I notice failures without intrusive notices.
- **Acceptance Criteria:**
  - [ ] Given the plugin is loaded, Then the status bar shows the Hakobi kanji (運) as a single glyph, color-coded for state: neutral (idle), accent color (running), error color (last run failed). No text labels in the status-bar item itself — colors carry state.
  - [ ] Given the user hovers the status-bar item, Then a tooltip appears containing readable detail: state name, name of the rule currently running (if any), timestamp of the last run, and a one-line summary of the last outcome ("4 files imported" / "2 of 4 files imported, see audit log" / etc.). The tooltip is the only place state is written in words.
  - [ ] Given the user clicks the status-bar item, Then the Hakobi settings tab opens on the General subtab (where the "Show audit log" button lives).
  - [ ] Given a rule run completes with failure, Then the status-bar item turns the error color and remains in that state until the user clicks the status bar OR the next successful run completes.
  - [ ] Given accessibility, Then the status-bar item has an `aria-label` with the same text content as the tooltip, so screen-reader users get state without relying on color.

### Should Have Features

#### F11: Configurable per-file IO timeout (global)
- **User Story:** As a vault owner, I want to configure a single per-file IO timeout that applies to all rules, so that I can accommodate slow external paths (NAS, large placeholder files) without per-rule fiddling.
- **Acceptance Criteria:**
  - [ ] Given the General settings tab, Then a single global setting `perFileTimeoutMs` is exposed with default 10000.
  - [ ] Given an absent or invalid `perFileTimeoutMs`, Then the default 10000 is used.
  - [ ] Given any rule run, Then the same global timeout applies to every per-file IO operation (read or write); no per-rule override exists in v0.1.

### Could Have Features

#### F12: File-menu integration
- Right-click on a note in the file explorer → "Export via rule…". Same effect as the `Export this note` command. Convenience only — defer if it costs measurable schedule.

### Won't Have (This Phase)
- External network surface, ports, MCP server, inbound HTTP listener, IPC.
- Native cloud-service APIs (Dropbox HTTP, Google Drive REST, S3, SFTP, WebDAV). Only mounted local FS paths.
- Mobile support — `isDesktopOnly: true`.
- Per-execution approval prompts. Rule creation is the approval.
- LLM / AI client integration of any kind, even passively.
- Coupling to other MiYo components (Tomo, Hashi, Kado, Seigyo). Hakobi is self-contained in v0.1.
- Daemon / system-service mode. Runs only while Obsidian is open.
- Cron-like schedule expressions. Only `everyMinutes`.
- Make-up runs for missed ticks while Obsidian was closed.
- Forced materialization of cloud-sync placeholders. Stalled placeholders are always skipped + logged in v0.1.
- Telemetry, analytics, crash reporting to third parties, version-update pings.
- Ferry of files into or out of `_inbox/` / `_outbox/` development handoff folders. Those are gitignored Claude-coordination buffers, never user runtime data.
- Custom side-panel views or leaves. Audit log lives inside the General settings tab.

## Detailed Feature Specifications

### Feature: Import Rule (F1) — most complex must-have

**Description:** A named, scheduled rule that copies (or moves) files from a declared local filesystem source folder, recursively across its subfolders, into a declared vault folder. Per-rule `flattenOnTarget` controls whether subfolder structure is mirrored on the vault side or collapsed to the destination root. Per-file behavior is governed by the rule's collision policy, dry-run flag, and per-device enable flag. Vault writes go through Obsidian's Vault API; FS reads go through Node `fs`.

**User Flow:**
1. User opens Settings → Hakobi → Add import rule.
2. User fills name, source FS path (OS folder picker, with text fallback), vault destination (Obsidian folder picker), `everyMinutes`, `action: copy | move`, `onCollision: skip | suffix`, `flattenOnTarget: true | false`, optional `dryRun`.
3. System validates: source path syntactically valid; vault destination exists; source root not inside vault; destination not equal to vault root, `.obsidian/`, or plugin data dir; `everyMinutes ≥ 1`.
4. User saves; system persists rule to `data.json`, sets `enabledOnThisDevice: true` in `device.json` for the device the user just used to create the rule, starts the timer.
5. At each tick, the scheduler walks the source subtree recursively, sanitizes filenames, checks symlinks (refuse), checks placeholders (skip + log on global timeout F11), computes destination subpath per `flattenOnTarget`, creates intermediate vault folders if needed, applies collision policy, performs atomic temp-then-rename, deletes source if `move`, appends audit entries.

**Business Rules:**
- BR1: Symlinks are refused at any level — for the rule's source root, for any subfolder reached by recursion, and for individual files.
- BR2: Cloud-sync placeholders are skipped after the global `perFileTimeoutMs` (F11); never force-materialized in v0.1.
- BR3: Atomic write — temp file in destination directory, then rename; source-delete (if `move`) happens only after rename succeeds.
- BR4: If a previous run of the same rule is still in flight, the new tick is skipped; no queueing in v0.1.
- BR5: `enabledOnThisDevice: false` means the rule is invisible to the scheduler and the audit log on this device.
- BR6: A rule's per-tick output is "all, some, or none" of the source files — there is no partial-file write thanks to atomic rename.
- BR7: Recursion descends into all non-symlink subdirectories of the source root; depth is unbounded in v0.1 but bounded by the path-length cap in F4.
- BR8: With `flattenOnTarget: false`, intermediate vault folders are created on demand via the Vault API; with `flattenOnTarget: true`, no intermediate folders are created and all files land in the destination root.
- BR9: With `action: move`, empty source subdirectories left after the run are NOT removed in v0.1 — only files are moved; tree pruning is post-v0.1.

**Edge Cases:**
- Source path missing at run time → rule-level failure entry; no per-file entries; scheduler continues.
- Destination unwritable (read-only mount, permissions) → rule-level failure; atomic rename ensures no orphan files.
- Source file modified during read → snapshot taken at read-start; if size mismatch detected at read-end, file is skipped with `decision: skipped, reason: source-modified`.
- Two rules sharing the same source root → allowed; documented as user's responsibility; both run independently.
- Source becomes a symlink between rule creation and run time → run-time check refuses the entire rule with `reason: source-is-symlink`.
- A subdirectory inside the source subtree is a symlink → that subdirectory's contents are skipped; one audit entry per skipped subdirectory; rule continues with siblings.
- Disk full on destination → write fails; temp file cleaned up; rule-level failure; user notified via status bar transitioning to error color.
- File appears mid-tick (race with sync agent) → snapshot at tick-start; new files picked up next tick.
- File disappears mid-tick (race with sync agent) → ENOENT tolerated per file; entry skipped with `decision: skipped, reason: source-vanished`; rule continues.
- Filename contains characters Obsidian rejects → sanitization handles; if reduced name is empty (e.g. all-control-chars), rejected with `reason: sanitization-empty`.
- Filename is `.DS_Store`, `Thumbs.db`, or another OS housekeeping file → rejected with `reason: housekeeping-file` (closed allowlist of OS-housekeeping names skipped by default).
- With `flattenOnTarget: true`, two source files with the same basename in different subfolders → second file collides; `onCollision` policy decides skip vs suffix; never overwrite.
- With `flattenOnTarget: false`, target subfolder name itself collides with an existing vault note (rare — same name as both folder and note) → run-level failure for that subtree with `reason: destination-name-conflicts-note`; rule continues with sibling subtrees.

## Success Metrics

### Key Performance Indicators

Hakobi is a free, local-first, no-telemetry OSS plugin. "Success" is measured by user-reported and observable proxies, never via in-app analytics. The MiYo Constitution L1 forbids telemetry — this is a non-negotiable, not a target to relax later.

- **Adoption (proxy):** Community plugin install count and GitHub star count, tracked manually by maintainer over 6-month windows. Target: ≥500 installs within 6 months of first release.
- **Engagement (proxy):** Issue-tracker ratio of "feature request" vs "bug report" issues — feature requests indicate active engaged use. Target: ≥1.5× feature-requests:bug-reports ratio in months 3–6.
- **Quality:** Project-owner dogfooding metric — fraction of audit-log entries with `decision: error` in the maintainer's daily use, target <1% of total entries over a 30-day window. External user issue-time-to-first-failure-report tracked via GitHub issues; target: median ≥7 days from install.
- **Business Impact:** Not applicable — Hakobi is non-commercial. The "business impact" target is reduced friction in the MiYo project owner's daily PKM workflow, measured subjectively (project-owner self-report) and via the project owner's own audit log entry volume (proxy for "rules are doing useful work").

### Tracking Requirements

Hakobi does **not** track or transmit any user actions externally. The audit log is the only "tracking" Hakobi does; it is local, metadata-only, and visible to the user. **No analytics events. No telemetry events. No remote events of any kind.**

| Event | Properties | Purpose |
|-------|------------|---------|
| Rule run start | timestamp, ruleId, ruleName, direction | Local audit / user diagnosis only |
| Rule run end | timestamp, ruleId, durationMs, success/failure, fileCount | Local audit / user diagnosis only |
| Per-file decision | timestamp, ruleId, sourcePathRelative, destinationPathRelative, operation, decision, errorCode, bytesTransferred | Local audit / user diagnosis only |
| Audit log purge | timestamp, decision: purged-by-user | Local audit (post-purge marker) |

---

## Constraints and Assumptions

### Constraints
- **Local-first (Constitution L1 Privacy & Security):** No telemetry, no analytics, no third-party crash reporting, no background network calls, no version-update pings.
- **Default-deny (Constitution L1 Privacy & Security):** Nothing happens to any file unless an explicit user-created rule covers it; rule existence does not grant any access beyond the declared subtree.
- **Metadata-only audit (Constitution L2 Privacy & Security):** Audit logs may not contain file content, frontmatter values, full home-directory absolute paths, or anything else beyond the closed field allowlist in F5.
- **No credentials in `data.json` (Constitution L2 Privacy & Security):** v0.1 has no credentials at all; this rule must survive into future versions.
- **Desktop-only (manifest):** `isDesktopOnly: true`; mobile out of scope.
- **No coupling to other MiYo components in v0.1:** Hakobi must function with no MiYo siblings present.
- **Kado is the only inbound vault surface in MiYo (Constitution L1 Architecture):** Hakobi has no inbound surface at all in v0.1; any future inbound surface in v0.2+ must route through Kado, not its own gateway.
- **Vault I/O via Vault API (Constitution L2 Performance):** Vault reads and writes use Obsidian's Vault API and metadata cache, not raw `fs`. Raw `fs` is reserved for paths outside the vault.
- **Performance L1 Performance:** Long-running work (file scans, transfers) must not block Obsidian's main UI thread; transfers must be batched/deferred so typing latency is not affected.
- **Bounded responses (Constitution L1 Performance):** Audit-log viewer is paginated (page size 50); never returns unbounded results.
- **English-only code and documentation (MiYo standards):** Code, comments, and docs in English; UI strings may be localized later.

### Assumptions
- The vault owner is the only operator. No multi-user, multi-permission, or admin-vs-user separation exists.
- The user's machine has Node `fs` available (true on all desktop Obsidian builds).
- The user's external paths are mounted local FS paths. Cloud-sync folders mounted as local paths are in scope; native cloud REST APIs are out of scope.
- The user understands that rules created on one device do not auto-run on other devices (per-device enable flag is intentional and surfaced in UI copy).
- Obsidian's plugin lifecycle hooks (`onload` / `onunload`) reliably fire and complete in reasonable time; timers registered via Obsidian's lifecycle helpers are cleaned up on unload.
- The user will not store credentials or other secrets inside file *names* (filenames may legitimately contain client / project codes, which the audit log will record as path components — acceptable per metadata scope).
- The user's clock is approximately accurate; audit-log timestamps are wall-clock, not monotonic.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| User exports sensitive vault folder to cloud-synced path, exposing it externally | High | Medium | Destination paths shown plainly in the rule list; PRIVACY.md documents that the user's choice of destination = the user's trust decision; per-device enable flag (F8) limits accidental multi-device firing |
| User creates vault → vault loop accidentally | High | Low | Hard-reject at rule save time (F9); explicit forbid-list (vault root, `.obsidian/`, plugin data dir) |
| Audit log grows unbounded and bloats plugin data dir | Medium | High | Monthly file rotation + 10 MB / 90 day defaults + manual purge button (F5) |
| Other Obsidian plugins read Hakobi's audit log | Low | High (this is the Obsidian model) | Audit log is metadata-only by design (F5); PRIVACY.md documents cross-plugin readability; no credentials anywhere in v0.1 |
| Sync replicates rules and the same rule fires on every device, causing conflict storms | High | High (without mitigation) | Per-device `enabledOnThisDevice` flag in sibling file (F8); newly Synced rules default to `false` per device; Hakobi explicitly does not coordinate multi-device enablement — that's the user's responsibility |
| Cloud-sync placeholder file stalls a rule run | Medium | Medium | Global per-file IO timeout (default 10s, F11); skip + log; never force-materialize |
| Path traversal via malicious filename (`../../.obsidian/...`) | High | Low (requires user-controlled untrusted source) | Filename sanitization pipeline (F4); basename-only; symlink refusal |
| Plugin unload leaves a timer alive ("daemon-by-accident") | High | Low | All timers registered via Obsidian's lifecycle helpers; PLAN must include a test asserting no timers remain after unload |
| Race between mid-copy source modification and read | Medium | Medium | Snapshot at read-start; size mismatch at read-end → skip + log; atomic temp-then-rename ensures no half-files in destination |
| User assumes Hakobi is a daemon and expects scheduled runs while Obsidian is closed | Medium | Medium | Explicit copy in settings: "Hakobi runs only while Obsidian is open."; FAQ entry in README; status bar (F10) shows live state |
| Two-device write contention on shared cloud-synced destination produces "Conflicted copy" files | Medium | Medium | Per-device enable flag (F8) is the primary defence; user is expected to enable each rule on a single device; no hostname-suffix mitigation in v0.1 |
| User imports from a folder that is *itself* the destination of an Obsidian Sync replica → double-sync risk | Medium | Low | Documented in PRIVACY.md / README as user's responsibility; per-device enable flag mitigates the worst case (only one device runs the rule) |
| Recursive import descends into a deep or pathological subtree, slowing the run | Medium | Low | Path-length cap in sanitization (F4); per-file global IO timeout (F11); rule-level run is bounded by overlap-skip behavior (F3) so a slow run cannot back up |

## Open Questions

The shape decisions are resolved (rule storage = hybrid; per-rule `copy | move`; collision = skip default + per-rule suffix override; "Export this note" = pick from configured rules; status bar IN v0.1; dry-run IN v0.1). Remaining questions intentionally deferred to SDD-time so they can be answered at the point of binding the design to types and code paths:

- [ ] Audit log error-code closed enum — finalize before SDD types are written. Initial proposal: `source-not-found`, `destination-not-writable`, `destination-parent-missing`, `destination-name-conflicts-note`, `symlink-refused`, `loop-refused`, `forbidden-path`, `sanitization-rejected`, `sanitization-empty`, `housekeeping-file`, `io-timeout`, `source-modified`, `source-vanished`, `source-is-symlink`, `subdir-is-symlink`, `disk-full`, `permission-denied`, `unknown`. **Defer to SDD.**
- [ ] Path expansion — does Hakobi expand `~` and `$HOME` / `%USERPROFILE%` at config time? Recommendation: yes, expand at config-time and persist the resolved absolute path. **Defer to SDD.**
- [ ] mtime preservation — preserve on export, not on import? Recommendation: yes. **Defer to SDD.**
- [ ] Tag-rule recursion — does `#projects` match `#projects/foo`? Recommendation: yes (Obsidian's own UI does this). **Defer to SDD.**
- [ ] Stability check before import pickup — "mtime unchanged for ≥2 seconds" vs. "atomic-rename-in" detection. Recommendation: mtime-stable. **Defer to SDD.**
- [ ] Rule ID generation — UUID or slug-from-name? Recommendation: UUID for stability across renames. **Defer to SDD.**
- [ ] OS-native folder picker integration in Obsidian's renderer process — Electron `dialog` API surface. **Defer to SDD.**
- [ ] Closed allowlist of OS-housekeeping filenames to skip on import (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.localized`, etc.). **Defer to SDD.**
- [ ] Default value for `flattenOnTarget` in the rule editor — `true` or `false`? Recommendation: `false` (preserve structure by default; flatten is explicit opt-in for "drop everything in one bucket" workflows like voice memos). **Defer to SDD.**

---

## Supporting Research

### Competitive Analysis
- **Hazel (macOS, $32):** Powerful generic rule engine. No Obsidian awareness — cannot select by tag, no audit log integrated with the vault, no vault-aware destination semantics.
- **Third-party sync tools (Dropbox, Syncthing, rclone):** Sync entire trees; bidirectional by default. Inverts the import-vs-export distinction; no rule-level audit; not vault-aware.
- **Obsidian "Auto-import" community plugins:** Mostly defunct or focused on web-clipper integration; none combine import + export + per-rule schedule + metadata-only audit + default-deny scope.
- **Cloud-API plugins (Dropbox/Google Drive REST):** Violate MiYo's local-first charter (Constitution L1); require API tokens; out of scope for MiYo by definition.
- **Hakobi's distinct position:** Obsidian-native, vault-aware (selectors include tags via metadata cache), local-FS only, audit-logged, default-deny, per-device-controllable under Sync. No direct competitor matches all five.

### User Research
Single primary user (project owner Marcus); user-research findings are derived from MiYo charter discussions and the Hakobi-specific Kokoro ADR-013 (accepted 2026-04-30). No external user interviews conducted for v0.1; post-release feedback channel is GitHub issues plus the MiYo internal Claude-coordination handoff protocol. Behavioral assumption: vault owner is technically comfortable, privacy-conscious, runs Obsidian primarily on macOS desktop, and uses a mix of capture (voice memo / screenshot / scratch-app) and offload (sharing / archive / partner-visible folder) workflows.

### Market Data
- Obsidian community plugin ecosystem: ~2000+ plugins. The file-management-plus-audit category (local-first, vault-aware, audit-logged, schedule-driven, Sync-conscious) is undersaturated.
- The MiYo target audience (privacy-first PKM users) is a self-selected slice of the Obsidian user base; no quantified TAM. Internal signal only — Hakobi optimizes for the project owner's workflow first, public adoption second.
