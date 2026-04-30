# src/ — Code Area Rules

## TDD
- RED: Write failing test first. No implementation before a failing test.
- GREEN: Minimal code to make the test pass. Nothing more.
- REFACTOR: Clean up only after GREEN. Run tests again.

## Contracts
- Domain rules live in `docs/ai/memory/domain.md` — link implementations to these.
- Public interfaces must match the SDD contract (if one exists).

## TypeScript Rules
- Strict mode: `"strict": true` in `tsconfig.json` — no exceptions.
- No `any` — use `unknown` + narrowing or define a proper type.
- Import order: node builtins → external → internal (enforced by ESLint).
- Prefer explicit return types on public functions.

## Obsidian Plugin Rules
- Keep `main.ts` thin: lifecycle wiring only, delegate logic to modules.
- Register cleanup with `this.register*` helpers (DOM listeners, intervals,
  events) so unload is clean. Mock's `_runCleanup()` lets tests assert this.
- Never mutate `manifest.json` `id` after first release — it is stable API.
- Avoid runtime `<style>` injection — Obsidian loads `styles.css` automatically.
  Bundle vendored CSS at build time (esbuild plugin) instead.
- Prefer `MarkdownRenderer.render()` over assigning to `innerHTML`/`outerHTML`.
