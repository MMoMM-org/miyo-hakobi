import { describe, it, expect } from "vitest";
import { newRuleId, type RuleId } from "../../src/domain/ruleId";

describe("ruleId", () => {
  it("returns a valid UUID v4 string", () => {
    const id = newRuleId();
    // UUID v4 format: 8-4-4-4-12 hex digits
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Regex.test(id)).toBe(true);
  });

  it("returns different IDs on consecutive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(newRuleId());
    }
    expect(ids.size).toBe(1000);
  });

  it("branded type rejects plain string assignment at compile time", () => {
    // @ts-expect-error -- RuleId is branded, plain string should not assign
    const _x: RuleId = "not-a-ruleid";
  });
});
