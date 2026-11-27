# Specification: 002-debug-logging-switch

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-11-27 |
| **Current Phase** | PLAN |
| **Decomposition tier** | Incremental |
| **Model tier** | hard |
| **Last Updated** | 2026-11-27 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Approved 2026-11-27 |
| solution.md | completed | Approved 2026-11-27; ADR-1..5 confirmed |
| plan/ | in_progress | Incremental tier |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

**Decomposition tier**: `Direct` (no plan) | `Incremental` (phase plan). Set by the classifier at the decomposition step and confirmed by the user; leave the placeholder until then. Read back by `spec.py --read`, which treats anything it does not recognise as absent.

**Model tier**: `routine` | `hard` | `frontier`. The classifier recommends it at the decomposition step and the user confirms it; leave the placeholder until then. `spec.py --read` treats anything it does not recognise as absent.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-27 | Spec created for GitHub issue #18 | User asked to take #18 through the XDD workflow after shipping #15/#16/#20 |
| 2026-11-27 | Start with PRD, Standard research mode | Recommended defaults; feature is single-repo and modest |
| 2026-11-27 | Visibility follows Kado: everything except errors stays `console.debug`; switch off = load events + daily totals only, switch on = also tick lines | Lint forbids `console.info`; misusing `console.warn` for routine lines was rejected. Kado (`GeneralTab.ts:289-310`) is the IA source of truth per `decisions.md` |
| 2026-11-27 | Totals: one aggregate line every 24 h since plugin load, in memory only, console only | Audit schema stays a closed allowlist (no F5 / PRIVACY.md schema change); counters lost on reload accepted |
| 2026-11-27 | Debug switch stored in `GlobalSettings` (data.json, synced) | Consistent with all other global settings and with Kado; per-device storage rejected |
| 2026-11-27 | Privacy: rule names only in opt-in debug lines; load + totals lines carry no rule names; error messages kept verbatim; new console section in PRIVACY.md | Diagnosis needs raw errors; default output stays free of user-chosen names |
| 2026-11-27 | PRD approved (26 acceptance criteria) | Includes: failures always name the rule; dry runs counted separately; zero-activity summary still emitted; initial-run start/end are load events; no catch-up summaries after sleep |
| 2026-11-27 | SDD approved; ADR-1..ADR-5 confirmed | Logger channel split, provider-based debug source, ActivityTotals fed/timed by Scheduler, GlobalSettings.debugLogging (no schemaVersion bump), supersede-note in spec 001 |
| 2026-11-27 | Decomposition tier: Incremental | Classifier recommended Incremental (feature_count=4 Must-Have; component_count=1 new: ActivityTotals; 26 ACs; no parallel markers). Accepted. |
| 2026-11-27 | Model tier: hard | Classifier recommended hard (novel_pattern=true: logger channel split; adr_count=5; high_risks=0). Accepted. |

## Context

GitHub issue #18 (owner): "add a switch to enable debug logging; move the tick events into the debug log, only show load/errors and periodic (probably 24 hours) totals by default."

---
*This file is managed by the xdd-meta skill.*
