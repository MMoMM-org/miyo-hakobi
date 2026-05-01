// CommandRegistry — registers the 7 PRD/F7 command-palette commands (T3.3).
//
// WHY this file exists:
// Hakobi exposes seven commands to Obsidian's command palette, covering the
// full PRD/F7 surface: run all imports, run a selected import rule, run all
// exports, run a selected export rule, export the currently-active note,
// and dry-run variants of the two "select" commands. This class owns the
// wiring of those commands so `main.ts` stays thin (lifecycle only).
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
//   - "Export this note" ad-hoc rule: for T3.3 scope, this command calls
//     `scheduler.runOnce` with a synthetic rule id. The Scheduler's runOnce()
//     looks up the rule by id from RuleStore, which means the ad-hoc rule will
//     not be found for now. Full ad-hoc-rule plumbing (e.g. a runOnceAdhoc
//     method or RuleStore injection) is deferred to Phase 4 / a follow-up task.

import type { TFile } from "obsidian";
import type { Rule, RuleId, ExportNoteRule } from "../domain/rule";

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
	vaultIo: {
		getActiveFile(): TFile | null;
	};
	notices: {
		noActiveNote(): void;
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

	/** Wire all 7 PRD/F7 commands onto the plugin. Call once from onload(). */
	registerAll(): void {
		const { plugin, scheduler, ruleStore, vaultIo, notices } = this.deps;

		// Default selectRule: no-op stub if no seam is injected. Production
		// should always inject a real FuzzySuggestModal-backed implementation.
		const selectRule =
			this.deps.selectRule ?? (async () => undefined);

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
		// 5. export-this-note — Export the currently-active note
		//
		// TODO (Phase 4): The ad-hoc ExportNoteRule built here is given a
		// synthetic id, but Scheduler.runOnce() looks up the rule by id from
		// RuleStore. Until a runOnceAdhoc() method (or equivalent injection
		// mechanism) is added to Scheduler, the Scheduler will not find the
		// rule and the export will silently no-op. The command structure and
		// TFile-null guard are correct; only the ad-hoc plumbing is deferred.
		// ------------------------------------------------------------------
		plugin.addCommand({
			id: "export-this-note",
			name: "Export this note",
			callback: async () => {
				const activeFile = vaultIo.getActiveFile();
				if (activeFile === null) {
					notices.noActiveNote();
					return;
				}

				// Build an ad-hoc ExportNoteRule for the active file.
				// The id is synthetic and not persisted — see TODO above.
				const adhocRule: ExportNoteRule = {
					id: "__active-note__" as RuleId,
					name: activeFile.name,
					direction: "export",
					sourceType: "note",
					sourceVaultNotePath: activeFile.path as ExportNoteRule["sourceVaultNotePath"],
					// destinationPath is unknown without a configured rule — placeholder.
					// Phase 4 will resolve destination from a user-selected export rule or
					// a default configured path.
					destinationPath: "" as ExportNoteRule["destinationPath"],
					everyMinutes: 1,
					action: "copy",
					onCollision: "skip",
					flattenOnTarget: false,
					dryRun: false,
				};

				await scheduler.runOnce(adhocRule.id, { dryRun: false });
			},
		});

		// ------------------------------------------------------------------
		// 6. run-import-dry-run-select — Dry-run a selected import rule
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
		// 7. run-export-dry-run-select — Dry-run a selected export rule
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
