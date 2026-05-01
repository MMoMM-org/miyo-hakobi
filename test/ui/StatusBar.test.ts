/**
 * Tests for src/ui/StatusBar.ts
 *
 * Uses a structural fake plugin with a local augmentEl helper rather than the
 * Plugin mock directly. The Plugin mock's addStatusBarItem already returns an
 * augmented HTMLElement (via the shared obsidian mock), but we keep a local
 * fake for isolation — StatusBar tests must not depend on the shared mock's
 * internal implementation details, so augmentEl is replicated here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusBar } from "../../src/ui/StatusBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal augmentEl replication for test setup.
 * We cannot import augmentEl from the mock (it's not exported), so we mount
 * the same Obsidian-DOM helpers that StatusBar relies on.
 */
function makeAugmentedEl(): HTMLElement {
	const el = document.createElement("div") as HTMLElement;
	const any = el as unknown as Record<string, unknown>;

	any["createEl"] = (
		childTag: string,
		opts?: { text?: string; cls?: string; attr?: Record<string, string> },
	): HTMLElement => {
		// Swap tag by creating a real element of the right tag type
		const realChild = document.createElement(childTag) as HTMLElement;
		// Copy augmented helpers onto it
		const childAny = realChild as unknown as Record<string, unknown>;
		childAny["createEl"] = (any["createEl"] as CallableFunction).bind(realChild);
		childAny["createSpan"] = (any["createSpan"] as CallableFunction).bind(realChild);
		childAny["createDiv"] = (any["createDiv"] as CallableFunction).bind(realChild);
		childAny["empty"] = () => {
			while (realChild.firstChild) realChild.removeChild(realChild.firstChild);
		};
		childAny["addClass"] = (...classes: string[]) => realChild.classList.add(...classes);
		childAny["removeClass"] = (...classes: string[]) => realChild.classList.remove(...classes);
		childAny["toggleClass"] = (cls: string, force?: boolean) => realChild.classList.toggle(cls, force);
		if (opts?.text) realChild.textContent = opts.text;
		if (opts?.cls) realChild.className = opts.cls;
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) realChild.setAttribute(k, v);
		}
		el.appendChild(realChild);
		return realChild;
	};

	any["createSpan"] = (opts?: { cls?: string; text?: string }): HTMLElement => {
		return (any["createEl"] as CallableFunction)("span", opts) as HTMLElement;
	};

	any["createDiv"] = (opts?: { cls?: string; text?: string }): HTMLElement => {
		return (any["createEl"] as CallableFunction)("div", opts) as HTMLElement;
	};

	any["empty"] = (): void => {
		while (el.firstChild) el.removeChild(el.firstChild);
	};

	any["addClass"] = (...classes: string[]): void => {
		el.classList.add(...classes);
	};

	any["removeClass"] = (...classes: string[]): void => {
		el.classList.remove(...classes);
	};

	any["toggleClass"] = (cls: string, force?: boolean): void => {
		el.classList.toggle(cls, force);
	};

	return el;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

type SettingsSubtab = "general" | "import" | "export";

