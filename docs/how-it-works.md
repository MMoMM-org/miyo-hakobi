# How It Works

## Architecture

Hakobi follows a layered architecture with downward-only dependency flow. No layer imports from the one above it.

```
NodeFs → VaultIo → AuditLog + Rotation → RuleStore → DeviceStore
       → InFlightRegistry → ImportRunner + ExportRunner → StatusBar
       → Scheduler → SettingsTab → CommandRegistry
```

| Layer | Responsibility | Key files |
|-------|---------------|-----------|
| **fs** | Time-bounded `node:fs/promises` adapter; the only place that touches Node's `fs` | `src/fs/NodeFs.ts`, `src/fs/PathSafe.ts` |
| **vault** | Obsidian Vault adapter; the only place that touches `app.vault` | `src/vault/VaultIo.ts` |
| **audit** | NDJSON writer + monthly rotation; metadata-only allowlist enforced at the writer | `src/audit/AuditLog.ts`, `src/audit/Rotation.ts`, `src/audit/AuditEntry.ts` |
| **persistence** | Rule definitions (synced) + per-device flags (not synced) | `src/persistence/RuleStore.ts`, `src/persistence/DeviceStore.ts` |
| **scheduler** | One timer per enabled rule; overlap-skip via `InFlightRegistry` | `src/scheduler/Scheduler.ts`, `src/scheduler/InFlightRegistry.ts` |
| **runner** | Per-tick file-by-file execution; atomic writes; sanitization; stability check | `src/runner/ImportRunner.ts`, `src/runner/ExportRunner.ts`, `src/runner/AtomicWriter.ts` |
| **domain** | Pure validation: scope checks, sanitization, rule shape | `src/domain/scope.ts`, `src/domain/sanitize.ts`, `src/domain/rule.ts` |
| **ui** | Status bar, command registry, modals | `src/ui/StatusBar.ts`, `src/ui/CommandRegistry.ts` |
| **settings** | Settings tab, header, three subtabs, rule editors | `src/settings/SettingsTab.ts`, `src/settings/HeaderSection.ts`, `src/settings/subtabs/*.ts` |

The **domain** layer is pure — no Obsidian, no Node `fs` — so the entire validation model is testable without either runtime.

## Scheduling

### One timer per enabled rule

When `Scheduler.start()` runs (during `onload()`), it iterates every rule and starts a `setInterval` at the rule's `everyMinutes` cadence — but only if the rule is `enabledOnThisDevice` on the current device. Each timer is registered with the plugin so unload disposes it cleanly.

### Initial run on plugin start

On plugin enable / Obsidian start, every enabled rule fires one immediate tick after `workspace.onLayoutReady` plus a 3-second grace delay (so the metadata cache has time to populate — otherwise tag-export rules would see an empty cache). This means you do not have to wait `everyMinutes` to see the first run.

### Overlap skip

Each rule has at most **one** in-flight run at a time. If a tick fires while the previous run is still going, it is skipped and recorded as `decision: skipped, reason: overlap` in the audit log.

This is enforced by `InFlightRegistry`, a tiny in-memory `Set<RuleId>` set on tick-start and cleared on tick-end.

### No catch-up runs

Hakobi runs **only while Obsidian is open**. Ticks missed during sleep or while Obsidian was closed are not made up — the next regularly scheduled tick fires normally and the missed ticks are simply gone.

If you need around-the-clock ferrying, that is explicitly outside Hakobi's v0.1 charter; consider a Hazel rule, a `launchd` / `systemd` unit, or a shell-script cron for that path.

### No daemon, no background mode

Hakobi has no persistent process. The scheduler is in-process inside Obsidian and dies with the app.

## Per-rule run anatomy

Each tick — whether timer-fired or manually invoked via "Run now" / "Run dry-run" / a command — does the following:

