# Specification: 001-v0-1

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-30 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-04-30 |

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
