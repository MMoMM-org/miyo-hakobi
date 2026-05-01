// Rule ID generation using UUID v4.
// Branded type ensures compile-time safety against accidental string→RuleId assignment.
// Uses crypto.randomUUID() (available in Electron ≥25 renderer & modern Node).

export type RuleId = string & { readonly __brand: "RuleId" };

export function newRuleId(): RuleId {
  return crypto.randomUUID() as RuleId;
}
