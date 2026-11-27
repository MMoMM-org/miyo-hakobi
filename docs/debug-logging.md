# Debug Logging

Hakobi writes to the developer console in two modes: a quiet default, and a detailed mode you switch on while diagnosing a problem. This page explains both, how to see the output, and how to turn the detail off again.

For the audit log (the record of file activity), see [Audit Log](audit-log.md). The console output described here is a diagnostic aid, not a record.

## The switch

Open **Settings → MiYo Hakobi → General**. Under the **Developer** heading, turn **Debug logging** on or off.

- It is **off** by default, including on existing installs that never had the setting.
- It takes effect immediately for the next run. No plugin reload is needed. A run already in progress may still finish writing its detail lines after you turn the switch off.
- The value is saved in `data.json`. It survives restarts and is synced by Obsidian Sync like every other General setting, so changing it on one device changes it on your others.

## Seeing the output: the "Verbose" level

Hakobi writes every routine line at the console's **debug** level. Browsers hide that level by default, so you will see nothing until you enable it.

1. Open the developer console: **Cmd+Option+I** on macOS, **Ctrl+Shift+I** on Windows and Linux. Choose the **Console** tab.
2. Open the **Default levels** dropdown (next to the filter box) and make sure **Verbose** is ticked.
3. Type `Hakobi` in the filter box to hide other plugins' lines.

Warnings and errors are shown at the default levels, so they appear without **Verbose**.

## What is written in each state

### Debug logging off (default)

Only these lines are written:

| What | When | Level |
|------|------|-------|
| Load and unload lines | Plugin load, initial run, unload | debug (needs Verbose) |
| Daily summary | 24 hours after load | debug (needs Verbose) |
| Warnings and errors | When something fails | warn / error (always visible) |

Example load and unload lines:

```
[Hakobi] plugin loading (0.2.4)
[Hakobi] config loaded: 3 rules (2 enabled on this device)
[Hakobi/Scheduler] initial run starting (2 enabled rules)
[Hakobi/Scheduler] initial run finished
[Hakobi] plugin loaded
[Hakobi] plugin unloading
```

No line is written for an individual run: not for a timer run, **Run now**, or a command.

### Debug logging on

Everything above, plus one set of lines per run:

```
[Hakobi/Scheduler] tick begin: Voice memos (import)
[Hakobi/Scheduler] tick end: Voice memos — ok (3 copied, 1 skipped, 0 failed)
[Hakobi/Scheduler] tick begin: Journal export (export) [dry-run]
[Hakobi/Scheduler] tick end: Journal export — ok (0 copied, 0 skipped, 0 failed)
[Hakobi/Scheduler] tick skip: Voice memos (import) — overlap
```

- `tick begin` and `tick end` bracket each run. A dry run is marked `[dry-run]`.
- `tick skip … — overlap` means the rule was still running from the previous tick, so this one was skipped.
- A run that aborts before finishing (for example a scope refusal or a missing source) still ends with `tick end … — ok`, with the counts it reached. The audit log carries the reason. The daily summary counts such a run as failed.

### Warnings and errors, in any state

A run that throws is always written as a warning, naming the rule and the underlying error message:

```
[Hakobi/Scheduler] tick end: Voice memos — failed: ENOSPC: no space left on device
```

The status bar kanji also turns to the error colour. Unexpected exceptions are written with `console.error`, for example `[Hakobi] initial run failed:` or `[Scheduler] Uncaught error in timer tick:`, followed by the error.

## The daily summary

24 hours after the plugin loads, Hakobi writes one line covering all rules together, then starts counting again from zero:

```
[Hakobi] daily summary: 2 completed, 2 failed, 1 overlap skip, 1 dry run; files 3 copied, 1 skipped, 2 failed
```

| Part | Meaning |
|------|---------|
| completed | Non-dry runs that finished normally |
| failed | Runs that threw, plus aborted runs such as a scope refusal, a missing source, or an import that ran out of disk space |
| overlap skip | Ticks skipped because the rule was still running |
| dry run | Dry runs that ended normally |
| files copied / skipped / failed | Totals for **completed, non-dry** runs only. Dry runs and aborted runs add nothing here |

A day with no runs still writes the line, with every count at zero. That shows the plugin is alive.

Things to know:

- The counts live **in memory only**. Reloading the plugin, restarting Obsidian or disabling the plugin resets them, and the activity of an interrupted period is never reported.
- The summary is **not an audit record**. It is not written to the audit log and carries no rule names or paths. For what happened to which file, use the [audit log](audit-log.md).
- It is written whatever the switch is set to.

## Turning it off again

Switch **Debug logging** off in **Settings → MiYo Hakobi → General → Developer**. Per-run lines stop with the next run, and the console returns to the quiet default. You can also untick **Verbose** in the console to hide the debug level entirely.

## Privacy

Rule names appear in some lines. File content never does. See [Developer console](../PRIVACY.md#developer-console) in the privacy policy for what each state writes, including that error messages may contain filesystem paths. Check a console excerpt before you share it publicly.

When you report a bug, a debug log excerpt from a reproduction is very helpful. See [Troubleshooting](troubleshooting.md#where-do-i-report-bugs).
