# Test Vault

Minimal Obsidian vault for developing `miyo-hakobi` against a live Obsidian app.

## Setup

1. Open this directory as a vault in Obsidian (**Open folder as vault** → select `test/Hakobi`). The directory name becomes the vault name in Obsidian's sidebar.
2. Trust the author when prompted — this enables community plugins.
3. Build the plugin once so `main.js` exists at the repo root:
   ```bash
   npm run build
   ```
4. Link the build output into the vault's plugin directory:
   ```bash
   mkdir -p .obsidian/plugins/miyo-hakobi
   ln -sf "$(pwd)/../../main.js"      .obsidian/plugins/miyo-hakobi/main.js
   ln -sf "$(pwd)/../../manifest.json" .obsidian/plugins/miyo-hakobi/manifest.json
   ln -sf "$(pwd)/../../styles.css"   .obsidian/plugins/miyo-hakobi/styles.css
   ```
5. Enable the plugin in **Settings → Community plugins**.
6. Run `npm run dev` in another terminal. Hot Reload reloads the plugin on every rebuild.

## What's in here

- `.obsidian/plugins/hot-reload/` — [pjeby/hot-reload](https://github.com/pjeby/hot-reload) v0.3.0, committed so the vault is usable immediately.
- `.obsidian/community-plugins.json` — enables Hot Reload on first open.
- `.gitignore` — keeps workspace state and the plugin's build output out of git.
