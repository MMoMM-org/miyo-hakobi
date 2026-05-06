# Troubleshooting / FAQ

The most common issues, in roughly the order people hit them.

## My rules don't run

99% of the time: the per-device toggle is off.

Open **Settings → Hakobi → Import** (or **Export**). The leftmost column of every rule row is a toggle. If it's visually subdued / off, the rule is disabled on this device — the scheduler will not start a timer for it. Newly-Synced rules from another device default to **off** on each new device. This is intentional — see [Per-device enablement](per-device.md).

If the toggle is on and the rule still doesn't run:

- **Open the audit log** (`Show audit log` button on the General subtab). If the file doesn't exist yet, the rule has never executed — likely a scope-validation issue at run time. Check the run-summary entries: `decision: rejected, reason: scope` means the runtime validator refused the rule (vault renamed, source path no longer exists, etc.).
- **Check the status bar.** The kanji 運 turns the error color and shows a sticky tooltip after a failure. Click it once to clear the marker AND open the General subtab.

## "Show audit log" doesn't open the file

The button asks your OS to open the current month's `YYYY-MM.ndjson` in whatever application is registered as the default for the `.ndjson` extension. If nothing is registered, nothing happens.

Most modern editors handle `.ndjson` (BBEdit, VSCode, Sublime Text, IntelliJ). On first use you may need to right-click the file in Finder / Explorer once → **Open With** → pick your editor → check **Always use this app**. After that, the button works.

If no audit log file exists yet (you just installed Hakobi and no rule has ever run), you will see a `No audit log entries yet` notice instead.

## Hakobi stopped doing things while my laptop was asleep

Hakobi runs **only while Obsidian is open**. There is no daemon and no make-up runs for missed ticks. When you wake the machine and Obsidian regains focus, the next regularly scheduled tick fires normally — but Hakobi does not back-fill the ticks it missed during sleep.

If you need around-the-clock ferrying, that is explicitly outside Hakobi's v0.1 charter; consider a Hazel rule, a `launchd` / `systemd` unit, or a shell-script cron for that path.

## Import sometimes skips a file

A few possibilities, all visible in the audit log with a specific `errorCode`:

| `errorCode` | Cause | Fix |
|------|-------|-----|
| `io-timeout` | Per-file IO didn't complete within `perFileTimeoutMs` (default 10s). Most often: a cloud-sync placeholder that hasn't materialized yet. | Wait — the next tick usually picks it up. For consistently slow paths, raise `perFileTimeoutMs` on the General subtab. |
| `housekeeping-file` | Filename is in the OS-housekeeping skip list (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.localized`). | This is by design. There is no way to opt these in. |
| `sanitization` | Filename contains NUL bytes, `..` segments, or reduces to empty after stripping control chars. | Rename the source file. |
| `not-stable-yet` | The source file's `mtime` is still changing — another agent is writing to it. Hakobi waits for `stabilityCheckMs` of mtime quiet before picking it up. | Wait for the writing agent to finish. The next tick picks it up. |

Open the audit log to see the exact `decision` + `errorCode` per file.

## My rule "looped" the vault

It didn't. Hakobi refuses at **save time** to create a rule that:

- Has both source and destination inside the vault (vault → vault loops), or
- Targets the vault root, `.obsidian/`, or Hakobi's own plugin data directory.

If you tried to save such a rule, you saw a validation error explaining which boundary you hit. The rule was not saved.

**Two-rule loops** (`/local/path → vault/A`, then `vault/A → /local/different-path`) are not actively detected — they're legitimate use cases ("import from one place, export to another"). If you accidentally point the second rule's destination at the first rule's source, you'll see it in the audit log immediately as a perpetual ferry. Disable one of the rules.

## Two devices running the same rule produced "Conflicted copy" files

Per-device enable flags (`enabledOnThisDevice`) default to `false` on each newly-synced device specifically to prevent this. Pick **one** device that should run each rule. See [Per-device enablement](per-device.md).

## "Why does my import rule keep picking up the same file twice?"

If your import source folder is *itself* the destination of an Obsidian Sync replica from another device (e.g. you point Hakobi at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Captures/` while another device is also Syncing into that folder), Hakobi can pick the file up before Sync has finished materializing it on this machine, or pick it up on multiple devices.

The primary defence is the per-device `enabledOnThisDevice` flag — keep the import rule enabled on **exactly one** device. Prefer configuring import sources to point at local capture folders that Obsidian Sync does **not** write into.

## "Run now" did nothing

If a previous run of the same rule is still in flight, "Run now" is no-op'd and a `Rule already running` notice appears at the bottom of the screen. There is no queueing in v0.1. Wait for the in-flight run to complete; the status bar exits the running state and the next "Run now" works.

## I deleted a rule but its audit-log entries are still there

By design. The audit log is append-only; deleting a rule does **not** retroactively delete its entries. If you want a clean slate, click **Purge audit log now** on the General subtab.

## My rule's source path doesn't exist anymore

The runtime validator catches this on every tick — the rule is rejected with `decision: rejected, reason: scope`, and the run summary records the failure. The rule's per-rule timer keeps firing (so the next tick is also rejected) until you either fix the path (Edit) or disable / delete the rule.

## I changed `Per-file IO timeout` and nothing seems different

Settings changes take effect immediately for the **next** tick — they are not retroactive on a tick already in flight. Wait for the next regular tick (or use "Run now") to confirm the new value is applied.

## Hakobi's status bar disappeared

The status bar item only appears once Hakobi's `onload` has completed. If Obsidian is in the middle of starting up, you may not see it for a second or two. If it stays missing for longer than ~10 seconds:

1. Toggle the plugin off and on in Settings → Community Plugins.
2. Open the Developer Console (`Cmd/Ctrl + Shift + I` on desktop) and look for `[Hakobi]` log lines or red errors.
3. If you see a stack trace, [open an issue](https://github.com/MMoMM-org/miyo-hakobi/issues) with the trace.

## Where do I report bugs?

[GitHub Issues](https://github.com/MMoMM-org/miyo-hakobi/issues). Include:

- Obsidian version (Settings → About → Current version)
- Hakobi version (manifest.json or the header in the settings tab)
- OS + version
- A short reproduction (the failing rule's settings, what you expected, what happened)
- Relevant audit-log entries (use the `Show audit log` button — paste plain text, the log is metadata-only by design)

## Where do I report a security issue?

Do **not** open a public issue. Email **marcus@mmomm.org**. See [SECURITY.md](../SECURITY.md) if it exists, or the project's general security policy.
