# Troubleshooting Memory

## Obsidian `normalizePath` strips leading slashes

`normalizePath` from the `obsidian` package assumes **vault-relative input**.
It strips leading and trailing slashes (and NFC-normalizes). Passing an
absolute filesystem path through it silently corrupts the path:

```
normalizePath("/Volumes/Vault/Folder")   // → "Volumes/Vault/Folder"
```

**Symptom in Hakobi (May 2026):** Folder + Note export rules failed with
`errorCode: forbidden-path` while Tag rules succeeded. The Tag path uses
`resolveVaultPath("")` which short-circuits before normalizePath, so it
escaped the bug.

**Rule:** never pass an already-absolute path through `normalizePath`.
Normalize the vault-relative *segment* first, then concatenate with the
absolute base. Applies to any MiYo Obsidian plugin (Kado, Hashi, Seigyo).

**Test mock gotcha:** the mock in `test/__mocks__/obsidian.ts` originally
only collapsed slashes — it did **not** strip leading slashes, so the
Hakobi unit tests passed while the real Obsidian build broke. Mock now
mirrors real behaviour; keep it in sync.

## Doubled separators in rule paths → `forbidden-path`

**Symptom (Sept 2026):** an import rule whose source path was typed as
`/Users/x//Library/Mobile Documents/…` saved without complaint but every run
failed with `forbidden-path`. Save-time validation only checks "absolute, no
`..`", and POSIX resolves `//` fine — so nothing objected until the run-time
guard in `scope.ts`:

```ts
const real = await fs.realpath(root);
if (real !== root && !isInsideRoot(real, root)) return violation("escape", …);
```

`realpath` collapses `//`, the strings differ, and the resolved path is not
*strictly* nested under the declared root — so the symlink guard reads it as an
escape. `escape` maps to `forbidden-path` in `errorCodeMapping`.

**Fix:** `validateRule` now runs every FS path through `canonicalFsPath`
(`normalizeFsPath`, non-throwing). Rules are healed on load, so existing
data.json entries need no re-save. `ImportRuleEditor` builds its rule object
outside `validateRule`, so it normalizes the expanded path itself.

**Rule:** any string that will later be compared against a `realpath()` result
must be canonicalized first. Prefer widening the canonicalization funnel over
loosening the guard.

## Obsidian `Menu.showAtMouseEvent` needs a real event

A synthetic `new MouseEvent("click", { clientX, clientY })` has no `target` and
no `view`, so Obsidian cannot derive the anchor element or owning document and
drops the menu at the viewport edge (Sept 2026: the rule overflow menu appeared
left of the settings window). Use `menu.showAtPosition({ x, y }, doc)` with the
anchor's `getBoundingClientRect()` and `ownerDocument` instead.

## Windows: every rule refused with `forbidden-path` (#15)

`scope.ts` treated only `/…` as absolute, so drive paths (`D:/…`) failed the
save-time shape check (`traversal` → audit `forbidden-path`). Behind it sat a
second trap: `getBasePath()` and `realpath()` return backslashes (and sometimes
a `\\?\` prefix) on Windows while rule paths are forward-slash canonical, so
the realpath escape check refused every rule and the vault-loop guard would
have silently stopped matching. Fix: `isAbsoluteFsPath` accepts drive letters;
every scope comparison goes through `comparablePath` (strip `\\?\`, `\` → `/`,
upper-case drive letter, trim trailing `/`).

**Rule:** scope checks compare *comparable* spellings on both sides — never a
raw `realpath()` / `getBasePath()` string against a stored rule path.

## Scope guard silently disabled by a vault-relative pluginDir (#20)

`main.ts` passed `manifest.dir` (`.obsidian/plugins/<id>`, vault-relative) as
`pluginDir` to the scope validators; `isForbiddenVaultPath` needs it absolute,
so only the vault root was refused and rules into/out of `.obsidian/` passed.
scope.test.ts never noticed because its fixture is absolute. Fix: pass
`vaultIo.resolveVaultPath(pluginDataDir)`; `test/main.scope-wiring.test.ts`
captures what main.ts actually wires and asserts the guard fires.

**Rule:** pure-domain tests prove the guard; a wiring test must prove main.ts
feeds it the shape it expects. DeviceStore keeps the vault-relative value.
