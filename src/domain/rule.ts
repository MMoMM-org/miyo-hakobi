// Rule schema for Hakobi — discriminated union types and pure validator.
// Defines all Rule variants (ImportRule, ExportFolderRule, ExportTagRule,
// ExportNoteRule) and validates unknown input against them, collecting ALL
// errors before returning. No external dependencies — keeps the bundle thin.
//
// assertNever() is exported for exhaustive switch/case guards: if a new
// variant is added to Rule without a matching branch, TypeScript raises a
// compile error at the assertNever call site.

import { type RuleId } from "./ruleId";
import { normalizeFsPath } from "../fs/PathSafe";

export type { RuleId };

// ---------------------------------------------------------------------------
// Branded path types (compile-time only)
// ---------------------------------------------------------------------------

export type AbsolutePath = string & { readonly __brand: "AbsolutePath" };
export type VaultRelativePath = string & { readonly __brand: "VaultRelativePath" };

// ---------------------------------------------------------------------------
// Result / error types
// ---------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };
export type ValidationError = { path: string; message: string };

// ---------------------------------------------------------------------------
// Rule interfaces
// ---------------------------------------------------------------------------

interface RuleBase {
  id: RuleId;
  name: string;
  everyMinutes: number;       // ≥ 1, finite
  action: "copy" | "move";
  onCollision: "skip" | "suffix";
  flattenOnTarget: boolean;
  dryRun: boolean;
}

export interface ImportRule extends RuleBase {
  direction: "import";
  sourcePath: AbsolutePath;
  destinationVaultPath: VaultRelativePath;
}

export interface ExportFolderRule extends RuleBase {
  direction: "export";
  sourceType: "folder";
  sourceVaultPath: VaultRelativePath;
  destinationPath: AbsolutePath;
}

export interface ExportTagRule extends RuleBase {
  direction: "export";
  sourceType: "tag";
  tags: string[];
  tagMatch: "any" | "all";
  destinationPath: AbsolutePath;
}

export interface ExportNoteRule extends RuleBase {
  direction: "export";
  sourceType: "note";
  sourceVaultNotePath: VaultRelativePath;
  destinationPath: AbsolutePath;
}

export type ExportRule = ExportFolderRule | ExportTagRule | ExportNoteRule;
export type Rule = ImportRule | ExportRule;

// ---------------------------------------------------------------------------
// Exhaustiveness helper
// ---------------------------------------------------------------------------

/** Compile-time exhaustiveness guard. If TypeScript reaches this call site,
 *  a new Rule variant was added without a corresponding handler branch. */
export function assertNever(x: never): never {
  throw new Error("unhandled rule variant: " + JSON.stringify(x));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(
  obj: Record<string, unknown>,
  field: string,
  errors: ValidationError[],
): string | undefined {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    errors.push({ path: field, message: `'${field}' must be a non-empty string` });
    return undefined;
  }
  return v;
}

function validateBase(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): Partial<RuleBase> {
  const base: Partial<RuleBase> = {};

  const id = requireString(obj, "id", errors);
  if (id !== undefined) base.id = id as RuleId;

  const name = requireString(obj, "name", errors);
  if (name !== undefined) base.name = name;

  // everyMinutes: finite number ≥ 1
  const em = obj["everyMinutes"];
  if (typeof em !== "number" || !Number.isInteger(em) || em < 1) {
    errors.push({ path: "everyMinutes", message: "'everyMinutes' must be a finite number ≥ 1" });
  } else {
    base.everyMinutes = em;
  }

  // action
  const action = obj["action"];
  if (action !== "copy" && action !== "move") {
    errors.push({ path: "action", message: "'action' must be 'copy' or 'move'" });
  } else {
    base.action = action;
  }

  // onCollision
  const onCollision = obj["onCollision"];
  if (onCollision !== "skip" && onCollision !== "suffix") {
    errors.push({ path: "onCollision", message: "'onCollision' must be 'skip' or 'suffix'" });
  } else {
    base.onCollision = onCollision;
  }

  // flattenOnTarget — default false
  const fot = obj["flattenOnTarget"];
  if (fot === undefined || fot === null) {
    base.flattenOnTarget = false;
  } else if (typeof fot !== "boolean") {
    errors.push({ path: "flattenOnTarget", message: "'flattenOnTarget' must be a boolean" });
  } else {
    base.flattenOnTarget = fot;
  }

  // dryRun — default false
  const dr = obj["dryRun"];
  if (dr === undefined || dr === null) {
    base.dryRun = false;
  } else if (typeof dr !== "boolean") {
    errors.push({ path: "dryRun", message: "'dryRun' must be a boolean" });
  } else {
    base.dryRun = dr;
  }

  return base;
}

