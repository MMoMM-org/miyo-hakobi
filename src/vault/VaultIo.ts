// VaultIo — single adapter that owns all in-vault I/O (T1.8).
//
// WHY this file exists:
// Hakobi reaches into Obsidian only through this class. It wraps `app.vault`,
// `app.metadataCache`, and `app.workspace` so the rest of the plugin (rule
// runner, transfer engines, settings UI, audit) never imports `obsidian`
// directly and never touches `node:fs` / `node:path` for vault content. That
// matters for two Constitution rules:
//   - L1 Privacy & Security — vault content stays on the documented path
//     (Vault API), never side-channels via `vault.adapter` or raw fs.
//   - L2 Performance       — going through the Vault API keeps Obsidian's
//     metadata cache, indexer, and Sync coherent. Bypassing it on writes
//     desynchronises every consumer that depends on the cache.
//
// Design notes:
//  - No raw `fs` / `path` imports. Vault content is routed through the Vault
//    API (`readBinary`, `createBinary`, `modifyBinary`, `createFolder`).
//  - `notesByTag` honours ADR-11 nested-tag inclusion: a rule tag of
//    `#projects` matches a file tag of `#projects/foo`. Implementation lives
//    in `tagMatches`.
//  - `listFolder({ recursive })` returns `TFile[]`, never string paths — the
//    caller can read `.path` and the consumer-facing types stay structurally
//    compatible with Obsidian's own surfaces.
//  - `VaultIoError` carries a closed `kind` discriminator
//    (`"not-found" | "not-folder" | "not-file"`) so callers can pattern-match
//    typed failures without parsing strings. `"not-file"` is emitted by
//    `writeBinary` when a TFolder occupies the target path — the slot is not
//    eligible to be overwritten as a file.
//  - Structurally compatible with `VaultIoScopeAdapter` from
//    src/domain/scope.ts on the `existsAtVaultPath` shape.
//  - T2.6 ExportRunner additions:
//    `fileByPath(path)` — thin wrapper around `app.vault.getFileByPath` so
//    ExportRunner can resolve a vault-relative note path to a TFile without
//    reaching into Obsidian directly.
//    `deleteNote(file)` — wraps `app.vault.delete` so ExportRunner's
//    `action: move` can remove the vault note after the FS write is confirmed.
//    `resolveVaultPath(path)` — converts a vault-relative path to an absolute
//    FS path via `app.vault.adapter.getBasePath()`. Required by
//    `VaultIoScopeAdapter` (scope.ts) and ExportRunner's scope validation.

import {
  type App,
  type CachedMetadata,
  TFile,
  TFolder,
  getAllTags,
} from "obsidian";

// ---------------------------------------------------------------------------
// VaultIoError — typed failure for the small set of paths that can produce a
// recoverable error (file/folder not found, wrong kind at path).
// ---------------------------------------------------------------------------

export type VaultIoErrorKind = "not-found" | "not-folder" | "not-file";

export class VaultIoError extends Error {
  public readonly kind: VaultIoErrorKind;
  public readonly path: string;

  constructor(kind: VaultIoErrorKind, path: string, message?: string) {
    super(message ?? `VaultIo: ${kind} at ${path}`);
    this.name = "VaultIoError";
    this.kind = kind;
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Tag matching helper (module-scoped, pure).
//
// ADR-11: rule tag `#projects` matches file tag `#projects/foo`. A file tag
// matches a rule tag iff they are equal OR the file tag starts with
// `<ruleTag>/`. Anything else is rejected.
// ---------------------------------------------------------------------------

function tagMatches(fileTag: string, ruleTag: string): boolean {
  return fileTag === ruleTag || fileTag.startsWith(`${ruleTag}/`);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class VaultIo {
  constructor(private readonly app: App) {}

  /**
   * Read a binary file from the vault by path.
   * @throws VaultIoError(kind='not-found') if no file exists at `path`.
   */
  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.app.vault.getFileByPath(path);
    if (file === null) {
      throw new VaultIoError("not-found", path);
    }
    return this.app.vault.readBinary(file);
  }

  /**
   * Write a binary buffer at `path`. Modifies an existing file or creates a
   * new one as appropriate. The Vault API handles the read-modify-write.
   *
   * @throws VaultIoError(kind='not-file') if a TFolder occupies the path.
   */
  async writeBinary(path: string, bytes: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, bytes);
      return;
    }
    if (existing instanceof TFolder) {
      // A folder occupies the slot; createBinary would fail at the Obsidian
      // API level. Surface a typed error instead.
      throw new VaultIoError("not-file", path);
    }
    await this.app.vault.createBinary(path, bytes);
  }

