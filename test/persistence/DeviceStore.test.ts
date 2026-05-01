// Tests for src/persistence/DeviceStore.ts (T2.2).
//
// What is asserted here:
//  - First run: device.json does not exist → generates a UUID, persists
//    { schemaVersion:1, deviceId, ruleEnablement:{} }, returns stable id.
//  - getDeviceId() is lazily loaded and cached (adapter.read called once
//    across multiple calls).
//  - isEnabled(ruleId): unknown ruleId → false (Synced-from-other-device
//    default-deny per PRD/F8).
//  - markCreatedHere(ruleId): sets the flag to true and persists.
//  - setEnabled(ruleId, flag): persists the flag; re-instantiating DeviceStore
//    with the same adapter reads back the correct value.
//  - removeRule(ruleId): deletes the key; subsequent isEnabled → false.
//  - Malformed JSON in device.json → re-init with fresh device (console warn,
//    no crash).
//  - device.json path assertion: adapter.write is called with a path that
//    contains "/device.json" (separate file from data.json).
//
// Adapter strategy: in-memory Map<string, string> fake adapter so all
// read/write/exists operations round-trip predictably without touching disk.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceStore } from "../../src/persistence/DeviceStore";
import type { DeviceFsAdapter } from "../../src/persistence/DeviceStore";
import type { RuleId } from "../../src/domain/ruleId";

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

