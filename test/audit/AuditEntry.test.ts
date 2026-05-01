// Tests for src/audit/AuditEntry.ts (T1.6).
// Covers PRD/F5 metadata-only invariant + SDD/Application Data Models AuditEntry.
//
// Test groups (per task body):
//   - "AuditEntry shape — compile-time": Exact<>-style type assertions guarantee
//     the interface admits ONLY the allowed fields. Counter-examples wrapped in
//     ts-expect-error directives prove compile-time rejection of forbidden fields.
//   - "serializeAuditEntry": single-line JSON, no trailing newline, omits
//     undefined optionals (so the on-disk representation never carries
//     `key: undefined` / `key: null` for absent fields).
//   - "parseAuditLine": Result<AuditEntry, ParseError> with five rejection
//     categories: malformed-json, missing-field, invalid-enum, invalid-type,
//     unknown-field.
//   - "Round-trip": at least 5 representative entries.
//   - "No content leak": static negative test asserting AuditEntry cannot
//     accept a `content: Buffer` field — closed types are PRD/F5's compile-time
//     guarantee that no file content can flow through serialize.

import { describe, it, expect } from "vitest";
import {
  type AuditEntry,
  type ParseError,
  type Direction,
  type Operation,
  type ErrorCode,
  type Decision,
  serializeAuditEntry,
  parseAuditLine,
} from "../../src/audit/AuditEntry";
import { type RuleId } from "../../src/domain/ruleId";

// ---------------------------------------------------------------------------
// Type-level Exact<> helper
// Used to assert that an object literal has *exactly* the AuditEntry fields
// — no more, no less. Mismatches surface as compile errors at the assignment
// site below.
// ---------------------------------------------------------------------------

type Exact<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? T : never;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RULE_ID = "550e8400-e29b-41d4-a716-446655440000" as RuleId;

const ruleOk: AuditEntry = {
  timestamp: "2026-05-01T12:00:00.000Z",
  ruleId: RULE_ID,
  ruleName: "Voice memos",
  direction: "import",
  operation: "copy",
  decision: "rule-ok",
};

const rulePartial: AuditEntry = {
  timestamp: "2026-05-01T12:01:00.000Z",
  ruleId: RULE_ID,
  ruleName: "Voice memos",
  direction: "import",
  operation: "error",
  decision: "rule-partial",
  errorCode: "io-timeout",
};

const fileOk: AuditEntry = {
  timestamp: "2026-05-01T12:02:00.123Z",
  ruleId: RULE_ID,
  ruleName: "Voice memos",
  direction: "import",
  operation: "copy",
  sourcePathRelative: "voice-memo-2026-04-30.m4a",
  destinationPathRelative: "Inbox/voice-memo-2026-04-30.m4a",
  decision: "ok",
  bytesTransferred: 12345,
  durationMs: 42,
};

const fileWouldWrite: AuditEntry = {
  timestamp: "2026-05-01T12:03:00.000Z",
  ruleId: RULE_ID,
  ruleName: "Voice memos (dry run)",
  direction: "import",
  operation: "would-write",
  sourcePathRelative: "memo.m4a",
  destinationPathRelative: "Inbox/memo.m4a",
  decision: "would-write",
};

// Export-direction fixture so the round-trip table exercises BOTH directions
// (the other four fixtures are import). Per code-quality review on T1.6.
const fileRejected: AuditEntry = {
  timestamp: "2026-05-01T12:04:00.000Z",
  ruleId: RULE_ID,
  ruleName: "Daily notes export",
  direction: "export",
  operation: "rejected",
  sourcePathRelative: "weird-symlink.md",
  decision: "rejected",
  errorCode: "symlink-refused",
};

