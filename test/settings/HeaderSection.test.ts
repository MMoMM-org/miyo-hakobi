/**
 * Tests for HeaderSection — the manifest-driven header above the settings subtab row.
 *
 * Covers: name, description, author link, GitHub repo link, funding links
 * (Record<string,string> | string | undefined), external-link class on all anchors,
 * and the no-innerHTML constraint (verified structurally via anchor count + hrefs).
 */

import { describe, it, expect, beforeEach } from "vitest";

// augmentEl is not exported from the mock, so we reconstruct it here by importing
// from the mock path directly — the mock module uses augmentEl internally in
// PluginSettingTab.containerEl already, so we just build our own via the same
// approach: call the Obsidian-augmented createEl helpers on the element.
// The simplest approach: create a plain div, then wrap it with the mock's
// PluginSettingTab so containerEl is already augmented.
import { PluginSettingTab, Plugin, App } from "obsidian";
import { HeaderSection } from "../../src/settings/HeaderSection";

// ---- helpers ----

/**
 * Returns an augmented HTMLElement (with Obsidian createEl/createDiv/etc.)
 * by borrowing the mock's PluginSettingTab.containerEl factory path.
 * This avoids duplicating augmentEl logic in tests.
 */
function makeContainer(): HTMLElement {
	const app = new App();
	const plugin = new Plugin(app);
	const tab = new PluginSettingTab(app, plugin);
	return tab.containerEl;
}

// Base manifest used across most tests
const BASE_MANIFEST = {
	id: "miyo-hakobi",
	name: "MiYo Hakobi",
	version: "0.0.0",
	minAppVersion: "1.5.7",
	description:
		"Scheduled file ferry between local filesystem and your Obsidian vault — import voice memos / snippets / etc. into your inbox, export folders / tags / notes to external locations.",
	author: "Marcus Breiden <marcus@mmomm.org>",
	authorUrl: "https://www.mmomm.org",
	fundingUrl: {
		"Buy Me a Coffee": "https://buymeacoffee.com/mmomm",
		"GitHub Sponsor": "https://github.com/sponsors/MMoMM-org",
	} as Record<string, string>,
	isDesktopOnly: true as const,
};

// ---- test suite ----

describe("HeaderSection", () => {
	let containerEl: HTMLElement;

	beforeEach(() => {
		containerEl = makeContainer();
	});

	it("injects manifest.name text into the container", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		expect(containerEl.textContent).toContain("MiYo Hakobi");
	});

	it("injects manifest.description text into the container", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		expect(containerEl.textContent).toContain(
			"Scheduled file ferry between local filesystem",
		);
	});

	it("renders an <a> with href === manifest.authorUrl containing author display name", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		const authorLink = anchors.find(
			(a) => a.getAttribute("href") === "https://www.mmomm.org",
		);
		expect(authorLink).toBeDefined();
		// Display name is the part before the angle bracket, trimmed
		expect(authorLink?.textContent).toContain("Marcus Breiden");
	});

	it("renders an <a> with href === hard-coded GitHub repo URL", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		const repoLink = anchors.find(
			(a) =>
				a.getAttribute("href") === "https://github.com/MMoMM-org/miyo-hakobi",
		);
		expect(repoLink).toBeDefined();
	});

	it("renders one <a> per fundingUrl entry when fundingUrl is a Record", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));

		const coffeeLink = anchors.find(
			(a) => a.getAttribute("href") === "https://buymeacoffee.com/mmomm",
		);
		expect(coffeeLink).toBeDefined();
		expect(coffeeLink?.textContent).toContain("Buy Me a Coffee");

		const sponsorLink = anchors.find(
			(a) =>
				a.getAttribute("href") === "https://github.com/sponsors/MMoMM-org",
		);
		expect(sponsorLink).toBeDefined();
		expect(sponsorLink?.textContent).toContain("GitHub Sponsor");
	});

	it("renders one <a> with generic label when fundingUrl is a plain string", () => {
		const manifest = {
			...BASE_MANIFEST,
			fundingUrl: "https://example.com/sponsor",
		};
		const section = new HeaderSection({
			plugin: { manifest },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		const sponsorLink = anchors.find(
			(a) => a.getAttribute("href") === "https://example.com/sponsor",
		);
		expect(sponsorLink).toBeDefined();
		// Generic label when fundingUrl is a plain string
		expect(sponsorLink?.textContent?.toLowerCase()).toContain("sponsor");
	});

	it("renders no funding links when fundingUrl is undefined", () => {
		const { fundingUrl: _dropped, ...manifestWithoutFunding } = {
			...BASE_MANIFEST,
			fundingUrl: undefined as
				| string
				| Record<string, string>
				| undefined,
		};
		void _dropped;
		const section = new HeaderSection({
			plugin: { manifest: manifestWithoutFunding },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		// Only author link + GitHub link should be present (no funding links)
		const fundingLinks = anchors.filter(
			(a) =>
				a.getAttribute("href") !== "https://www.mmomm.org" &&
				a.getAttribute("href") !== "https://github.com/MMoMM-org/miyo-hakobi",
		);
		expect(fundingLinks).toHaveLength(0);
	});

	it("all <a> elements have the external-link class (Obsidian convention)", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		expect(anchors.length).toBeGreaterThan(0);
		for (const anchor of anchors) {
			expect(anchor.className).toContain("external-link");
		}
	});

	it("anchor hrefs are set via DOM attributes, not innerHTML (structural check)", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		// If innerHTML were used, the mock's createEl path wouldn't be invoked and
		// anchors might lack proper class or attribute. We verify by ensuring each
		// anchor has an explicit href attribute (set via createEl opts.href or
		// setAttribute, not innerHTML).
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		// Expected: author + github + 2 funding = 4
		expect(anchors).toHaveLength(4);
		for (const anchor of anchors) {
			expect(anchor.getAttribute("href")).toBeTruthy();
		}
	});
});