  /** True iff a file or folder currently exists at the vault-relative path. */
  existsAtVaultPath(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  /**
   * List the TFile children of a folder.
   * - `recursive: false` returns only immediate TFile children (sub-folders skipped).
   * - `recursive: true` returns ALL TFile descendants (depth-first walk).
   *
   * @throws VaultIoError(kind='not-folder') if the path does not resolve to a TFolder.
   */
  async listFolder(
    path: string,
    opts: { recursive: boolean },
  ): Promise<TFile[]> {
    const node = this.app.vault.getAbstractFileByPath(path);
    if (!(node instanceof TFolder)) {
      throw new VaultIoError("not-folder", path);
    }

    if (!opts.recursive) {
      return node.children.filter((c): c is TFile => c instanceof TFile);
    }

    const out: TFile[] = [];
    const stack: TFolder[] = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const child of current.children) {
        if (child instanceof TFile) {
          out.push(child);
        } else if (child instanceof TFolder) {
          stack.push(child);
        }
      }
    }
    return out;
  }

  /**
   * Find markdown notes whose tags match the given rule.
   *
   * - `match='any'`: file matches if at least one of its tags matches at least
   *   one rule tag (with nested-tag inclusion per ADR-11).
   * - `match='all'`: file matches if every rule tag matches at least one file tag.
   *
   * Files with no metadata cache (or no tags) are excluded.
   */
  async notesByTag(tags: string[], match: "any" | "all"): Promise<TFile[]> {
    const out: TFile[] = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache: CachedMetadata | null =
        this.app.metadataCache.getFileCache(file);
      if (cache === null) continue;
      const fileTags = getAllTags(cache);
      if (fileTags === null || fileTags.length === 0) continue;

      const matched =
        match === "any"
          ? tags.some((rt) => fileTags.some((ft) => tagMatches(ft, rt)))
          : tags.every((rt) => fileTags.some((ft) => tagMatches(ft, rt)));

      if (matched) out.push(file);
    }
    return out;
  }

  /** The currently-active markdown file in the workspace, or null if none. */
  getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  /**
   * Ensure that a folder exists at `path`. No-op if it already does. If a
   * non-folder file occupies the path, throws VaultIoError(kind='not-folder').
   */
  async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing === null) {
      await this.app.vault.createFolder(path);
      return;
    }
    if (existing instanceof TFolder) return;
    // Path exists but is not a folder.
    throw new VaultIoError("not-folder", path);
  }

  /**
   * Rename a vault path. Thin pass-through to `app.vault.adapter.rename` —
   * required by AtomicWriter (T1.9) for the temp-then-rename pattern, where
   * the source path is a sibling temp file with no corresponding TFile entry
   * in the high-level Vault API. We accept the documented (and Sync-aware)
   * caveat that adapter-level rename does not refresh the metadata cache as
   * eagerly as `app.fileManager.renameFile`; for tmp-files in the atomic
   * write path that's the desired behaviour — they are never indexed.
   */
  async renameInVault(from: string, to: string): Promise<void> {
    await this.app.vault.adapter.rename(from, to);
  }

  /**
   * Remove a vault path. Thin pass-through to `app.vault.adapter.remove` —
   * used by AtomicWriter (T1.9) for best-effort cleanup of temp files when
   * an atomic write fails part-way. Same rationale as `renameInVault` for
   * not going through the high-level API: the temp file has no TFile.
   */
  async removeInVault(path: string): Promise<void> {
    await this.app.vault.adapter.remove(path);
  }

  /**
   * Resolve a vault-relative path to an absolute filesystem path.
   * Uses `app.vault.adapter.getBasePath()` — the canonical way to get the
   * vault root on desktop Obsidian (Electron / DataAdapter). Empty-string
   * input returns the vault root itself.
   *
   * Added in T2.6 to satisfy `VaultIoScopeAdapter.resolveVaultPath` and to
   * give ExportRunner a typed way to compute absolute child paths for
   * scope validation without reaching into Obsidian internals directly.
   */
  /**
   * Inverse of {@link resolveVaultPath}: given an absolute filesystem path,
   * return the vault-relative segment if the path is inside the vault, or
   * `null` if it is not.
   *
   * Used by main.ts's `openInDefaultApp` seam: Obsidian's
   * `app.openWithDefaultApp(path)` expects a vault-relative path. Passing
   * an absolute path silently fails because Obsidian re-roots it under the
   * vault directory and finds nothing. Callers convert with this method,
   * fall back to a Notice (or future Electron `shell.openPath`) if it
   * returns `null`.
   *
   * Edge cases:
   *  - Vault root itself returns "" (empty string), mirroring `resolveVaultPath("")`.
   *  - A path that shares a prefix with the vault root but is NOT nested
   *    (e.g. `/Volumes/VaultExtra` vs `/Volumes/Vault`) returns `null` —
   *    we require an exact `/` boundary.
   */
  vaultRelativeOf(absPath: string): string | null {
    const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
    const v = adapter.getBasePath().replace(/\/+$/, "");
    if (absPath === v) return "";
    if (absPath.startsWith(`${v}/`)) return absPath.slice(v.length + 1);
    return null;
  }

  resolveVaultPath(vaultRelPath: string): string {
    const adapter = this.app.vault.adapter as unknown as { getBasePath(): string };
    const base = adapter.getBasePath();
    // Normalize the vault-relative segment ONLY (backslashes → slashes, collapse
    // duplicate slashes, strip leading/trailing slashes). We deliberately do
    // NOT pass the joined absolute path through Obsidian's normalizePath:
    // normalizePath assumes vault-relative input and strips the leading slash,
    // turning "/Volumes/Vault/Foo" into "Volumes/Vault/Foo" — a corrupted
    // absolute path that bypasses subsequent realpath/lstat scope checks and
    // causes ScopeViolations downstream.
    const trimmed = vaultRelPath
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    if (trimmed === "") return base;
    return `${base}/${trimmed}`;
  }

  /**
   * Look up a TFile by vault-relative path. Returns null if no file exists
   * at the path (mirrors Obsidian's own `getFileByPath` semantics).
   *
   * Added in T2.6 for ExportRunner's `sourceType: note` branch, which needs
   * to resolve a vault-relative note path to a TFile without knowing about
   * the Obsidian API directly.
   */
  fileByPath(path: string): TFile | null {
    return this.app.vault.getFileByPath(path);
  }

  /**
   * Delete a vault note after a successful export write. Used by ExportRunner's
   * `action: move` branch.
   *
   * We use `vault.delete()` rather than `fileManager.trashFile()` here because
   * `trashFile` was added in Obsidian v1.6.6 and Hakobi's `minAppVersion` is
   * 1.5.7 — using it would fail on older Obsidian installs. When the minimum
   * version is raised to ≥ 1.6.6, replace `vault.delete` with
   * `fileManager.trashFile` to respect the user's system-trash preference.
   *
   * eslint-disable-next-line comment below suppresses the prefer-file-manager-
   * trash-file warning for exactly this call site.
   *
   * Added in T2.6.
   */
  async deleteNote(file: TFile): Promise<void> {
    // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- trashFile needs Obsidian ≥1.6.6; minAppVersion is 1.5.7
    await this.app.vault.delete(file);
  }
}
