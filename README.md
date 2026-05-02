# MiYo Hakobi

> Scheduled file ferry between local filesystem and your Obsidian vault — without inviting any cloud-API, daemon, telemetry, or inbound-network trade-offs.

## Table of Contents

- [What Hakobi does](#what-hakobi-does)
- [What Hakobi does NOT do](#what-hakobi-does-not-do)
- [Installation](#installation)
- [First-run flow](#first-run-flow)
- [Settings layout](#settings-layout)
- [Commands](#commands)
- [Per-device enablement](#per-device-enablement)
- [Audit log](#audit-log)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [Privacy](#privacy)
- [Possible future features](#possible-future-features)
- [Development](#development)
- [License](#license)

## What Hakobi does

Hakobi is an Obsidian community plugin that ferries files between your vault and user-configured **local filesystem paths** on a simple `everyMinutes` schedule.

- **Import** rules pull files from a local FS folder (e.g. `~/Recordings/`) into a vault folder (e.g. `Inbox/Voice/`). Filenames are sanitized so exotic OS filenames cannot break vault paths or escape via `..`.
- **Export** rules push vault content out to a local FS path. Three source-types are supported: a **vault folder** (recursive), a **tag** selector (single tag or multiple with `any` / `all`), or a **single note**.
- Each rule has its own `everyMinutes` schedule. Rule creation is the only approval moment; after that, ferrying happens silently.
- A small **status-bar indicator** (kanji 運) shows live state — neutral (idle), accent (running), error color (last run failed) — with a tooltip that names the running rule and summarises the last outcome.
- Every run is recorded in a **metadata-only NDJSON audit log** kept in the plugin data directory. The log records paths, operations, decisions, byte counts, and timings — never file content, never frontmatter values, never absolute home-directory paths.
- Path traversal and symlinks are refused at scan time. Rules that would loop the vault into itself, or that target the vault root / `.obsidian/` / Hakobi's own data directory, are rejected at save time.

## What Hakobi does NOT do

The following are explicitly **out of scope** for v0.1 and will not arrive without a Constitution review:

- **No external network surface.** No ports, no MCP server, no inbound HTTP listener, no IPC socket. (External access to your vault is the job of [MiYo Kado](https://github.com/MMoMM-org/miyo-kado).)
- **No native cloud-service APIs.** No Dropbox HTTP, no Google Drive REST, no S3, no SFTP, no WebDAV. Hakobi only reads and writes locally-mounted FS paths. Cloud-sync folders that mount as local paths (Dropbox, iCloud Drive, OneDrive, Google Drive's local mirror, Syncthing) are in scope as plain local paths — your trust decision.
- **No mobile support.** `isDesktopOnly: true`.
- **No per-execution approval prompts.** Creating the rule IS the approval. Once saved, a rule runs silently on its schedule.
- **No LLM / AI integration of any kind**, even passively.
- **No coupling to other MiYo components** (Tomo, Hashi, Kado, Seigyo) in v0.1.
- **No daemon / system-service mode.** Hakobi runs only while Obsidian is open.
- **No cron expressions.** Only `everyMinutes`.
- **No make-up runs** for ticks missed while Obsidian was closed or the machine was asleep.
- **No forced materialization** of cloud-sync placeholder files. Stalled placeholders are skipped + logged.
- **No telemetry, analytics, or crash reporting.** Ever. See [PRIVACY.md](PRIVACY.md).

## Installation

### Community Plugins (after listing)

1. Open Obsidian Settings → Community Plugins
2. Search for **MiYo Hakobi**
3. Install and enable

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-hakobi/releases/latest)
2. Create folder `<vault>/.obsidian/plugins/miyo-hakobi/`
3. Copy the downloaded files into that folder
4. Restart Obsidian, then enable the plugin in Settings → Community Plugins

### BRAT (Beta)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `MMoMM-org/miyo-hakobi`

## First-run flow

1. Open Obsidian → Settings → **Hakobi**.
2. You will see a **header** (plugin name, tagline, author/docs/funding links from `manifest.json`) above a row of three subtabs: **General**, **Import**, **Export**.
3. The **General** subtab is selected by default. Adjust global settings if you need to (defaults are sensible).
4. Switch to **Import** or **Export** and click **Add rule**. Name the rule, pick source and destination, set `everyMinutes`, choose `copy | move` and `skip | suffix`, save.
5. Saving sets `enabledOnThisDevice: true` for the device you used to create the rule. The scheduler starts the timer immediately.
6. Watch the status-bar kanji 運 — it turns the accent color while a run is in flight and the error color if a run fails.

## Settings layout

The Hakobi settings tab has a fixed header section followed by three subtabs.

### General subtab

- **Per-file IO timeout (ms)** — applies to every per-file read/write across all rules. Default `10000`. Increase if you ferry to/from slow paths (NAS, large cloud-sync placeholders).
- **Audit retention (days)** — files older than this are pruned at the next rotation. Default `90`.
- **Audit max size (MB)** — per-file cap. Default `10`. Once exceeded, the file rotates.
- **Stability check window (ms)** — how long an import-source file's mtime must be unchanged before Hakobi picks it up. Default `2000`. Prevents picking up half-written files mid-copy by another agent.
- **`Show audit log`** button — opens the **current month's** `YYYY-MM.ndjson` file in your OS default app for `.ndjson`. There is no in-tab viewer; inspect with whatever tool you prefer (text editor, `grep`, `jq`).
- **`Purge audit log now`** button — requires explicit confirmation in a dialog; deletes every NDJSON file under the audit directory and writes a single post-purge marker entry to a fresh log.

### Import subtab

- Empty state: "Add import rule" button.
- Once configured: a list of rules. Each row shows the rule name, source → destination paths, `everyMinutes`, action (`copy` / `move`), collision policy, flat-target flag, an overflow menu (`⋯`), and a per-device enable toggle (`✓`).
- Overflow menu: **Edit** / **Run now** / **Run dry-run** / **Delete**.

### Export subtab

Same shape as Import. Source-type can be **folder** (vault subtree, recursive), **tag** (single tag or multiple with `tagMatch: any | all`), or **note** (a single vault note).

## Commands

Hakobi registers exactly six commands. Obsidian auto-prefixes commands with the plugin name in the command palette, so they appear as `Hakobi: …`.

- `Run all import rules`
- `Run an import rule…`
- `Run all export rules`
- `Run an export rule…`
- `Dry-run an import rule…` — runs the rule without writing anything; the audit log records `would-write` / `would-skip` / `would-suffix` decisions.
- `Dry-run an export rule…` — same, for export rules.

If you invoke a `Run …` command while the same rule is already in flight, it is no-op'd and a `Rule already running` notice appears. There is no queueing in v0.1.

## Per-device enablement

This is the most-likely-to-confuse aspect of Hakobi. Read it once.

- **Rule definitions** live in `<vault>/.obsidian/plugins/miyo-hakobi/data.json`. If you have **Obsidian Sync** enabled and configured to sync plugin data, rule definitions replicate to your other devices.
- **Per-device flags** (`enabledOnThisDevice` per rule, last-run timestamps, transient run state) live in a sibling file `<vault>/.obsidian/plugins/miyo-hakobi/device.json`. Obsidian Sync **does not replicate this file** — it sits outside the `loadData`/`saveData` channel by design.
- A rule that arrives on a new device via Sync defaults to `enabledOnThisDevice: false` on that device. **You must explicitly enable each rule on every device that should run it.**
- This is intentional. Without it, every device would fire the same export to a shared cloud-synced destination at the same `everyMinutes` cadence and produce "Conflicted copy" files. Hakobi does not coordinate or warn about multi-device enablement — it expects you to enable each rule on exactly one device unless you specifically want concurrent runs.

If a rule "doesn't run", this is almost always why. Check the toggle on the right edge of each rule row.

## Audit log

- **Location:** `<vault>/.obsidian/plugins/miyo-hakobi/audit/YYYY-MM.ndjson`. Rotated monthly.
- **Format:** newline-delimited JSON. Each line is one entry — either a per-file entry or a rule-level summary entry (one summary per run).
- **Retention:** defaults to **10 MB per file** and **90 days**, both adjustable on the General subtab. Rotation is opportunistic (checked at run time, not on a separate timer).
- **Scope:** **metadata only.** The writer enforces a closed allowlist of fields (`timestamp`, `ruleId`, `ruleName`, `direction`, `operation`, `decision`, `sourcePathRelative`, `destinationPathRelative`, `errorCode`, `bytesTransferred`, `durationMs`). Any attempt to record a field outside the allowlist is a build-time error in the writer. The audit log NEVER contains file content, frontmatter values, absolute home paths, or vault-root paths. See [PRIVACY.md](PRIVACY.md#audit-log-scope) for the full contract.
- **Cross-plugin readability:** Obsidian gives every installed plugin filesystem access to every other plugin's data directory. Hakobi cannot prevent this; the audit log is metadata-only by design so a hostile or compromised plugin reading it sees rule names, relative paths, operations, and timings — not your note content. See [PRIVACY.md](PRIVACY.md#cross-plugin-readability).
- **Inspection:** click `Show audit log` in Settings → Hakobi → General. There is no in-tab viewer in v0.1; inspection is delegated to your OS default app for `.ndjson`.

## Troubleshooting / FAQ

### My rules don't run

Verify `enabledOnThisDevice` is **on** for each rule on this device. Open Settings → Hakobi → Import (or Export) and look at the toggle at the right edge of each rule row.

Newly-Synced rules from another device default to **disabled** on each new device. This is intentional — see [Per-device enablement](#per-device-enablement).

### "Show audit log" doesn't open the file

The button asks your OS to open the current month's `YYYY-MM.ndjson` in whatever application is registered as the default for the `.ndjson` extension. If nothing is registered, nothing happens.

Most modern text editors handle `.ndjson` (BBEdit, VSCode, Sublime Text, IntelliJ). On first use you may need to right-click the file in Finder / Explorer once → "Open With" → pick your editor → check "Set default" or "Always use this app". After that, the button works.

If no audit log file exists yet (you just installed Hakobi and no rule has ever run), you will see a `No audit log entries yet` notice instead.

### Hakobi stopped doing things while my laptop was asleep

Hakobi runs **only while Obsidian is open**. There is no daemon and no make-up runs for missed ticks. When you wake the machine and Obsidian regains focus, the next regularly scheduled tick fires normally — but Hakobi does not back-fill the ticks it missed during sleep.

If you need around-the-clock ferrying, that is explicitly outside Hakobi's v0.1 charter; consider a Hazel rule, a launchd / systemd unit, or a shell-script cron for that path.

### Import sometimes skips a file

A few possibilities, all visible in the audit log:

- **Stalled cloud-sync placeholder.** Hakobi waits up to `perFileTimeoutMs` (default 10s) for a per-file IO operation to complete. Cloud providers (iCloud Drive, OneDrive Files-On-Demand) keep "placeholder" files that materialize on access; if materialization stalls past the timeout, Hakobi skips the file with `errorCode: io-timeout`. Hakobi never force-materializes placeholders in v0.1.
- **OS housekeeping file.** Files like `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.localized` are skipped by default with `errorCode: housekeeping-file`.
- **Sanitization rejection.** Filenames containing NUL bytes, attempted path traversals (`..`), or that reduce to empty after stripping control characters are refused with `decision: rejected, reason: sanitization`.
- **Stability check.** A file whose mtime is changing (still being written by another agent) is held back until `stabilityCheckMs` of mtime quiet has elapsed.

Open the audit log to see the exact `decision` + `errorCode` per file.

### My rule "looped" the vault

It didn't — Hakobi refuses at **save time** to create a rule that:

- has both source and destination inside the vault (vault → vault loops), or
- targets the vault root, `.obsidian/`, or Hakobi's own plugin data directory.

If you tried to save such a rule, you saw a validation error explaining which boundary you hit.

### Two devices running the same rule produced "Conflicted copy" files

Per-device enable flags (`enabledOnThisDevice`) default to `false` on each newly-Synced device specifically to prevent this. Pick **one** device that should run each rule. See [Per-device enablement](#per-device-enablement).

### "Why does my import rule keep picking up the same file twice?"

If your import source folder is *itself* the destination of an Obsidian Sync replica from another device (e.g. you point Hakobi at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Captures/` while another device is also Syncing into that folder), Hakobi can pick the file up before Sync has finished materializing it on this machine, or pick it up on multiple devices. The primary defence is the per-device `enabledOnThisDevice` flag — keep the import rule enabled on exactly one device. Prefer configuring import sources to point at local capture folders that Obsidian Sync does **not** write into.

## Privacy

Hakobi is local-first with no telemetry, no analytics, and no network surfaces. The full privacy contract — including the closed audit-log field allowlist, the symlink-refusal rationale, and the cross-plugin-readability disclosure — lives in **[PRIVACY.md](PRIVACY.md)**.

## Possible future features

These are ideas that have been considered but are not committed to any release. No promises, no timelines.

- **Export the active note via a chosen rule** — one-shot active-note export with a fuzzy-suggester modal that lists configured export rules. Currently you can configure a `type: note` export rule for any specific note and run it via `Run an export rule…`.

## Development

```bash
git clone https://github.com/MMoMM-org/miyo-hakobi.git
cd miyo-hakobi
git config core.hooksPath .githooks
npm install
npm run dev          # esbuild watch mode
npm run build        # type-check + esbuild production build
npm test             # vitest unit tests
npm run lint         # eslint with eslint-plugin-obsidianmd
npm run typecheck    # tsc --noEmit
```

`npm run dev` watches `src/` and rebuilds `main.js` on change. To live-test in Obsidian, point the watcher's output at your dev vault's `.obsidian/plugins/miyo-hakobi/` directory and use Obsidian's "Reload app without saving" command (or the Hot-Reload plugin) after each rebuild.

## License

MIT — see [LICENSE](LICENSE).
