// CommandRegistry — registers the 6 PRD/F7 command-palette commands (T3.3).
//
// WHY this file exists:
// Hakobi exposes six commands to Obsidian's command palette, covering the
// full PRD/F7 surface: run all imports, run a selected import rule, run all
// exports, run a selected export rule, and dry-run variants of the two
// "select" commands. This class owns the wiring of those commands so
// `main.ts` stays thin (lifecycle only).
//
// Design notes:
//   - The `selectRule` dependency is an injectable seam. In production, the
//     real wiring will pass a FuzzySuggestModal subclass. In tests, a plain
//     vi.fn() is passed instead — no real Obsidian modal needed.
//   - Obsidian convention: `addCommand({ id })` IDs must NOT include the
//     plugin's display name prefix ("Hakobi:"). Obsidian prepends the plugin's
//     name automatically. Including the prefix would result in a double-prefix
//     like "Hakobi: Hakobi: Run all import rules" in the palette.
//   - Command disposal: `Plugin.addCommand` registers commands under the
//     plugin's lifecycle. Obsidian removes them automatically on plugin unload.
//     No explicit register* call is needed in this class.
//   - "Rule already running" Notice: the CommandRegistry does NOT currently
//     surface a runtime "already running" Notice. That is a Scheduler concern.
//     `notices.ruleAlreadyRunning()` is available on the notices interface for
//     future use from the Scheduler's audit observer (Phase 4+).

import type { Rule, RuleId } from "../domain/rule";

// ---------------------------------------------------------------------------
// Structural dependency interfaces
// ---------------------------------------------------------------------------

export interface CommandRegistryDeps {
	plugin: {
		addCommand(cmd: {
			id: string;
			name: string;
			callback: () => void | Promise<void>;
		}): void;
	};
	scheduler: {
		runOnce(ruleId: RuleId, opts?: { dryRun?: boolean }): Promise<void>;
		runAll(direction: "import" | "export", opts?: { dryRun?: boolean }): Promise<void>;
	};
	ruleStore: {
		load(): Promise<{ rules: Rule[] }>;
	};
	notices: {
		ruleAlreadyRunning(name: string): void;
		transient(m: string): void;
	};
	/**
	 * Injectable rule-selection seam. Production passes a FuzzySuggestModal
	 * subclass; tests pass a vi.fn() — no real Obsidian modal needed.
	 * Returns the selected Rule, or `undefined` if the user cancels.
	 */
	selectRule?: (rules: Rule[]) => Promise<Rule | undefined>;
}

// ---------------------------------------------------------------------------
// CommandRegistry
// ---------------------------------------------------------------------------

export class CommandRegistry {
	private readonly deps: CommandRegistryDeps;

	constructor(deps: CommandRegistryDeps) {
		this.deps = deps;
	}

	/** Wire all 6 PRD/F7 commands onto the plugin. Call once from onload(). */
	registerAll(): void {
		const { plugin, scheduler, ruleStore } = this.deps;

		// Default selectRule: no-op stub if no seam is injected. Production
		// should always inject a real FuzzySuggestModal-backed implementation.
		const selectRule =
			this.deps.selectRule ?? (() => Promise.resolve(undefined));

		// ------------------------------------------------------------------
		// 1. run-import-all — Run all import rules
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-import-all",
			name: "Run all import rules",
			callback: () => scheduler.runAll("import", { dryRun: false }),
		});

		// ------------------------------------------------------------------
		// 2. run-import-select — Run a selected import rule
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-import-select",
			name: "Run an import rule…",
			callback: async () => {
				const { rules } = await ruleStore.load();
				const importRules = rules.filter((r) => r.direction === "import");
				const chosen = await selectRule(importRules);
				if (chosen === undefined) return;
				await scheduler.runOnce(chosen.id, { dryRun: false });
			},
		});

		// ------------------------------------------------------------------
		// 3. run-export-all — Run all export rules
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-export-all",
			name: "Run all export rules",
			callback: () => scheduler.runAll("export", { dryRun: false }),
		});

		// ------------------------------------------------------------------
		// 4. run-export-select — Run a selected export rule
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-export-select",
			name: "Run an export rule…",
			callback: async () => {
				const { rules } = await ruleStore.load();
				const exportRules = rules.filter((r) => r.direction === "export");
				const chosen = await selectRule(exportRules);
				if (chosen === undefined) return;
				await scheduler.runOnce(chosen.id, { dryRun: false });
			},
		});

		// ------------------------------------------------------------------
		// 5. run-import-dry-run-select — Dry-run a selected import rule
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-import-dry-run-select",
			name: "Dry-run an import rule…",
			callback: async () => {
				const { rules } = await ruleStore.load();
				const importRules = rules.filter((r) => r.direction === "import");
				const chosen = await selectRule(importRules);
				if (chosen === undefined) return;
				await scheduler.runOnce(chosen.id, { dryRun: true });
			},
		});

		// ------------------------------------------------------------------
		// 6. run-export-dry-run-select — Dry-run a selected export rule
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "run-export-dry-run-select",
			name: "Dry-run an export rule…",
			callback: async () => {
				const { rules } = await ruleStore.load();
				const exportRules = rules.filter((r) => r.direction === "export");
				const chosen = await selectRule(exportRules);
				if (chosen === undefined) return;
				await scheduler.runOnce(chosen.id, { dryRun: true });
			},
		});
	}
}
