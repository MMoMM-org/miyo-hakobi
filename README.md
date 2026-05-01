# MiYo Hakobi

Scheduled file ferry between local filesystem and your Obsidian vault — import voice memos / snippets / etc. into your inbox, export folders / tags / notes to external locations.

## Installation

### Community Plugins (after listing)
1. Open Obsidian Settings → Community Plugins
2. Search for "MiYo Hakobi"
3. Install and enable

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-hakobi/releases/latest)
2. Create folder `<vault>/.obsidian/plugins/miyo-hakobi/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin

### BRAT (Beta)
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `MMoMM-org/miyo-hakobi`

## Usage

<!-- Describe how to use the plugin -->

## Development

```bash
git clone https://github.com/MMoMM-org/miyo-hakobi.git
cd miyo-hakobi
git config core.hooksPath .githooks
npm install
npm run dev       # Watch mode
npm run build     # Production build
npm test          # Run tests
npm run lint      # Lint
```

## Privacy

Hakobi is local-first with no telemetry, no analytics, and no network surfaces. See [PRIVACY.md](PRIVACY.md) for the full privacy contract.

## License

MIT - see [LICENSE](LICENSE)
