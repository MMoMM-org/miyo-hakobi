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
      // for any rules — but simulate the scheduler's actual contract by
      // registering at least one interval via plugin.registerInterval(...).
      // This proves the post-onload "timers are registered" invariant
      // (phase-4.md T4.1.2 spec) without depending on real Scheduler internals.
      const { Scheduler } = await import("../../src/scheduler/Scheduler");
      let plugin: InstanceType<typeof Plugin> | undefined;
      const startSpy = vi
        .spyOn(Scheduler.prototype, "start")
        .mockImplementation(async () => {
          // Called only after `await plugin.onload()` — plugin is guaranteed assigned.
          // Register a heartbeat interval through the Plugin contract so the
          // mock's _cleanupFns gets a clearInterval entry — mirrors what the
          // real Scheduler.start() does for each rule's everyMinutes timer.
          plugin!.registerInterval(
            setInterval(() => {}, 60_000) as unknown as number,
          );
        });
      const stopSpy = vi
        .spyOn(Scheduler.prototype, "stop")
        .mockImplementation(() => {});

      vi.useFakeTimers();

      plugin = await makePlugin();
      if (!plugin) throw new Error("makePlugin() returned undefined");

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
      // Use advanceTimersByTimeAsync(0) instead of runAllTimersAsync so the
      // perpetual heartbeat interval registered by Scheduler.start() does not
      // loop forever — we only need queued microtasks/0ms timers to flush.
      await vi.advanceTimersByTimeAsync(0);

      // Scheduler is running: start() called exactly once on cycle 1
      expect(startSpy).toHaveBeenCalledTimes(1);

      // Cleanup registry is non-empty AND a fake timer is active — proves
      // "timers are registered" (phase-4.md T4.1.2). The Scheduler.start mock
      // simulates the real contract by enqueuing one registerInterval call.
      expect(
        (plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns.length,
      ).toBeGreaterThan(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // Obsidian surface registrations happened
      const addCommandDelta1 =
        (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length - baseAddCommandCalls;
      const addSettingTabDelta1 =
        (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length - baseAddSettingTabCalls;
      const addStatusBarItemDelta1 =
        (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length - baseAddStatusBarItemCalls;
      expect(addCommandDelta1).toBe(6);
      expect(addSettingTabDelta1).toBe(1);
      expect(addStatusBarItemDelta1).toBe(1);

      // ---- unload + cleanup cycle 1 ----
      plugin.onunload();

      // Scheduler.stop() called once (production onunload calls scheduler?.stop())
      expect(stopSpy).toHaveBeenCalledTimes(1);

      // Now Obsidian would invoke all register*() cleanups; the mock exposes
      // _runCleanup() to do this synchronously.
      (plugin as unknown as { _runCleanup(): void })._runCleanup();

      // Drain any 0ms timers/microtasks a future cleanup might enqueue. We use
      // advanceTimersByTimeAsync(0) instead of runAllTimersAsync because the
      // Scheduler.start mock above registers a perpetual heartbeat interval —
      // runAllTimersAsync would chase that interval forever if a future cleanup
      // accidentally left it un-cleared. advanceTimersByTimeAsync(0) is the
      // safe drain primitive: flushes ready work without recursing.
      await vi.advanceTimersByTimeAsync(0);

      // Assertions: zero residual state after cycle 1
      expect((plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      // "all DOM listeners removed" (phase-4.md T4.1.2). Production now
      // registers DOM listeners through plugin.registerDomEvent (StatusBar
      // click handler). Each such call enqueues a removeEventListener cleanup
      // on _cleanupFns — proven drained at length 0 above. We assert ≥ 1 here
      // so that if a future change accidentally drops the registerDomEvent
      // path (and reverts to raw addEventListener), this test fails loudly.
      const cycle1DomEventCalls =
        (plugin.registerDomEvent as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(cycle1DomEventCalls).toBeGreaterThan(0);

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
      // Same reasoning as cycle 1 — flush microtasks/0ms timers without
      // looping the perpetual heartbeat interval registered by start().
      await vi.advanceTimersByTimeAsync(0);

      // Scheduler.start() was called again — total now 2
      expect(startSpy).toHaveBeenCalledTimes(2);

      // Same "timers are registered" invariant as cycle 1 — proves the
      // re-load wired the scheduler back in (no leak across reloads).
      expect(
        (plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns.length,
      ).toBeGreaterThan(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // Same delta as cycle 1: 6 commands, 1 settings tab, 1 status bar item.
      // (If onload were leaving stale state behind, we might see >6 commands
      // — duplicate registrations, the classic hot-reload bug.)
      const addCommandDelta2 =
        (plugin.addCommand as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddCommandCalls;
      const addSettingTabDelta2 =
        (plugin.addSettingTab as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddSettingTabCalls;
      const addStatusBarItemDelta2 =
        (plugin.addStatusBarItem as ReturnType<typeof vi.fn>).mock.calls.length - beforeCycle2AddStatusBarItemCalls;
      expect(addCommandDelta2).toBe(6);
      expect(addSettingTabDelta2).toBe(1);
      expect(addStatusBarItemDelta2).toBe(1);

      // ---- unload + cleanup cycle 2 ----
      plugin.onunload();
      expect(stopSpy).toHaveBeenCalledTimes(2);

      (plugin as unknown as { _runCleanup(): void })._runCleanup();
      // Same reasoning as cycle 1: advanceTimersByTimeAsync(0) drains ready
      // work without chasing the perpetual heartbeat interval that the
      // Scheduler.start mock registers — runAllTimersAsync would loop forever
      // if a future cleanup ever left the heartbeat un-cleared.
      await vi.advanceTimersByTimeAsync(0);

      // Final assertions: zero residual state after cycle 2 (no leaks across
      // reloads — the canonical SDD/Reliability invariant).
      expect((plugin as unknown as { _cleanupFns: unknown[] })._cleanupFns).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      // Same invariant as cycle 1: registerDomEvent kept being used (no
      // accidental revert to raw addEventListener) AND its cleanups landed
      // on _cleanupFns, which we drained at length 0 above. The cumulative
      // call count must have grown by at least the cycle 1 amount — proves
      // re-onload re-registered the same listeners cleanly.
      const cycle2DomEventCalls =
        (plugin.registerDomEvent as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(cycle2DomEventCalls).toBeGreaterThanOrEqual(cycle1DomEventCalls * 2);
    },
  );
});
