// main.test.ts — lifecycle integration tests for HakobiPlugin (T3.11).
//
// WHY this file exists:
// Verifies that HakobiPlugin wires every Phase 1-3 module correctly in its
// onload/onunload lifecycle: construction order, Obsidian surface calls (addCommand x7,
// addStatusBarItem, addSettingTab), scheduler start/stop, timer cleanup, and
// manifest identity invariants.
//
// Approach: instantiate HakobiPlugin against the lightweight obsidian mock. Use
// vi.spyOn(Scheduler.prototype, 'start') and 'stop' to assert the scheduler is
// started on load and stopped on unload. Use the plugin mock's tracking
// (addStatusBarItem, addCommand, addSettingTab, _runCleanup) for structural assertions.

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Import mocked Obsidian deps (hoisted before the plugin) ──────────────────
import { App, Plugin } from "obsidian";

// ── Module under test ────────────────────────────────────────────────────────
// We do NOT mock the real Phase 1-3 implementations; the obsidian mock and jsdom
// are sufficient for structural assertions.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal App mock with getBasePath and getFullPath seams. */
function makeApp(): App {
  const app = new App();
  // DeviceStore adapter uses app.vault.adapter.read/write/exists
  // (already present on the mock). Add getFullPath so AuditLog's
  // getAuditDir factory can resolve a real FS path.
  (app.vault.adapter as Record<string, unknown>)["getFullPath"] = vi.fn(
    (rel: string) => `/tmp/hakobi-test-vault/.obsidian/plugins/miyo-hakobi/${rel}`,
  );
  return app;
}

/** Instantiate HakobiPlugin against the App mock and stamp the manifest. */
async function makePlugin() {
  // Lazy import so spies can be set up before construction
  const { default: HakobiPlugin } = await import("../src/main");
  const app = makeApp();
  const plugin = new HakobiPlugin(app) as HakobiPlugin & Plugin;

  // Stamp a realistic manifest (Plugin mock only has id + name + version fields)
  Object.assign(plugin.manifest, {
    id: "miyo-hakobi",
    name: "MiYo Hakobi",
    version: "0.0.0",
    description: "Scheduled file ferry",
    author: "Marcus Breiden <marcus@mmomm.org>",
    authorUrl: "https://www.mmomm.org",
    dir: ".obsidian/plugins/miyo-hakobi",
  });

  return plugin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HakobiPlugin", () => {

  // T3.11-1: class identity
  it("is an instance of Plugin (obsidian Plugin base class)", async () => {
    const plugin = await makePlugin();
    expect(plugin).toBeInstanceOf(Plugin);
  });

  // T3.11-2: addSettingTab called once with a HakobiSettingsTab instance
  it("calls addSettingTab exactly once with a HakobiSettingsTab after onload()", async () => {
    const { HakobiSettingsTab } = await import("../src/settings/SettingsTab");
    const plugin = await makePlugin();
    await plugin.onload();
    expect(plugin.addSettingTab).toHaveBeenCalledTimes(1);
    const [tab] = (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect(tab).toBeInstanceOf(HakobiSettingsTab);
  });

  // T3.11-3: addStatusBarItem called at least once
  it("calls addStatusBarItem at least once after onload()", async () => {
    const plugin = await makePlugin();
    await plugin.onload();
    expect(plugin.addStatusBarItem).toHaveBeenCalledTimes(1);
  });

  // T3.11-4: addCommand called exactly 7 times
  it("calls addCommand exactly 7 times after onload()", async () => {
    const plugin = await makePlugin();
    await plugin.onload();
    expect(plugin.addCommand).toHaveBeenCalledTimes(7);
  });

  // T3.11-5: scheduler.start() called
  it("calls Scheduler.start() during onload()", async () => {
    const { Scheduler } = await import("../src/scheduler/Scheduler");
    const startSpy = vi.spyOn(Scheduler.prototype, "start").mockResolvedValue(undefined);
    const plugin = await makePlugin();
    await plugin.onload();
    expect(startSpy).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });

  // T3.11-6: scheduler.stop() called on unload
  it("calls Scheduler.stop() during onunload()", async () => {
    const { Scheduler } = await import("../src/scheduler/Scheduler");
    vi.spyOn(Scheduler.prototype, "start").mockResolvedValue(undefined);
    const stopSpy = vi.spyOn(Scheduler.prototype, "stop").mockImplementation(() => {});
    const plugin = await makePlugin();
    await plugin.onload();
    plugin.onunload();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    stopSpy.mockRestore();
  });

  // T3.11-7: no leaked timers after onload + _runCleanup
  it("has no active intervals after _runCleanup() (no timer leaks)", async () => {
    vi.useFakeTimers();
    try {
      const { Scheduler } = await import("../src/scheduler/Scheduler");
      // Allow start to run but not actually schedule real timers
      vi.spyOn(Scheduler.prototype, "start").mockResolvedValue(undefined);

      const plugin = await makePlugin();
      await plugin.onload();
      plugin.onunload();
      plugin._runCleanup();

      // Drain any pending NodeFs I/O timeouts (best-effort rotation check
      // fired from onload via `.catch(() => undefined)` — not a leak, just
      // an in-flight async operation). After draining, the count must be 0.
      await vi.runAllTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  // T3.11-7b: no leaked cleanup fns (DOM listeners / intervals / events) after _runCleanup
  //
  // The Plugin mock's register() and registerInterval() both enqueue into
  // _cleanupFns. _runCleanup() splices the list (runs all fns and clears it)
  // so any non-zero residual would mean something registered a cleanup that
  // never ran — a DOM-listener or interval leak. Asserting length === 0
  // is the canonical "no orphaned listeners" check for this mock.
  it("_runCleanup() leaves no orphaned cleanup functions (no DOM-listener / interval leaks)", async () => {
    const { Scheduler } = await import("../src/scheduler/Scheduler");
    vi.spyOn(Scheduler.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(Scheduler.prototype, "stop").mockImplementation(() => {});

    const plugin = await makePlugin();
    await plugin.onload();
    plugin.onunload();
    plugin._runCleanup();

    // After _runCleanup(), the registry must be empty — every registered
    // cleanup fn was executed and removed.
    expect(plugin._cleanupFns).toHaveLength(0);

    vi.restoreAllMocks();
  });

  // T3.11-8: manifest identity invariants
  it("manifest.json preserves id=miyo-hakobi and isDesktopOnly=true", () => {
    const manifestPath = path.resolve(__dirname, "../manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      id: string;
      isDesktopOnly: boolean;
    };
    expect(manifest.id).toBe("miyo-hakobi");
    expect(manifest.isDesktopOnly).toBe(true);
  });

  // T3.11 — SettingsTab alias removed: the named export 'SettingsTab' must NOT exist
  it("SettingsTab.ts no longer exports the backward-compat SettingsTab alias", async () => {
    const settingsTabModule = await import("../src/settings/SettingsTab");
    // The 'SettingsTab' alias should be gone; only HakobiSettingsTab remains
    expect((settingsTabModule as Record<string, unknown>)["SettingsTab"]).toBeUndefined();
  });

  // T3.11 — types/index.ts no longer exports PluginSettings/DEFAULT_SETTINGS
  it("types/index.ts no longer exports legacy PluginSettings or DEFAULT_SETTINGS", async () => {
    const typesModule = await import("../src/types/index");
    expect((typesModule as Record<string, unknown>)["DEFAULT_SETTINGS"]).toBeUndefined();
    // PluginSettings is a type-only export so it won't appear at runtime — this is correct
  });
});
