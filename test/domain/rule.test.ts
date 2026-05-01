// Tests for src/domain/rule.ts — Rule schema, types, and validator.
// Covers all 4 Rule variants, field validation, defaults, error aggregation,
// JSON round-trip, and compile-time exhaustiveness.

import { describe, it, expect } from "vitest";
import {
  validateRule,
  type Rule,
  type ImportRule,
  type ExportFolderRule,
  type ExportTagRule,
  type ExportNoteRule,
  assertNever,
} from "../../src/domain/rule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "My rule",
  everyMinutes: 5,
  action: "copy" as const,
  onCollision: "skip" as const,
  flattenOnTarget: false,
  dryRun: false,
};

const IMPORT_RAW = {
  ...BASE,
  direction: "import",
  sourcePath: "/Users/me/Downloads",
  destinationVaultPath: "Inbox",
};

const EXPORT_FOLDER_RAW = {
  ...BASE,
  direction: "export",
  sourceType: "folder",
  sourceVaultPath: "Projects",
  destinationPath: "/Users/me/Backup/Projects",
};

const EXPORT_TAG_RAW = {
  ...BASE,
  direction: "export",
  sourceType: "tag",
  tags: ["#projects", "#active"],
  tagMatch: "any" as const,
  destinationPath: "/Users/me/Backup/Tags",
};

const EXPORT_NOTE_RAW = {
  ...BASE,
  direction: "export",
  sourceType: "note",
  sourceVaultNotePath: "Daily/2026-04-30.md",
  destinationPath: "/Users/me/Backup/Daily",
};

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("validateRule — ImportRule happy path", () => {
  it("accepts a valid ImportRule", () => {
    const result = validateRule(IMPORT_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rule = result.value as ImportRule;
      expect(rule.direction).toBe("import");
      expect(rule.sourcePath).toBe("/Users/me/Downloads");
      expect(rule.destinationVaultPath).toBe("Inbox");
    }
  });
});

describe("validateRule — ExportFolderRule happy path", () => {
  it("accepts a valid ExportFolderRule", () => {
    const result = validateRule(EXPORT_FOLDER_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rule = result.value as ExportFolderRule;
      expect(rule.direction).toBe("export");
      expect(rule.sourceType).toBe("folder");
    }
  });
});

describe("validateRule — ExportTagRule happy path", () => {
  it("accepts a valid ExportTagRule with multiple tags", () => {
    const result = validateRule(EXPORT_TAG_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rule = result.value as ExportTagRule;
      expect(rule.sourceType).toBe("tag");
      expect(rule.tags).toEqual(["#projects", "#active"]);
      expect(rule.tagMatch).toBe("any");
    }
  });

  it("accepts ExportTagRule with empty tags array", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tags: [] });
    expect(result.ok).toBe(true);
  });

  it("accepts tagMatch 'all'", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tagMatch: "all" });
    expect(result.ok).toBe(true);
  });
});

describe("validateRule — ExportNoteRule happy path", () => {
  it("accepts a valid ExportNoteRule", () => {
    const result = validateRule(EXPORT_NOTE_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rule = result.value as ExportNoteRule;
      expect(rule.sourceType).toBe("note");
      expect(rule.sourceVaultNotePath).toBe("Daily/2026-04-30.md");
    }
  });
});

// ---------------------------------------------------------------------------
// Required-field omission
// ---------------------------------------------------------------------------