function makeAdapter(): { adapter: DeviceFsAdapter; store: Map<string, string> } {
  const store = new Map<string, string>();

  const adapter: DeviceFsAdapter = {
    async read(path: string): Promise<string> {
      const value = store.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    async write(path: string, data: string): Promise<void> {
      store.set(path, data);
    },
    async exists(path: string): Promise<boolean> {
      return store.has(path);
    },
  };

  return { adapter, store };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLUGIN_DATA_DIR = ".obsidian/plugins/miyo-hakobi";
const DEVICE_JSON_PATH = `${PLUGIN_DATA_DIR}/device.json`;
const RULE_ID_A = "aaaaaaaa-0000-0000-0000-000000000001" as RuleId;
const RULE_ID_B = "bbbbbbbb-0000-0000-0000-000000000002" as RuleId;
const FIXED_UUID = "11111111-2222-3333-4444-555555555555";

function makeStore(
  store: Map<string, string>,
  overrides?: { randomUUID?: () => string },
): DeviceStore {
  const { adapter } = { adapter: makeSpy(store) };
  return new DeviceStore({
    adapter,
    pluginDataDir: PLUGIN_DATA_DIR,
    randomUUID: overrides?.randomUUID ?? (() => FIXED_UUID),
  });
}

// Wrap the raw map adapter with vi.fn() spies for call-count assertions.
function makeSpy(store: Map<string, string>): DeviceFsAdapter {
  return {
    read: vi.fn(async (path: string): Promise<string> => {
      const value = store.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    }),
    write: vi.fn(async (path: string, data: string): Promise<void> => {
      store.set(path, data);
    }),
    exists: vi.fn(async (path: string): Promise<boolean> => store.has(path)),
  };
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

describe("DeviceStore — first run", () => {
  it("generates a UUID and persists device.json when it does not exist", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({
      adapter: spy,
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    const id = await ds.getDeviceId();

    expect(id).toBe(FIXED_UUID);
    expect(spy.write).toHaveBeenCalledOnce();
    expect(spy.write).toHaveBeenCalledWith(
      DEVICE_JSON_PATH,
      expect.stringContaining(FIXED_UUID),
    );
  });

  it("persisted device.json has schemaVersion 1 and empty ruleEnablement", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({
      adapter: spy,
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.getDeviceId();

    const raw = store.get(DEVICE_JSON_PATH);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { schemaVersion: number; deviceId: string; ruleEnablement: Record<string, boolean> };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.deviceId).toBe(FIXED_UUID);
    expect(parsed.ruleEnablement).toEqual({});
  });

  it("device.json path contains /device.json (not nested inside data.json)", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({ adapter: spy, pluginDataDir: PLUGIN_DATA_DIR });

    await ds.getDeviceId();

    expect(spy.write).toHaveBeenCalledWith(
      expect.stringContaining("/device.json"),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe("DeviceStore — caching", () => {
  it("reads device.json only once across multiple getDeviceId() calls", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({
      adapter: spy,
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    // First call initializes (exists returns false, then writes).
    await ds.getDeviceId();
    // Second and third calls should use the in-memory cache.
    await ds.getDeviceId();
    await ds.getDeviceId();

    // exists() called once; read() not called for a missing file (we write
    // immediately). On the first call exists() returns false so no read occurs.
    // On subsequent calls the cache is used — exists and read should not be
    // called again.
    expect(spy.exists).toHaveBeenCalledTimes(1);
    expect(spy.read).not.toHaveBeenCalled();
  });

  it("returns the same UUID on every call", async () => {
    const { store } = makeAdapter();
    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    const id1 = await ds.getDeviceId();
    const id2 = await ds.getDeviceId();
    expect(id1).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// isEnabled — default-deny for unknown rules
// ---------------------------------------------------------------------------

describe("DeviceStore.isEnabled", () => {
  it("returns false for a ruleId not in ruleEnablement (Synced default-deny)", async () => {
    const { store } = makeAdapter();
    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.getDeviceId(); // initialize
    expect(await ds.isEnabled(RULE_ID_A)).toBe(false);
  });

  it("returns the stored value for a known ruleId", async () => {
    const { store } = makeAdapter();
    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.setEnabled(RULE_ID_A, true);
    expect(await ds.isEnabled(RULE_ID_A)).toBe(true);

    await ds.setEnabled(RULE_ID_A, false);
    expect(await ds.isEnabled(RULE_ID_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markCreatedHere
// ---------------------------------------------------------------------------

describe("DeviceStore.markCreatedHere", () => {
  it("sets the rule to enabled=true and persists", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({
      adapter: spy,
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.markCreatedHere(RULE_ID_A);

    expect(await ds.isEnabled(RULE_ID_A)).toBe(true);
    // write called: once for first-run init (from markCreatedHere → setEnabled
    // → ensures loaded) and once for the persist.
    expect(spy.write).toHaveBeenCalledTimes(2);
  });

  it("re-instantiation with the same adapter still sees enabled=true", async () => {
    const { store } = makeAdapter();

    const ds1 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });
    await ds1.markCreatedHere(RULE_ID_B);

    // New instance, same backing store.
    const ds2 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
    });
    expect(await ds2.isEnabled(RULE_ID_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setEnabled
// ---------------------------------------------------------------------------

describe("DeviceStore.setEnabled", () => {
  it("persists the flag and is readable by a new DeviceStore instance", async () => {
    const { store } = makeAdapter();

    const ds1 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });
    await ds1.setEnabled(RULE_ID_A, true);

    const ds2 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
    });
    expect(await ds2.isEnabled(RULE_ID_A)).toBe(true);
  });

  it("toggling from true to false persists correctly", async () => {
    const { store } = makeAdapter();

    const ds1 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });
    await ds1.setEnabled(RULE_ID_A, true);
    await ds1.setEnabled(RULE_ID_A, false);

    const ds2 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
    });
    expect(await ds2.isEnabled(RULE_ID_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// removeRule
// ---------------------------------------------------------------------------

describe("DeviceStore.removeRule", () => {
  it("deletes the key from ruleEnablement and subsequent isEnabled returns false", async () => {
    const { store } = makeAdapter();
    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.setEnabled(RULE_ID_A, true);
    expect(await ds.isEnabled(RULE_ID_A)).toBe(true);

    await ds.removeRule(RULE_ID_A);
    expect(await ds.isEnabled(RULE_ID_A)).toBe(false);
  });

  it("persists the removal so a new instance also sees false", async () => {
    const { store } = makeAdapter();

    const ds1 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });
    await ds1.setEnabled(RULE_ID_A, true);
    await ds1.removeRule(RULE_ID_A);

    const ds2 = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
    });
    expect(await ds2.isEnabled(RULE_ID_A)).toBe(false);

    // Also assert the key is absent from the JSON.
    const raw = store.get(DEVICE_JSON_PATH);
    const parsed = JSON.parse(raw!) as { ruleEnablement: Record<string, boolean> };
    expect(Object.keys(parsed.ruleEnablement)).not.toContain(RULE_ID_A);
  });

  it("is a no-op (no error) when ruleId is not present", async () => {
    const { store } = makeAdapter();
    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.getDeviceId(); // init
    await expect(ds.removeRule(RULE_ID_A)).resolves.toBeUndefined();
    expect(await ds.isEnabled(RULE_ID_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON recovery
// ---------------------------------------------------------------------------

describe("DeviceStore — malformed JSON recovery", () => {
  it("re-inits with a fresh device when device.json is not valid JSON", async () => {
    const { store } = makeAdapter();
    // Pre-seed device.json with garbage.
    store.set(DEVICE_JSON_PATH, "{ this is not json }");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    const id = await ds.getDeviceId();

    // Should recover with a fresh UUID.
    expect(id).toBe(FIXED_UUID);
    // Should have warned.
    expect(warnSpy).toHaveBeenCalled();
    // New device.json should be valid.
    const raw = store.get(DEVICE_JSON_PATH);
    expect(() => JSON.parse(raw!)).not.toThrow();

    warnSpy.mockRestore();
  });

  it("does not throw on malformed JSON — just warns and continues", async () => {
    const { store } = makeAdapter();
    store.set(DEVICE_JSON_PATH, "CORRUPT");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const ds = new DeviceStore({
      adapter: makeSpy(store),
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await expect(ds.getDeviceId()).resolves.toBe(FIXED_UUID);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Path assertion — separate from data.json
// ---------------------------------------------------------------------------

describe("DeviceStore — path is a sibling of data.json, not nested inside it", () => {
  it("writes to a path ending in /device.json", async () => {
    const { store } = makeAdapter();
    const spy = makeSpy(store);
    const ds = new DeviceStore({
      adapter: spy,
      pluginDataDir: PLUGIN_DATA_DIR,
      randomUUID: () => FIXED_UUID,
    });

    await ds.getDeviceId();

    // All write calls target .../device.json — never data.json.
    for (const call of spy.write.mock.calls) {
      expect(call[0]).toMatch(/\/device\.json$/);
      expect(call[0]).not.toContain("data.json");
    }
  });
});
