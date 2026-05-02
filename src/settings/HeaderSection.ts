/**
 * HeaderSection — persistent header rendered above the subtab row in the SettingsTab.
 *
 * Why this file exists: the header surfaces plugin identity (name, tagline, author,
 * GitHub repo, funding) sourced directly from manifest.json so that any change to
 * plugin metadata automatically propagates to the UI without code edits. This is the
 * manifest-driven approach mandated by ADR-10.
 *
 * All link elements are constructed via Obsidian's createEl() helper rather than
 * innerHTML — required by Obsidian plugin guidelines and the MiYo Constitution (L1
 * Code Quality rule on MarkdownRenderer / no innerHTML).
 */

import type { PluginManifest } from "obsidian";

/** Extended manifest shape to include fundingUrl, which Obsidian's PluginManifest
 * type does not officially expose but which is present in manifest.json. */
interface HakobiManifest extends PluginManifest {
	fundingUrl?: string | Record<string, string>;
}

interface HeaderSectionDeps {
	plugin: { manifest: HakobiManifest };
	containerEl: HTMLElement;
}

/** Hardcoded GitHub repository URL — the only hard-coded URL in this file. */
const REPO_URL = "https://github.com/MMoMM-org/miyo-hakobi";

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

/**
 * Renders funding links from a fundingUrl value into a parent element.
 * - Record<string,string>: one link per entry, key as label.
 * - string: one link with a generic "Sponsor" label.
 * - undefined/missing: no links rendered.
 */
function renderFundingLinks(
	parentEl: HTMLElement,
	fundingUrl: string | Record<string, string> | undefined,
): void {
	if (fundingUrl === undefined) return;

	const createLink = (href: string, label: string): void => {
		(parentEl as unknown as {
			createEl(
				tag: string,
				opts: { href: string; text: string; cls: string; attr: Record<string, string> },
			): HTMLElement;
		}).createEl("a", {
			href,
			text: label,
			cls: "external-link",
			attr: { target: "_blank", rel: "noopener" },
		});
	};

	if (typeof fundingUrl === "string") {
		createLink(fundingUrl, "Sponsor");
		return;
	}

	// Record<string, string>: iterate entries in insertion order
	for (const [label, url] of Object.entries(fundingUrl)) {
		createLink(url, label);
	}
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
function appendText(parentEl: HTMLElement, content: string): void {
	(parentEl as unknown as { createSpan(opts: { text: string }): HTMLElement }).createSpan({
		text: content,
	});
}

export class HeaderSection {
	private readonly plugin: { manifest: HakobiManifest };
	private readonly containerEl: HTMLElement;

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
		this.containerEl = deps.containerEl;
	}

	/**
	 * Populates a container with the plugin header: name, tagline, author link,
	 * GitHub repo link, and funding links. Safe to call multiple times (each call
	 * appends — callers should empty the container first if re-rendering).
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
		// so we MUST invoke them as methods on the element — yanking the function
		// off the cast and calling it bare strips `this` and crashes at runtime.
		const targetEl = target as unknown as {
			createDiv(opts?: { cls?: string; text?: string }): HTMLElement;
		};

		// Outer wrapper (createDiv preferred over createEl("div"))
		const header = targetEl.createDiv({ cls: "hakobi-header" });
		const headerEl = header as unknown as {
			createEl(tag: string, opts?: { text?: string; cls?: string }): HTMLElement;
		};

		// Plugin name
		headerEl.createEl("h1", { text: manifest.name });

		// Tagline / description
		headerEl.createEl("p", { text: manifest.description, cls: "hakobi-tagline" });

		// Meta line: author | repo | funding
		const meta = headerEl.createEl("p", { cls: "hakobi-meta" });

		// Author link — only render an anchor if authorUrl is present; otherwise plain text
		const authorName = parseAuthorDisplayName(manifest.author ?? "");
		appendText(meta, "Author: ");
		if (manifest.authorUrl !== undefined) {
			appendLink(meta, manifest.authorUrl, authorName);
		} else {
			appendText(meta, authorName);
		}

		// Repo link
		appendText(meta, " | Repo: ");
		appendLink(meta, REPO_URL, "GitHub");

		// Funding links (only if present)
		if (manifest.fundingUrl !== undefined) {
			appendText(meta, " | Support: ");
			renderFundingLinks(meta, manifest.fundingUrl);
		}
	}
}