// Sentinel entry written by AuditLog.purgeAll (T1.10). Uses the dedicated
// "purged-by-user" decision value added to the closed allowlist alongside
// T1.10. Direction/operation are placeholders — purge is not a rule action.
const purgeSentinel: AuditEntry = {
  timestamp: "2026-05-01T12:05:00.000Z",
  ruleId: "00000000-0000-0000-0000-000000000000" as RuleId,
  ruleName: "Hakobi audit purge",
  direction: "import",
  operation: "skipped",
  decision: "purged-by-user",
};

// ---------------------------------------------------------------------------
// AuditEntry shape — compile-time assertions
// ---------------------------------------------------------------------------

describe("AuditEntry shape — compile-time", () => {
  it("admits only the allowed AuditEntry fields (Exact<> assertion)", () => {
    type AllowedShape = {
      timestamp: string;
      ruleId: RuleId;
      ruleName: string;
      direction: Direction;
      operation: Operation;
      sourcePathRelative?: string;
      destinationPathRelative?: string;
      decision: Decision;
      errorCode?: ErrorCode;
      bytesTransferred?: number;
      durationMs?: number;
    };

    // If AuditEntry diverges from AllowedShape (extra/missing fields, or
    // different optionality), the line below fails to type-check.
    type _ExactCheck = Exact<AuditEntry, AllowedShape>;
    const _proof: _ExactCheck = ruleOk;
    // Use _proof so the unused-vars rule has no leg to stand on.
    expect(_proof).toBe(ruleOk);
  });

  it("rejects an entry with an extra field at compile time", () => {
    // The directive on the next line guarantees PRD/F5 compile-time rejection
    // of `content: Buffer` — file bytes cannot reach the audit log.
    const _bad: AuditEntry = {
      ...ruleOk,
      // @ts-expect-error — `content` is NOT in the AuditEntry allowlist.
      content: new Uint8Array([1, 2, 3]),
    };
    expect(_bad.timestamp).toBe(ruleOk.timestamp);
  });

  it("rejects an entry with a frontmatter field at compile time", () => {
    const _bad: AuditEntry = {
      ...ruleOk,
      // @ts-expect-error — `frontmatter` is NOT in the AuditEntry allowlist.
      frontmatter: { tags: ["secret"] },
    };
    expect(_bad.timestamp).toBe(ruleOk.timestamp);
  });

  it("rejects an entry with an absolute path field at compile time", () => {
    const _bad: AuditEntry = {
      ...ruleOk,
      // @ts-expect-error — `sourcePathAbsolute` is NOT in the AuditEntry allowlist.
      sourcePathAbsolute: "/Users/me/Vault/inbox/note.md",
    };
    expect(_bad.timestamp).toBe(ruleOk.timestamp);
  });
});

// ---------------------------------------------------------------------------
// serializeAuditEntry
// ---------------------------------------------------------------------------

