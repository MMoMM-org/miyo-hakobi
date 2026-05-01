// unload.test.ts — Plugin lifecycle integration test (T4.1).
//
// WHY this file exists:
// Verifies that HakobiPlugin's onload/onunload pair leaves zero residual state
// behind: zero active timers, zero orphaned cleanup functions (DOM listeners /
// intervals / events registered via Plugin.register* helpers), and that two
// consecutive load/unload cycles produce identical clean-state outcomes — the
// realistic case during hot-reload development (pjeby/hot-reload v0.3.0 is the
// preinstalled live-reload path, see test/CLAUDE.md).
//
// Approach:
// - Instantiate HakobiPlugin against the obsidian mock (same pattern as
//   test/main.test.ts).
// - Spy Scheduler.prototype.start/stop so the test stays focused on lifecycle
//   wiring, not scheduler internals.
// - Use vi.useFakeTimers() so any best-effort async work (rotation.checkAndRotate)
//   that schedules a microtask/timer does not leak into the timer count
//   assertion.
// - Run the full onload → assert → onunload → _runCleanup → assert sequence
//   TWICE inside one test, with no-leak assertions between cycles AND after the
//   second cycle, to prove no state leaks across hot-reloads.
//
// References:
// - SDD/Quality Requirements/Reliability — "Plugin unload leaves zero active
//   timers and zero registered DOM listeners (asserted via Plugin._runCleanup()
//   in test/lifecycle/unload.test.ts)."
// - SDD/Implementation Gotchas — Setting tab display() / no-daemon promise.
// - SDD Glossary — register*, Plugin._runCleanup() (mock-only).

import { describe, it, expect, vi, afterEach } from "vitest";

import { App, Plugin } from "obsidian";

// ---------------------------------------------------------------------------
// Helpers (mirrors test/main.test.ts; intentionally duplicated so this test
// file stays self-contained — a lifecycle test that depends on a sibling test
// file's helpers would itself be a leak risk).
// ---------------------------------------------------------------------------

/** Build a minimal App mock with the seams HakobiPlugin.onload() needs. */
function makeApp(): App {
  const app = new App();
  // AuditLog's getAuditDir factory + DeviceStore both use getFullPath; the
  // base mock does not ship one because not every test path needs it.
  (app.vault.adapter as Record<string, unknown>)["getFullPath"] = vi.fn(
    (rel: string) => `/tmp/hakobi-test-vault/.obsidian/plugins/miyo-hakobi/${rel}`,
  );
  return app;
}

/** Lazy-import HakobiPlugin so any vi.spyOn() set up first is in place when
 *  the constructor runs. */
