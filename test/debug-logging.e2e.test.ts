// debug-logging.e2e.test.ts — end-to-end proof of the Debug logging switch and
// the daily summary inside a loaded HakobiPlugin (#18, T3.2).
//
// WHY this file exists:
// The unit tests cover the logger, the Scheduler counters and the main.ts
// wiring separately. This file drives one real plugin through the whole story
// with fake timers: tick lines gated by the switch, the live flip through the
// General save wrapper, exactly one counts-only summary after 24 h, and a
// clean teardown. Only the ImportRunner.run seam is faked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { App, Plugin } from "obsidian";
import { log, setDebugSource } from "../src/util/logger";
import { ImportRunner } from "../src/runner/ImportRunner";
import { DAILY_SUMMARY_INTERVAL_MS } from "../src/scheduler/ActivityTotals";
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

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const RULE_NAME = "Secret Voice Memos";
const EVERY_MINUTES = 7; // 420 s: never lands on the 3 s grace or the 24 h mark
const INTERVAL_MS = EVERY_MINUTES * 60_000;
const GRACE_MS = 3_000;
const SUMMARY_RE = /daily summary/;

async function loadPluginWithRule(): Promise<TestPlugin> {
  const { default: HakobiPlugin } = await import("../src/main");
  const app = new App();
  const adapter = app.vault.adapter as unknown as Record<string, unknown>;
  adapter["getFullPath"] = vi.fn((rel: string) => `/vault/${rel}`);
  // device.json marks the rule enabled on this device.
  adapter["exists"] = vi.fn(async (p: string) => p.endsWith("device.json"));
  adapter["read"] = vi.fn(async () =>
    JSON.stringify({ schemaVersion: 1, deviceId: "dev-1", ruleEnablement: { [RULE_ID]: true } }),
  );
  const plugin = new HakobiPlugin(app, { id: "miyo-hakobi" } as never) as TestPlugin;
  Object.assign(plugin.manifest, {
    id: "miyo-hakobi",
    version: "9.9.9",
    dir: ".obsidian/plugins/miyo-hakobi",
  });
  const data = {
    schemaVersion: 1,
    rules: [
      {
        id: RULE_ID,
        name: RULE_NAME,
        everyMinutes: EVERY_MINUTES,
        action: "copy",
        onCollision: "skip",
        flattenOnTarget: false,
        dryRun: false,
        direction: "import",
        sourcePath: "/tmp/source",
        destinationVaultPath: "inbox",
      },
    ],
    globalSettings: {},
  };
  plugin.loadData = vi.fn(async () => data);
  await plugin.onload();
  return plugin;
}

function debugLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c.map(String).join(" "));
}

const tickLines = (l: string[]): string[] => l.filter((x) => x.includes("tick "));