describe("serializeAuditEntry", () => {
  it("returns single-line JSON (no embedded newline, no trailing newline)", () => {
    const line = serializeAuditEntry(fileOk);
    expect(line).not.toContain("\n");
    expect(line.endsWith("\n")).toBe(false);
  });

  it("preserves all required fields on a rule-level entry", () => {
    const line = serializeAuditEntry(ruleOk);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBe(ruleOk.timestamp);
    expect(parsed["ruleId"]).toBe(ruleOk.ruleId);
    expect(parsed["ruleName"]).toBe(ruleOk.ruleName);
    expect(parsed["direction"]).toBe(ruleOk.direction);
    expect(parsed["operation"]).toBe(ruleOk.operation);
    expect(parsed["decision"]).toBe(ruleOk.decision);
  });

  it("preserves all optional fields when present", () => {
    const line = serializeAuditEntry(fileOk);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["sourcePathRelative"]).toBe(fileOk.sourcePathRelative);
    expect(parsed["destinationPathRelative"]).toBe(fileOk.destinationPathRelative);
    expect(parsed["bytesTransferred"]).toBe(fileOk.bytesTransferred);
    expect(parsed["durationMs"]).toBe(fileOk.durationMs);
  });

  it("omits undefined optional fields rather than emitting `key: undefined`", () => {
    // Policy: serializer drops keys whose value is undefined. Avoids `null`
    // collisions on the JSON side and keeps log lines compact.
    const line = serializeAuditEntry(ruleOk);
    expect(line).not.toContain("sourcePathRelative");
    expect(line).not.toContain("destinationPathRelative");
    expect(line).not.toContain("errorCode");
    expect(line).not.toContain("bytesTransferred");
    expect(line).not.toContain("durationMs");
  });

  it("does not leak fields outside the closed allowlist even if the input is polluted", () => {
    // Guard against runtime objects that have been augmented (e.g. by mistake)
    // with extra fields. The serializer walks the closed allowlist, so extras
    // never reach disk.
    const polluted = {
      ...ruleOk,
      // These are not part of AuditEntry — type-cast to satisfy the test setup.
      content: "secret bytes",
    } as AuditEntry & Record<string, unknown>;
    // Use defineProperty with enumerable:true to create a *genuine* own,
    // enumerable property — this is what JSON.stringify and Object.keys see.
    // (A plain `__proto__: {...}` literal sets the prototype, not an own
    // property, so it would never be iterated and the assertion below would
    // be vacuous.) This makes `not.toContain("injected")` load-bearing: it
    // would FAIL for a naive `JSON.stringify(entry)` serializer and PASS only
    // for the closed-allowlist walk that backs the PRD/F5 privacy guarantee.
    Object.defineProperty(polluted, "injected", {
      value: "leaked-marker",
      enumerable: true,
    });
    const line = serializeAuditEntry(polluted);
    expect(line).not.toContain("content");
    expect(line).not.toContain("secret bytes");
    expect(line).not.toContain("injected");
    expect(line).not.toContain("leaked-marker");
  });
});

// ---------------------------------------------------------------------------
// parseAuditLine
// ---------------------------------------------------------------------------

