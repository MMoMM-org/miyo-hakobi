---
title: "Debug logging switch and quiet default console output"
status: draft
version: "1.0"
---

# Implementation Plan

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All `[NEEDS CLARIFICATION: ...]` markers have been addressed
- [x] All specification file paths are correct and exist
- [x] Each phase follows TDD: Prime → Test → Implement → Validate
- [x] Every task has verifiable success criteria
- [x] A developer could follow this plan independently

### QUALITY CHECKS (Should Pass)

- [x] Context priming section is complete
- [x] All implementation phases are defined with linked phase files
- [x] Dependencies between phases are clear (no circular dependencies)
- [x] Parallel work is properly tagged with `[parallel: true]`
- [x] Activity hints provided for specialist selection `[activity: type]`
- [x] Every phase references relevant SDD sections
- [x] Every test references PRD acceptance criteria
- [x] Integration & E2E tests defined in final phase
- [x] Project commands match actual project setup

---

## Output Schema

### PLAN Status Report

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| specId | string | Yes | Spec identifier (NNN-name format) |
| title | string | Yes | Feature title |
| status | enum: `DRAFT`, `IN_REVIEW`, `COMPLETE` | Yes | Document readiness |
| phases | PhaseStatus[] | Yes | Status of each implementation phase |
| totalTasks | number | Yes | Total tasks across all phases |
| parallelTasks | number | Yes | Tasks marked `[parallel: true]` |
| specReferences | number | Yes | Count of `[ref: ...]` specification links |
| clarificationsRemaining | number | Yes | Count of `[NEEDS CLARIFICATION]` markers |

### PhaseStatus

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phase | number | Yes | Phase number |
| name | string | Yes | Phase name |
| status | enum: `COMPLETE`, `NEEDS_CLARIFICATION`, `IN_PROGRESS` | Yes | Current state |
| tasks | number | Yes | Task count in this phase |
| file | string | Yes | Path to phase file (phase-N.md) |
| detail | string | No | What needs clarification or what's in progress |

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Complete the Pre-Implementation Specification Gate
2. **During Implementation**: Reference specific SDD sections in each task
3. **After Each Task**: Run Specification Compliance checks
4. **Phase Completion**: Verify all specification requirements are met

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation with clear rationale
2. Obtain approval before proceeding
3. Update SDD when the deviation improves the design
4. Record all deviations in this plan for traceability

## Metadata Reference

- `[parallel: true]` - Tasks that can run concurrently
- `[component: component-name]` - For multi-component features
- `[ref: document/section; lines: 1, 2-3]` - Links to specifications, patterns, or interfaces and (if applicable) line(s)
- `[activity: type]` - Activity hint for specialist agent selection
- `[model: routine|hard|frontier]` - Overrides the spec's model tier for this task

### Success Criteria

**Validate** = Process verification ("did we follow TDD?")
**Success** = Outcome verification ("does it work correctly?")

```markdown
# Single-line format
- Success: [Criterion] `[ref: PRD/AC-X.Y]`

# Multi-line format
- Success:
  - [ ] [Criterion 1] `[ref: PRD/AC-X.Y]`
  - [ ] [Criterion 2] `[ref: SDD/Section]`
```

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:

- `docs/XDD/specs/002-debug-logging-switch/requirements.md`: Product Requirements (F1–F5, 26 ACs)
- `docs/XDD/specs/002-debug-logging-switch/solution.md`: Solution Design (ADR-1..5)
- `src/CLAUDE.md`, `test/CLAUDE.md`: TDD and test conventions for this repo
- `/Volumes/Moon/Coding/MiYo/Kado/docs/debug-logging.md`: reference for the user doc (read-only)

**Key Design Decisions**:

- **ADR-1, logger channel split**: `log.debug` is gated (per-run detail). The new `log.lifecycle` is always on (load/unload, daily summary). Both write `console.debug`. `warn` and `error` are unchanged.
- **ADR-2, debug source as a provider**: `main.ts` registers `setDebugSource(() => this.globalSettings.debugLogging)` in onload and `setDebugSource(null)` in onunload. The value is read live and can never be stale.
- **ADR-3, ownership of the totals**: the pure `ActivityTotals` counts. `Scheduler.executeTick` feeds it, and the Scheduler owns the 24 h summary interval (`window.setInterval` + `registerInterval`, cancelled in `stop()`).
- **ADR-4, persistence**: `GlobalSettings.debugLogging: boolean`, default `false`, with a boolean type-check merge and no `schemaVersion` bump.
- **ADR-5, supersede note**: a note in spec 001's `solution.md` at its "console errors only" rule.
- **ADR-6, aborted runs count as failed**: `RunStats.aborted` is set on the runners' early-return paths; the summary counts those runs as failed. It does not key on `rule-failed`.

**Implementation Context**:

```bash
# Testing
npm test                    # vitest unit + integration (jsdom, obsidian mock)
npm run test:watch          # watch mode

# Quality
npm run lint                # eslint (obsidianmd) && stylelint styles.css
npm run build               # tsc -noEmit -skipLibCheck && esbuild production (typecheck)

# Full validation
npm test && npm run lint && npm run build
```

---

## Implementation Phases

Each phase is defined in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Foundations](phase-1.md)
- [x] [Phase 2: Wiring and settings UI](phase-2.md)
- [x] [Phase 3: Documentation and end-to-end validation](phase-3.md)

---

## Plan Verification

Before this plan is ready for implementation, verify:

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |

### AC → Task traceability

| PRD AC | Task |
|---|---|
| AC-1.1, 1.6 (toggle, heading, description) | T2.3 |
| AC-1.2, 1.3 (live effect) | T1.1, T2.2, T3.2 |
| AC-1.4, 1.5 (persist, synced storage) | T1.3 |
| AC-2.1, 2.5 (tick lines gated) | T2.1 |
| AC-2.2, 2.3 (load/unload always) | T2.1 (scheduler lines), T2.2 (main.ts lines) |
| AC-2.4 (failures always) | T2.1 (regression assert), T1.1 |
| AC-2.6 (console levels) | T1.1 |
| AC-3.2, 3.3, 3.5, 3.6 (counting, dry runs, reset, no names) | T1.2 |
| AC-3.2 / Rule 3 (aborted runs are failed runs) | T1.4, T1.2, T2.1 |
| Rule 7 (disabled rules not counted), Edge 3 (switch change keeps counts) | T2.1 |
| AC-3.1, 3.4, 3.7 (cadence, zero line, stop/reload) | T2.1 |
| AC-4.1, 4.2, 4.3 (privacy of lines) | T1.2 (summary), T2.1 (lifecycle + tick lines) |
| AC-4.4 (PRIVACY.md) | T3.1 |
| AC-5.1–5.3 (docs) | T3.1 |
| All, end-to-end | T3.2 |
