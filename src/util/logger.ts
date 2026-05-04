/**
 * Logger — single, plugin-wide log surface.
 *
 * Why this file exists:
 * The Obsidian community-plugin lint rule (obsidianmd/rule-custom-message
 * → no-console) only allows `console.debug`, `console.warn`, and
 * `console.error` — `console.log`/`console.info` are treated as release
 * noise. Routing every call site through `log.*` keeps a single style of
 * logging across the codebase and lets us swap the underlying mechanism
 * later (level gating, prefixing, off-switch) without touching callers.
 *
 * Channel guidance (matches Obsidian's plugin guidelines):
 *  - `log.debug`  — diagnostic / lifecycle / per-tick traces.
 *                   Hidden by default in DevTools (verbose level).
 *  - `log.warn`   — recoverable problems the user might want to see.
 *  - `log.error`  — failures the user should see.
 */

export const log = {
	debug(...args: unknown[]): void {
		console.debug(...args);
	},
	warn(...args: unknown[]): void {
		console.warn(...args);
	},
	error(...args: unknown[]): void {
		console.error(...args);
	},
};
