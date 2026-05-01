---
title: "Hakobi v0.1 — Implementation Plan"
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

(See plan template — preserved verbatim.)

---

## Specification Compliance Guidelines

### How to Ensure Specification Adherence

1. **Before Each Phase**: Read all phase-context references, including the relevant SDD sections and ADRs.
2. **During Implementation**: Reference the specific SDD section number in commit messages and PR descriptions.
3. **After Each Task**: Re-read the task's `[ref:]` and confirm the deliverable matches.
4. **Phase Completion**: Run `npm test && npm run lint && npm run typecheck && npm run build` and verify zero errors.

### Deviation Protocol

When implementation requires changes from the specification:
1. Document the deviation in the phase file's "Deviations" section (added on-demand).
2. Update the spec README's Decisions Log with the deviation rationale.
3. If the deviation reflects a better design, update the SDD before continuing.
4. The xdd workflow's `validate` step will flag any unaddressed deviations.

## Metadata Reference

- `[parallel: true]` — Tasks that can run concurrently within the phase.
- `[ref: document/section; lines: X-Y]` — Links to PRD/SDD sections.
- `[activity: type]` — Specialist hint (`domain-modeling`, `data-architecture`, `backend-api`, `frontend-ui`, `validate`).

### Success Criteria

**Validate** = process verification ("did we follow TDD?")
**Success** = outcome verification ("does it work correctly?")

---

## Context Priming

*GATE: Read all files in this section before starting any implementation.*

**Specification**:
- `docs/XDD/specs/001-v0-1/requirements.md` — PRD (F1–F12, MoSCoW, acceptance criteria)
- `docs/XDD/specs/001-v0-1/solution.md` — SDD (12 ADRs, directory map, runtime view, sanitize + collision reference impls)
- `docs/XDD/specs/001-v0-1/README.md` — Spec decision log (resolved shape decisions, review notes)

**Repo memory & standards**:
- `CLAUDE.md` (project root) — routing rules, build commands, project rules
- `src/CLAUDE.md` — TDD discipline, TypeScript rules, Obsidian plugin patterns
- `test/CLAUDE.md` — test naming, mock conventions, lifecycle cleanup assertions
- `docs/ai/memory/general.md` — Marcus's inline-review pattern
- `docs/ai/memory/decisions.md` — settings UI = miyo-kado pattern
- `~/Kouzou/projects/miyo/miyo-constitution.md` — L1/L2 rules that bind privacy, default-deny, audit, code quality, performance, operations

**Key Design Decisions**:
- **ADR-1**: Layered modular monolith (5 layers, downward-only deps).
- **ADR-2**: Rule schema = TypeScript discriminated union (`direction` + `sourceType`).
- **ADR-3**: Hybrid persistence (`data.json` rules + sibling `device.json` per-device flags + sibling `audit/YYYY-MM.ndjson`).
- **ADR-4**: Audit log path encoding = rule-root-relative.
- **ADR-9**: Per-rule `registerInterval` timer + in-memory `InFlightRegistry` for overlap-skip.
- **ADR-10**: Settings UI = manifest-driven header + 3 subtabs (General / Import / Export); inline rule editor; audit log = OS-default-app launch button.

**Implementation Context**:
```bash
# Testing
npm test                    # vitest run (unit)
npm run test:watch          # vitest watch
npm run test:coverage       # vitest with v8 coverage
npm run test:live           # vitest with vitest.live.config.ts (vault-backed; requires Obsidian)

# Quality
npm run lint                # eslint . (eslint-plugin-obsidianmd rules; zero errors required)
npm run lint:fix            # eslint . --fix
npm run typecheck           # tsc --noEmit (strict mode)
npm run audit               # npm audit --audit-level=high --omit=dev

# Build
npm run dev                 # esbuild watch
npm run build               # tsc --noEmit + esbuild production (target ≤ 100 KB minified)

# Full pre-commit gate (run before any task is marked done)
npm run typecheck && npm test && npm run lint && npm run build
```

---

## Implementation Phases

Each phase is in a separate file. Tasks follow red-green-refactor: **Prime** (understand context), **Test** (red), **Implement** (green), **Validate** (refactor + verify).

> **Tracking Principle**: Track logical units that produce verifiable outcomes. The TDD cycle is the method, not separate tracked items.

- [x] [Phase 1: Domain & Audit Primitives](phase-1.md)
- [x] [Phase 2: Engine — Persistence, Scheduler, Runners](phase-2.md)
- [x] [Phase 3: UI & Lifecycle Wiring](phase-3.md)
- [ ] [Phase 4: Integration, E2E, Polish](phase-4.md)

---

## Plan Verification

| Criterion | Status |
|-----------|--------|
| A developer can follow this plan without additional clarification | ✅ |
| Every task produces a verifiable deliverable | ✅ |
| All PRD acceptance criteria map to specific tasks | ✅ (F1→T2.5, F2→T2.6, F3→T2.4, F4→T1.1, F5→T1.10, F6→T3.5, F7→T3.3, F8→T2.1+T2.2, F9→T1.2, F10→T3.2, F11→T1.7, F12→T3.4) |
| All SDD components have implementation tasks | ✅ |
| Dependencies are explicit with no circular references | ✅ |
| Parallel opportunities are marked with `[parallel: true]` | ✅ |
| Each task has specification references `[ref: ...]` | ✅ |
| Project commands in Context Priming are accurate | ✅ (verified against `package.json`) |
| All phase files exist and are linked from this manifest as `[Phase N: Title](phase-N.md)` | ✅ |
