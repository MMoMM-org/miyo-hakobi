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
