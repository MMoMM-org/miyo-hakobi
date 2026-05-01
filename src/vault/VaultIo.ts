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
//    src/domain/scope.ts on the `existsAtVaultPath` shape. `resolveVaultPath`
//    is added in T1.10 when other consumers need it.

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
}
