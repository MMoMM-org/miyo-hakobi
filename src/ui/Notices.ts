// WHY this file exists:
// Centralizes every user-facing Obsidian Notice so that:
// (a) translation/localization can happen at one seam later — swap strings here,
//     not scattered across every feature file;
// (b) tests assert canonical strings live in exactly one place, making copy
//     drift detectable via a single grep invariant;
// (c) Obsidian plugin-review guidelines (no <script>-style HTML in Notice text)
//     are enforced uniformly at this boundary rather than at each call site.

import { Notice } from "obsidian";

/**
 * Shows a transient notice with Obsidian's default timeout.
 * Use for informational feedback that should auto-dismiss.
 */
export function transient(message: string): void {
	new Notice(message);
}

/**
 * Shows a persistent notice that stays until the user dismisses it (timeout=0).
 * Use for warnings or errors that require user attention.
 */
export function persistent(message: string): void {
	new Notice(message, 0);
}

/**
 * Shows the canonical "No active note" notice.
 * Fires when a command requires an active editor but none is open.
 */
export function noActiveNote(): void {
	// Canonical string — must match exactly; tests assert this verbatim.
	new Notice("No active note");
}

/**
 * Shows the canonical "Rule already running" notice for the given rule name.
 * Fires when the scheduler rejects a concurrent execution of the same rule.
 */
export function ruleAlreadyRunning(ruleName: string): void {
	// Canonical string — must match exactly; tests assert this verbatim.
	new Notice(`Rule '${ruleName}' is already running`);
}
