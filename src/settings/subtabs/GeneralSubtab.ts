// GeneralSubtab — global settings form + audit-log control surface (ADR-10, T3.5).
//
// WHY this file exists:
// The four global settings (perFileTimeoutMs, auditRetentionDays, auditMaxBytes,
// stabilityCheckMs) are persisted via RuleStore because they live in data.json
// alongside rules. The audit-log "Show" and "Purge" buttons are the only
// operations on the audit log surface visible to the user. The OS-default-app
// launch eliminates the need for an in-app NDJSON viewer. Injection seams
// (auditFilePresent, currentMonthAuditPath, openInDefaultApp, confirm) keep this
// subtab unit-testable without Electron / Obsidian Modal / FS coupling.
//
// Refs: PRD/F6, PRD/F11, SDD/UI Visualization Guide (General subtab), ADR-10.

import { Setting } from "obsidian";
import type { GlobalSettings } from "../../types/index";

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface GeneralSubtabDeps {
	ruleStore: {
		loadGlobalSettings(): Promise<GlobalSettings>;
		saveGlobalSettings(settings: GlobalSettings): Promise<void>;
	};
	auditLog: { purgeAll(): Promise<void> };
	notices: { transient(m: string): void; persistent(m: string): void };
	/** Returns true iff the current-month audit NDJSON file exists. */
	auditFilePresent: () => Promise<boolean>;
	/** Returns the absolute path of the current-month audit NDJSON file. */
	currentMonthAuditPath: () => string;
	/**
	 * Launches the file in the OS default application. Production wires Electron
	 * shell.openPath or app.openWithDefaultApp. Tests inject a vi.fn().
	 */
	openInDefaultApp: (absPath: string) => Promise<void>;
	/**
	 * Confirmation seam — production opens a Modal asking "Purge audit log?";
	 * tests inject vi.fn(async () => true|false).
	 */
	confirm: (message: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// GeneralSubtab
// ---------------------------------------------------------------------------

export class GeneralSubtab {
	private readonly deps: GeneralSubtabDeps;

	constructor(deps: GeneralSubtabDeps) {
		this.deps = deps;
	}

	/**
	 * Sync entry point — called once by the PluginSettingTab display().
	 * Async loading is fire-and-forget; values populate within one microtask tick.
	 */
	render(containerEl: HTMLElement): void {
		void this._loadAndRender(containerEl);
	}

	// -------------------------------------------------------------------------
	// Private: async render body
	// -------------------------------------------------------------------------

	private async _loadAndRender(containerEl: HTMLElement): Promise<void> {
		const settings = await this.deps.ruleStore.loadGlobalSettings();

		// Keep a mutable snapshot of the current settings so each field's
		// onChange closure can spread the latest values when calling save.
		let current: GlobalSettings = { ...settings };

		const save = async (next: GlobalSettings): Promise<void> => {
			current = next;
			await this.deps.ruleStore.saveGlobalSettings(next);
		};

		// -----------------------------------------------------------------------
		// Section: Global settings
		// -----------------------------------------------------------------------

		new Setting(containerEl).setName("Global settings").setHeading();

		// Field: Per-file IO timeout (ms)
		this._addNumericSetting(containerEl, {
			name: "Per-file IO timeout (ms)",
			desc: "Maximum time (in milliseconds) allowed for a single file operation before it is abandoned. Default: 10000.",
			field: "perFileTimeoutMs",
			getCurrent: () => current,
			save,
		});

		// Field: Audit retention (days)
		this._addNumericSetting(containerEl, {
			name: "Audit retention (days)",
			desc: "How many days of audit log entries to keep. Older month-files are pruned on the next run. Default: 90.",
			field: "auditRetentionDays",
			getCurrent: () => current,
			save,
		});

		// Field: Audit max bytes
		this._addNumericSetting(containerEl, {
			name: "Audit max bytes",
			desc: "Rotate the audit log when the active NDJSON file exceeds this size in bytes. Default: 10485760 (10 MB).",
			field: "auditMaxBytes",
			getCurrent: () => current,
			save,
		});

		// Field: Stability-check window (ms)
		this._addNumericSetting(containerEl, {
			name: "Stability-check window (ms)",
			desc: "How long a file's mtime must be stable before it is considered safe to copy. Default: 2000.",
			field: "stabilityCheckMs",
			getCurrent: () => current,
			save,
		});

		// -----------------------------------------------------------------------
		// Section: Audit log
		// -----------------------------------------------------------------------

		new Setting(containerEl).setName("Audit log").setHeading();

		// Show audit log button
		new Setting(containerEl)
			.setName("Show audit log")
			.setDesc("Open the current-month audit log file in your default application.")
			.addButton((btn) => {
				btn.setButtonText("Show audit log").onClick(() => {
					void this._showAuditLog();
				});
			});

		// Purge audit log button
		new Setting(containerEl)
			.setName("Purge audit log")
			.setDesc("Delete all audit log entries. This cannot be undone.")
			.addButton((btn) => {
				btn.setButtonText("Purge audit log now").setWarning().onClick(() => {
					void this._purgeAuditLog();
				});
			});
	}

	// -------------------------------------------------------------------------
	// Private: numeric setting helper
	// -------------------------------------------------------------------------

	private _addNumericSetting(
		containerEl: HTMLElement,
		opts: {
			name: string;
			desc: string;
			field: keyof GlobalSettings;
			getCurrent: () => GlobalSettings;
			save: (next: GlobalSettings) => Promise<void>;
		},
	): void {
		new Setting(containerEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addText((text) => {
				text
					.setValue(String(opts.getCurrent()[opts.field]))
					.onChange((raw) => {
						const parsed = Number(raw);
						// Require a plain positive integer string — reject scientific
						// notation (e.g. "1e5"), decimals, negatives, and non-numeric input.
						if (!Number.isInteger(parsed) || parsed <= 0 || !/^\d+$/.test(raw.trim())) {
							// Invalid — reset to the current value
							text.setValue(String(opts.getCurrent()[opts.field]));
							return;
						}
						void opts.save({ ...opts.getCurrent(), [opts.field]: parsed });
					});
			});
	}

	// -------------------------------------------------------------------------
	// Private: Show audit log
	// -------------------------------------------------------------------------

	private async _showAuditLog(): Promise<void> {
		const exists = await this.deps.auditFilePresent();
		if (!exists) {
			this.deps.notices.transient("No audit log entries yet");
			return;
		}
		const path = this.deps.currentMonthAuditPath();
		try {
			await this.deps.openInDefaultApp(path);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.deps.notices.transient(
				`Couldn't open audit log: ${reason} — file is at: ${path}`,
			);
		}
	}

	// -------------------------------------------------------------------------
	// Private: Purge audit log
	// -------------------------------------------------------------------------

	private async _purgeAuditLog(): Promise<void> {
		const confirmed = await this.deps.confirm(
			"Purge all audit log entries? This cannot be undone.",
		);
		if (!confirmed) return;
		await this.deps.auditLog.purgeAll();
		this.deps.notices.transient("Audit log purged");
	}
}

// ---------------------------------------------------------------------------
// ConfirmModal — tiny Obsidian Modal subclass usable as the production `confirm`
// seam. Import Modal from obsidian; production main.ts wires this as:
//
//   confirm: (msg) => new ConfirmModal(app, msg).show()
//
// The subtab itself accepts `confirm` as a function — ConfirmModal is a
// convenience export for production wiring; tests never import it.
// ---------------------------------------------------------------------------

// Importing Modal here so the class is available for production wiring without
// requiring callers to import from two places.
import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ConfirmModal extends Modal {
	private readonly message: string;
	private resolve!: (value: boolean) => void;
	readonly result: Promise<boolean>;

	constructor(app: App, message: string) {
		super(app);
		this.message = message;
		this.result = new Promise<boolean>((res) => {
			this.resolve = res;
		});
	}

	/**
	 * Opens the modal and returns a Promise that resolves with the user's choice.
	 * Named `show()` rather than `open()` to avoid the no-misused-promises
	 * lint error that arises from overriding a void-returning base method with
	 * a Promise-returning override. Production wiring calls `modal.show()`.
	 */
	show(): Promise<boolean> {
		this.open();
		return this.result;
	}

	onOpen(): void {
		this.contentEl.empty();

		const p = this.contentEl.ownerDocument.createElement("p");
		p.textContent = this.message;
		this.contentEl.appendChild(p);

		const row = this.contentEl.ownerDocument.createElement("div");
		this.contentEl.appendChild(row);

		const confirmBtn = this.contentEl.ownerDocument.createElement("button");
		confirmBtn.textContent = "Purge";
		confirmBtn.classList.add("mod-warning");
		confirmBtn.addEventListener("click", () => {
			this.resolve(true);
			this.close();
		});
		row.appendChild(confirmBtn);

		const cancelBtn = this.contentEl.ownerDocument.createElement("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => {
			this.resolve(false);
			this.close();
		});
		row.appendChild(cancelBtn);
	}

	onClose(): void {
		// If the user closes via ESC / backdrop, resolve false so the Promise settles.
		this.resolve(false);
	}
}
