// Audit entry types and pure serialize/parse for the metadata-only audit log.
//
// WHY this module exists:
// The existence of a single closed-allowlist serializer and parser is the
// compile-time and runtime guarantee that no file content / frontmatter
// values / absolute paths can flow through the audit log to disk
// (Constitution L1 Privacy & Security; PRD/F5; SDD/Application Data Models).
//
// Closed-list invariant:
// - The Direction / Operation / ErrorCode / Decision unions and the
//   AuditEntry interface are closed (no `[k: string]: unknown` index signature
//   anywhere).
// - serializeAuditEntry walks a hand-authored allowlist of keys. Even if a
//   caller hands in an object polluted at runtime with extra fields, those
//   fields cannot reach the JSON output.
// - parseAuditLine builds the entry by walking the same allowlist and rejects
//   any extra keys defensively, so a tampered log file cannot smuggle unknown
//   data back into memory.
//
// Pure module: no Node fs / Obsidian imports. Runs identically in plugin
// context and unit tests.

import { type RuleId } from "../domain/ruleId";
import { type Result } from "../domain/rule";

// ---------------------------------------------------------------------------
// Closed enum unions — array-as-source-of-truth
// The runtime allowlists (`*_VALUES`) and the type-level unions are derived
// from the same array literal, so adding a new variant to one without the
// other is impossible. Both array and type are exported for downstream use.
// ---------------------------------------------------------------------------

export const DIRECTION_VALUES = ["import", "export"] as const;
export type Direction = (typeof DIRECTION_VALUES)[number];

export const OPERATION_VALUES = [
  "copy",
  "move",
  "skip",
  "suffix",
  "rejected",
  "error",
  "would-write",
  "would-skip",
  "would-suffix",
  "skipped",
] as const;
export type Operation = (typeof OPERATION_VALUES)[number];

export const ERROR_CODE_VALUES = [
  "source-not-found",
  "destination-not-writable",
  "destination-parent-missing",
  "destination-name-conflicts-note",
  "symlink-refused",
  "subdir-is-symlink",
  "source-is-symlink",
  "loop-refused",
  "forbidden-path",
  "sanitization-rejected",
  "sanitization-empty",
  "housekeeping-file",
  "io-timeout",
  "source-modified",
  "source-vanished",
  "disk-full",
  "permission-denied",
  "overlap",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

export const DECISION_VALUES = [
  "ok",
  "skipped",
  "rejected",
  "error",
  "would-write",
  "would-skip",
  "would-suffix",
  "rule-ok",
  "rule-failed",
  "rule-partial",
] as const;
export type Decision = (typeof DECISION_VALUES)[number];

// ---------------------------------------------------------------------------
// AuditEntry — closed allowlist of fields
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;                 // ISO 8601 UTC
  ruleId: RuleId;
  ruleName: string;
  direction: Direction;
  operation: Operation;
  sourcePathRelative?: string;       // relative to rule source root; never absolute
  destinationPathRelative?: string;  // relative to rule destination root
  decision: Decision;
  errorCode?: ErrorCode;
  bytesTransferred?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// ParseError — closed discriminated union
// ---------------------------------------------------------------------------

export type ParseError =
  | { kind: "malformed-json"; detail: string }
  | { kind: "missing-field"; detail: string }
  | { kind: "invalid-enum"; detail: string }
  | { kind: "invalid-type"; detail: string }
  | { kind: "unknown-field"; detail: string };

// ---------------------------------------------------------------------------
// Allowlist of AuditEntry keys (the single source of truth for serialize +
// parse). Required keys come first; optionals after. Order here also dictates
// the property order in the serialized JSON line.
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "timestamp",
  "ruleId",
  "ruleName",
  "direction",
  "operation",
  "decision",
] as const;

const OPTIONAL_KEYS = [
  "sourcePathRelative",
  "destinationPathRelative",
  "errorCode",
  "bytesTransferred",
  "durationMs",
] as const;

const ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  ...REQUIRED_KEYS,
  ...OPTIONAL_KEYS,
]);

// ---------------------------------------------------------------------------
// serializeAuditEntry — single-line JSON, closed allowlist
// Walks the known keys in a fixed order. Optional fields with `undefined`
// values are dropped. Returns a string with NO embedded or trailing newline;
// the audit-log writer is responsible for appending a single `\n`.
// ---------------------------------------------------------------------------

export function serializeAuditEntry(entry: AuditEntry): string {
  const out: Record<string, string | number> = {};

  // Required fields — assumed present per the AuditEntry type contract.
  out["timestamp"] = entry.timestamp;
  out["ruleId"] = entry.ruleId;
  out["ruleName"] = entry.ruleName;
  out["direction"] = entry.direction;
  out["operation"] = entry.operation;
  out["decision"] = entry.decision;

  // Optional fields — drop undefined.
  if (entry.sourcePathRelative !== undefined) {
    out["sourcePathRelative"] = entry.sourcePathRelative;
  }
  if (entry.destinationPathRelative !== undefined) {
    out["destinationPathRelative"] = entry.destinationPathRelative;
  }
  if (entry.errorCode !== undefined) {
    out["errorCode"] = entry.errorCode;
  }
  if (entry.bytesTransferred !== undefined) {
    out["bytesTransferred"] = entry.bytesTransferred;
  }
  if (entry.durationMs !== undefined) {
    out["durationMs"] = entry.durationMs;
  }

  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// parseAuditLine — defensive parser
//
// Order of checks (documented per task body):
//   1. malformed-json  — strip optional trailing newline, JSON.parse.
//   2. invalid-type    — payload must be a plain object (not array/null).
//   3. unknown-field   — reject any key outside ALLOWED_KEYS.
//   4. missing-field   — every REQUIRED_KEY must be present.
//   5. invalid-type    — required strings are strings; optional fields have
//                        the right primitive shape.
//   6. invalid-enum    — closed enums match their *_VALUES arrays.
//
// We intentionally check unknown-field BEFORE missing-field so that adversarial
// inputs that smuggle extra keys are rejected with the most specific reason.
// ---------------------------------------------------------------------------

export function parseAuditLine(line: string): Result<AuditEntry, ParseError> {
  // Tolerate a single trailing \n (NDJSON readers may pass it through).
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown JSON parse error";
    return fail({ kind: "malformed-json", detail });
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail({
      kind: "invalid-type",
      detail: "expected a JSON object at the top level",
    });
  }

  const obj = raw as Record<string, unknown>;

  // Defensive: reject any extra keys.
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return fail({
        kind: "unknown-field",
        detail: `unexpected field '${key}'`,
      });
    }
  }

  // Required-field presence.
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) {
      return fail({
        kind: "missing-field",
        detail: `required field '${key}' is missing`,
      });
    }
  }

  // String-type required fields.
  const timestamp = obj["timestamp"];
  if (typeof timestamp !== "string") {
    return fail({ kind: "invalid-type", detail: "'timestamp' must be a string" });
  }
  const ruleId = obj["ruleId"];
  if (typeof ruleId !== "string") {
    return fail({ kind: "invalid-type", detail: "'ruleId' must be a string" });
  }
  const ruleName = obj["ruleName"];
  if (typeof ruleName !== "string") {
    return fail({ kind: "invalid-type", detail: "'ruleName' must be a string" });
  }

  // Closed-enum required fields.
  const directionRaw = obj["direction"];
  if (typeof directionRaw !== "string") {
    return fail({ kind: "invalid-type", detail: "'direction' must be a string" });
  }
  if (!isMember(DIRECTION_VALUES, directionRaw)) {
    return fail({
      kind: "invalid-enum",
      detail: `'direction' must be one of ${joinValues(DIRECTION_VALUES)} — got ${JSON.stringify(directionRaw)}`,
    });
  }

  const operationRaw = obj["operation"];
  if (typeof operationRaw !== "string") {
    return fail({ kind: "invalid-type", detail: "'operation' must be a string" });
  }
  if (!isMember(OPERATION_VALUES, operationRaw)) {
    return fail({
      kind: "invalid-enum",
      detail: `'operation' must be one of ${joinValues(OPERATION_VALUES)} — got ${JSON.stringify(operationRaw)}`,
    });
  }

  const decisionRaw = obj["decision"];
  if (typeof decisionRaw !== "string") {
    return fail({ kind: "invalid-type", detail: "'decision' must be a string" });
  }
  if (!isMember(DECISION_VALUES, decisionRaw)) {
    return fail({
      kind: "invalid-enum",
      detail: `'decision' must be one of ${joinValues(DECISION_VALUES)} — got ${JSON.stringify(decisionRaw)}`,
    });
  }

  // Optional fields.
  const sourcePathRelative = obj["sourcePathRelative"];
  if (sourcePathRelative !== undefined && typeof sourcePathRelative !== "string") {
    return fail({
      kind: "invalid-type",
      detail: "'sourcePathRelative' must be a string when present",
    });
  }

  const destinationPathRelative = obj["destinationPathRelative"];
  if (destinationPathRelative !== undefined && typeof destinationPathRelative !== "string") {
    return fail({
      kind: "invalid-type",
      detail: "'destinationPathRelative' must be a string when present",
    });
  }

  const errorCodeRaw = obj["errorCode"];
  let errorCode: ErrorCode | undefined;
  if (errorCodeRaw !== undefined) {
    if (typeof errorCodeRaw !== "string") {
      return fail({
        kind: "invalid-type",
        detail: "'errorCode' must be a string when present",
      });
    }
    if (!isMember(ERROR_CODE_VALUES, errorCodeRaw)) {
      return fail({
        kind: "invalid-enum",
        detail: `'errorCode' must be one of ${joinValues(ERROR_CODE_VALUES)} — got ${JSON.stringify(errorCodeRaw)}`,
      });
    }
    errorCode = errorCodeRaw;
  }

  const bytesTransferredRaw = obj["bytesTransferred"];
  if (
    bytesTransferredRaw !== undefined &&
    typeof bytesTransferredRaw !== "number"
  ) {
    return fail({
      kind: "invalid-type",
      detail: "'bytesTransferred' must be a number when present",
    });
  }

  const durationMsRaw = obj["durationMs"];
  if (
    durationMsRaw !== undefined &&
    typeof durationMsRaw !== "number"
  ) {
    return fail({
      kind: "invalid-type",
      detail: "'durationMs' must be a number when present",
    });
  }

  // Build the AuditEntry from the validated allowlist (no spread of `obj`).
  const entry: AuditEntry = {
    timestamp,
    ruleId: ruleId as RuleId,
    ruleName,
    direction: directionRaw,
    operation: operationRaw,
    decision: decisionRaw,
  };
  if (typeof sourcePathRelative === "string") {
    entry.sourcePathRelative = sourcePathRelative;
  }
  if (typeof destinationPathRelative === "string") {
    entry.destinationPathRelative = destinationPathRelative;
  }
  if (errorCode !== undefined) {
    entry.errorCode = errorCode;
  }
  if (typeof bytesTransferredRaw === "number") {
    entry.bytesTransferred = bytesTransferredRaw;
  }
  if (typeof durationMsRaw === "number") {
    entry.durationMs = durationMsRaw;
  }

  return { ok: true, value: entry };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(error: ParseError): Result<AuditEntry, ParseError> {
  return { ok: false, errors: error };
}

function isMember<T extends string>(values: readonly T[], v: string): v is T {
  return (values as readonly string[]).includes(v);
}

function joinValues(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}
