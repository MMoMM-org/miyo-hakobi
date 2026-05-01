---
title: "Phase 1: Domain & Audit Primitives"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Domain & Audit Primitives

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Application Data Models]` — Rule discriminated union, AuditEntry shape, GlobalSettings, DeviceState
- `[ref: SDD/Implementation Examples; sanitize.ts]` — reference sanitize pipeline (9 steps + traced walkthrough)
- `[ref: SDD/Implementation Examples; resolveCollisionName]` — collision-suffix probe loop
- `[ref: SDD/Cross-Cutting Concepts/System-Wide Patterns; Security]` — sanitize + scope test coverage targets
- `[ref: PRD/F4]` — sanitization acceptance criteria
- `[ref: PRD/F5]` — audit log shape and metadata-only invariant
- `[ref: PRD/F8]` — rule storage hybrid (informs schema types here)
- `[ref: PRD/F9]` — default-deny scope criteria
- `[ref: PRD/F11]` — global IO timeout (informs NodeFs timeout wiring here)

**Key Decisions**:
- ADR-2 (discriminated union schema), ADR-4 (rule-root-relative audit paths), ADR-7 (UUID v4 rule IDs), ADR-12 (closed housekeeping skip-list), and the new Obsidian-invalid-char step in sanitize all land here.

**Dependencies**:
- None (this is the foundation phase).

---

## Tasks

This phase delivers the pure, Obsidian-free foundation: types, sanitize, scope, atomic-write helper, NDJSON audit log + rotation, and the FS / Vault adapter wrappers. Most tasks are mutually independent and can run in parallel; the few that compose other Phase-1 modules are sequenced after them.

- [x] **T1.1 Filename sanitization** `[activity: domain-modeling] [parallel: true]`

  1. Prime: Read sanitize reference impl `[ref: SDD/Implementation Examples; sanitize.ts]` and PRD criterion `[ref: PRD/F4]`.
  2. Test: NUL byte rejection; `..` / path-separator stripping; OS housekeeping allowlist (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.localized`, `.AppleDouble`, `$RECYCLE.BIN`, `System Volume Information`); control-char stripping; Obsidian-invalid char replacement (`* " \ / < > : | ?` → `_`); leading/trailing dot+space trim; Windows-reserved name suffixing (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`); empty-after-sanitize rejection; UTF-8 byte-length cap (255 segment / 1024 total). Each rule has at least one accept and one reject case (Constitution L1 Testing).
  3. Implement: `src/domain/sanitize.ts` — pure function `sanitizeFilename(input: string): SanitizeResult`. Closed `SanitizeResult` discriminated union.
  4. Validate: `npm test test/domain/sanitize.test.ts && npm run lint && npm run typecheck`.
  5. Success:
     - [ ] Every documented sanitization rule has both accept and reject test cases `[ref: PRD/F4]`
     - [ ] `sanitize.ts` is dependency-free (no Obsidian, no Node fs imports) `[ref: SDD/Solution Strategy]`

- [x] **T1.2 Default-deny scope checks** `[activity: domain-modeling] [parallel: true]`

  1. Prime: Read scope requirements `[ref: SDD/Application Data Models; rule.ts]`, `[ref: PRD/F9]`, `[ref: SDD/Acceptance Criteria/Default-Deny Criteria]`.
  2. Test: realpath escape rejection (symlink trap, `..` chain); vault-internal-source AND vault-internal-destination rejection; vault root / `.obsidian/` / plugin data dir rejection; symlink at rule root rejection; symlink for an enumerated child rejection; absolute path inside a filename rejection.
  3. Implement: `src/domain/scope.ts` — pure functions `isInsideRoot(real, root)`, `isVaultPath(p, vaultRoot)`, `isForbiddenVaultPath(p, vaultRoot, pluginDir)`, `validateRuleAtSave(rule, vaultRoot, pluginDir)`, `validateRuleAtRunTime(rule, fs, vaultIo)`. The first three are pure; the last two take FS/Vault adapters as parameters (DI for test).
  4. Validate: 100% line coverage on this module `[ref: SDD/Quality Requirements/Security]`. Lint + typecheck.
  5. Success:
     - [ ] All default-deny acceptance criteria covered by tests `[ref: PRD/F9]`
     - [ ] Scope decisions are deterministic given (path, vaultRoot, pluginDir) `[ref: SDD/ADR-1]`

- [x] **T1.3 Rule ID generation** `[activity: domain-modeling] [parallel: true]`

  1. Prime: `[ref: SDD/ADR-7]`.
  2. Test: returns a valid UUID v4 string; two consecutive calls return different IDs.
  3. Implement: `src/domain/ruleId.ts` — `newRuleId(): RuleId` using `crypto.randomUUID()` (Electron renderer global). Brand the return type as `RuleId`.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] `RuleId` is a branded type so accidental string→RuleId assignment fails at compile time `[ref: SDD/ADR-2]`

- [x] **T1.4 Rule schema (types + validators)** `[activity: domain-modeling]`

  1. Prime: `[ref: SDD/Application Data Models]` (entire section), `[ref: PRD/F1, F2, F8]`.
  2. Test: each `Rule` variant accepts a valid example; required-field omission fails validation; `everyMinutes < 1` rejected; tags must start with `#`; `flattenOnTarget` defaults to `false` if absent (post-migration); `dryRun` defaults to `false` if absent.
  3. Implement: `src/domain/rule.ts` — discriminated union `Rule`, `ImportRule`, `ExportRule = ExportFolderRule | ExportTagRule | ExportNoteRule`; pure validator `validateRule(input: unknown): Result<Rule, ValidationError[]>`. No Zod dependency; hand-rolled validation keeps the bundle thin (Constitution L2 Dependencies).
  4. Validate: lint + typecheck. Compile-time exhaustiveness asserted via a `never`-arm test (compiler error if a variant is added without a runner branch).
  5. Success:
     - [ ] All Rule variants round-trip JSON cleanly `[ref: SDD/Data Storage Changes]`
     - [ ] Validator surfaces the union of errors, not just the first one `[ref: SDD/ADR-2]`

- [x] **T1.5 Path safety helpers** `[activity: domain-modeling] [parallel: true]`

  1. Prime: `[ref: SDD/ADR-5]`, `[ref: SDD/OS Filesystem Boundary]` (in PRD-time integration research as informed the SDD).
  2. Test: `~` / `$HOME` / `%USERPROFILE%` expansion; persists resolved absolute path; rejects path with NUL byte; rejects unbounded length; normalizes `\` → `/` and collapses duplicate `/`.
  3. Implement: `src/fs/PathSafe.ts` — `expandUserPath(input)`, `normalizeFsPath(input)`, `assertNoTraversal(input)`. Pure (no fs calls).
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] Path expansion is deterministic given env vars `[ref: SDD/ADR-5]`

- [x] **T1.6 Audit entry types** `[activity: domain-modeling] [parallel: true]`

  1. Prime: `[ref: SDD/Application Data Models; AuditEntry]`, `[ref: PRD/F5]`.
  2. Test: TypeScript-level — only allowed fields present (assert with `Exact<>` helper); `serializeAuditEntry(entry)` produces single-line JSON without trailing newline; `parseAuditLine(line)` returns `Result<AuditEntry, ParseError>`; round-trip preserves all fields; rejects lines with unknown fields (defensive).
  3. Implement: `src/audit/AuditEntry.ts` — closed `Operation` / `ErrorCode` / `Decision` enums, `AuditEntry` interface, `serialize`/`parse` pure functions.
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] No file content / frontmatter / absolute paths can flow through serialize (compile-time guarded by closed types) `[ref: PRD/F5]`

- [x] **T1.7 NodeFs adapter (with global IO timeout)** `[activity: data-architecture] [parallel: true]`

  1. Prime: `[ref: PRD/F11]`, `[ref: SDD/Cross-Cutting Concepts/Performance]`.
  2. Test: `readFile` / `writeFile` / `lstat` / `rename` / `unlink` / `readdir` / `realpath` / `mkdir` wrappers; each respects the configured `perFileTimeoutMs` via `Promise.race` against a timeout sentinel; on timeout, throws a typed `IoTimeoutError` (errorCode `io-timeout`); cloud-sync placeholder simulation triggers timeout (mock long-running readFile).
  3. Implement: `src/fs/NodeFs.ts` — class `NodeFs` constructed with `{ timeoutMs: () => number }`; methods are thin async wrappers around `fs/promises`. Errors mapped to typed exceptions (`IoTimeoutError`, `IoNotFoundError`, `IoPermissionError`, `IoUnknownError`).
  4. Validate: lint + typecheck.
  5. Success:
     - [ ] All FS operations are time-bounded `[ref: PRD/F11]`
     - [ ] Errors are typed with closed error codes (no raw `Error` objects leak) `[ref: PRD/F5]`

- [x] **T1.8 VaultIo adapter** `[activity: data-architecture] [parallel: true]`

  1. Prime: `[ref: SDD/Obsidian API Touchpoints]`, mock surface in `test/__mocks__/obsidian.ts`.
  2. Test: `readBinary(path)`, `writeBinary(path, bytes)`, `existsAtVaultPath(path)`, `listFolder(path, { recursive })`, `notesByTag(tags, match)` (uses `getAllTags` + `metadataCache.getFileCache`), `getActiveFile()`, `ensureFolder(path)`. Each method is asserted to use the Vault API (mock spies confirm `app.vault.create` / `read` / `getMarkdownFiles` are called).
  3. Implement: `src/vault/VaultIo.ts` — class wrapping `app.vault` + `app.metadataCache` + `app.workspace`. Owns all in-vault I/O.
  4. Validate: lint + typecheck.
  5. Success:
     - [x] No raw `fs` import anywhere in `VaultIo.ts` `[ref: SDD/Solution Strategy]`
     - [x] Tag-rule recursion (nested tags) implemented per ADR-11 `[ref: SDD/ADR-11]`

- [x] **T1.9 Atomic writer** `[activity: data-architecture]`

  Depends on T1.7 (NodeFs) and T1.8 (VaultIo).

  1. Prime: `[ref: SDD/Implementation Examples; resolveCollisionName]`, `[ref: SDD/Cross-Cutting Concepts/System-Wide Patterns; Atomic write-temp-then-rename]`.
  2. Test: `writeFsAtomic(path, bytes)` writes to `<path>.tmp.<rand>` then renames; on failure the temp file is removed; `writeVaultAtomic(path, bytes)` does the equivalent through the Vault API; `resolveCollisionName(dir, baseName, exists)` matches the SDD's traced walkthrough exactly (including `MAX_SUFFIX_ATTEMPTS = 999`).
  3. Implement: `src/runner/AtomicWriter.ts` — pure-ish helpers parameterized by `(NodeFs | VaultIo)`. `resolveCollisionName` is fully pure; `writeFsAtomic` / `writeVaultAtomic` are async.
  4. Validate: lint + typecheck.
  5. Success:
     - [x] No half-files in destination on simulated mid-write failure (asserted via mock injection) `[ref: SDD/BR3]`
     - [x] Collision suffix algorithm matches the SDD walkthrough byte-for-byte `[ref: SDD/Implementation Examples]`

- [x] **T1.10 AuditLog + Rotation** `[activity: data-architecture]`

  Depends on T1.6 (AuditEntry) and T1.7 (NodeFs).

  1. Prime: `[ref: PRD/F5]`, `[ref: SDD/ADR-3]`, `[ref: SDD/Cross-Cutting Concepts/System-Wide Patterns; NDJSON]`.
  2. Test: `append(entry)` writes a single line + newline, never two entries on one line, never overwrites; `iterate(filter)` reads newest-first (paginated 50 entries internally even though the viewer is dropped — the engine still uses paginated reads for any internal display); `purgeAll()` deletes all files under `audit/` and writes one `decision: purged-by-user` entry to a fresh log; `Rotation.checkAndRotate(maxBytes, retentionDays)` deletes files older than `retentionDays`, rotates current file when its size exceeds `maxBytes`. File path encoding: rule-root-relative paths only `[ref: SDD/ADR-4]`.
  3. Implement: `src/audit/AuditLog.ts` (append + iterate + purge) and `src/audit/Rotation.ts` (rotation policy). Path: `<pluginDataDir>/audit/YYYY-MM.ndjson` via `app.vault.adapter.getFullPath()` for the plugin data dir.
  4. Validate: lint + typecheck. Concurrent-append test: 100 parallel `append` calls produce exactly 100 well-formed lines.
  5. Success:
     - [ ] Audit entries are metadata-only (test asserts no string field contains "/Users/" or "/home/" absolute prefixes) `[ref: PRD/F5, Constitution L2]`
     - [ ] Audit files outside the vault (in plugin data dir) `[ref: SDD/ADR-3]`

- [x] **T1.11 Phase 1 Validation** `[activity: validate]`

  - Run `npm run typecheck && npm test && npm run lint && npm run build`.
  - Assert no Obsidian / fs imports in `src/domain/` modules (grep-based test).
  - Assert no remote URLs (`fetch`, `http://`, `https://`) in any Phase 1 source file.
  - Confirm `src/types/index.ts` re-exports `Rule`, `AuditEntry`, `GlobalSettings`, `DeviceState`, `RuleId` for downstream phases.
  - Update spec README's Decisions Log if any deviation surfaced.