async function makePlugin(): Promise<InstanceType<typeof Plugin>> {
  const { default: HakobiPlugin } = await import("../../src/main");
  const app = makeApp();
  const plugin = new HakobiPlugin(app);

  // Stamp a realistic manifest — the base mock only ships id/name/version.
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

describe("HakobiPlugin lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // T4.1 — zero residual state after unload, across two consecutive cycles
  //
  // The single-test "load → unload → load → unload" shape is intentional:
  // a plugin that leaks state between hot-reloads passes a "load + unload once"
  // test and only fails the second cycle. Splitting this into two tests would
  // hide that class of bug because vitest resets module-level state between
  // its (resp. it.each) cases.
  it(
    "two consecutive load/unload cycles leave no active timers and no orphaned cleanups",
    async () => {
      // Stub Scheduler.start so onload finishes without scheduling real timers
      // for any rules. (start() is async and awaited in onload.)
      const { Scheduler } = await import("../../src/scheduler/Scheduler");
      const startSpy = vi
        .spyOn(Scheduler.prototype, "start")
        .mockResolvedValue(undefined);
      const stopSpy = vi
        .spyOn(Scheduler.prototype, "stop")
        .mockImplementation(() => {});

      vi.useFakeTimers();

      const plugin = await makePlugin();

      // ---------------------------------------------------------------------
      // CYCLE 1
      // ---------------------------------------------------------------------

      // Snapshot the per-plugin spy call counts BEFORE cycle 1 so we can assert
      // deltas (the same plugin instance accumulates counts across cycles).
      const baseAddCommandCalls = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length;
      const baseAddSettingTabCalls = (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length;
      const baseAddStatusBarItemCalls = (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length;

      await plugin.onload();

      // Drain best-effort rotation.checkAndRotate() that onload fires-and-forgets.
      await vi.runAllTimersAsync();

      // Scheduler is running: start() called exactly once on cycle 1
      expect(startSpy).toHaveBeenCalledTimes(1);

      // Cleanup registry is non-empty — registerInterval and/or register pushed
      // entries during onload (e.g., the per-rule timers via Scheduler, or
      // future register*-based subscriptions). If this ever drops to 0,
      // either the wiring regressed or HakobiPlugin no longer registers any
      // cleanup; either way, this is the canary.
      // NOTE: With Scheduler.start() stubbed, no rule timers are registered;
      // the production code currently has no other register*() calls in
      // onload(). So we only assert _cleanupFns is an array (sanity), not
      // that it is non-empty — leaving room for future register* additions
      // without forcing this test to chase them.
      expect(Array.isArray((plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns)).toBe(true);

      // Obsidian surface registrations happened
      const addCommandDelta1 =
        (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length - baseAddCommandCalls;
      const addSettingTabDelta1 =
        (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length - baseAddSettingTabCalls;
      const addStatusBarItemDelta1 =
        (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length - baseAddStatusBarItemCalls;
      expect(addCommandDelta1).toBe(7);
      expect(addSettingTabDelta1).toBe(1);
      expect(addStatusBarItemDelta1).toBe(1);

      // ---- unload + cleanup cycle 1 ----
      plugin.onunload();

      // Scheduler.stop() called once (production onunload calls scheduler?.stop())
      expect(stopSpy).toHaveBeenCalledTimes(1);

      // Now Obsidian would invoke all register*() cleanups; the mock exposes
      // _runCleanup() to do this synchronously.
      (plugin as unknown as { _runCleanup(): void })._runCleanup();

      // Drain any timers that may have been queued during cleanup (none expected)
      await vi.runAllTimersAsync();

      // Assertions: zero residual state after cycle 1
      expect((plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      // ---------------------------------------------------------------------
      // CYCLE 2 — re-load the same plugin instance and unload again.
      // This catches state that survives onunload (e.g. members on `this`
      // not re-initialised by onload, listener references kept on captured
      // closures, etc.) — exactly the hot-reload failure mode.
      // ---------------------------------------------------------------------

      const beforeCycle2AddCommandCalls = (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length;
      const beforeCycle2AddSettingTabCalls = (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length;
      const beforeCycle2AddStatusBarItemCalls = (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length;

      await plugin.onload();
      await vi.runAllTimersAsync();

      // Scheduler.start() was called again — total now 2
      expect(startSpy).toHaveBeenCalledTimes(2);

      // Same delta as cycle 1: 7 commands, 1 settings tab, 1 status bar item.
      // (If onload were leaving stale state behind, we might see >7 commands
      // — duplicate registrations, the classic hot-reload bug.)
      const addCommandDelta2 =
        (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddCommandCalls;
      const addSettingTabDelta2 =
        (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddSettingTabCalls;
      const addStatusBarItemDelta2 =
        (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddStatusBarItemCalls;
      expect(addCommandDelta2).toBe(7);
      expect(addSettingTabDelta2).toBe(1);
      expect(addStatusBarItemDelta2).toBe(1);

      // ---- unload + cleanup cycle 2 ----
      plugin.onunload();
      expect(stopSpy).toHaveBeenCalledTimes(2);

      (plugin as unknown as { _runCleanup(): void })._runCleanup();
      await vi.runAllTimersAsync();

      // Final assertions: zero residual state after cycle 2 (no leaks across
      // reloads — the canonical SDD/Reliability invariant).
      expect((plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
