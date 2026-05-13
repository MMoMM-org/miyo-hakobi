# Security Policy

## Reporting a Vulnerability

If you discover a security issue in MiYo Hakobi, please **do not** open a public GitHub issue. Instead, email **marcus@mmomm.org** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept if applicable)
- The MiYo Hakobi version + Obsidian version + OS

I aim to respond within 7 days. Coordinated disclosure is appreciated for issues that affect user vault contents or credential handling.

---

## What ships to your vault

MiYo Hakobi is an Obsidian plugin. Only the bundled `main.js` (built with esbuild) runs inside Obsidian. Build/test/CI tooling **never executes in the user environment**.

### Production dependencies (bundled in `main.js`)

<!-- List every runtime dependency with one-line purpose. Keep in sync with package.json `dependencies`. -->

| Package | Purpose |
|---|---|
| _none_ | _Plugin currently has no runtime dependencies._ |

These are the only packages whose vulnerabilities can affect users in their vaults.

### Build/test/CI dependencies (never shipped)

`vitest`, `vite` (transitive), `esbuild`, `typescript`, `semantic-release`, `jsdom`, ESLint plugins, etc. — these run only on the maintainer's machine and in GitHub Actions. They never reach a user's Obsidian instance.

---

## Dependabot alert triage

GitHub Dependabot scans the full `package-lock.json` and may surface alerts for **transitive dependencies** that are not part of the shipped bundle. Triage policy:

| Alert location | User-impact | Action |
|---|---|---|
| Direct production dep with exploitable surface | **HIGH** | Fix immediately, release patch |
| Direct production dep, vulnerability in unused feature | Low | Track, fix at next regular update |
| Transitive of production dep, unused feature | Low | Track, upgrade via parent dep |
| Build/test/CI tooling | None | Auto-merge Dependabot patch bumps |

### Currently open alerts (last reviewed 2026-05-13)

MiYo Hakobi has **no runtime dependencies**, so no Dependabot alert can affect a user's vault directly. Open alerts are all in build/test/CI tooling.

**Bundled inside `npm@10.9.8` (a transitive of `semantic-release`) — CI-only, never shipped:**
- `picomatch` — ReDoS via extglob quantifiers; POSIX character-class glob mismatch.
- `ip-address` — XSS in `Address6` HTML-emitting methods (Hakobi never renders IP addresses as HTML).
- `brace-expansion` — ReDoS via zero-step sequence (auto-dismissed by Dependabot).

`npm audit fix` without `--force` is a no-op for the above: the vulnerable versions are pinned by the `npm` CLI that `@semantic-release/npm` bundles. A `--force` fix would downgrade `semantic-release`, which is a regression. Plan: upgrade when `semantic-release` ships against `npm@11+`.

---

## Supported versions

Only the latest minor version receives security patches. MiYo Hakobi follows semantic versioning; the most recent release on `master` is the only supported branch.

| Version | Supported |
|---|---|
| 0.2.x | ✅ |
| < 0.2.0 | ❌ Please upgrade |