1. **Pre-flight scope check.** `validateRuleAtRunTime` re-validates the rule against the current vault root and plugin data dir. Catches edge cases like a vault that was renamed since the rule was created.
2. **Source enumeration.**
   - **Import:** read the source FS folder (or its current contents). Apply housekeeping skip (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.localized`).
   - **Export folder:** read the vault subtree.
   - **Export tag:** consult the metadata cache for notes carrying any/all of the configured tags.
   - **Export note:** look up the single note path.
3. **Per-file:**
   - **Sanitize** (import only) — strip control characters, refuse path traversals, refuse empty names.
   - **Stability check** (import only) — confirm `mtime` has been quiet for `stabilityCheckMs`. If not, skip with `errorCode: not-stable-yet`.
   - **Read** the source bytes (Node FS for import, Vault API for export).
   - **Resolve collision** — if the destination already exists: `skip` or `suffix` (append `-1`, `-2`, …).
   - **Write atomically** — write to a `*.tmp` sibling and `rename()` over the destination. No half-written files.
   - **Post-write:** if `move`, delete the source.
   - **Audit one entry** per file.
4. **Audit one summary entry** for the run as a whole (rule name, totals, duration, exit decision).

Every step is independently bounded by `perFileTimeoutMs`. If a single file's IO stalls past the timeout (typical cause: cloud-sync placeholder), Hakobi skips the file with `errorCode: io-timeout` and continues with the next.

## Sanitization

Hakobi never trusts source filenames. The `sanitize` module rejects:

| Input | Reason |
|-------|--------|
| Names containing `\0` (NUL bytes) | Filesystem corruption risk |
| Names containing `..` segments | Path traversal — refuses to escape the destination |
| Names that reduce to empty after stripping control characters | No safe destination name |
| Names with embedded `/` or `\` after normalization | Cross-directory writes are not allowed |

Rejected files surface as `decision: rejected, reason: sanitization` in the audit log; the run continues with the next file.

## Scope validation

Every rule is validated against the running vault — both at **save time** (creation / edit) and at **run time** (every tick).

The validator refuses any rule that would:

- Have **both** source and destination inside the vault (vault → vault loops).
- Target the vault root, `.obsidian/`, or Hakobi's own plugin data directory.
- Reference a vault path that does not exist.
- Reference an FS path that is itself a symlink chain that escapes its declared target.

Rules that fail run-time validation are **not run**; the audit log records `decision: rejected, reason: scope`.

## Atomic writes

Writes go through `AtomicWriter`, which:

1. Writes to a `<destination>.tmp.<random>` sibling file.
2. `fsync`s the temp file.
3. `rename()`s atomically over the destination.

If a crash occurs mid-write, the destination is either entirely the old version or entirely the new version — never partial. The temp file may remain orphaned; it is harmless and gets cleaned up on the next run.

## Audit log

Hakobi records every run in a metadata-only NDJSON log under `<vault>/.obsidian/plugins/miyo-hakobi/audit/YYYY-MM.ndjson`. The writer enforces a closed allowlist of fields — file content, frontmatter values, and absolute home paths are **never** recorded.

For the full format, retention rules, and allowlist see [Audit log](audit-log.md).

## Status bar

The status-bar indicator (kanji 運) is a small UI piece driven by three events from the scheduler:

| Scheduler event | Status bar transition |
|----------------|----------------------|
| `setRunning(ruleName)` | → `running` (accent color, tooltip names the rule) |
| `setIdle(lastSummary?)` | → `idle` (neutral, tooltip shows last summary if present) |
| `setFailed(summary)` | → `failed` (error color, sticky tooltip) |

The `failed` state is **sticky**: a stale `setIdle` does not clear it. It clears only when (a) a new run starts (`setRunning` is observed before the next `setIdle`), or (b) you click the indicator. Clicking in `failed` clears the marker AND opens the General subtab — your acknowledgement.

## Storage layout

```
<vault>/.obsidian/plugins/miyo-hakobi/
├── main.js               (built bundle)
├── manifest.json         (plugin metadata)
├── styles.css            (bundled CSS)
├── data.json             (rule definitions — synced by Obsidian Sync)
├── device.json           (per-device flags — NOT synced)
└── audit/
    ├── 2026-04.ndjson    (rotated)
    ├── 2026-05.ndjson    (current month)
    └── …
```

`data.json` and `device.json` are siblings on purpose — Obsidian Sync replicates `data.json` but not `device.json`. See [Per-device enablement](per-device.md) for the full reasoning.

## Lifecycle

| Event | What Hakobi does |
|-------|------------------|
| Plugin enable | Construct all modules, register settings tab, register commands, start scheduler |
| Plugin disable / Obsidian close | `scheduler.stop()` cancels every timer; Obsidian disposes registered DOM listeners and intervals |
| Plugin reload | Disable + enable in sequence — no state survives, so reload is the canonical "reset" |
| Vault rename / move | Next tick re-validates the rule's vault root; if the old root is gone, the rule fails with `decision: rejected, reason: scope` |

## Part of MiYo

Hakobi is one component in the [MiYo](https://github.com/MMoMM-org) family. It deliberately has **no** integration with the others:

- No coupling to **Tomo**, **Hashi**, **Kado**, or **Seigyo**.
- External access to your vault is the job of [MiYo Kado](https://github.com/MMoMM-org/miyo-kado), the security-first MCP gateway. Hakobi reaches outward to user-configured FS paths but accepts no inbound traffic.
