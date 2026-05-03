// errorCodeMapping — translate domain ScopeViolation reasons into the
// AuditEntry ErrorCode taxonomy.
//
// WHY this file exists:
// Both ImportRunner and ExportRunner need to surface scope violations in the
// audit log with a stable, taxonomy-aligned errorCode (PRD/F8). The mapping
// is identical for both directions, so it lives here to avoid duplication
// and to keep the two runners in lockstep — adding a new ScopeViolationReason
// in domain/scope.ts triggers an exhaustiveness compile error here, forcing
// both runners to learn about it at the same time.

import { assertNever } from "../domain/rule";
import type { ScopeViolation } from "../domain/scope";
import type { ErrorCode } from "../audit/AuditEntry";

export function mapScopeViolationToErrorCode(
  reason: ScopeViolation["reason"],
): ErrorCode {
  switch (reason) {
    case "vault-loop":           return "loop-refused";
    case "forbidden-path":       return "forbidden-path";
    case "symlink":              return "source-is-symlink";
    case "escape":               return "forbidden-path";
    case "traversal":            return "forbidden-path";
    case "absolute-in-filename": return "forbidden-path";
  }
  assertNever(reason);
}