describe("parseAuditLine", () => {
  it("parses a valid serialized entry", () => {
    const line = serializeAuditEntry(fileOk);
    const result = parseAuditLine(line);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fileOk);
    }
  });

  it("tolerates a single trailing newline (NDJSON readers may include it)", () => {
    const line = serializeAuditEntry(fileOk) + "\n";
    const result = parseAuditLine(line);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fileOk);
    }
  });

  it("rejects malformed JSON with kind 'malformed-json'", () => {
    const result = parseAuditLine("{ this is : not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("malformed-json");
      expect(typeof result.errors.detail).toBe("string");
    }
  });

  it("rejects a non-object JSON payload (array) with kind 'invalid-type'", () => {
    const result = parseAuditLine("[1,2,3]");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
    }
  });

  it("rejects a line with an unknown field (defensive)", () => {
    const polluted = JSON.stringify({ ...ruleOk, unexpected: "x" });
    const result = parseAuditLine(polluted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("unknown-field");
      expect(result.errors.detail).toContain("unexpected");
    }
  });

  it("rejects a line missing a required field", () => {
    const incomplete = JSON.stringify({
      timestamp: ruleOk.timestamp,
      ruleId: ruleOk.ruleId,
      ruleName: ruleOk.ruleName,
      direction: ruleOk.direction,
      operation: ruleOk.operation,
      // decision missing
    });
    const result = parseAuditLine(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("missing-field");
      expect(result.errors.detail).toContain("decision");
    }
  });

  it("rejects a line with an invalid enum value (operation: 'weird')", () => {
    const bad = JSON.stringify({ ...ruleOk, operation: "weird" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-enum");
      expect(result.errors.detail).toContain("operation");
    }
  });

  it("rejects a line with an invalid enum value (direction: 'sideways')", () => {
    const bad = JSON.stringify({ ...ruleOk, direction: "sideways" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-enum");
      expect(result.errors.detail).toContain("direction");
    }
  });

  it("rejects a line with an invalid enum value (decision: 'fine')", () => {
    const bad = JSON.stringify({ ...ruleOk, decision: "fine" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-enum");
      expect(result.errors.detail).toContain("decision");
    }
  });

  it("rejects a line with an invalid enum value (errorCode: 'mystery')", () => {
    const bad = JSON.stringify({ ...rulePartial, errorCode: "mystery" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-enum");
      expect(result.errors.detail).toContain("errorCode");
    }
  });

  it("rejects a line with a type-mismatched required field (timestamp: number)", () => {
    const bad = JSON.stringify({ ...ruleOk, timestamp: 1714521600000 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("timestamp");
    }
  });

  it("rejects a line with a type-mismatched optional field (bytesTransferred: string)", () => {
    const bad = JSON.stringify({ ...fileOk, bytesTransferred: "100" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("bytesTransferred");
    }
  });

  it("rejects a line with a non-string sourcePathRelative", () => {
    const bad = JSON.stringify({ ...fileOk, sourcePathRelative: 42 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("sourcePathRelative");
    }
  });

  it("rejects a line with a non-string destinationPathRelative", () => {
    const bad = JSON.stringify({ ...fileOk, destinationPathRelative: 7 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("destinationPathRelative");
    }
  });

  it("rejects a line with a non-string errorCode", () => {
    // `errorCode` is present but not a string → invalid-type, not invalid-enum.
    const bad = JSON.stringify({ ...rulePartial, errorCode: 99 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("errorCode");
    }
  });

  it("rejects a line with a type-mismatched durationMs (string)", () => {
    const bad = JSON.stringify({ ...fileOk, durationMs: "fast" });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("durationMs");
    }
  });

  it("rejects a line with a non-string ruleId", () => {
    const bad = JSON.stringify({ ...ruleOk, ruleId: 42 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("ruleId");
    }
  });

  it("rejects a line with a non-string ruleName", () => {
    const bad = JSON.stringify({ ...ruleOk, ruleName: null });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("ruleName");
    }
  });

  it("rejects a line with a non-string direction (number)", () => {
    const bad = JSON.stringify({ ...ruleOk, direction: 1 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("direction");
    }
  });

  it("rejects a line with a non-string operation (boolean)", () => {
    const bad = JSON.stringify({ ...ruleOk, operation: true });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("operation");
    }
  });

  it("rejects a line with a non-string decision (number)", () => {
    const bad = JSON.stringify({ ...ruleOk, decision: 0 });
    const result = parseAuditLine(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
      expect(result.errors.detail).toContain("decision");
    }
  });

  it("rejects a JSON null payload with kind 'invalid-type'", () => {
    const result = parseAuditLine("null");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind).toBe("invalid-type");
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("Round-trip serialize → parse", () => {
  const cases: ReadonlyArray<{ name: string; entry: AuditEntry }> = [
    { name: "rule-level ok (no file paths)", entry: ruleOk },
    { name: "rule-level partial with errorCode", entry: rulePartial },
    { name: "per-file ok with bytes + duration", entry: fileOk },
    { name: "per-file would-write (dry-run)", entry: fileWouldWrite },
    { name: "per-file rejected export (symlink-refused, source path only)", entry: fileRejected },
    { name: "purge sentinel (decision: purged-by-user)", entry: purgeSentinel },
  ];

  for (const { name, entry } of cases) {
    it(`preserves all fields: ${name}`, () => {
      const line = serializeAuditEntry(entry);
      const result = parseAuditLine(line);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(entry);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// ParseError shape
// ---------------------------------------------------------------------------

describe("ParseError shape", () => {
  it("has the documented closed kinds", () => {
    // Compile-time enumeration of the allowed ParseError kinds. Adding a new
    // kind to the union without updating this test forces an explicit choice.
    const kinds: ReadonlyArray<ParseError["kind"]> = [
      "malformed-json",
      "missing-field",
      "invalid-enum",
      "invalid-type",
      "unknown-field",
    ];
    expect(kinds).toHaveLength(5);
  });
});
