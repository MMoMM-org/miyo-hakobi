# Tools Memory

## Test tooling gaps (found during #18, 2026-11-27)

- `npm run test:coverage` fails: `@vitest/coverage-v8` is not a devDependency.
  Coverage targets in plans can only be checked by inspection until it is added.
- `npx tsc -p tsconfig.test.json --noEmit` reports ~200 pre-existing errors
  (abstract mock classes, untyped `mock.calls[0][0]` casts, `_runCleanup` not on
  `Plugin`). Nothing runs it: `npm run build` checks `src/` only and vitest does
  not typecheck. Do not treat new errors there as a gate without a baseline.
