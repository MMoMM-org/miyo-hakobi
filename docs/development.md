# Development Guide

For audience and architecture overview, see [How it works](how-it-works.md). For installing the plugin as an end user, see [Installation](installation.md).

## Setup

```bash
git clone https://github.com/MMoMM-org/miyo-hakobi.git
cd miyo-hakobi
git config core.hooksPath .githooks
npm install
```

The `git config core.hooksPath` line wires the repo's pre-commit hook (which blocks direct commits to `main`).

## Build

```bash
npm run build        # tsc strict typecheck + esbuild production bundle
npm run dev          # esbuild watch mode for live development
```

`npm run build` produces `main.js` at the **plugin root** (not `dist/`) — that is where Obsidian expects it.

`npm run dev` watches `src/` and rebuilds on save. To live-test in Obsidian, point the watcher's output at your dev vault's `.obsidian/plugins/miyo-hakobi/` directory and use the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) to pick up the rebuild.

## Test

```bash
npm test             # vitest unit tests (one shot)
npm run test:watch   # vitest watch mode
npm run test:coverage # vitest with v8 coverage
```

Tests use vitest + jsdom + a custom Obsidian mock at `test/__mocks__/obsidian.ts`. The mock fires real DOM events for `Setting`, `Toggle`, `Button`, and `Dropdown` so tests dispatch real clicks and inputs against `inputEl`, `toggleEl`, `buttonEl`, `selectEl`.

Lifecycle cleanup is testable via the mock's `Plugin._runCleanup()` — simulates Obsidian invoking every `register*()` callback on unload. Asserting `_cleanupFns` is empty after `_runCleanup()` proves no listeners or intervals were left orphaned.

## Lint

```bash
npm run lint         # eslint with eslint-plugin-obsidianmd rules + stylelint on styles.css
npm run lint:css     # stylelint only (CSS browser-compat check)
```

The lint config enforces Obsidian-plugin best practices (DOM-listener registration through `registerDomEvent`, prefer `createEl` over `innerHTML`, no direct `document` access where Workspace API exists).

`npm run lint` also runs **stylelint** with `stylelint-no-unsupported-browser-features` against `styles.css`, scoped to the `browserslist` target (`chrome 124` — Obsidian's Electron 30 / Chromium runtime for `minAppVersion` 1.6.6). This reproduces the Obsidian community-plugin submission bot's CSS browser-compat check locally — e.g. `text-decoration` with a style value (`underline wavy`) is flagged as only partially supported; use `border-bottom` for underline-style cues instead. Catching it here avoids a round-trip through the directory reviewer.

## Test vault

`test/Hakobi/` is a real Obsidian vault you can open for live manual testing. Hot-reload (`pjeby/hot-reload` v0.3.0) is preinstalled — `npm run dev` keeps the plugin live-reloading on rebuild.

Do **not** edit `.obsidian/` contents in the test vault by hand; hot-reload manages them.

## TDD discipline

The repo follows a strict TDD loop, enforced via `src/CLAUDE.md`:

1. **RED** — write a failing test first. No implementation before a failing test exists.
2. **GREEN** — minimal code to make the test pass. Nothing more.
3. **REFACTOR** — clean up only after GREEN. Run tests again.

Tests mirror the `src/` directory structure: `src/foo/Bar.ts` → `test/foo/Bar.test.ts`.

## Architecture rules

For the full architectural model, see [How it works](how-it-works.md). The short version of the rules every change must respect:

- **Layered, downward-only deps.** No upward imports. (`fs/` cannot import `vault/`; `vault/` cannot import `audit/`; etc.)
- **Domain layer is pure.** No `obsidian` import. No `node:fs`. The validator and sanitization run in plain TypeScript, testable without either runtime.
- **`main.ts` is thin.** Lifecycle wiring only. Logic lives in dedicated modules.
- **DOM listeners go through `plugin.registerDomEvent`.** Not raw `addEventListener`. Obsidian removes them on unload.
- **Audit-log writer enforces the field allowlist at compile time.** Add a field to the allowlist *and* the type before you can use it.
- **No runtime `<style>` injection.** `styles.css` is bundled and Obsidian loads it.
- **Avoid `innerHTML` / `outerHTML`.** Prefer `createEl` / `createDiv` / `createSpan` / `MarkdownRenderer.render`.

## Branching

`main` is protected by a pre-commit hook (`.githooks/pre-commit`) and a Claude-tool hook (`block-main-edits.sh`). Always branch:

```bash
git checkout -b feat/<short-description>      # for features
git checkout -b fix/<short-description>       # for fixes
git checkout -b docs/<short-description>      # for doc-only changes
git checkout -b refactor/<short-description>  # for refactors
```

The block-main-edits hook denies `Write`/`Edit` on `main` for any file that isn't gitignored. To override for legitimate main work (rare), relaunch your editor with `CLAUDE_ALLOW_MAIN_EDITS=1`.

## Commit conventions

Conventional commits — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Release notes are generated from commit history.

CLAUDE.md additionally requires:

- Commit after every completed task.
- Limit each change to one feature or one fix.
- Push to remote at least every 10 commits.

## Live testing

Open `test/Hakobi/` as a vault in Obsidian. The vault has Hot-Reload preinstalled, so `npm run dev` keeps the plugin live-reloading on rebuild. Use the test vault for any UX / live-DOM / cross-platform checks before merging.

## Releases

Hakobi follows the same release flow as the rest of the MiYo family: conventional commits → semver → `versions.json` + `manifest.json` bump → tag → GitHub Release with `main.js` + `manifest.json` + `styles.css` attached.

The `version-bump` script (when wired) drives the version files in lockstep. Until v1.0.0 ships, this repo is in pre-release; expect breaking changes.

## Where to file things

- **Bugs / feature requests:** [GitHub Issues](https://github.com/MMoMM-org/miyo-hakobi/issues).
- **Security issues:** email `marcus@mmomm.org`. Do not open a public issue.
- **Architectural drift / new ADR:** Hakobi-local ADRs live under `docs/XDD/specs/` if at all.
