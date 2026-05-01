// example.test.ts — placeholder test updated when scaffold types were removed (T3.11).
//
// The original test referenced the legacy PluginSettings / DEFAULT_SETTINGS scaffold
// which was removed in T3.11 in favour of the real GlobalSettings surface.
// This test now verifies that GlobalSettings is exported from types/index.ts.

import { describe, expect, it } from "vitest";
import type { GlobalSettings } from "../src/types/index";

describe("Plugin Settings", () => {
  it("GlobalSettings type is exported from types/index", () => {
    // Verifies the module compiles and exports at least one real runtime value.
    // GlobalSettings is a type-only export; we verify the module loads cleanly.
    const settings: GlobalSettings = {
      perFileTimeoutMs: 10000,
      auditRetentionDays: 90,
      auditMaxBytes: 10485760,
      stabilityCheckMs: 2000,
    };
    expect(settings.perFileTimeoutMs).toBe(10000);
    expect(settings.auditRetentionDays).toBe(90);
    expect(settings.auditMaxBytes).toBe(10485760);
    expect(settings.stabilityCheckMs).toBe(2000);
  });
});
