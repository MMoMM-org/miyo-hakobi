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
	if (fundingUrl === undefined || fundingUrl === null) return;

	const createLink = (href: string, label: string): void => {
		const any = parentEl as unknown as Record<string, unknown>;
		const createEl = any["createEl"] as (
			tag: string,
			opts: { href: string; text: string; cls: string; attr: Record<string, string> },
		) => HTMLElement;
		createEl("a", {
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
	const any = parentEl as unknown as Record<string, unknown>;
	const createEl = any["createEl"] as (
		tag: string,
		opts: { href: string; text: string; cls: string; attr: Record<string, string> },
	) => HTMLElement;
	return createEl("a", {
		href,
		text,
		cls: "external-link",
		attr: { target: "_blank", rel: "noopener" },
	});
}

/** Appends a text-only span to parentEl using Obsidian's createSpan helper. */
function appendText(parentEl: HTMLElement, content: string): void {
	const any = parentEl as unknown as Record<string, unknown>;
	const createSpan = any["createSpan"] as (opts: { text: string }) => HTMLElement;
	createSpan({ text: content });
}

export class HeaderSection {
	private readonly plugin: { manifest: HakobiManifest };
	private readonly containerEl: HTMLElement;

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
		this.containerEl = deps.containerEl;
	}

	/**
	 * Populates containerEl with the plugin header: name, tagline, author link,
	 * GitHub repo link, and funding links. Safe to call multiple times (each call
	 * appends — callers should empty containerEl first if re-rendering).
	 */
	render(): void {
		const { manifest } = this.plugin;
		const containerAny = this.containerEl as unknown as Record<string, unknown>;

		// createDiv helper from Obsidian's augmented DOM (preferred over createEl("div"))
		const createDiv = containerAny["createDiv"] as (opts?: {
			cls?: string;
			text?: string;
		}) => HTMLElement;

		// Outer wrapper
		const header = createDiv({ cls: "hakobi-header" });
		const headerAny = header as unknown as Record<string, unknown>;
		const headerCreateEl = headerAny["createEl"] as (
			tag: string,
			opts?: { text?: string; cls?: string },
		) => HTMLElement;

		// Plugin name
		headerCreateEl("h1", { text: manifest.name });

		// Tagline / description
		headerCreateEl("p", { text: manifest.description, cls: "hakobi-tagline" });

		// Meta line: author | repo | funding
		const meta = headerCreateEl("p", { cls: "hakobi-meta" });

		// Author link
		const authorName = parseAuthorDisplayName(manifest.author ?? "");
		appendText(meta, "Author: ");
		appendLink(meta, manifest.authorUrl ?? "", authorName);

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
