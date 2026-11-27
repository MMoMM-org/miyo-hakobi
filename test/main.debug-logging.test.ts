// main.debug-logging.test.ts — wiring of the Debug logging switch (#18, T2.2).
//
// WHY this file exists:
// The logger gate is only useful if main.ts registers the live settings value
// as its source, keeps load/unload lines visible with the switch off, and
// clears the source on unload. The General save wrapper is a local in main.ts,
// so its constructor deps are captured to drive the live flip without the UI.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { App, Plugin } from "obsidian";
import { log, setDebugSource } from "../src/util/logger";
import type { GlobalSettings } from "../src/types/index";

const captured: Record<string, Record<string, unknown>> = {};

vi.mock("../src/settings/subtabs/GeneralSubtab", async (orig) => {
  const m = await orig<typeof import("../src/settings/subtabs/GeneralSubtab")>();
  const Orig = m.GeneralSubtab as unknown as new (deps: Record<string, unknown>) => object;
  return {
    ...m,
    GeneralSubtab: class extends Orig {
      constructor(deps: Record<string, unknown>) {
        super(deps);
        captured["GeneralSubtab"] = deps;
      }
    },
  };
});

type TestPlugin = InstanceType<typeof import("../src/main").default> & Plugin;

async function loadPlugin(persistedDebugLogging?: boolean): Promise<TestPlugin> {
  const { default: HakobiPlugin } = await import("../src/main");
  const app = new App();
  (app.vault.adapter as unknown as Record<string, unknown>)["getFullPath"] = vi.fn(
    (rel: string) => `/vault/${rel}`,
  );
  const plugin = new HakobiPlugin(app, { id: "miyo-hakobi" } as never) as TestPlugin;
  Object.assign(plugin.manifest, {
    id: "miyo-hakobi",
    version: "9.9.9",
    dir: ".obsidian/plugins/miyo-hakobi",
  });
  if (persistedDebugLogging !== undefined) {
    const data = {
      schemaVersion: 1,
      rules: [],
      globalSettings: { debugLogging: persistedDebugLogging },
    };
    plugin.loadData = vi.fn(async () => data);
  }
  await plugin.onload();
  return plugin;
}

function debugLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c.map(String).join(" "));
}

describe("HakobiPlugin debug logging wiring (#18)", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  let plugin: TestPlugin | undefined;
  let unloaded = false;

  beforeEach(() => {
    delete captured["GeneralSubtab"];
    spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (!unloaded) plugin?.onunload();
    unloaded = false;
    plugin?._runCleanup();
    plugin = undefined;
    setDebugSource(null);
    spy.mockRestore();
  });

  it("log.debug is silent after onload while debugLogging is false", async () => {
    plugin = await loadPlugin();
    spy.mockClear();
    log.debug("probe-off");
    expect(debugLines(spy)).not.toContain("probe-off");
  });

  it("persisted debugLogging true is read through the load path", async () => {
    plugin = await loadPlugin(true);
    spy.mockClear();
    log.debug("persisted-on");
    expect(debugLines(spy)).toContain("persisted-on");
  });

  it("persisted debugLogging false stays silent through the load path", async () => {
    plugin = await loadPlugin(false);
    spy.mockClear();
    log.debug("persisted-off");
    expect(debugLines(spy)).not.toContain("persisted-off");
  });

  it("log.debug writes after onload when debugLogging is true", async () => {
    plugin = await loadPlugin();
    (plugin as unknown as { globalSettings: GlobalSettings }).globalSettings.debugLogging = true;
    spy.mockClear();
    log.debug("probe-on");
    expect(debugLines(spy)).toContain("probe-on");
  });

  it("flipping the switch through the captured save wrapper takes effect without reload", async () => {
    plugin = await loadPlugin();
    const deps = captured["GeneralSubtab"] as unknown as {
      ruleStore: {
        loadGlobalSettings: () => Promise<GlobalSettings>;
        saveGlobalSettings: (s: GlobalSettings) => Promise<void>;
      };
    };
    const current = await deps.ruleStore.loadGlobalSettings();
    spy.mockClear();
    log.debug("before-flip");
    expect(debugLines(spy)).not.toContain("before-flip");

    await deps.ruleStore.saveGlobalSettings({ ...current, debugLogging: true });
    spy.mockClear();
    log.debug("after-flip");
    expect(debugLines(spy)).toContain("after-flip");

    await deps.ruleStore.saveGlobalSettings({ ...current, debugLogging: false });
    spy.mockClear();
    log.debug("after-flip-back");
    expect(debugLines(spy)).not.toContain("after-flip-back");
  });

  it("plugin loading and loaded lines appear with the switch off", async () => {
    plugin = await loadPlugin();
    const lines = debugLines(spy);
    expect(lines.some((l) => l.includes("plugin loading (9.9.9)"))).toBe(true);
    expect(lines.some((l) => l.includes("plugin loaded"))).toBe(true);
  });

  it("plugin unloading line appears with the switch off", async () => {
    plugin = await loadPlugin();
    spy.mockClear();
    plugin.onunload();
    unloaded = true;
    expect(debugLines(spy).some((l) => l.includes("plugin unloading"))).toBe(true);
  });

  it("onunload clears the source so log.debug is silent even if the switch was on", async () => {
    plugin = await loadPlugin();
    (plugin as unknown as { globalSettings: GlobalSettings }).globalSettings.debugLogging = true;
    plugin.onunload();
    unloaded = true;
    spy.mockClear();
    log.debug("after-unload");
    expect(debugLines(spy)).not.toContain("after-unload");
  });
});
