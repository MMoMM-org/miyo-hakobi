# Privacy Policy — MiYo Hakobi

_Last updated: YYYY-MM-DD._

> Required for any plugin that touches the network, stores credentials, or processes user content beyond the local vault. If your plugin is purely offline with no telemetry, you can drop this file or keep a one-paragraph version that says so explicitly.

## TL;DR

<!-- One-paragraph summary. Example: -->
<!-- MiYo Hakobi is an offline-first, zero-telemetry Obsidian community plugin. Your vault content stays on your machine. The plugin does not phone home and does not collect usage analytics. -->

## What MiYo Hakobi does with your data

<!-- Enumerate every data flow: what is read, what is written, what is sent over the network, where it is stored. -->
- _e.g._ Vault content remains local; no upload.
- _e.g._ Credentials (API tokens) are stored in `<vault>/.obsidian/plugins/miyo-hakobi/data.json`.

## What MiYo Hakobi does NOT do

- **No telemetry.** No usage events, crash reports, or analytics.
- **No third-party tracking.** No advertising IDs, cookies, or fingerprinting.
- **No sharing.** The plugin does not initiate sharing flows.

## Network hosts contacted

<!-- Required if the plugin makes network requests. List every host explicitly — Obsidian reviewers and security-conscious users will check this. -->

| Host | Purpose | Required |
|---|---|---|
| _(none)_ | _Plugin makes no network requests._ | — |

## Permissions and scopes requested

<!-- Required if the plugin uses OAuth or any third-party API. List each scope and why. -->

| Scope | Why |
|---|---|
| _(none)_ | _No third-party API access._ |

## Security of local credentials

<!-- Required if any credentials or tokens are stored locally. -->
- _e.g._ Tokens are stored at `<vault>/.obsidian/plugins/miyo-hakobi/data.json` with `chmod 600` where the platform allows.
- _e.g._ Tokens are NOT stored in `data.json` so that Obsidian Sync does not propagate them across devices.

## Disconnect and data retention

- Uninstalling the plugin removes its bundle from `<vault>/.obsidian/plugins/miyo-hakobi/`.
- Local plugin data (settings, cached state) is retained until the user manually deletes the plugin folder.

## Dependencies and supply chain

The full list of bundled dependencies is visible in `package-lock.json` in this repository. We run `npm audit` on every release; security issues in dependencies are tracked as part of the release checklist (see `SECURITY.md`).

## Open source

- Source code: https://github.com/MMoMM-org/miyo-hakobi
- Issue tracker: https://github.com/MMoMM-org/miyo-hakobi/issues
- License: MIT

## Contact

Privacy-relevant bug reports: open an issue at the tracker above, or email `marcus@mmomm.org`.

## Changes to this policy

Any changes to this policy will be announced in the release notes and in `CHANGELOG.md`.
