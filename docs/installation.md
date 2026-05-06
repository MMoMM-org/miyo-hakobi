# Installation

## From Obsidian Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for **MiYo Hakobi**
3. Click **Install**, then **Enable**

## Using BRAT (recommended while pending review)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) lets you install plugins directly from GitHub before they appear in the Community directory.

1. Install the BRAT plugin
2. In BRAT settings, **Add Beta Plugin** → paste `MMoMM-org/miyo-hakobi`
3. Enable **MiYo Hakobi** in **Settings → Community Plugins**

## Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-hakobi/releases/latest)
2. Create `<your-vault>/.obsidian/plugins/miyo-hakobi/` (if it doesn't exist)
3. Place the three files inside that folder
4. Reload Obsidian and enable **MiYo Hakobi** in **Settings → Community Plugins**

## Platform support

Hakobi is **desktop-only** (`isDesktopOnly: true` in the manifest). It will not appear in Obsidian's Community Plugins list on iOS or Android. The plugin uses Node.js filesystem APIs that are not available on mobile.

| Platform | Status |
|----------|--------|
| macOS | Primary supported platform |
| Linux | Supported (Best Effort) |
| Windows | Community Support (PR Welcome)|
| iOS / Android | Not supported (`isDesktopOnly`) |

## Next steps

- [Configure your first rule](configuration.md) — settings walkthrough, import and export rules
- [Example configurations](example-configs.md) — common setups (voice memos, daily journal, tag bundles)
- [How it works](how-it-works.md) — architecture, scheduler, audit log model