function makeDeps() {
	const el = makeAugmentedEl();
	const openSettings = vi.fn<[SettingsSubtab], void>();
	const deps = {
		plugin: {
			addStatusBarItem: vi.fn(() => el),
		},
		openSettings,
	};
	return { el, openSettings, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatusBar", () => {
	let el: HTMLElement;
	let openSettings: ReturnType<typeof vi.fn>;
	let statusBar: StatusBar;

	beforeEach(() => {
		const setup = makeDeps();
		el = setup.el;
		openSettings = setup.openSettings;
		statusBar = new StatusBar(setup.deps);
	});

	// T1 — kanji 運 is present in the element
	it("renders the kanji 運 in the status-bar element", () => {
		expect(el.textContent).toContain("運");
	});

	// T2 — initial state is mod-idle
	it("starts in mod-idle state", () => {
		expect(el.classList.contains("mod-idle")).toBe(true);
		expect(el.classList.contains("mod-running")).toBe(false);
		expect(el.classList.contains("mod-failed")).toBe(false);
	});

	// T2 — initial tooltip is "Hakobi: idle"
	it("initial tooltip is 'Hakobi: idle'", () => {
		expect(el.getAttribute("title")).toBe("Hakobi: idle");
	});

	// T2 — initial aria-label matches tooltip
	it("initial aria-label matches tooltip", () => {
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));
	});

	// T3 — setRunning transitions classes and tooltip
	it("setRunning removes mod-idle, adds mod-running, updates tooltip", () => {
		statusBar.setRunning("Voice memos");
		expect(el.classList.contains("mod-idle")).toBe(false);
		expect(el.classList.contains("mod-running")).toBe(true);
		expect(el.classList.contains("mod-failed")).toBe(false);
		expect(el.getAttribute("title")).toBe("Hakobi: running 'Voice memos'…");
	});

	// T3 — aria-label matches tooltip after setRunning
	it("aria-label matches tooltip after setRunning", () => {
		statusBar.setRunning("Voice memos");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));
	});

	// T4 — setIdle after setRunning clears mod-running
	it("setIdle after setRunning transitions to mod-idle", () => {
		statusBar.setRunning("Voice memos");
		statusBar.setIdle();
		expect(el.classList.contains("mod-running")).toBe(false);
		expect(el.classList.contains("mod-idle")).toBe(true);
		expect(el.classList.contains("mod-failed")).toBe(false);
	});

	// T4 — tooltip back to idle (no summary)
	it("setIdle with no summary shows 'Hakobi: idle'", () => {
		statusBar.setRunning("Voice memos");
		statusBar.setIdle();
		expect(el.getAttribute("title")).toBe("Hakobi: idle");
	});

	// T5 — setIdle with lastSummary
	it("setIdle with lastSummary shows summary in tooltip", () => {
		statusBar.setRunning("Voice memos");
		statusBar.setIdle("3 files copied");
		expect(el.getAttribute("title")).toBe(
			"Hakobi: idle — last run: 3 files copied",
		);
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));
	});

	// T6 — setFailed transitions classes and tooltip
	it("setFailed adds mod-failed and updates tooltip", () => {
		statusBar.setFailed("disk-full");
		expect(el.classList.contains("mod-failed")).toBe(true);
		expect(el.classList.contains("mod-idle")).toBe(false);
		expect(el.classList.contains("mod-running")).toBe(false);
		expect(el.getAttribute("title")).toBe("Hakobi: failed — disk-full");
	});

	// T6 — aria-label matches tooltip after setFailed
	it("aria-label matches tooltip after setFailed", () => {
		statusBar.setFailed("disk-full");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));
	});

	// T7 — sticky-failed: setIdle without prior setRunning keeps mod-failed
	it("setIdle without prior setRunning keeps mod-failed (sticky)", () => {
		statusBar.setFailed("x");
		statusBar.setIdle("some summary");
		expect(el.classList.contains("mod-failed")).toBe(true);
	});

	// T8 — after setFailed → setRunning → setIdle: failure is cleared
	it("failure cleared when setRunning then setIdle follows setFailed", () => {
		statusBar.setFailed("x");
		statusBar.setRunning("y");
		statusBar.setIdle("done");
		expect(el.classList.contains("mod-failed")).toBe(false);
		expect(el.classList.contains("mod-idle")).toBe(true);
	});

	// T9 — click calls openSettings('general')
	it("clicking the element calls openSettings('general')", () => {
		el.click();
		expect(openSettings).toHaveBeenCalledWith("general");
	});

	// T10 — click while in mod-failed: clears failed AND calls openSettings
	it("clicking while in mod-failed clears failed state and calls openSettings", () => {
		statusBar.setFailed("err");
		el.click();
		expect(openSettings).toHaveBeenCalledWith("general");
		expect(el.classList.contains("mod-failed")).toBe(false);
		expect(el.classList.contains("mod-idle")).toBe(true);
	});

	// T11 — aria-label always matches tooltip across every state
	it("aria-label always matches tooltip across all state transitions", () => {
		// initial
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));

		// running
		statusBar.setRunning("test-rule");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));

		// idle with summary
		statusBar.setIdle("2 files");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));

		// failed
		statusBar.setFailed("oops");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));

		// running again after failed
		statusBar.setRunning("retry");
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));

		// idle again (failure cleared)
		statusBar.setIdle();
		expect(el.getAttribute("aria-label")).toBe(el.getAttribute("title"));
	});
});
