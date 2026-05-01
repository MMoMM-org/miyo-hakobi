/**
 * Tests for SettingsTab orchestrator — ADR-10 3-subtab layout.
 *
 * Covers: container clearing, header rendered once, 3 subtab buttons,
 * mod-cta placement, subtab body rendering, subtab swap without re-rendering
 * the header, deep-link initialSubtab argument, and a 50ms perf budget.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, Plugin, PluginSettingTab } from "obsidian";
import { HakobiSettingsTab, type SubtabKey, type SettingsTabDeps } from "../../src/settings/SettingsTab";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

function makeDeps(): SettingsTabDeps {
	return {
		headerSection: { render: vi.fn() },
		generalSubtab: { render: vi.fn() },
		importSubtab: { render: vi.fn() },
		exportSubtab: { render: vi.fn() },
	};
}

function makeTab(
	deps?: Partial<SettingsTabDeps>,
): { tab: HakobiSettingsTab; deps: SettingsTabDeps; app: App; plugin: Plugin } {
	const app = new App();
	const plugin = new Plugin(app);
	const resolvedDeps: SettingsTabDeps = { ...makeDeps(), ...deps };
	const tab = new HakobiSettingsTab(app, plugin, resolvedDeps);
	return { tab, deps: resolvedDeps, app, plugin };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HakobiSettingsTab", () => {
	describe("display()", () => {
		it("clears the container before rendering", () => {
			const { tab } = makeTab();
			// Pre-populate the container with junk
			const junk = document.createElement("span");
			junk.textContent = "old content";
			tab.containerEl.appendChild(junk);

			tab.display();

			// Container should no longer contain the junk span
			expect(tab.containerEl.contains(junk)).toBe(false);
			expect(tab.containerEl.textContent).not.toContain("old content");
		});

		it("calls headerSection.render exactly once per display() call", () => {
			const { tab, deps } = makeTab();
			tab.display();
			expect(deps.headerSection.render).toHaveBeenCalledTimes(1);
		});

		it("renders three subtab buttons with labels General, Import, Export", () => {
			const { tab } = makeTab();
			tab.display();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const labels = buttons.map((b) => b.textContent?.trim());
			expect(labels).toContain("General");
			expect(labels).toContain("Import");
			expect(labels).toContain("Export");
		});

		it("the General subtab button has mod-cta by default", () => {
			const { tab } = makeTab();
			tab.display();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const generalBtn = buttons.find((b) => b.textContent?.trim() === "General");
			expect(generalBtn).toBeDefined();
			expect(generalBtn?.classList.contains("mod-cta")).toBe(true);
		});

		it("calls generalSubtab.render once with a body container element", () => {
			const { tab, deps } = makeTab();
			tab.display();

			expect(deps.generalSubtab.render).toHaveBeenCalledTimes(1);
			const [bodyEl] = (deps.generalSubtab.render as ReturnType<typeof vi.fn>).mock.calls[0] as [HTMLElement];
			expect(bodyEl).toBeInstanceOf(HTMLElement);
		});

		it("does not call importSubtab.render or exportSubtab.render when defaulting to general", () => {
			const { tab, deps } = makeTab();
			tab.display();

			expect(deps.importSubtab.render).not.toHaveBeenCalled();
			expect(deps.exportSubtab.render).not.toHaveBeenCalled();
		});
	});

	describe("subtab switching", () => {
		it("clicking Import: calls importSubtab.render, does NOT re-call generalSubtab.render or headerSection.render", () => {
			const { tab, deps } = makeTab();
			tab.display();

			// Sanity: general was called once during display()
			expect(deps.generalSubtab.render).toHaveBeenCalledTimes(1);
			expect(deps.headerSection.render).toHaveBeenCalledTimes(1);

			// Click the Import button
			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const importBtn = buttons.find((b) => b.textContent?.trim() === "Import")!;
			importBtn.click();

			expect(deps.importSubtab.render).toHaveBeenCalledTimes(1);
			// General and header should NOT have been called again
			expect(deps.generalSubtab.render).toHaveBeenCalledTimes(1);
			expect(deps.headerSection.render).toHaveBeenCalledTimes(1);
		});

		it("clicking Import: moves mod-cta from General to Import", () => {
			const { tab } = makeTab();
			tab.display();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const generalBtn = buttons.find((b) => b.textContent?.trim() === "General")!;
			const importBtn = buttons.find((b) => b.textContent?.trim() === "Import")!;

			expect(generalBtn.classList.contains("mod-cta")).toBe(true);
			expect(importBtn.classList.contains("mod-cta")).toBe(false);

			importBtn.click();

			expect(generalBtn.classList.contains("mod-cta")).toBe(false);
			expect(importBtn.classList.contains("mod-cta")).toBe(true);
		});

		it("clicking Export after clicking Import: calls exportSubtab.render and moves mod-cta", () => {
			const { tab, deps } = makeTab();
			tab.display();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const importBtn = buttons.find((b) => b.textContent?.trim() === "Import")!;
			const exportBtn = buttons.find((b) => b.textContent?.trim() === "Export")!;

			importBtn.click();
			exportBtn.click();

			expect(deps.exportSubtab.render).toHaveBeenCalledTimes(1);
			expect(deps.importSubtab.render).toHaveBeenCalledTimes(1);
			expect(exportBtn.classList.contains("mod-cta")).toBe(true);
			expect(importBtn.classList.contains("mod-cta")).toBe(false);
		});
	});

	describe("initialSubtab argument (deep-linking)", () => {
		it("display('import') renders Import as the active subtab", () => {
			const { tab, deps } = makeTab();
			tab.display("import");

			expect(deps.importSubtab.render).toHaveBeenCalledTimes(1);
			expect(deps.generalSubtab.render).not.toHaveBeenCalled();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const importBtn = buttons.find((b) => b.textContent?.trim() === "Import")!;
			expect(importBtn.classList.contains("mod-cta")).toBe(true);
		});

		it("display('export') renders Export as the active subtab", () => {
			const { tab, deps } = makeTab();
			tab.display("export");

			expect(deps.exportSubtab.render).toHaveBeenCalledTimes(1);
			expect(deps.generalSubtab.render).not.toHaveBeenCalled();
			expect(deps.importSubtab.render).not.toHaveBeenCalled();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const exportBtn = buttons.find((b) => b.textContent?.trim() === "Export")!;
			expect(exportBtn.classList.contains("mod-cta")).toBe(true);
		});
	});

	describe("re-entrant display()", () => {
		it("re-calling display() clears the container fully — no duplicate header or buttons", () => {
			const { tab, deps } = makeTab();
			tab.display();
			tab.display();

			// Header rendered once per display() = 2 total, but no stale nodes
			expect(deps.headerSection.render).toHaveBeenCalledTimes(2);

			// Only 3 subtab buttons, not 6
			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const subtabLabels = ["General", "Import", "Export"];
			const subtabButtons = buttons.filter((b) =>
				subtabLabels.includes(b.textContent?.trim() ?? ""),
			);
			expect(subtabButtons).toHaveLength(3);
		});
	});

	describe("perf budget", () => {
		it("subtab swaps (General → Import → Export → General) complete under 50ms total", () => {
			// Stub subtabs have empty render bodies — the orchestrator's swap logic
			// itself must be O(1) and well under the 50ms budget.
			const { tab } = makeTab();
			tab.display();

			const buttons = Array.from(tab.containerEl.querySelectorAll("button"));
			const importBtn = buttons.find((b) => b.textContent?.trim() === "Import")!;
			const exportBtn = buttons.find((b) => b.textContent?.trim() === "Export")!;
			const generalBtn = buttons.find((b) => b.textContent?.trim() === "General")!;

			const start = performance.now();
			importBtn.click();
			exportBtn.click();
			generalBtn.click();
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(50);
		});
	});
});
