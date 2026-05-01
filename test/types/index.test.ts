// Re-export round-trip tests for src/types/index.ts (T1.11).
//
// WHY this file exists:
// `src/types/index.ts` is the single import surface downstream phases will
// reach for to get Rule, RuleId, AuditEntry, GlobalSettings, DeviceState
// and the persisted PluginData shape. These tests keep that surface
// honest: the exported types are still assignable from realistic literals
// (the `const x: T = literal` lines are compile-time assertions).

import { describe, expect, it } from "vitest";
import type {
	AuditEntry,
	DeviceState,
	GlobalSettings,
	PluginData,
	Rule,
	RuleId,
} from "../../src/types/index";

describe("src/types/index re-export surface", () => {
	it("re-exports Rule and RuleId so a typed Rule literal is assignable", () => {
		// Compile-time assertion: if Rule or RuleId are not re-exported with the
		// expected shape, this file will fail to type-check.
		const ruleId = "00000000-0000-4000-8000-000000000000" as RuleId;
		const rule: Rule = {
			id: ruleId,
			name: "demo",
			everyMinutes: 5,
			action: "copy",
			onCollision: "skip",
			flattenOnTarget: false,
			dryRun: false,
			direction: "import",
			sourcePath: "/tmp/source" as Rule extends { sourcePath: infer P } ? P : never,
			destinationVaultPath: "Inbox" as Rule extends { destinationVaultPath: infer P } ? P : never,
		};
		expect(rule.id).toBe(ruleId);
		expect(rule.direction).toBe("import");
	});

	it("re-exports AuditEntry so a literal entry is assignable", () => {
		const ruleId = "11111111-1111-4111-8111-111111111111" as RuleId;
		const entry: AuditEntry = {
			timestamp: "2026-01-01T00:00:00.000Z",
			ruleId,
			ruleName: "demo",
			direction: "export",
			operation: "copy",
			decision: "ok",
		};
		expect(entry.decision).toBe("ok");
	});

	it("exports GlobalSettings with the four documented fields", () => {
		const gs: GlobalSettings = {
			perFileTimeoutMs: 1,
			auditRetentionDays: 1,
			auditMaxBytes: 1,
			stabilityCheckMs: 1,
		};
		// Each field is read so the assertion is a real runtime check too.
		expect(gs.perFileTimeoutMs).toBe(1);
		expect(gs.auditRetentionDays).toBe(1);
		expect(gs.auditMaxBytes).toBe(1);
		expect(gs.stabilityCheckMs).toBe(1);
	});

	it("exports DeviceState with the documented fields", () => {
		const ruleId = "22222222-2222-4222-8222-222222222222" as RuleId;
		const ds: DeviceState = {
			schemaVersion: 1,
			deviceId: "device-1",
			ruleEnablement: { [ruleId]: true },
		};
		expect(ds.schemaVersion).toBe(1);
		expect(ds.ruleEnablement[ruleId]).toBe(true);
	});

	it("exports PluginData composed of Rule[] and GlobalSettings", () => {
		const globalSettings: GlobalSettings = {
			perFileTimeoutMs: 10_000,
			auditRetentionDays: 90,
			auditMaxBytes: 10_485_760,
			stabilityCheckMs: 2_000,
		};
		const data: PluginData = {
			schemaVersion: 1,
			rules: [],
			globalSettings,
		};
		expect(data.rules).toEqual([]);
		expect(data.globalSettings).toBe(globalSettings);
	});
});