describe("validateRule — required-field omission", () => {
  it("rejects input missing 'id'", () => {
    const { id: _id, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "id")).toBe(true);
    }
  });

  it("rejects input missing 'name'", () => {
    const { name: _name, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "name")).toBe(true);
    }
  });

  it("rejects ImportRule missing 'sourcePath'", () => {
    const { sourcePath: _sp, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "sourcePath")).toBe(true);
    }
  });

  it("rejects ImportRule missing 'destinationVaultPath'", () => {
    const { destinationVaultPath: _d, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "destinationVaultPath")).toBe(true);
    }
  });

  it("rejects ExportFolderRule missing 'destinationPath'", () => {
    const { destinationPath: _d, ...rest } = EXPORT_FOLDER_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "destinationPath")).toBe(true);
    }
  });

  it("rejects ExportTagRule missing 'tagMatch'", () => {
    const { tagMatch: _t, ...rest } = EXPORT_TAG_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "tagMatch")).toBe(true);
    }
  });

  it("rejects ExportNoteRule missing 'sourceVaultNotePath'", () => {
    const { sourceVaultNotePath: _s, ...rest } = EXPORT_NOTE_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "sourceVaultNotePath")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// everyMinutes boundary tests
// ---------------------------------------------------------------------------

describe("validateRule — everyMinutes boundaries", () => {
  it("rejects everyMinutes = 0", () => {
    const result = validateRule({ ...IMPORT_RAW, everyMinutes: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "everyMinutes")).toBe(true);
    }
  });

  it("rejects everyMinutes = -1", () => {
    const result = validateRule({ ...IMPORT_RAW, everyMinutes: -1 });
    expect(result.ok).toBe(false);
  });

  it("accepts everyMinutes = 1", () => {
    const result = validateRule({ ...IMPORT_RAW, everyMinutes: 1 });
    expect(result.ok).toBe(true);
  });

  it("rejects everyMinutes = Infinity", () => {
    const result = validateRule({ ...IMPORT_RAW, everyMinutes: Infinity });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "everyMinutes")).toBe(true);
    }
  });

  it("rejects everyMinutes = NaN", () => {
    const result = validateRule({ ...IMPORT_RAW, everyMinutes: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "everyMinutes")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tag validation
// ---------------------------------------------------------------------------

describe("validateRule — tag validation", () => {
  it("accepts tags starting with #", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tags: ["#projects"] });
    expect(result.ok).toBe(true);
  });

  it("rejects tag not starting with #", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tags: ["projects"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.startsWith("tags"))).toBe(true);
    }
  });

  it("allows empty tags array", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tags: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid tagMatch value", () => {
    const result = validateRule({ ...EXPORT_TAG_RAW, tagMatch: "none" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "tagMatch")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Default application
// ---------------------------------------------------------------------------

describe("validateRule — defaults", () => {
  it("defaults flattenOnTarget to false when absent", () => {
    const { flattenOnTarget: _f, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flattenOnTarget).toBe(false);
    }
  });

  it("defaults dryRun to false when absent", () => {
    const { dryRun: _d, ...rest } = IMPORT_RAW;
    const result = validateRule(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(false);
    }
  });

  it("preserves explicit flattenOnTarget = true", () => {
    const result = validateRule({ ...IMPORT_RAW, flattenOnTarget: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flattenOnTarget).toBe(true);
    }
  });

  it("preserves explicit dryRun = true", () => {
    const result = validateRule({ ...IMPORT_RAW, dryRun: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dryRun).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Error aggregation (multiple errors at once)
// ---------------------------------------------------------------------------

describe("validateRule — error aggregation", () => {
  it("returns multiple errors for bad everyMinutes AND bad tags", () => {
    const input = {
      ...EXPORT_TAG_RAW,
      everyMinutes: 0,
      tags: ["projects"],  // missing #
    };
    const result = validateRule(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.path === "everyMinutes")).toBe(true);
      expect(result.errors.some((e) => e.path.startsWith("tags"))).toBe(true);
    }
  });

  it("aggregates errors for multiple missing fields", () => {
    // Only keep direction and sourceType
    const input = { direction: "import", sourceType: undefined };
    const result = validateRule(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip
// ---------------------------------------------------------------------------

describe("validateRule — JSON round-trip", () => {
  it("ImportRule survives JSON.parse(JSON.stringify(...))", () => {
    const r1 = validateRule(IMPORT_RAW);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const serialized = JSON.stringify(r1.value);
    const parsed: unknown = JSON.parse(serialized);
    const r2 = validateRule(parsed);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value).toEqual(r1.value);
    }
  });

  it("ExportTagRule survives JSON round-trip", () => {
    const r1 = validateRule(EXPORT_TAG_RAW);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = validateRule(JSON.parse(JSON.stringify(r1.value)));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value).toEqual(r1.value);
    }
  });
});

// ---------------------------------------------------------------------------
// Compile-time exhaustiveness (assertNever)
// ---------------------------------------------------------------------------

describe("assertNever — exhaustiveness", () => {
  it("throws at runtime for unhandled variant (guarded by type system)", () => {
    // This function covers all known variants — missing one would be a ts error.
    function describeRule(rule: Rule): string {
      if (rule.direction === "import") return "import";
      if (rule.sourceType === "folder") return "folder";
      if (rule.sourceType === "tag") return "tag";
      if (rule.sourceType === "note") return "note";
      return assertNever(rule);
    }

    const r = validateRule(IMPORT_RAW);
    if (r.ok) {
      expect(describeRule(r.value)).toBe("import");
    }
  });

  it("assertNever fails to compile when a variant is unhandled (proven via ts-expect-error)", () => {
    // This function intentionally omits the "note" branch.
    // assertNever should fail to compile because rule is not `never` at this point.
    function incompleteDescribeRule(rule: Rule): string {
      if (rule.direction === "import") return "import";
      if (rule.sourceType === "folder") return "folder";
      if (rule.sourceType === "tag") return "tag";
      // INTENTIONALLY missing the "note" branch — assertNever should fail to compile
      // because rule is still ExportNoteRule here, not `never`.
      // @ts-expect-error -- exhaustiveness violation: ExportNoteRule is not handled
      return assertNever(rule);
    }

    // Verify at runtime that the function throws for an unhandled variant.
    const r = validateRule(EXPORT_NOTE_RAW);
    if (r.ok) {
      expect(() => incompleteDescribeRule(r.value)).toThrow();
    }
  });

  it("assertNever throws when called with a value at runtime", () => {
    expect(() => assertNever("unexpected" as never)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Invalid direction/sourceType combos
// ---------------------------------------------------------------------------

describe("validateRule — invalid discriminator combos", () => {
  it("rejects unknown direction", () => {
    const result = validateRule({ ...IMPORT_RAW, direction: "sync" });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown sourceType for export", () => {
    const result = validateRule({ ...EXPORT_FOLDER_RAW, sourceType: "unknown" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateRule(null).ok).toBe(false);
    expect(validateRule("string").ok).toBe(false);
    expect(validateRule(42).ok).toBe(false);
  });
});
