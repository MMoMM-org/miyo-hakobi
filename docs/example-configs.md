# Example Configurations

Concrete recipes for common Hakobi setups. Each one is a single rule; you can combine multiple rules in any direction.

For the settings UI walkthrough, see [Configuration Guide](configuration.md). For the architectural model, see [How it works](how-it-works.md).

## 1. Voice memos → Inbox (import)

You record voice memos to a local folder (or a Shortcuts-output folder, or a Whisper transcription folder). You want them to land in your vault's `Inbox/Voice/` folder, mirroring whatever sub-folder structure the source has.

| Field | Value |
|-------|-------|
| Name | `Voice memos` |
| Source path | `~/Recordings/voice-memos` |
| Destination vault folder | `Inbox/Voice` |
| Every (minutes) | `5` |
| Action | `move` (consume from source) — or `copy` if you want to keep originals |
| On collision | `skip` |
| Flatten on target | off |
| Dry run | off |

**Why move:** voice memos are typically one-shot artifacts; you don't want them sitting in two places. **Why skip:** if the same filename ever shows up twice, treat the existing vault file as authoritative.

## 2. Exercise journal → external backup (export, single note)

You keep an excercise journal at `Journal/exercise_log.md` and want a plaintext copy outside the vault at all times.

This recipe is for **one specific note**. If you want every note from the folder exported, use recipe 4 (folder export) instead.

| Field | Value |
|-------|-------|
| Name | `Excercise backup` |
| Source type | `note` |
| Source vault note | `Journal/excercise_log.md` |
| Destination path | `~/Documents/` |
| Every (minutes) | `15` |
| Action | `copy` |
| On collision | `skip` (the destination always exists after the first run; `skip` would never overwrite — which is what you want) — wait, you want to overwrite. Use `suffix` if you want history, or open an issue: a true "overwrite" mode is on the wishlist. |

**Tip:** for a true overwriting backup of a single note, prefer recipe 4 with a one-note folder, or use a Hazel rule outside the vault.

## 3. Tagged notes → publishable folder (export, tag selector)

You tag notes with `#publish` when they're ready to leave the vault (a static-site generator picks them up from a watched folder).

| Field | Value |
|-------|-------|
| Name | `Publish` |
| Source type | `tag` |
| Tags | `publish` |
| Tag match | `any` (single tag, doesn't matter) |
| Destination path | `~/sites/blog/content/` |
| Every (minutes) | `10` |
| Action | `copy` |
| On collision | `suffix` (preserves prior versions; SSGs that read by frontmatter ID won't double-publish) |
| Flatten on target | on (publish folder doesn't care about your vault structure) |
| Dry run | off |

**Variant — multi-tag intersection:** set tags to `publish, ready` and tag match to `all` — only notes carrying both tags export.

**Variant — multi-tag union:** set tags to `publish, draft-public` and tag match to `any` — notes carrying either tag export.

## 4. Project notes → cloud-synced folder (export, folder)

You collaborate with someone outside the vault and want all notes under `Projects/Acme/` mirrored into a folder synced via Dropbox / iCloud / Syncthing.

| Field | Value |
|-------|-------|
| Name | `Acme — Dropbox mirror` |
| Source type | `folder` |
| Source vault folder | `Projects/Acme` |
| Destination path | `~/Dropbox/Acme/notes/` |
| Every (minutes) | `5` |
| Action | `copy` |
| On collision | `suffix` (avoid "Conflicted copy" wars with the sync client) |
| Flatten on target | off (preserve sub-folder structure for the collaborator) |
| Dry run | off |

**Heads up:** if your collaborator is also writing into that folder, expect collisions. The Hakobi run does not coordinate with the cloud-sync client; whichever side writes last wins on disk, and the loser shows up as a sync-client conflict file. The `suffix` collision policy reduces but does not eliminate this. Also Hakobi normally doesn't import that folder by itself. WATCH OUT for Import/Export LOOPS!!!!!!

## 5. Inbox capture from Drafts / Bear / Apple Notes (import)

Many capture apps export to a watch folder. Drafts, Bear, and Apple Notes (via Shortcuts) all support "save to folder" actions. Point Hakobi at that folder.

| Field | Value |
|-------|-------|
| Name | `Drafts → Inbox` |
| Source path | `~/Library/Mobile Documents/iCloud~com~agiletortoise~Drafts5/Documents/exports/` |
| Destination vault folder | `Inbox/Drafts` |
| Every (minutes) | `5` |
| Action | `move` |
| On collision | `suffix` |
| Flatten on target | on (Drafts exports flat already; this just ensures it stays flat in the vault) |
| Dry run | off |

**Cloud-sync caution:** the iCloud Mobile Documents path is a placeholder folder. If iCloud has not yet downloaded a draft on this machine, Hakobi will see it as a placeholder and skip it with `errorCode: io-timeout` after `perFileTimeoutMs`. Once iCloud materializes the file (typically seconds), the next tick picks it up.

## 6. Templates → external "starters" library (export, folder)

You maintain a folder of `Templates/` you want available to other tools (Obsidian itself reads them, but a script outside the vault also wants them).

| Field | Value |
|-------|-------|
| Name | `Templates → starters` |
| Source type | `folder` |
| Source vault folder | `Templates` |
| Destination path | `~/Library/CloudStorage/iCloud Drive/Starters/` |
| Every (minutes) | `30` |
| Action | `copy` |
| On collision | `suffix` (preserve external edits — your script might be writing, too) |
| Flatten on target | off |
| Dry run | off (run it once with **on** first to verify the file list) |

**Recommended workflow:** save the rule with **Dry run: on** for one tick. Open `Show audit log` and confirm the `would-write` entries match the file list you expect. Switch dry-run off.

## 7. One-way archive of an old project (export, folder)

You finished a project and want to archive `Projects/2024-website/` to an external archive folder. You want it moved out of the vault, not copied.

| Field | Value |
|-------|-------|
| Name | `Archive 2024 website` |
| Source type | `folder` |
| Source vault folder | `Projects/2024-website` |
| Destination path | `~/Archive/2024-website` |
| Every (minutes) | `60` (this is a "run once and disable" rule — the cadence barely matters) |
| Action | `move` |
| On collision | `skip` (prefer not to overwrite existing archive files; you want one canonical move) |
| Flatten on target | off (preserve sub-folders) |

After Hakobi has run this once and the source folder is empty, **disable the rule on this device** (toggle off) so future ticks don't keep firing on an empty source. You can also delete the rule entirely.

## Combining rules: "import to vault, then export elsewhere"

Hakobi does not chain rules — each rule is independent. If you want a file to be picked up from disk **and** mirrored elsewhere:

1. **Import rule:** `~/Recordings → Inbox/Voice` (`move`, every 5 min).
2. **Export rule:** `Inbox/Voice → ~/Backups/voice` (`copy`, every 5 min).

Both run independently. There's no shared state, so a file imported in tick N may not be exported until tick N+1 — by design.

**Avoid loops.** Hakobi rejects any single rule whose source and destination are both inside the vault. Two-rule loops (vault → FS → vault into a different folder) are not actively detected; if you create one, you'll see it in the audit log immediately.

## Recommended dry-run workflow

For any new rule that will move files (`action: move`) or operate on a large source folder, save the rule with **Dry run: on** for one tick. Open `Show audit log` and confirm the recorded `would-write` / `would-skip` decisions match your expectation. Then switch dry-run off.

## Per-device enablement reminder

Every rule defaults to `enabledOnThisDevice: false` on every device that did not create it. If you sync your vault between machines, see [Per-device enablement](per-device.md) before being surprised that "the rule didn't run on my laptop."
