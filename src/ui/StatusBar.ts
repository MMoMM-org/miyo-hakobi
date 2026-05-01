/**
 * StatusBar — kanji 運 (ferry/transport, the Hakobi brand glyph) in Obsidian's
 * status bar, cycling through three states driven by the scheduler:
 *
 *   idle      — no rule is currently running; optionally shows last-run summary
 *   running   — one named rule is being executed right now
 *   failed    — the last attempt ended with an error
 *
 * The element responds to click → opens the General subtab of Hakobi settings.
 * This is useful so users can quickly reconfigure a failing rule.
 *
 * Sticky-failed semantic: a failed state persists until a NEW attempt completes
 * (setRunning followed by setIdle), because a bare setIdle without a preceding
 * setRunning does not represent a successful new run — it might be a stale
 * lifecycle event. Clicking while failed also clears the failure and opens
 * settings, giving the user an explicit "I've seen this" acknowledgement path.
 *
 * aria-label always mirrors the title tooltip so screen readers receive the
 * same information as sighted users (no color-only signal; kanji shape is
 * unique but text remains the primary channel).
 */

// WHY: StatusBar is a pure UI concern — it owns the Obsidian status-bar DOM
// element and the three-state machine that drives it.  No scheduler or runner
// logic lives here; those layers call setRunning/setIdle/setFailed as events.

type State = "idle" | "running" | "failed";

/** Subtabs the settings callback can receive (mirrors SettingsTab definition). */
type SettingsSubtab = "general" | "import" | "export";

export interface StatusBarDeps {
	/** Structural slice — only the subset of Plugin that StatusBar needs. */
	plugin: { addStatusBarItem: () => HTMLElement };
	/** Open the plugin settings modal at a specific subtab. */
	openSettings: (subtab: SettingsSubtab) => void;
}

export class StatusBar {
	private readonly el: HTMLElement;
	private state: State = "idle";
	/**
	 * Tracks whether a setRunning call has been made since the last setFailed.
	 * Used to implement the sticky-failed semantic: setIdle only clears a prior
	 * failure if a new run was started (setRunning was called first).
	 */
	private runningAfterFailed = false;

	constructor(private readonly deps: StatusBarDeps) {
		this.el = deps.plugin.addStatusBarItem();

		// Render the kanji glyph once — it never changes.
		// Obsidian augments the status-bar element with createSpan; use it so the
		// plugin follows the obsidianmd/prefer-create-el rule and works with popout
		// windows (activeDocument compatibility is handled by Obsidian's augmentation).
		const any = this.el as unknown as Record<string, unknown>;
		(any["createSpan"] as (opts: { text: string }) => HTMLElement)({
			text: "運",
		});

		// Register click handler directly on the element.
		// The element's lifecycle is owned by Obsidian (via addStatusBarItem),
		// so there is no separate cleanup needed here — Obsidian removes the
		// status-bar item on plugin unload.
		this.el.addEventListener("click", () => {
			if (this.state === "failed") {
				// User acknowledges the failure; clear it and open settings.
				this.applyState("idle");
			}
			this.deps.openSettings("general");
		});

		// Set initial state.
		this.applyState("idle");
	}

	// ---------------------------------------------------------------------------
	// Public state transitions
	// ---------------------------------------------------------------------------

	/** Mark the status bar as idle. If lastSummary is provided, show it in the tooltip. */
	setIdle(lastSummary?: string): void {
		if (this.state === "failed" && !this.runningAfterFailed) {
			// Sticky-failed: no new run has started since the last failure.
			// Ignore this setIdle call entirely — the failed state and its tooltip
			// persist until the user clicks or a new attempt completes.
			return;
		}
		this.runningAfterFailed = false;
		this.applyState("idle", lastSummary);
	}

	/** Mark the status bar as running the named rule. */
	setRunning(ruleName: string): void {
		if (this.state === "failed") {
			// A new attempt has started — record this so the subsequent setIdle
			// is allowed to clear the failed marker.
			this.runningAfterFailed = true;
		}
		this.applyState("running", undefined, ruleName);
	}

	/** Mark the status bar as failed with the given summary. */
	setFailed(summary: string): void {
		this.runningAfterFailed = false;
		this.applyState("failed", summary);
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	private applyState(
		state: State,
		summary?: string,
		ruleName?: string,
	): void {
		this.state = state;

		// Update CSS classes.
		this.el.classList.remove("mod-idle", "mod-running", "mod-failed");
		switch (state) {
			case "idle":
				this.el.classList.add("mod-idle");
				break;
			case "running":
				this.el.classList.add("mod-running");
				break;
			case "failed":
				this.el.classList.add("mod-failed");
				break;
		}

		// Update tooltip.
		const tooltip = this.buildTooltip(state, ruleName, summary);
		this.updateTooltip(tooltip);
	}

	private buildTooltip(
		state: State,
		ruleName?: string,
		summary?: string,
	): string {
		switch (state) {
			case "idle":
				return summary
					? `Hakobi: idle — last run: ${summary}`
					: "Hakobi: idle";
			case "running":
				return `Hakobi: running '${ruleName}'…`;
			case "failed":
				return summary
					? `Hakobi: failed — ${summary}`
					: "Hakobi: failed";
		}
	}

	private updateTooltip(tooltip: string): void {
		this.el.setAttribute("title", tooltip);
		this.el.setAttribute("aria-label", tooltip);
	}
}
