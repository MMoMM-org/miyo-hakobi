# Decisions Memory

## Settings UI: mirror miyo-kado's IA pattern

When designing settings UIs for Hakobi (and other MiYo Obsidian plugins), follow `miyo-kado`'s layout:

- **Single `PluginSettingTab`** at the top.
- **Header section** (always visible): plugin name + tagline, author/docs/funding URLs sourced from `manifest.json` so they cannot drift from the Community Plugins listing.
- **Manually-rendered subtabs** below the header (Obsidian doesn't ship native subtabs — implement as a row of `ButtonComponent`s with `mod-cta` on the active one + a body container that re-renders on switch).
- **Inline expand pattern** for editors (clicking "Add X" inserts the form directly into the subtab body, not a separate Modal overlay).

For Hakobi specifically: subtabs are General / Import / Export. Audit-log inspection is delegated to the OS default app via a "Show audit log" button on the General subtab — no in-tab pagination/filter UI.

**Why:** Recognizable across the MiYo ecosystem; saves the cost of bespoke audit-viewer UI; lets users use grep/jq/their preferred tooling against raw NDJSON.

**Source of truth:** Kokoro ADR for Kado's settings UI; the pattern was confirmed in this repo's SDD ADR-10 (`docs/XDD/specs/001-v0-1/solution.md`).