/**
 * Canonicalize a user-entered filesystem path: `\` to `/`, runs of `/`
 * collapsed, trailing separator trimmed.
 *
 * Why it happens here: a path like `/Users/me//Documents` passes every
 * syntactic check (absolute, no `..`) and POSIX resolves it fine, but the
 * run-time guard in scope.ts compares `realpath(root)` against the declared
 * root *as strings* — and realpath collapses the doubled separator. The rule
 * would then be rejected as an escape from its own source root. Normalizing
 * inside validateRule means every validated Rule — read from data.json or
 * built by an editor — carries the same spelling realpath returns.
 *
 * `normalizeFsPath` throws on NUL bytes and over-cap input; both are integrity
 * errors that the path checks in the editors already surface, so we hand the
 * raw value back rather than turning validateRule into a second reporter.
 */
function canonicalFsPath(p: string): string {
  try {
    return normalizeFsPath(p);
  } catch {
    return p;
  }
}

function validateImport(
  obj: Record<string, unknown>,
  base: Partial<RuleBase>,
  errors: ValidationError[],
): Result<ImportRule, ValidationError[]> {
  const localErrors: ValidationError[] = [];

  const sourcePath = requireString(obj, "sourcePath", localErrors);
  const destinationVaultPath = requireString(obj, "destinationVaultPath", localErrors);

  const allErrors = [...errors, ...localErrors];
  if (
    allErrors.length > 0 ||
    base.id === undefined ||
    base.name === undefined ||
    base.everyMinutes === undefined ||
    base.action === undefined ||
    base.onCollision === undefined ||
    base.flattenOnTarget === undefined ||
    base.dryRun === undefined ||
    sourcePath === undefined ||
    destinationVaultPath === undefined
  ) {
    return { ok: false, errors: allErrors };
  }

  const rule: ImportRule = {
    id: base.id,
    name: base.name,
    everyMinutes: base.everyMinutes,
    action: base.action,
    onCollision: base.onCollision,
    flattenOnTarget: base.flattenOnTarget,
    dryRun: base.dryRun,
    direction: "import",
    sourcePath: canonicalFsPath(sourcePath) as AbsolutePath,
    destinationVaultPath: destinationVaultPath as VaultRelativePath,
  };
  return { ok: true, value: rule };
}

function validateExportFolder(
  obj: Record<string, unknown>,
  base: Partial<RuleBase>,
  errors: ValidationError[],
): Result<ExportFolderRule, ValidationError[]> {
  const localErrors: ValidationError[] = [];

  const sourceVaultPath = requireString(obj, "sourceVaultPath", localErrors);
  const destinationPath = requireString(obj, "destinationPath", localErrors);

  const allErrors = [...errors, ...localErrors];
  if (
    allErrors.length > 0 ||
    base.id === undefined ||
    base.name === undefined ||
    base.everyMinutes === undefined ||
    base.action === undefined ||
    base.onCollision === undefined ||
    base.flattenOnTarget === undefined ||
    base.dryRun === undefined ||
    sourceVaultPath === undefined ||
    destinationPath === undefined
  ) {
    return { ok: false, errors: allErrors };
  }

  const rule: ExportFolderRule = {
    id: base.id,
    name: base.name,
    everyMinutes: base.everyMinutes,
    action: base.action,
    onCollision: base.onCollision,
    flattenOnTarget: base.flattenOnTarget,
    dryRun: base.dryRun,
    direction: "export",
    sourceType: "folder",
    sourceVaultPath: sourceVaultPath as VaultRelativePath,
    destinationPath: canonicalFsPath(destinationPath) as AbsolutePath,
  };
  return { ok: true, value: rule };
}

