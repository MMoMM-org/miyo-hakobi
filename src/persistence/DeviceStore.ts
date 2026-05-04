// WHY this file exists:
// Per-device flag storage for Hakobi rules. ADR-3 mandates a hybrid storage
// scheme: `data.json` holds rule definitions (Sync-portable), while
// `device.json` holds per-device enablement flags (NOT Sync-replicated).
//
// DeviceStore manages `<pluginDataDir>/device.json` via an injected
// DeviceFsAdapter so it stays decoupled from the Obsidian API and is fully
// testable without running Obsidian.
//
// Semantics:
//  - `isEnabled(ruleId)`: absent key → `false` (Synced-from-other-device
//    default-deny, PRD/F8). Present key → stored value.
//  - `markCreatedHere(ruleId)`: thin wrapper calling `setEnabled(ruleId, true)`
//    to express the distinct intent "this rule was created on this device".
//    The caller (settings UI) is responsible for calling this immediately
//    after rule creation.
//  - `schemaVersion` mismatch: treated as a migration seam. v1 writes back
//    with schemaVersion:1 on next save without altering data.
//  - Malformed JSON: re-inits with a fresh device state and logs a console warn.

import type { RuleId } from "../domain/ruleId";
import type { DeviceState } from "../types";
import { log } from "../util/logger";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Minimal structural interface for the data adapter. No Obsidian import. */
export interface DeviceFsAdapter {
  read(path: string): Promise<string>; // utf-8
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface DeviceStoreDeps {
  adapter: DeviceFsAdapter;
  pluginDataDir: string; // e.g. ".obsidian/plugins/miyo-hakobi"
  randomUUID?: () => string; // injectable for deterministic tests
}

// ---------------------------------------------------------------------------
// DeviceStore
// ---------------------------------------------------------------------------

export class DeviceStore {
  private readonly adapter: DeviceFsAdapter;
  private readonly deviceJsonPath: string;
  private readonly randomUUID: () => string;
  private cache: DeviceState | null = null;

  constructor(deps: DeviceStoreDeps) {
    this.adapter = deps.adapter;
    this.deviceJsonPath = `${deps.pluginDataDir}/device.json`;
    this.randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Ensures the in-memory cache is populated; reads or creates device.json. */
  private async ensureLoaded(): Promise<void> {
    if (this.cache !== null) return;

    const exists = await this.adapter.exists(this.deviceJsonPath);

    if (!exists) {
      await this.initFresh();
      return;
    }

    let raw: string;
    try {
      raw = await this.adapter.read(this.deviceJsonPath);
    } catch {
      // read failed unexpectedly after exists returned true — treat as corrupt
      log.warn(
        "[DeviceStore] Failed to read device.json; re-initializing with a fresh device.",
      );
      await this.initFresh();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log.warn(
        "[DeviceStore] device.json contains malformed JSON; re-initializing with a fresh device.",
      );
      await this.initFresh();
      return;
    }

    // Accept any object with the expected shape; treat schemaVersion mismatch
    // as a migration seam — keep data but normalize to 1 on next write.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "deviceId" in parsed &&
      typeof (parsed as Record<string, unknown>).deviceId === "string" &&
      "ruleEnablement" in parsed &&
      typeof (parsed as Record<string, unknown>).ruleEnablement === "object" &&
      (parsed as Record<string, unknown>).ruleEnablement !== null
    ) {
      const p = parsed as Record<string, unknown>;
      this.cache = {
        schemaVersion: 1,
        deviceId: p.deviceId as string,
        ruleEnablement: p.ruleEnablement as Record<RuleId, boolean>,
      };
    } else {
      log.warn(
        "[DeviceStore] device.json has unexpected structure; re-initializing with a fresh device.",
      );
      await this.initFresh();
    }
  }

  /** Creates a fresh DeviceState, persists it, and populates the cache. */
  private async initFresh(): Promise<void> {
    const state: DeviceState = {
      schemaVersion: 1,
      deviceId: this.randomUUID(),
      ruleEnablement: {},
    };
    await this.persist(state);
    this.cache = state;
  }

  /** Serializes and writes the given state to device.json. */
  private async persist(state: DeviceState): Promise<void> {
    await this.adapter.write(this.deviceJsonPath, JSON.stringify(state));
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Returns the persisted device UUID. Lazy-initializes on first call. */
  async getDeviceId(): Promise<string> {
    await this.ensureLoaded();
    return this.cache!.deviceId;
  }

  /** Returns whether the rule is enabled on this device.
   *  Absent key → false (Synced default-deny per PRD/F8). */
  async isEnabled(ruleId: RuleId): Promise<boolean> {
    await this.ensureLoaded();
    const flag = this.cache!.ruleEnablement[ruleId];
    return flag ?? false;
  }

  /** Sets the enablement flag for a rule and persists. */
  async setEnabled(ruleId: RuleId, enabled: boolean): Promise<void> {
    await this.ensureLoaded();
    this.cache!.ruleEnablement[ruleId] = enabled;
    await this.persist(this.cache!);
  }

  /** Marks a rule as created on this device (enabled = true).
   *  Semantically distinct from setEnabled — use at the call site immediately
   *  after the user creates a rule on this device. */
  async markCreatedHere(ruleId: RuleId): Promise<void> {
    await this.setEnabled(ruleId, true);
  }

  /** Removes the rule's enablement entry. After removal isEnabled → false. */
  async removeRule(ruleId: RuleId): Promise<void> {
    await this.ensureLoaded();
    delete this.cache!.ruleEnablement[ruleId];
    await this.persist(this.cache!);
  }
}
