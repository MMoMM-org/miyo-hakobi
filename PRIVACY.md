# Privacy Policy — MiYo Hakobi

_Last updated: 2026-05-01._

## TL;DR

MiYo Hakobi is a local-first, zero-telemetry Obsidian community plugin. It ferries files between your Obsidian vault and user-configured local filesystem paths on a schedule. It has no network surface — no telemetry, no analytics, no crash reporting, no update pings, no inbound HTTP, no outbound HTTP. Your vault content stays on your machine. The only tracking Hakobi does is a local, metadata-only audit log that you can read, paginate, purge, and export from the plugin's settings tab.

This document is the trust contract for v0.1 of the plugin. Every section addresses a specific Constitution L1 / L2 Privacy rule from the [MiYo Constitution](https://github.com/MMoMM-org/miyo-kokoro).

## Network surfaces

**None.** Hakobi v0.1 makes no network requests of any kind.

- No telemetry, no usage analytics, no crash reporting to third-party services.
- No version-update pings, no "phone home" on startup or unload.
- No inbound surface: no HTTP server, no port listener, no IPC socket, no MCP endpoint. (External access to your vault is the job of [MiYo Kado](https://github.com/MMoMM-org/miyo-kado) — Hakobi does not duplicate that surface.)
- No outbound surface: the plugin bundle excludes `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource`. A CI lint check enforces this on every build.
- No third-party SDKs that initiate network calls in the background.

If a future version introduces any network surface, it will be documented here before release and disabled by default.

## Data stored locally

Hakobi stores three things on your local disk, all under your vault's plugin data directory:

| What | Where | Synced by Obsidian Sync? |
|---|---|---|
| Rule definitions (import/export rule names, paths, schedules, copy/move mode, collision behavior, dry-run flag, etc.) | `<vault>/.obsidian/plugins/miyo-hakobi/data.json` | **Yes**, if you have Obsidian Sync enabled and configured to sync plugin data. |
| Per-device flags (`enabledOnThisDevice` per rule, last-run timestamps, transient run state) | `<vault>/.obsidian/plugins/miyo-hakobi/device.json` | **No** — intentionally a sibling file outside `data.json` so each device decides for itself which rules run. Newly synced rules default to `enabledOnThisDevice: false` on every device. |
| NDJSON audit log files | `<vault>/.obsidian/plugins/miyo-hakobi/audit/YYYY-MM.ndjson` (rotated monthly) | Depends on your Obsidian Sync configuration. The audit log is metadata-only by design (see below); we recommend excluding the `audit/` directory from Sync if you do not want diagnostic logs replicated across devices. |

Defaults for the audit log: rotate monthly, cap each file at **10 MB**, retain for **90 days**. You can change these in Settings → General. A "Purge audit log" button is available in the same tab.

Hakobi v0.1 stores **no credentials** anywhere — there are no API tokens, no OAuth refresh tokens, no passwords, because there is no remote service to authenticate against. If a future version adds external integrations, credentials will be stored in a separate sibling file (not in `data.json`) so that Obsidian Sync does not propagate them across devices.

## Data sent externally

**None.** Hakobi sends no data anywhere outside your machine.

- No telemetry events.
- No analytics events.
- No third-party crash reporting.
- No update pings, no version checks against any server.
- No remote events of any kind.

The audit log is the only "tracking" Hakobi does, and it is **local, metadata-only, and visible to you** in the General settings tab.

## Audit log scope

Audit log entries are constrained to a closed allowlist of fields. The plugin will refuse to write any field outside this list. The allowed fields are:

- `timestamp` — wall-clock ISO-8601 of the entry.
- `ruleId` — opaque UUID of the rule that produced the entry.
- `ruleName` — user-chosen name of the rule (e.g. `"Voice memos to Inbox"`).
- `direction` — `import` or `export`.
- `operation` — one of `copy`, `move`, `skip`, `suffix`, `rejected`, `error`, `would-write`, `would-skip`, `would-suffix`, `skipped`.
- `decision` — short summary of why this operation was chosen (e.g. `"new file"`, `"collision-skip"`, `"sanitization-rejected"`).
- `sourcePathRelative` — path **relative to the rule's source root**. Never absolute, never includes home-directory components.
- `destinationPathRelative` — path **relative to the rule's destination root**. Never absolute.
- `errorCode` — closed enum value (e.g. `source-not-found`, `symlink-refused`, `loop-refused`, `io-timeout`). Never a raw exception string, never a stack trace.
- `bytesTransferred` — integer byte count. Never the bytes themselves.
- `durationMs` — wall-clock duration of the operation.
- `fileCount` — number of files processed in a rule-run summary entry.
- `success` — boolean for rule-run summary entries.

**The audit log NEVER contains:**

- File content (no bytes, no excerpts, no hashes of bytes).
- Frontmatter values (no YAML, no field values, no tags-as-data).
- Full home-directory absolute paths (paths are always relative to the rule root).
- Full vault-root absolute paths.
- Credentials, tokens, environment variables, or process arguments.
- Any field outside the allowlist above. The writer enforces this at the type level (closed `AuditEntry` discriminated union); any attempt to add a field is a build-time error, not a runtime check.

This addresses Constitution **L2 Privacy & Security**: "Audit logs and operation traces produced by MiYo components must record metadata only — never note content, frontmatter values, file bytes, or credentials."

## Symlinks

**Symlinks are refused at scan time.**

When Hakobi walks an import source directory or resolves an export destination, any encountered symlink — file or directory — is logged with `errorCode: symlink-refused` (or `subdir-is-symlink`) and skipped. Hakobi never follows symlinks.

Rationale: a symlink under a configured rule root could point anywhere on the filesystem (including outside the user's intended subtree, into `/etc`, `~/.ssh`, another vault, etc.). Refusing them at scan time is the simplest defence against path-traversal escapes from the configured rule subtree, and it complements the filename sanitization pipeline (F4) and the default-deny path resolver (F9) which `realpath()`s every candidate and rejects anything escaping the declared root.

If you have a legitimate use case for following a symlink, the supported path is to configure the symlink target directly as the rule's source or destination.

## Cloud-sync destinations

Hakobi treats locally-mounted cloud-sync folders (Dropbox, iCloud Drive, OneDrive, Google Drive's local mirror, Syncthing, etc.) as **ordinary local filesystem paths**. From the plugin's perspective there is no difference between `~/Documents/notes/` and `~/Dropbox/notes/` — both are local paths.

**This means: your choice of destination is your trust decision.** If you configure an export rule that writes to a cloud-synced folder, those files will be uploaded to that cloud provider as soon as the sync client picks them up. Hakobi cannot and does not warn you which folders on your machine are cloud-synced — that is information only your OS and the sync client have.

Mitigations Hakobi provides:

- Destination paths are shown plainly in the rule list, so you can see at a glance which rules write where.
- The per-device `enabledOnThisDevice` flag (F8) limits accidental multi-device firing: a rule synced via Obsidian Sync to a second device defaults to disabled and must be explicitly enabled there.
- Rule creation is the only approval moment; once created, a rule runs silently on its schedule. Re-read your rule list periodically.

Native cloud-service APIs (Dropbox HTTP, Google Drive REST, S3, SFTP) are explicitly **out of scope** for v0.1. Hakobi will not gain such integrations without a Constitution review and an explicit feature flag.

## Cross-plugin readability

Obsidian's plugin model gives every installed plugin filesystem access to every other plugin's data directory under `<vault>/.obsidian/plugins/`. There is no per-plugin sandbox. **This is a property of Obsidian, not a Hakobi choice.**

Consequences for Hakobi:

- Other Obsidian plugins you install can, in principle, read `data.json`, `device.json`, and the `audit/*.ndjson` files.
- Hakobi cannot prevent this.

Mitigations that are Hakobi's responsibility:

- The audit log is metadata-only by design (see above), so a plugin reading it sees rule names, relative paths, operations, and timings — not your note content.
- Hakobi v0.1 stores **no credentials**, so there is nothing sensitive in `data.json` for another plugin to exfiltrate.
- This document calls out the cross-plugin readability explicitly so that, if your threat model includes "another installed plugin is hostile or compromised", you can decide which plugins you trust before installing them.

If you treat your audit log as sensitive (e.g. rule names that themselves describe sensitive folder structures), consider naming rules generically.

## Permissions and scopes requested

| Scope | Why |
|---|---|
| _(none)_ | _No third-party API access. No OAuth. No tokens._ |

## Security of local credentials

Not applicable in v0.1 — Hakobi stores no credentials. If a future version adds an integration that requires credentials, those credentials will be stored in a sibling file (not `data.json`) with platform-appropriate file permissions, and this section will be updated before that version ships.

## Disconnect and data retention

- Disabling the plugin in Obsidian's community-plugins panel stops all scheduled runs immediately and unloads all timers.
- Uninstalling the plugin removes the plugin bundle from `<vault>/.obsidian/plugins/miyo-hakobi/`, but Obsidian preserves the plugin's data directory by default. To delete all Hakobi state, manually remove `<vault>/.obsidian/plugins/miyo-hakobi/` after uninstalling.
- The "Purge audit log" button in Settings → General deletes all `audit/*.ndjson` files and writes a single post-purge marker entry to the new month's log.
- Hakobi does not retain anything outside the plugin data directory.

## Dependencies and supply chain

Runtime dependencies are bounded with semver ranges in `package.json`. The full list of bundled dependencies is visible in `package-lock.json` in this repository. We run `npm audit` on every release; security issues in dependencies are tracked as part of the release checklist (see `SECURITY.md`).

Hakobi v0.1 has no runtime dependencies that perform network I/O.

## Open source

- Source code: https://github.com/MMoMM-org/miyo-hakobi
- Issue tracker: https://github.com/MMoMM-org/miyo-hakobi/issues
- License: MIT

The full implementation — including the audit-log writer, the path resolver, and the lint check that forbids `fetch` / `XMLHttpRequest` / `WebSocket` — is auditable in source.

## Contact

Privacy-relevant bug reports: open an issue at the tracker above, or email `marcus@mmomm.org`.

## Changes to this policy

Any changes to this policy will be announced in the release notes and in `CHANGELOG.md`. The git history of this file is the canonical record of past versions.
