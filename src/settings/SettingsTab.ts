/**
 * SettingsTab — orchestrator for the Hakobi settings panel.
 *
 * WHY this file exists:
 * ADR-10 mandates a 3-subtab information architecture (General / Import / Export)
 * with a manifest-driven header rendered once above the subtab row. This class
 * owns ONLY the layout: it creates a headerContainer (rendered once by HeaderSection),
 * a subtabRow with 3 buttons, and a bodyContainer that is emptied and re-filled
 * whenever the active subtab changes. Each subtab's content is delegated entirely
 * to its dedicated class (GeneralSubtab, ImportSubtab, ExportSubtab) — this
 * orchestrator never touches subtab content directly.
 *
 * Layout:
 *   containerEl
 *   ├── headerContainer  ← HeaderSection.render() fills this once per display()
 *   ├── subtabRow        ← 3 buttons; active button carries mod-cta
 *   └── bodyContainer    ← active subtab fills this; swapped on button click
 *
 * Subtab swap is O(1): bodyContainer.empty() + activeSubtab.render(bodyContainer).
 * The header is never re-rendered on subtab swap — only on display().
 *
 * Deep-linking: display(initialSubtab?) accepts an optional SubtabKey argument
 * so the status-bar click handler can open directly to 'general'. TypeScript
 * allows widening a base class's void method signature with optional parameters
 * in subclasses.
 *
 * Refs: SDD/ADR-10, SDD/Cross-Cutting Concepts/User Interface & UX.
 */

import { type App, type Plugin, PluginSettingTab } from "obsidian";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SubtabKey = "general" | "import" | "export";

export interface SettingsTabDeps {
	headerSection: { render(containerEl: HTMLElement): void };
	generalSubtab: { render(containerEl: HTMLElement): void };
	importSubtab: { render(containerEl: HTMLElement): void };
	exportSubtab: { render(containerEl: HTMLElement): void };
}

// ---------------------------------------------------------------------------
// Subtab metadata — drives the button row
// ---------------------------------------------------------------------------

interface SubtabMeta {
	key: SubtabKey;
	label: string;
}

const SUBTABS: SubtabMeta[] = [
	{ key: "general", label: "General" },
	{ key: "import", label: "Import" },
	{ key: "export", label: "Export" },
];

// ---------------------------------------------------------------------------
// Helper: call Obsidian's augmented DOM helpers via the Record cast pattern
// used throughout the codebase (no innerHTML, no direct DOM mutation).
// ---------------------------------------------------------------------------

function createDiv(el: HTMLElement, opts?: { cls?: string }): HTMLElement {
	const any = el as unknown as Record<string, unknown>;
	const create = any["createDiv"] as (opts?: { cls?: string }) => HTMLElement;
	return create(opts);
}

function emptyEl(el: HTMLElement): void {
	const any = el as unknown as Record<string, unknown>;
	const empty = any["empty"] as () => void;
	empty();
}

// ---------------------------------------------------------------------------
// HakobiSettingsTab
// ---------------------------------------------------------------------------

// No-op deps used when main.ts (T3.11 placeholder) constructs SettingsTab with
// only 2 args. T3.11 will wire the real deps; remove once T3.11 ships.
const DEFAULT_DEPS: SettingsTabDeps = {
	headerSection: { render: () => {} },
	generalSubtab: { render: () => {} },
	importSubtab: { render: () => {} },
	exportSubtab: { render: () => {} },
};

// Backward-compat alias — main.ts (T3.11 placeholder) still imports SettingsTab;
// T3.11 will rewrite that import. Remove this alias once T3.11 ships.
export { HakobiSettingsTab as SettingsTab };

export class HakobiSettingsTab extends PluginSettingTab {
	private readonly deps: SettingsTabDeps;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps = DEFAULT_DEPS) {
		super(app, plugin);
		this.deps = deps;
	}

	/**
	 * Renders the full settings panel. Clears containerEl, then renders:
	 *   1. headerContainer — HeaderSection fills this (manifest-driven; once per display()).
	 *   2. subtabRow — 3 buttons; active button gets mod-cta class.
	 *   3. bodyContainer — active subtab renders into this; swapped on button click.
	 *
	 * @param initialSubtab — which subtab to activate on open; defaults to 'general'.
	 */
	display(initialSubtab: SubtabKey = "general"): void {
		const { containerEl } = this;
		emptyEl(containerEl);

		// 1. Header — rendered once; never re-rendered on subtab swap.
		// The orchestrator creates headerContainer and passes it explicitly so that
		// HeaderSection renders into the correct DOM node regardless of how deps are
		// constructed. main.ts (T3.11) constructs HeaderSection without a containerEl
		// and relies on this render(containerEl) call to supply the target.
		const headerContainer = createDiv(containerEl, { cls: "hakobi-settings-header" });
		this.deps.headerSection.render(headerContainer);

		// 2. Subtab row
		const subtabRow = createDiv(containerEl, { cls: "hakobi-settings-subtab-row" });
		const buttons = new Map<SubtabKey, HTMLButtonElement>();
		let activeKey: SubtabKey = initialSubtab;

		// 3. Body container — filled by the active subtab
		const bodyContainer = createDiv(containerEl, { cls: "hakobi-settings-body" });

		// Build buttons — we define onSwap first so the click handler can reference it
		const onSwap = (newKey: SubtabKey): void => {
			if (newKey === activeKey) return;

			// Move mod-cta
			const prev = buttons.get(activeKey);
			const next = buttons.get(newKey);
			prev?.classList.remove("mod-cta");
			next?.classList.add("mod-cta");

			activeKey = newKey;

			// Swap body
			emptyEl(bodyContainer);
			this._renderActiveSubtab(activeKey, bodyContainer);
		};

		const subtabRowAny = subtabRow as unknown as Record<string, unknown>;
		const createEl = subtabRowAny["createEl"] as (
			tag: string,
			opts?: { cls?: string; text?: string },
		) => HTMLElement;

		for (const meta of SUBTABS) {
			const cls = meta.key === initialSubtab ? "mod-cta" : "";
			const btn = createEl("button", { text: meta.label, ...(cls ? { cls } : {}) }) as HTMLButtonElement;
			btn.addEventListener("click", () => onSwap(meta.key));
			buttons.set(meta.key, btn);
		}

		// 4. Initial body render
		this._renderActiveSubtab(initialSubtab, bodyContainer);
	}

	// ---------------------------------------------------------------------------
	// Private: dispatch render to the correct subtab
	// ---------------------------------------------------------------------------

	private _renderActiveSubtab(key: SubtabKey, bodyContainer: HTMLElement): void {
		switch (key) {
			case "general":
				this.deps.generalSubtab.render(bodyContainer);
				break;
			case "import":
				this.deps.importSubtab.render(bodyContainer);
				break;
			case "export":
				this.deps.exportSubtab.render(bodyContainer);
				break;
		}
	}
}
