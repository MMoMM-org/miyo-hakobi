/**
 * Tests for GeneralSubtab — global settings form + audit-log buttons.
 *
 * Covers:
 *  1. render() triggers async load; four numeric inputs appear with seeded values
 *  2-5. Editing each numeric field calls saveGlobalSettings with the new value
 *  6. "Show audit log" when file exists → openInDefaultApp called
 *  7. "Show audit log" when file absent → transient notice, no open
 *  8. "Show audit log" when openInDefaultApp throws → transient notice with path
 *  9. Purge button confirmed → purgeAll called, purge notice shown
 * 10. Purge button declined → purgeAll NOT called, no notice
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginSettingTab, Plugin, App } from "obsidian";
import { GeneralSubtab } from "../../../src/settings/subtabs/GeneralSubtab";
import type { GlobalSettings } from "../../../src/types/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

/** Drains the microtask queue so fire-and-forget async render completes. */
async function flushMicrotasks(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const SEED_SETTINGS: GlobalSettings = {
	perFileTimeoutMs: 10000,
	auditRetentionDays: 90,
	auditMaxBytes: 10485760,
	stabilityCheckMs: 2000,
};

const AUDIT_PATH = "/audit/2026-05.ndjson";

function makeDeps(overrides: Partial<{
	loadGlobalSettings: () => Promise<GlobalSettings>;
	saveGlobalSettings: (s: GlobalSettings) => Promise<void>;
	purgeAll: () => Promise<void>;
	auditFilePresent: () => Promise<boolean>;
	openInDefaultApp: (p: string) => Promise<void>;
	confirm: (msg: string) => Promise<boolean>;
}> = {}) {
	return {
		ruleStore: {
			loadGlobalSettings: overrides.loadGlobalSettings ?? vi.fn(async () => ({ ...SEED_SETTINGS })),
			saveGlobalSettings: overrides.saveGlobalSettings ?? vi.fn(async () => {}),
		},
		auditLog: {
			purgeAll: overrides.purgeAll ?? vi.fn(async () => {}),
		},
		notices: {
			transient: vi.fn(),
			persistent: vi.fn(),
		},
		auditFilePresent: overrides.auditFilePresent ?? vi.fn(async () => true),
		currentMonthAuditPath: () => AUDIT_PATH,
		openInDefaultApp: overrides.openInDefaultApp ?? vi.fn(async () => {}),
		confirm: overrides.confirm ?? vi.fn(async () => true),
	};
}

// ---------------------------------------------------------------------------
// Helpers for finding elements after render
// ---------------------------------------------------------------------------

/** Finds an input element associated with a setting row whose name matches the label text (case-insensitive). */
function findInputByLabel(containerEl: HTMLElement, labelText: string): HTMLInputElement | null {
	const settings = containerEl.querySelectorAll("[data-setting-name]");
	const lower = labelText.toLowerCase();
	for (const settingEl of Array.from(settings)) {
		const attrValue = settingEl.getAttribute("data-setting-name")?.toLowerCase() ?? "";
		if (attrValue.includes(lower)) {
			return settingEl.querySelector("input") ?? null;
		}
	}
	return null;
}

/** Finds a button element whose text content contains the given text. */
function findButtonByText(containerEl: HTMLElement, text: string): HTMLButtonElement | null {
	const buttons = Array.from(containerEl.querySelectorAll("button"));
	return buttons.find((b) => b.textContent?.includes(text)) ?? null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GeneralSubtab", () => {
	let containerEl: HTMLElement;

	beforeEach(() => {
		containerEl = makeContainer();
	});

	// -------------------------------------------------------------------------
	// Test 1: render populates four numeric inputs with loaded values
	// -------------------------------------------------------------------------

	it("after render settles, four numeric inputs show the loaded values", async () => {
		const deps = makeDeps();
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		// Verify loadGlobalSettings was called
		expect(deps.ruleStore.loadGlobalSettings).toHaveBeenCalledOnce();

		// Verify four inputs with the seeded values are present
		const timeoutInput = findInputByLabel(containerEl, "timeout");
		expect(timeoutInput).not.toBeNull();
		expect(timeoutInput?.value).toBe("10000");

		const retentionInput = findInputByLabel(containerEl, "retention");
		expect(retentionInput).not.toBeNull();
		expect(retentionInput?.value).toBe("90");

		const maxBytesInput = findInputByLabel(containerEl, "max bytes");
		expect(maxBytesInput).not.toBeNull();
		expect(maxBytesInput?.value).toBe("10485760");

		const stabilityInput = findInputByLabel(containerEl, "stability");
		expect(stabilityInput).not.toBeNull();
		expect(stabilityInput?.value).toBe("2000");
	});

	// -------------------------------------------------------------------------
	// Test 2: editing perFileTimeoutMs calls saveGlobalSettings
	// -------------------------------------------------------------------------

	it("editing perFileTimeoutMs calls saveGlobalSettings with updated value", async () => {
		const saveGlobalSettings = vi.fn(async () => {});
		const deps = makeDeps({ saveGlobalSettings });
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const input = findInputByLabel(containerEl, "timeout");
		expect(input).not.toBeNull();
		input!.value = "15000";
		input!.dispatchEvent(new Event("input"));
		await flushMicrotasks();

		expect(saveGlobalSettings).toHaveBeenCalledOnce();
		const arg = saveGlobalSettings.mock.calls[0]![0] as GlobalSettings;
		expect(arg.perFileTimeoutMs).toBe(15000);
		// Other fields preserved
		expect(arg.auditRetentionDays).toBe(SEED_SETTINGS.auditRetentionDays);
		expect(arg.auditMaxBytes).toBe(SEED_SETTINGS.auditMaxBytes);
		expect(arg.stabilityCheckMs).toBe(SEED_SETTINGS.stabilityCheckMs);
	});

	// -------------------------------------------------------------------------
	// Test 3: editing auditRetentionDays calls saveGlobalSettings
	// -------------------------------------------------------------------------

	it("editing auditRetentionDays calls saveGlobalSettings with updated value", async () => {
		const saveGlobalSettings = vi.fn(async () => {});
		const deps = makeDeps({ saveGlobalSettings });
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const input = findInputByLabel(containerEl, "retention");
		expect(input).not.toBeNull();
		input!.value = "30";
		input!.dispatchEvent(new Event("input"));
		await flushMicrotasks();

		expect(saveGlobalSettings).toHaveBeenCalledOnce();
		const arg = saveGlobalSettings.mock.calls[0]![0] as GlobalSettings;
		expect(arg.auditRetentionDays).toBe(30);
		expect(arg.perFileTimeoutMs).toBe(SEED_SETTINGS.perFileTimeoutMs);
	});

	// -------------------------------------------------------------------------
	// Test 4: editing auditMaxBytes calls saveGlobalSettings
	// -------------------------------------------------------------------------

	it("editing auditMaxBytes calls saveGlobalSettings with updated value", async () => {
		const saveGlobalSettings = vi.fn(async () => {});
		const deps = makeDeps({ saveGlobalSettings });
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const input = findInputByLabel(containerEl, "max bytes");
		expect(input).not.toBeNull();
		input!.value = "5242880";
		input!.dispatchEvent(new Event("input"));
		await flushMicrotasks();

		expect(saveGlobalSettings).toHaveBeenCalledOnce();
		const arg = saveGlobalSettings.mock.calls[0]![0] as GlobalSettings;
		expect(arg.auditMaxBytes).toBe(5242880);
		expect(arg.perFileTimeoutMs).toBe(SEED_SETTINGS.perFileTimeoutMs);
	});

	// -------------------------------------------------------------------------
	// Test 5: editing stabilityCheckMs calls saveGlobalSettings
	// -------------------------------------------------------------------------

	it("editing stabilityCheckMs calls saveGlobalSettings with updated value", async () => {
		const saveGlobalSettings = vi.fn(async () => {});
		const deps = makeDeps({ saveGlobalSettings });
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const input = findInputByLabel(containerEl, "stability");
		expect(input).not.toBeNull();
		input!.value = "5000";
		input!.dispatchEvent(new Event("input"));
		await flushMicrotasks();

		expect(saveGlobalSettings).toHaveBeenCalledOnce();
		const arg = saveGlobalSettings.mock.calls[0]![0] as GlobalSettings;
		expect(arg.stabilityCheckMs).toBe(5000);
		expect(arg.perFileTimeoutMs).toBe(SEED_SETTINGS.perFileTimeoutMs);
	});

	// -------------------------------------------------------------------------
	// Test 6: Show audit log — file exists → openInDefaultApp called
	// -------------------------------------------------------------------------

	it("Show audit log when file exists calls openInDefaultApp with the audit path", async () => {
		const openInDefaultApp = vi.fn(async () => {});
		const deps = makeDeps({
			auditFilePresent: vi.fn(async () => true),
			openInDefaultApp,
		});
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const btn = findButtonByText(containerEl, "Show audit log");
		expect(btn).not.toBeNull();
		btn!.click();
		await flushMicrotasks();

		expect(openInDefaultApp).toHaveBeenCalledOnce();
		expect(openInDefaultApp).toHaveBeenCalledWith(AUDIT_PATH);
		expect(deps.notices.transient).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Test 7: Show audit log — file absent → transient notice, no open
	// -------------------------------------------------------------------------

	it("Show audit log when file absent shows transient notice and skips open", async () => {
		const openInDefaultApp = vi.fn(async () => {});
		const deps = makeDeps({
			auditFilePresent: vi.fn(async () => false),
			openInDefaultApp,
		});
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const btn = findButtonByText(containerEl, "Show audit log");
		expect(btn).not.toBeNull();
		btn!.click();
		await flushMicrotasks();

		expect(openInDefaultApp).not.toHaveBeenCalled();
		expect(deps.notices.transient).toHaveBeenCalledOnce();
		const msg = (deps.notices.transient as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
		expect(msg).toContain("No audit log entries yet");
	});

	// -------------------------------------------------------------------------
	// Test 8: Show audit log — openInDefaultApp throws → notice with path
	// -------------------------------------------------------------------------

	it("Show audit log when openInDefaultApp throws shows transient notice with path", async () => {
		const openInDefaultApp = vi.fn(async () => {
			throw new Error("permission denied");
		});
		const deps = makeDeps({
			auditFilePresent: vi.fn(async () => true),
			openInDefaultApp,
		});
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const btn = findButtonByText(containerEl, "Show audit log");
		expect(btn).not.toBeNull();
		btn!.click();
		await flushMicrotasks();

		expect(deps.notices.transient).toHaveBeenCalledOnce();
		const msg = (deps.notices.transient as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
		expect(msg).toContain(AUDIT_PATH);
	});

	// -------------------------------------------------------------------------
	// Test 9: Purge confirmed → purgeAll called, notice shown
	// -------------------------------------------------------------------------

	it("Purge button confirmed calls purgeAll and shows purge notice", async () => {
		const purgeAll = vi.fn(async () => {});
		const deps = makeDeps({
			purgeAll,
			confirm: vi.fn(async () => true),
		});
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const btn = findButtonByText(containerEl, "Purge");
		expect(btn).not.toBeNull();
		btn!.click();
		await flushMicrotasks();

		expect(purgeAll).toHaveBeenCalledOnce();
		expect(deps.notices.transient).toHaveBeenCalledOnce();
		const msg = (deps.notices.transient as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
		expect(msg).toContain("Audit log purged");
	});

	// -------------------------------------------------------------------------
	// Test 10: Purge declined → purgeAll NOT called, no notice
	// -------------------------------------------------------------------------

	it("Purge button declined does not call purgeAll and shows no notice", async () => {
		const purgeAll = vi.fn(async () => {});
		const deps = makeDeps({
			purgeAll,
			confirm: vi.fn(async () => false),
		});
		const subtab = new GeneralSubtab(deps);
		subtab.render(containerEl);
		await flushMicrotasks();

		const btn = findButtonByText(containerEl, "Purge");
		expect(btn).not.toBeNull();
		btn!.click();
		await flushMicrotasks();

		expect(purgeAll).not.toHaveBeenCalled();
		expect(deps.notices.transient).not.toHaveBeenCalled();
	});
});
