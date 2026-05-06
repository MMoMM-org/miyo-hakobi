# Audit Log

Every Hakobi run is recorded in a metadata-only NDJSON log. The log is local-first, never leaves your machine, and contains **no file content** — see the [field allowlist](#field-allowlist) below for the complete list of what is recorded.

For the privacy contract that the audit log implements, see [PRIVACY.md](../PRIVACY.md#audit-log-scope).

## Location

```
<vault>/.obsidian/plugins/miyo-hakobi/audit/YYYY-MM.ndjson
```

One file per calendar month, named after the month's UTC year and month (e.g. `2026-05.ndjson`). The current month's file is the one written to; previous months are read-only.

## Format

Newline-delimited JSON. Each line is one entry — a complete JSON object, terminated by `\n`. Two entry shapes:

### Per-file entry

One entry per file that the runner considered.

```json
{
  "timestamp": "2026-05-06T08:23:11.412Z",
  "ruleId": "rule-id-a",
  "ruleName": "Voice memos",
  "direction": "import",
  "operation": "copy",
  "decision": "written",
  "sourcePathRelative": "memo-2026-05-06-08-22.m4a",
  "destinationPathRelative": "Inbox/Voice/memo-2026-05-06-08-22.m4a",
  "bytesTransferred": 1843204,
  "durationMs": 78
}
```

### Run-summary entry

One entry per run, written at the end. Aggregates the per-file decisions for that tick.

```json
{
  "timestamp": "2026-05-06T08:23:11.490Z",
  "ruleId": "rule-id-a",
  "ruleName": "Voice memos",
  "direction": "import",
  "operation": "summary",
  "decision": "ok",
  "durationMs": 84
}
```

## Field allowlist

The writer enforces a closed allowlist at compile time — adding a field outside the list is a build-time error. Constitution L2 Privacy compliance is structural, not by convention.

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | ISO 8601 UTC string | Always present, millisecond precision. |
| `ruleId` | opaque string | The `RuleId` brand from `domain/ruleId.ts`. Stable across renames. |
| `ruleName` | string | Human-readable rule name at the time of the run. May change between runs if the rule was edited. |
| `direction` | `"import"` \| `"export"` | The rule's direction. |
| `operation` | string | `"copy"`, `"move"`, `"summary"`, `"would-copy"`, `"would-move"`, `"would-summary"` (dry-run variants). |
| `decision` | string | `"written"`, `"skipped"`, `"rejected"`, `"would-write"`, `"would-skip"`, `"would-suffix"`, `"ok"`, `"failed"`. |
| `sourcePathRelative` | string \| absent | Source path relative to the rule's source root. **Never absolute.** **Never the home directory path.** Absent on summary entries. |
| `destinationPathRelative` | string \| absent | Destination path relative to the rule's destination root. Same rules as source. Absent on summary entries. |
| `errorCode` | string \| absent | One of `io-timeout`, `not-stable-yet`, `housekeeping-file`, `sanitization`, `scope`, `unknown`. Present only when `decision` is `skipped`, `rejected`, or `failed`. |
| `bytesTransferred` | integer \| absent | Source size for `written` / `would-write`; absent otherwise. |
| `durationMs` | integer | Wall-clock duration for the per-file IO or the whole run. |

## What the log NEVER contains

This is the entire point of the closed allowlist:

- ❌ File content
- ❌ Frontmatter values
- ❌ Note titles when used as content (only the `ruleName` is recorded; note paths are recorded as relative paths, not as titles)
- ❌ Absolute filesystem paths
- ❌ Home directory paths (`/Users/<you>/`, `/home/<you>/`)
- ❌ Tag values (when a tag-export rule runs, the audit log records per-note paths but not which tag matched)
- ❌ User identity (no machine ID, no usernames, no IPs)
- ❌ Any timestamps in your local timezone — UTC only

## Retention

Two retention rules apply at every rotation check:

| Rule | Default | Configurable in |
|------|---------|----------------|
| Per-file size cap | 10 MB | General subtab → "Audit max size (MB)" |
| Age limit | 90 days | General subtab → "Audit retention (days)" |

When a check fires:

1. If the **current month's** file has exceeded the size cap, the file is rotated. (The mechanic for rotating mid-month is to truncate the over-cap file to its first lines until it is under the cap — the writer does not start a new file mid-month. This keeps the "one file per UTC month" invariant.)
2. Files whose entire content is older than the age limit are deleted.

Rotation checks are **opportunistic**, not on a separate timer:

- Once at plugin enable (after `globalSettings` is loaded).
- After every General-subtab settings save (so a freshly-tightened retention takes effect immediately).
- A best-effort attempt at every audit-log write (cheap; no file open if the in-memory size estimate is under cap).

There is no daily rotation timer. Hakobi does not hold audit-log file handles open between writes.

## Inspection

Click **Show audit log** in Settings → Hakobi → General. This calls Obsidian's `openWithDefaultApp` on the current month's file, which delegates to your OS. Whatever your OS has registered as the default for `.ndjson` opens — typically a text editor.

Most modern editors handle NDJSON well (BBEdit, VSCode, Sublime Text, IntelliJ). If nothing happens when you click the button, your OS has no default registered for the extension. On macOS / Windows, right-click the file once in Finder / Explorer, **Open With → Choose Application**, pick your editor, check "Always use." After that, the button works.

For programmatic inspection, the file is plain NDJSON — every line is a self-contained JSON object. Process with `jq`, `grep`, or a one-liner Python:

```bash
# all skipped imports today
jq -c 'select(.direction=="import" and .decision=="skipped")' \
  "<vault>/.obsidian/plugins/miyo-hakobi/audit/$(date +%Y-%m).ndjson"

# total bytes transferred this month, grouped by rule
jq -s 'group_by(.ruleName) |
       map({rule: .[0].ruleName,
            bytes: (map(.bytesTransferred // 0) | add)})' \
  "<vault>/.obsidian/plugins/miyo-hakobi/audit/$(date +%Y-%m).ndjson"
```

## Purging

The **Purge audit log now** button (General subtab) deletes every NDJSON file under the audit directory after explicit confirmation in a modal dialog.

After purge, Hakobi writes a single marker entry to a fresh log file:

```json
{
  "timestamp": "2026-05-06T08:30:00.000Z",
  "ruleId": "—",
  "ruleName": "—",
  "direction": "import",
  "operation": "summary",
  "decision": "ok",
  "durationMs": 0
}
```

This is intentionally a no-op-shaped marker that an external monitoring tool can recognize as "purge happened" without leaking that the user purged the log content.

## Cross-plugin readability

Obsidian gives every installed plugin filesystem access to every other plugin's data directory. Hakobi cannot prevent this. The audit log is metadata-only **specifically so** a hostile or compromised plugin reading it sees rule names, relative paths, operations, and timings — not your note content.

If you treat your audit log as sensitive (e.g. the rule name itself reveals confidential context), consider:

- Renaming the rule to a generic identifier.
- Reducing retention.
- Periodic purges.

The `Purge audit log now` button is the user-facing tool for this.
