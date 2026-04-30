# test/ — Test Area Rules

## Naming
- File: `<module>.test.ts` — mirror `src/` structure.
- Function/describe: `describe('<unit>', () => { it('<behaviour>', ...) })`.

## Coverage expectations
- All public interfaces must have tests.
- Happy path + at least one error path per function.

## Test data
- Use fixtures/factories, not hardcoded production-like data.
- Isolate: each test creates its own data; don't share mutable state.
- `__mocks__/obsidian.ts` ships factories (`createMockTFile`,
  `createMockCachedMetadata`); add more there rather than inline.

## Obsidian mock
- The mock fires real DOM events for `Setting` + UI primitives (Text, Toggle,
  Button, Dropdown). Tests can dispatch clicks/inputs against `inputEl`,
  `toggleEl`, `buttonEl`, `selectEl`.
- Reset between tests: `Notice._reset()` to clear notice instances.
- Lifecycle cleanup: assert plugin cleanup with `plugin._runCleanup()`.

## Test vault (`test/Hakobi/`)
- Open this folder as a vault in Obsidian for live manual testing.
- Hot-reload (pjeby/hot-reload v0.3.0) is preinstalled — `npm run dev` keeps
  the plugin live-reloading on rebuild.
- Do NOT edit `.obsidian/` contents by hand; hot-reload manages them.

## Live tests
- See `docs/live-testing.md` (when present) for vault-backed test setup.
- Live tests live under `test/live/` and run via `npm run test:live`.
