import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Live tests run in Node (no DOM); they still import production code
			// that imports from "obsidian". Resolve to the same vi.fn-based mock
			// used by unit tests — live tests synthesize a NodeFS-backed App on
			// top of it via test/live/_helpers/makeNodeApp.
			obsidian: path.resolve(HERE, "test/__mocks__/obsidian.ts"),
		},
	},
	test: {
		globals: true,
		// jsdom — production code (HakobiPlugin → StatusBar → addStatusBarItem)
		// touches `document` and `window` even in non-UI paths. jsdom polyfills
		// those globals while leaving `node:fs` untouched, which is what the
		// vault-backed E2E surface needs (real disk I/O via NodeFs/AuditLog).
		environment: "jsdom",
		include: ["test/live/**/*.test.ts"],
		testTimeout: 90_000,
		hookTimeout: 30_000,
	},
});