function validateExportTag(
  obj: Record<string, unknown>,
  base: Partial<RuleBase>,
  errors: ValidationError[],
): Result<ExportTagRule, ValidationError[]> {
  const localErrors: ValidationError[] = [];

  // tags
  const rawTags = obj["tags"];
  let tags: string[] | undefined;
  if (!Array.isArray(rawTags)) {
    localErrors.push({ path: "tags", message: "'tags' must be an array" });
  } else {
    tags = [];
    for (let i = 0; i < rawTags.length; i++) {
      const t: unknown = rawTags[i];
      if (typeof t !== "string" || t.length < 2 || !t.startsWith("#")) {
        localErrors.push({
          path: `tags[${i}]`,
          message: `tags[${i}] must be a non-empty string starting with '#'`,
        });
      } else {
        tags.push(t);
      }
    }
  }

  // tagMatch
  const tagMatch = obj["tagMatch"];
  if (tagMatch !== "any" && tagMatch !== "all") {
    localErrors.push({ path: "tagMatch", message: "'tagMatch' must be 'any' or 'all'" });
  }

  const destinationPath = requireString(obj, "destinationPath", localErrors);

  const allErrors = [...errors, ...localErrors];
  if (
    allErrors.length > 0 ||
    base.id === undefined ||
    base.name === undefined ||
    base.everyMinutes === undefined ||
    base.action === undefined ||
    base.onCollision === undefined ||
    base.flattenOnTarget === undefined ||
    base.dryRun === undefined ||
    tags === undefined ||
    (tagMatch !== "any" && tagMatch !== "all") ||
    destinationPath === undefined
  ) {
    return { ok: false, errors: allErrors };
  }

  const rule: ExportTagRule = {
    id: base.id,
    name: base.name,
    everyMinutes: base.everyMinutes,
    action: base.action,
    onCollision: base.onCollision,
    flattenOnTarget: base.flattenOnTarget,
    dryRun: base.dryRun,
    direction: "export",
    sourceType: "tag",
    tags,
    tagMatch,
    destinationPath: canonicalFsPath(destinationPath) as AbsolutePath,
  };
  return { ok: true, value: rule };
}

function validateExportNote(
  obj: Record<string, unknown>,
  base: Partial<RuleBase>,
  errors: ValidationError[],
): Result<ExportNoteRule, ValidationError[]> {
  const localErrors: ValidationError[] = [];

  const sourceVaultNotePath = requireString(obj, "sourceVaultNotePath", localErrors);
  const destinationPath = requireString(obj, "destinationPath", localErrors);

  const allErrors = [...errors, ...localErrors];
  if (
    allErrors.length > 0 ||
    base.id === undefined ||
    base.name === undefined ||
    base.everyMinutes === undefined ||
    base.action === undefined ||
    base.onCollision === undefined ||
    base.flattenOnTarget === undefined ||
    base.dryRun === undefined ||
    sourceVaultNotePath === undefined ||
    destinationPath === undefined
  ) {
    return { ok: false, errors: allErrors };
  }

  const rule: ExportNoteRule = {
    id: base.id,
    name: base.name,
    everyMinutes: base.everyMinutes,
    action: base.action,
    onCollision: base.onCollision,
    flattenOnTarget: base.flattenOnTarget,
    dryRun: base.dryRun,
    direction: "export",
    sourceType: "note",
    sourceVaultNotePath: sourceVaultNotePath as VaultRelativePath,
    destinationPath: canonicalFsPath(destinationPath) as AbsolutePath,
  };
  return { ok: true, value: rule };
}

// ---------------------------------------------------------------------------
// Public validator
// ---------------------------------------------------------------------------

/** Validates an unknown value against the Rule discriminated union.
 *  Collects ALL validation errors before returning (not first-fail).
 *  Defaults: flattenOnTarget → false, dryRun → false when absent. */
export function validateRule(input: unknown): Result<Rule, ValidationError[]> {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Rule must be a plain object" }],
    };
  }

  const baseErrors: ValidationError[] = [];
  const base = validateBase(input, baseErrors);

  const direction = input["direction"];

  if (direction === "import") {
    return validateImport(input, base, baseErrors);
  }

  if (direction === "export") {
    const sourceType = input["sourceType"];
    if (sourceType === "folder") return validateExportFolder(input, base, baseErrors);
    if (sourceType === "tag") return validateExportTag(input, base, baseErrors);
    if (sourceType === "note") return validateExportNote(input, base, baseErrors);

    return {
      ok: false,
      errors: [
        ...baseErrors,
        {
          path: "sourceType",
          message: `'sourceType' must be 'folder', 'tag', or 'note' — got ${JSON.stringify(sourceType)}`,
        },
      ],
    };
  }

  return {
    ok: false,
    errors: [
      ...baseErrors,
      {
        path: "direction",
        message: `'direction' must be 'import' or 'export' — got ${JSON.stringify(direction)}`,
      },
    ],
  };
}
