/**
 * Tests for HeaderSection — the manifest-driven header above the settings subtab row.
 *
 * Covers: name, version, author link, GitHub repo link, no funding links,
 * inlined hanko image (no runtime resolver), curated tagline, and the
 * external-link class on all anchors.
 */

import { describe, it, expect, beforeEach } from "vitest";

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

	it("renders the manifest-driven identity line with name, version, author link, and Documentation link", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const identity = containerEl.querySelector(".hakobi-header-identity");
		expect(identity).not.toBeNull();
		expect(identity?.textContent).toContain("MiYo Hakobi");
		expect(identity?.textContent).toContain("v0.0.0");
		expect(identity?.textContent).toContain("Marcus Breiden");
		expect(identity?.textContent).toContain("Documentation");
	});

	it("does NOT use manifest.description in the header — the in-plugin tagline is curated separately", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		// The verbose manifest description is reserved for Obsidian's plugin
		// listing; the header shows a punchy curated tagline instead.
		expect(containerEl.textContent).not.toContain(
			"Scheduled file ferry between local filesystem",
		);
		expect(containerEl.textContent).not.toContain("import voice memos");
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

	it("renders the Documentation link pointing at the GitHub repo URL", () => {
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
		// Label is "Documentation" — Obsidian's Community Plugins UI surfaces
		// the GitHub link itself, so we use the more descriptive label here.
		expect(repoLink?.textContent).toContain("Documentation");
	});

	it("does NOT render funding links — Obsidian's Community Plugins UI surfaces manifest.fundingUrl on the listing page", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		// None of the funding URLs from BASE_MANIFEST.fundingUrl should appear.
		const fundingHrefs = [
			"https://buymeacoffee.com/mmomm",
			"https://github.com/sponsors/MMoMM-org",
		];
		for (const href of fundingHrefs) {
			const link = anchors.find((a) => a.getAttribute("href") === href);
			expect(link, `funding link ${href} should not render in the header`).toBeUndefined();
		}
	});

	it("ignores fundingUrl entirely regardless of shape (string, Record, or undefined)", () => {
		// Plain string fundingUrl — should still produce no funding link
		const stringFundingManifest = {
			...BASE_MANIFEST,
			fundingUrl: "https://example.com/sponsor",
		};
		const sectionStr = new HeaderSection({
			plugin: { manifest: stringFundingManifest },
			containerEl,
		});
		sectionStr.render();
		expect(
			containerEl.querySelector("a[href='https://example.com/sponsor']"),
		).toBeNull();
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

	it("renders exactly 2 anchors (author + Documentation) with valid hrefs", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		expect(anchors).toHaveLength(2);
		for (const anchor of anchors) {
			expect(anchor.getAttribute("href")).toBeTruthy();
		}
	});

	it("renders author name as plain text (no anchor) when authorUrl is absent", () => {
		const { authorUrl: _dropped, ...manifestWithoutAuthorUrl } = BASE_MANIFEST;
		void _dropped;
		const section = new HeaderSection({
			plugin: { manifest: manifestWithoutAuthorUrl },
			containerEl,
		});
		section.render();
		// Author display name must still appear somewhere in the output
		expect(containerEl.textContent).toContain("Marcus Breiden");
		// There must be NO anchor element with an empty href (broken anchor)
		const anchors = Array.from(containerEl.querySelectorAll("a"));
		const brokenAnchor = anchors.find((a) => a.getAttribute("href") === "");
		expect(brokenAnchor).toBeUndefined();
		// Documentation link is the only anchor we expect; the author becomes plain text.
		const repoAnchor = anchors.find(
			(a) =>
				a.getAttribute("href") === "https://github.com/MMoMM-org/miyo-hakobi",
		);
		expect(repoAnchor).toBeDefined();
		expect(anchors).toHaveLength(1);
	});

	// -----------------------------------------------------------------------
	// Hanko image rendering (inlined via esbuild dataurl loader — no runtime resolver)
	// -----------------------------------------------------------------------

	it("renders the hanko <img> without a runtime resolver — src is a non-empty string from the bundled import", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const img = containerEl.querySelector<HTMLImageElement>(
			"img.hakobi-header-hanko",
		);
		expect(img).not.toBeNull();
		// In production the loader inlines as `data:image/png;base64,...`; under
		// vitest/Vite the asset import resolves to a project-relative URL string.
		// Either is acceptable — what matters is that no runtime resolver was used.
		const src = img?.getAttribute("src") ?? "";
		expect(src.length).toBeGreaterThan(0);
		// Alt text is required for accessibility — must reference the plugin name
		expect(img?.getAttribute("alt")).toContain("MiYo Hakobi");
	});

	// -----------------------------------------------------------------------
	// Tagline
	// -----------------------------------------------------------------------

	it("renders the curated tagline 'Scheduled Vault Import/Export' regardless of manifest.description", () => {
		const section = new HeaderSection({
			plugin: { manifest: BASE_MANIFEST },
			containerEl,
		});
		section.render();
		const tagline = containerEl.querySelector(".hakobi-tagline");
		expect(tagline).not.toBeNull();
		expect(tagline?.textContent).toBe("Scheduled Vault Import/Export");
	});
});
