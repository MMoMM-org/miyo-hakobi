/**
 * Logger — single, plugin-wide log surface.
 *
 * Why this file exists:
 * The Obsidian community-plugin lint rule (obsidianmd/rule-custom-message
 * → no-console) only allows `console.debug`, `console.warn`, and
 * `console.error` — `console.log`/`console.info` are treated as release
 * noise. Routing every call site through `log.*` keeps a single style of
 * logging across the codebase and lets us gate output centrally (the
 * Debug logging switch) without touching callers.
 *
 * Channel guidance (four channels):
 *  - `log.debug`     — per-run detail. Written only when the user turned on
 *                      Debug logging (via `setDebugSource`).
 *  - `log.lifecycle` — load/unload events and the daily summary. Always
 *                      written, at debug level.
 *  - `log.warn`      — recoverable problems the user might want to see.
 *  - `log.error`     — failures the user should see.
 */

let debugSource: () => boolean = () => false;

/** Registers the live Debug logging switch. `null` restores the default (off). */
export function setDebugSource(source: (() => boolean) | null): void {
	debugSource = source ?? (() => false);
}

export const log = {
	/** Per-run detail. Only when the user turned on Debug logging. */
	debug(...args: unknown[]): void {
		if (debugSource()) console.debug(...args);
	},
	/** Load/unload events and the daily summary. Always, at debug level. */
	lifecycle(...args: unknown[]): void {
		console.debug(...args);
	},
	warn(...args: unknown[]): void {
		console.warn(...args);
	},
	error(...args: unknown[]): void {
		console.error(...args);
	},
};