describe("debug logging switch and daily summary, end to end (#18)", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let runSpy: ReturnType<typeof vi.spyOn>;
  let plugin: TestPlugin | undefined;
  let unloaded = false;

  beforeEach(() => {
    vi.useFakeTimers();
    delete captured["GeneralSubtab"];
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    runSpy = vi
      .spyOn(ImportRunner.prototype, "run")
      .mockResolvedValue({ copied: 1, skipped: 0, failed: 0, aborted: false });
  });

  afterEach(() => {
    if (!unloaded) plugin?.onunload();
    unloaded = false;
    plugin?._runCleanup();
    plugin = undefined;
    setDebugSource(null);
    runSpy.mockRestore();
    debugSpy.mockRestore();
    vi.useRealTimers();
  });

  it("with the switch off, runs write no tick lines but load lines are present", async () => {
    plugin = await loadPluginWithRule();
    await vi.advanceTimersByTimeAsync(GRACE_MS + 1);
    expect(runSpy).toHaveBeenCalledTimes(1); // initial run
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(runSpy).toHaveBeenCalledTimes(2); // one timer run

    const all = debugLines(debugSpy);
    expect(tickLines(all)).toEqual([]);
    expect(all.some((l) => l.includes("plugin loading (9.9.9)"))).toBe(true);
    expect(all.some((l) => l.includes("config loaded: 1 rules (1 enabled on this device)"))).toBe(true);
    expect(all.some((l) => l.includes("plugin loaded"))).toBe(true);
  });

  it("toggling on through the General save wrapper makes the next run write tick lines", async () => {
    plugin = await loadPluginWithRule();
    await vi.advanceTimersByTimeAsync(GRACE_MS + INTERVAL_MS);
    expect(tickLines(debugLines(debugSpy))).toEqual([]);

    const deps = captured["GeneralSubtab"] as unknown as {
      ruleStore: {
        loadGlobalSettings: () => Promise<GlobalSettings>;
        saveGlobalSettings: (s: GlobalSettings) => Promise<void>;
      };
    };
    const current = await deps.ruleStore.loadGlobalSettings();
    await deps.ruleStore.saveGlobalSettings({ ...current, debugLogging: true });

    debugSpy.mockClear();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    const ticks = tickLines(debugLines(debugSpy));
    expect(ticks.some((l) => l.includes("tick begin"))).toBe(true);
    expect(ticks.some((l) => l.includes("tick end") && l.includes("1 copied"))).toBe(true);
  });

  it("writes exactly one counts-only daily summary at the 24 h mark", async () => {
    plugin = await loadPluginWithRule();
    await vi.advanceTimersByTimeAsync(GRACE_MS + INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DAILY_SUMMARY_INTERVAL_MS - GRACE_MS - INTERVAL_MS);

    const summaries = debugLines(debugSpy).filter((l) => SUMMARY_RE.test(l));
    const n = runSpy.mock.calls.length;
    expect(n).toBe(1 + Math.floor(DAILY_SUMMARY_INTERVAL_MS / INTERVAL_MS)); // initial + timer runs
    expect(summaries).toEqual([
      `[Hakobi] daily summary: ${n} completed, 0 failed, 0 overlap skips, 0 dry runs; files ${n} copied, 0 skipped, 0 failed`,
    ]);
    expect(summaries[0]).not.toContain(RULE_NAME);
  });

  it("onunload then _runCleanup clears every interval the plugin registered and log.debug stays silent", async () => {
    const clearSpy = vi.spyOn(window, "clearInterval");
    plugin = await loadPluginWithRule();
    const deps = captured["GeneralSubtab"] as unknown as {
      ruleStore: {
        loadGlobalSettings: () => Promise<GlobalSettings>;
        saveGlobalSettings: (s: GlobalSettings) => Promise<void>;
      };
    };
    await deps.ruleStore.saveGlobalSettings({
      ...(await deps.ruleStore.loadGlobalSettings()),
      debugLogging: true,
    });
    await vi.advanceTimersByTimeAsync(GRACE_MS + 1);

    // Scoped to this plugin: its registered intervals (rule timer + summary
    // timer). The global fake-timer count is not used because a fire-and-forget
    // audit rotation briefly holds a NodeFs timeout timer of its own.
    const registered = (plugin.registerInterval as unknown as { mock: { calls: number[][] } })
      .mock.calls.map((c) => c[0]);
    expect(registered).toHaveLength(2);

    plugin.onunload();
    unloaded = true;
    plugin._runCleanup();
    const cleared = clearSpy.mock.calls.map((c) => c[0]);
    for (const id of registered) expect(cleared).toContain(id);

    debugSpy.mockClear();
    runSpy.mockClear();
    log.debug("after-unload");
    await vi.advanceTimersByTimeAsync(DAILY_SUMMARY_INTERVAL_MS);
    expect(runSpy).not.toHaveBeenCalled();
    expect(debugLines(debugSpy)).toEqual([]);
    clearSpy.mockRestore();
  });
});
