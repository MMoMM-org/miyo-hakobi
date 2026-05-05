/**
 * HeaderSection — persistent header rendered above the subtab row in the SettingsTab.
 *
 * Why this file exists: the header surfaces plugin identity (name, version, author,
 * documentation link) sourced directly from manifest.json plus the Hakobi hanko
 * (印, the seal) as a visual anchor on the right. Manifest-driven so any change
 * to plugin metadata automatically propagates.
 *
 * Layout (two-column flex):
 *   ┌─ .hakobi-header-text (flex 1) ──────────────────┐  ┌─ .hakobi-header-hanko ─┐
 *   │ .hakobi-header-identity                          │  │   <img 72x72>          │
 *   │   Name v0.1.0 · Author · Documentation           │  │                        │
 *   │ .hakobi-tagline                                  │  │                        │
 *   │   <short tagline, first half of manifest desc>   │  │                        │
 *   └──────────────────────────────────────────────────┘  └────────────────────────┘
 *
 * Tagline: hardcoded `TAGLINE` constant. We deliberately keep this independent
 * from `manifest.description` — the manifest description is the prose blurb
 * Obsidian shows in its Community Plugins listing (longer, search-friendly),
 * while the in-plugin header tagline is a punchy four-word identity. They serve
 * different audiences.
 *
 * Funding links: NOT rendered here. Obsidian's Community Plugins UI surfaces
 * `manifest.fundingUrl` automatically on the plugin's listing page, so we don't
 * duplicate it inside our own settings panel.
 *
 * All link elements are constructed via Obsidian's createEl() helper rather than
 * innerHTML — Obsidian plugin guideline + MiYo Constitution L1 Code Quality.
 */

import type { PluginManifest } from "obsidian";

interface HeaderSectionDeps {
	plugin: { manifest: PluginManifest };
	containerEl: HTMLElement;
	/**
	 * Resolves a plugin-relative asset path (e.g. "assets/hakobi_hanko_144.png")
	 * to a URL the browser can load. Production wires this to
	 * `app.vault.adapter.getResourcePath(`${manifest.dir}/${rel}`)`. Tests inject
	 * a stub. When absent, the hanko image is skipped — the text column still
	 * renders, so unit tests that don't care about the image stay green.
	 */
	resolveAsset?: (relativePath: string) => string;
}

/** Hardcoded GitHub repository URL — the only hard-coded URL in this file. */
const REPO_URL = "https://github.com/MMoMM-org/miyo-hakobi";

/** Plugin-relative path to the hanko image (144×144 PNG, displayed at 72×72
 *  CSS pixels for HiDPI sharpness). */
const HANKO_REL_PATH = "assets/hakobi_hanko_144.png";

/** In-plugin header tagline. Curated identity copy, not the verbose manifest
 *  description used by Obsidian's plugin listing. */
const TAGLINE = "Scheduled Vault Import/Export";

/**
 * Parses the human-readable author display name from Obsidian's author string.
 * Obsidian convention: "Full Name <email@example.com>" — we take the part before
 * the angle bracket and trim whitespace. Falls back to the full string if no
 * angle bracket is present.
 */
function parseAuthorDisplayName(author: string): string {
	const angleIdx = author.indexOf("<");
	if (angleIdx === -1) return author.trim();
	return author.slice(0, angleIdx).trim();
}

/** Creates a link element and appends it to parentEl using Obsidian's createEl. */
function appendLink(
	parentEl: HTMLElement,
	href: string,
	text: string,
): HTMLElement {
	return (parentEl as unknown as {
		createEl(
			tag: string,
			opts: { href: string; text: string; cls: string; attr: Record<string, string> },
		): HTMLElement;
	}).createEl("a", {
		href,
		text,
		cls: "external-link",
		attr: { target: "_blank", rel: "noopener" },
	});
}

/** Appends a text-only span to parentEl using Obsidian's createSpan helper. */
function appendText(parentEl: HTMLElement, content: string, cls?: string): void {
	(parentEl as unknown as {
		createSpan(opts: { text: string; cls?: string }): HTMLElement;
	}).createSpan(cls === undefined ? { text: content } : { text: content, cls });
}

/** Appends the " · " separator span used between identity-line items. */
function appendSep(parentEl: HTMLElement): void {
	appendText(parentEl, " · ", "hakobi-header-sep");
}

export class HeaderSection {
	private readonly plugin: { manifest: PluginManifest };
	private readonly containerEl: HTMLElement;
	private readonly resolveAsset: ((rel: string) => string) | undefined;

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
		this.containerEl = deps.containerEl;
		this.resolveAsset = deps.resolveAsset;
	}

	/**
	 * Populates a container with the plugin header.
	 *
	 * @param containerEl — target element to render into; overrides the
	 *   constructor-captured containerEl when provided. The orchestrator
	 *   (SettingsTab) always supplies this so the header lands in the correct
	 *   layout slot regardless of how deps are wired.
	 */
	render(containerEl?: HTMLElement): void {
		const { manifest } = this.plugin;
		const target = containerEl ?? this.containerEl;

		// Obsidian's augmented DOM helpers are prototype methods that read `this`,
		// so we MUST invoke them as methods on the element.
		const targetEl = target as unknown as {
			createDiv(opts?: { cls?: string }): HTMLElement;
			createEl(
				tag: string,
				opts?: { cls?: string; attr?: Record<string, string> },
			): HTMLElement;
		};

		// Left column: text identity
		const textCol = targetEl.createDiv({ cls: "hakobi-header-text" });

		// Identity line: name vX.Y.Z · Author · GitHub · funding…
		const identity = (textCol as unknown as {
			createDiv(opts: { cls: string }): HTMLElement;
		}).createDiv({ cls: "hakobi-header-identity" });

		appendText(identity, manifest.name, "hakobi-plugin-name");
		appendText(identity, ` v${manifest.version}`);

		const authorName = parseAuthorDisplayName(manifest.author ?? "");
		appendSep(identity);
		if (manifest.authorUrl !== undefined) {
			appendLink(identity, manifest.authorUrl, authorName);
		} else {
			appendText(identity, authorName);
		}

		appendSep(identity);
		appendLink(identity, REPO_URL, "Documentation");

		// Tagline (curated, manifest-independent)
		(textCol as unknown as {
			createEl(tag: string, opts: { text: string; cls: string }): HTMLElement;
		}).createEl("p", { text: TAGLINE, cls: "hakobi-tagline" });

		// Right column: hanko image (only when resolveAsset is wired)
		if (this.resolveAsset !== undefined) {
			const src = this.resolveAsset(HANKO_REL_PATH);
			targetEl.createEl("img", {
				cls: "hakobi-header-hanko",
				attr: {
					src,
					alt: `${manifest.name} hanko`,
				},
			});
		}
	}
}
