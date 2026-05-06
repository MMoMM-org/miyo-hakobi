# Per-device Enablement

This is the **single most-likely-to-confuse** aspect of Hakobi. Read it once.

## The model

Hakobi splits storage into two sibling files:

| File | Synced by Obsidian Sync? | What it stores |
|------|--------------------------|----------------|
| `data.json` | **Yes** (if Sync is enabled and configured for plugin data) | Rule definitions: name, paths, schedule, copy/move mode, collision behavior, dry-run flag |
| `device.json` | **No** — intentionally outside the `loadData`/`saveData` channel | Per-device flags: `enabledOnThisDevice` per rule, last-run timestamps, transient run state |

The split is deliberate. **A rule definition is portable; the decision to RUN a rule is per-device.**

## Why

Imagine you have one rule:

> **Daily journal export** → `~/Dropbox/journal-today.md`, every 15 minutes, action `copy`.

You configure it on your Mac. You also use Obsidian on your Linux laptop. Obsidian Sync replicates `data.json`, so the rule definition appears on both machines. Now what?

- **If both devices ran the rule automatically:** they would both fire every 15 minutes, both write to the same `~/Dropbox/journal-today.md` (same path on both machines because home directories happen to coincide, or different paths if home directories differ — neither of which is what you wanted), and the cloud-sync client would either lose writes or produce "Conflicted copy" files.
- **If you had to manually disable the rule on the second machine:** that's a setting you have to remember, on every newly-synced rule, on every device.

Hakobi takes the **safer default**: a freshly-synced rule arrives with `enabledOnThisDevice: false`. You opt every device in explicitly.

## What you'll see

### Scenario 1: Newly synced rule, scheduler doesn't run

You created a rule on Device A. You opened Obsidian on Device B. The rule is visible in Settings → Hakobi → Import (or Export) — but **the per-device toggle is off**, the timer is not running, and the status bar stays idle.

→ **Fix:** flip the toggle on Device B. The timer starts immediately.

### Scenario 2: "I deleted the rule on Device A but it's still on Device B"

Obsidian Sync replicates rule **deletions** as well as additions. If the rule still exists on Device B, Sync hasn't replicated yet (network paused, sync disabled, etc.). Wait for the next sync, or check Sync's log on Device B.

### Scenario 3: "Conflicted copy" files appearing

You forgot to disable the rule on one device. Both are firing the same export to the same destination. Pick one device to be the source of truth, disable the toggle on every other device.

### Scenario 4: A rule "doesn't run" — no obvious reason

Almost always: the toggle is off. Open Settings → Hakobi → the rule's subtab → look at the leftmost column of the rule row. The toggle is visually subdued when off.

## Storage details

`device.json` lives at `<vault>/.obsidian/plugins/miyo-hakobi/device.json`. It is a sibling of `data.json` in the same plugin data directory.

The reason it's a **sibling file** rather than a section of `data.json`: Obsidian's Sync explicitly replicates `data.json` (when plugin-data sync is enabled). Anything stored alongside it in the same JSON file is replicated too. To opt **out** of replication, the data has to live somewhere Obsidian's Sync does not look — hence the sibling file.

`device.json` contents are intentionally minimal:

```json
{
  "deviceId": "<random uuid generated on first run>",
  "rules": {
    "<ruleId>": {
      "enabledOnThisDevice": true,
      "lastRunAt": "2026-05-06T08:23:11.412Z"
    }
  }
}
```

The `deviceId` is generated locally on first run, never sent anywhere, and is used only as a stable identifier inside `device.json` — it has no role outside the file.

## What ABOUT cross-device coordination?

Hakobi does not coordinate or warn about multi-device enablement. It does not watch for "this rule is also enabled on another device." Cross-device coordination would require either a shared state surface (against the local-first principle) or a heuristic ("did `lastRunAt` change without my knowledge?") that has its own false-positive failure modes.

Pick **one** device per rule. If you need belt-and-braces, run a reconciler periodically: `cat $vault/.obsidian/plugins/miyo-hakobi/device.json | jq` on each machine, eyeball the toggles.

## Summary

- Rule **definitions** sync. Rule **execution** is per-device.
- Newly synced rules default to **off** on every device that didn't create them.
- The toggle is the leftmost element of every rule row. If a rule "doesn't run," check the toggle.
- Hakobi does not coordinate across devices. Pick one device per rule.

If you are now thinking "the toggle should be more visually prominent so I notice it," open an issue — accessibility / discoverability feedback is welcome.
