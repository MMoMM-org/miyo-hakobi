# Specification: 001-v0-1

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-30 |
| **Current Phase** | Completed |
| **Last Updated** | 2026-05-02 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | PRD approved 2026-04-30 after one review pass (6 inline notes consumed) |
| solution.md | completed | SDD approved 2026-04-30 after one review pass (2 inline notes consumed); 12/12 ADRs confirmed |
| plan/ | completed | PLAN — 4 phases, 38 tasks, all PRD F# ↔ task mapping verified |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-30 | Scaffold spec `001-v0-1` | First spec for Hakobi; covers full v0.1 charter (Kokoro ADR-013) |
| 2026-04-30 | Workflow mode = Standard, start phase = PRD | Charter is detailed enough that parallel research suffices; PRD-first matches greenfield. |
| 2026-04-30 | Rule storage = hybrid (`data.json` + per-device enable bit) | Sync-portable rule shape; only the opted-in device runs each rule → no cross-device conflict storms on cloud-synced destinations. |
| 2026-04-30 | Operation semantics = per-rule `action: copy \| move` | More surface area, but matches realistic mix (voice-memo capture wants copy; archive/offload wants move). |
| 2026-04-30 | Collision policy = skip + log default, per-rule suffix override | Aligns with default-deny; never overwrite silently. Numeric suffix is the only opt-in alternative; no overwrite option exposed. |
| 2026-04-30 | "Export This Note" = pick from configured export rules | Single code path, audit-log entries always rule-attributed; user must have at least one export rule. |
| 2026-04-30 | Status-bar indicator IN v0.1 (minimal) | Surfaces failures without nagging persistent notices; click opens audit log. |
| 2026-04-30 | Dry-run mode IN v0.1 (per-rule toggle + commands) | Low-cost, high-value safety for first-run rule misconfiguration; logs decisions without writes. |
| 2026-04-30 | Audit log location = plugin data dir, NOT in-vault | Avoids Sync amplifying metadata leak surface; Constitution L2 metadata-only stays per-device. |
| 2026-04-30 | Symlinks refused in v0.1 (consensus from Security + Requirements perspectives) | Default-deny; revisit post-v0.1. |
| 2026-04-30 | Vault ↔ vault loop = hard reject at rule creation | Loop prevention is a hard rule, not a warning (Security DD3). |
| 2026-04-30 | PRD review: drop F11 cloud-sync path heuristic warning | Owner decision; risk table mitigations re-anchored on per-device enable flag (F8) + PRIVACY.md disclosure. |
| 2026-04-30 | PRD review: drop F14 rule import/export as JSON | Owner decision; v0.1 scope discipline. |
| 2026-04-30 | PRD review: per-file IO timeout = global setting only, not per-rule (F11, was F12) | Owner decision; simpler config surface; renumbered F12→F11 and dropped F12 per-rule advanced UI. |
| 2026-04-30 | PRD review: command IDs registered without `Hakobi:` prefix | Obsidian prefixes with plugin name automatically; doubling the prefix is a known smell. |
| 2026-04-30 | PRD review: F8 explicitly states no multi-device enablement coordination | Hakobi does not detect/coordinate when multiple devices have the same rule enabled — user's responsibility. Avoids cross-device locking complexity. |
| 2026-04-30 | PRD review: F10 status-bar = kanji 運 with color states + hover tooltip | Owner decision; replaces the "Hakobi: idle / running / failed" text. Kanji + color carry state; tooltip carries detail; aria-label preserves accessibility. |
| 2026-04-30 | PRD review: source-side recursion is the default for both directions; new `flattenOnTarget` option | Owner decision; replaces the per-rule `recurse` toggle on F2 and removes the "immediate root only" restriction on F1. Resolves the previously-deferred "folder-rule recursion default" open question (recursion is now baseline behavior, not a toggle). |
| 2026-04-30 | SDD review: settings UI = 3 subtabs (General / Import / Export) + manifest-driven header section; mirrors miyo-kado | Owner decision; recognizable across MiYo ecosystem. Header surfaces author/docs/funding URLs from manifest.json so they cannot drift from the Community Plugins listing. |
| 2026-04-30 | SDD review: drop in-tab audit-log viewer; replace with "Show audit log" button on General subtab | Owner decision; pushes inspection to OS default app (text editor / grep / jq). PRD F6 rewritten — no pagination, no filter bar, no virtualized rendering. Major scope reduction. |
| 2026-04-30 | SDD review: F10 status-bar click target = General subtab (not "scrolled to audit-log section") | Cascades from the previous decision — there is no audit-log section to scroll to anymore. |
| 2026-04-30 | SDD review: sanitize pipeline must replace Obsidian-invalid chars (`*"\\/<>:|?`) with `_` | Owner-flagged omission; Obsidian's note-create API rejects these even when the OS allows them. F4 acceptance criterion in PRD updated; sanitize.ts reference impl gains a step 5. |
| 2026-04-30 | SDD review: ADRs 1, 2, 3, 8, 9, 11, 12 confirmed inline by owner; ADRs 4, 5, 6, 7, 10 still pending | Inline `[X]` checkbox marks treated as approval signal. ADR-10 was rewritten in this review pass (3-subtab IA + audit-log button) and remains pending. |
| 2026-04-30 | ADRs 4, 5, 6, 7, 10 approved as drafted | All 12 ADRs now confirmed; SDD complete. ADR-4 (audit log path = rule-root-relative), ADR-5 (path expansion at config save), ADR-6 (mtime preserve on export only), ADR-7 (UUID v4 rule ID), ADR-10 (3-subtab IA). |
| 2026-04-30 | PLAN: 4 phases, 38 tasks | Phase 1 Domain & Audit Primitives (11 tasks, mostly parallel) → Phase 2 Engine (7 tasks) → Phase 3 UI & Lifecycle (12 tasks) → Phase 4 Integration & Polish (8 tasks). All PRD F1–F12 → task mappings verified in plan/README.md verification table. |
| 2026-04-30 | PLAN: added explicit `src/persistence/` modules (RuleStore, DeviceStore) | The SDD's mermaid diagram showed RuleStore + DeviceStore as components but the directory map did not list them as files. Plan T2.1 + T2.2 create these modules under `src/persistence/`. Minor SDD addition; not a deviation, but logged here for traceability. |
| 2026-05-01 | T1.11: retain legacy `PluginSettings` / `DEFAULT_SETTINGS` exports in `src/types/index.ts` as compatibility aliases | `src/main.ts` and `src/settings/SettingsTab.ts` still import the original esbuild-template types. Removing them would force `main.ts` rewiring into Phase 1, conflating scopes. The aliases are clearly marked as legacy and scheduled for removal in Phase 3 alongside the main.ts rewire. New `PluginData` / `GlobalSettings` / `DeviceState` exports are in place per the SDD. |
| 2026-05-01 | T4.7: PRD/F2 wording reconciled to ErrorCode enum — `source-note-missing` → `source-not-found` | The PRD draft used `source-note-missing` for the export-note "source missing" failure, but the SDD's closed `ErrorCode` union (single source of truth at `src/audit/AuditEntry.ts`) uses `source-not-found` as the canonical name for any missing-source failure (import or export). Two names for the same failure mode is a drift hazard. Resolution: update PRD/F2 acceptance criterion + SDD acceptance criterion to read `source-not-found`; production already uses the canonical name. No new ErrorCode variant added. |
| 2026-05-01 | T4.7: Defect A fix — ExportRunner.run pre-checks note existence for `sourceType: note` rules before invoking `validateRuleAtRunTime` | `validateRuleAtRunTime` calls `fs.lstat` on the resolved source root, which threw `IoNotFoundError` for an export-note rule whose vault note no longer existed. The throw escaped `ExportRunner.run` uncaught, and `Scheduler.executeTick`'s catch-all converted it to `errorCode: "unknown"` — masking the typed `source-not-found` outcome PRD/F2 demands. The fix adds an `existence pre-check` (vaultIo.fileByPath) at the top of `ExportRunner.run` for note rules, so the typed errorCode flows through reliably. Folder/tag rules are unaffected (their roots tolerate emptiness; the scope validator does not throw for them). Live test (`test/live/export.live.test.ts`) updated to assert the corrected behaviour. |
| 2026-05-01 | T4.7: Defect B deferred — `Export this note` command full picker UX deferred to v0.2 | The PRD/F7 acceptance criterion calls for a fuzzy-suggest list of export rules + active-note routing on the `Export this note` command. The current v0.1 implementation registers the command and correctly guards "no active note" via Notice, but builds a synthetic ad-hoc rule with an empty destination and a synthetic id; Scheduler.runOnce can't find the rule by id and the command silently no-ops. Rationale for deferral: the full picker UX requires Modal + suggester wiring beyond the v0.1 implementation budget, and the safer failure mode (silent no-op) is preferable to the riskier alternative (silently exporting via the wrong rule). User impact: the command appears in the palette but is currently a no-op. README troubleshooting section documents the limitation; users should configure an export rule of `type: note` for the specific note instead. Follow-up tracked as a Phase-5/v0.2 task. |
| 2026-05-01 | T4.8: Phase 4 implementation complete; manifest bumped to v0.1.0; spec marked completed; ready for PR. | Final pre-commit gate green (749 unit tests / 36 files / typecheck / lint / build) and `npm run test:live` 5/5 against the tmp-vault harness. `manifest.json` version bumped 0.0.0 → 0.1.0 as a sanity check (semantic-release owns the canonical version in CI). Plan README + phase-4 frontmatter marked completed; T4.8 checkbox closed. v0.1 ship-ready. |
| 2026-05-02 | T4.7 follow-up: Defect B resolution changed from "deferred" to "removed" — `Export this note` command deleted from the v0.1 surface. | Owner decision supersedes the 2026-05-01 deferral row. Shipping a registered command that silently no-ops (synthetic ad-hoc rule that Scheduler.runOnce cannot find by id) is worse for users than not shipping it at all. The command, its callback, and the related TODO comments in `src/ui/CommandRegistry.ts` are removed; the `vaultIo` and `notices.noActiveNote` deps drop out of `CommandRegistryDeps`. Reconciled across PRD F7 (7 → 6 commands; "Export this note" acceptance criterion deleted), SDD (`exactly seven` → `exactly six`; SDD "WHEN `Export this note` is invoked with no active note" criterion deleted), tests (`CommandRegistry`, `compliance`, `main`, `lifecycle/unload`: all `7` → `6`), and the user README (command list down to six; troubleshooting FAQ entry removed; new "Possible future features" section documents the full picker UX as an idea with no version pin). No behaviour deferred; no version commitment made. |

## Context

Hakobi v0.1 — scheduled file ferry between local FS and the Obsidian vault.

Charter source: Kokoro ADR-013 (accepted 2026-04-30).

In-scope (v0.1):
- Named **import rules** (external local FS path → vault folder)
- Named **export rules** (vault folder/tag/note → external local FS path)
- Simple per-rule `everyMinutes` scheduler (no daemon)
- Filename sanitization on import
- NDJSON audit log (metadata only) with built-in viewer in General settings tab
- Command-palette commands: Run Import/Export All, Run Import/Export (select), Export This Note

Out-of-scope (v0.1):
- External surface, ports, MCP, LLM
- Coupling to Tomo / Kado / Hashi
- Native cloud-service APIs (Dropbox, Google Drive, S3, SFTP) — only mounted local paths
- Mobile (`isDesktopOnly: true`)
- Per-execution prompts (rule creation **is** the approval)

Constraints:
- Local-first; no telemetry / network calls
- Audit log records metadata only (paths, op, timestamp, decision) — never content
- Kado is the only external-inbound vault surface; Hakobi reaches outward only

---
*This file is managed by the xdd-meta skill.*
