// CommandRegistry.test.ts — TDD tests for T3.3.
//
// These tests verify that CommandRegistry registers exactly 7 commands with
// correct IDs and that each callback delegates to the right scheduler/notice
// method. The `selectRule` seam is injected as a vi.fn() so no Obsidian
// FuzzySuggestModal is needed in tests.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "../__mocks__/obsidian";
import type { ImportRule, ExportFolderRule } from "../../src/domain/rule";
import type { RuleId } from "../../src/domain/rule";
import { CommandRegistry } from "../../src/ui/CommandRegistry";
import type { CommandRegistryDeps } from "../../src/ui/CommandRegistry";

// ---------------------------------------------------------------------------
// Helpers — minimal typed fakes
// ---------------------------------------------------------------------------

function makeImportRule(id: string, name: string): ImportRule {
	return {
		id: id as RuleId,
		name,
		direction: "import",
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		sourcePath: "/some/source" as ImportRule["sourcePath"],
		destinationVaultPath: "Inbox" as ImportRule["destinationVaultPath"],
	};
}

function makeExportRule(id: string, name: string): ExportFolderRule {
	return {
		id: id as RuleId,
		name,
		direction: "export",
		sourceType: "folder",
		everyMinutes: 5,
		action: "copy",
		onCollision: "skip",
		flattenOnTarget: false,
		dryRun: false,
		sourceVaultPath: "Notes" as ExportFolderRule["sourceVaultPath"],
		destinationPath: "/some/dest" as ExportFolderRule["destinationPath"],
	};
}

const importRule = makeImportRule("rule-import-1", "My Import");
const exportRule = makeExportRule("rule-export-1", "My Export");

type RecordedCommand = {
	id: string;
	name: string;
	callback: () => void | Promise<void>;
};

function makeDeps(overrides?: Partial<CommandRegistryDeps>): {
	deps: CommandRegistryDeps;
	commands: RecordedCommand[];
	plugin: CommandRegistryDeps["plugin"];
	scheduler: CommandRegistryDeps["scheduler"];
	ruleStore: CommandRegistryDeps["ruleStore"];
	vaultIo: CommandRegistryDeps["vaultIo"];
	notices: CommandRegistryDeps["notices"];
	selectRule: NonNullable<CommandRegistryDeps["selectRule"]>;
} {
	const commands: RecordedCommand[] = [];

	const plugin = {
		addCommand: vi.fn((cmd: RecordedCommand) => {
			commands.push(cmd);
		}),
	};

	const scheduler = {
		runOnce: vi.fn(async () => {}),
		runAll: vi.fn(async () => {}),
	};

	const ruleStore = {
		load: vi.fn(async () => ({ rules: [importRule, exportRule] })),
	};

	const vaultIo = {
		getActiveFile: vi.fn((): TFile | null => null),
	};

	const notices = {
		noActiveNote: vi.fn(),
		ruleAlreadyRunning: vi.fn(),
		transient: vi.fn(),
	};

	// Default selectRule: returns first rule from the list (happy path)
	const selectRule = vi.fn(async (rules: typeof importRule[]) =>
		rules[0],
	) as NonNullable<CommandRegistryDeps["selectRule"]>;

	const deps: CommandRegistryDeps = {
		plugin,
		scheduler,
		ruleStore,
		vaultIo,
		notices,
		selectRule,
		...overrides,
	};

	return { deps, commands, plugin, scheduler, ruleStore, vaultIo, notices, selectRule };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommandRegistry", () => {
	describe("registerAll()", () => {
		it("calls plugin.addCommand exactly 7 times", () => {
			const { deps, commands } = makeDeps();
			const registry = new CommandRegistry(deps);
			registry.registerAll();
			expect(commands).toHaveLength(7);
		});

		it("registers exactly the 7 expected IDs and no others", () => {
			const { deps, commands } = makeDeps();
			const registry = new CommandRegistry(deps);
			registry.registerAll();

			const ids = commands.map((c) => c.id);
			const expectedIds = [
				"run-import-all",
				"run-import-select",
				"run-export-all",
				"run-export-select",
				"export-this-note",
				"run-import-dry-run-select",
				"run-export-dry-run-select",
			];
			expect(ids.sort()).toEqual(expectedIds.sort());
		});

		it("no registered ID starts with 'hakobi' (case-insensitive)", () => {
			const { deps, commands } = makeDeps();
			const registry = new CommandRegistry(deps);
			registry.registerAll();

			for (const cmd of commands) {
				expect(cmd.id.toLowerCase()).not.toMatch(/^hakobi/);
			}
		});
	});

	describe("run-import-all callback", () => {
		it("invokes scheduler.runAll('import', { dryRun: false })", async () => {
			const { deps, commands, scheduler } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-import-all")!;
			await cmd.callback();

			expect(scheduler.runAll).toHaveBeenCalledOnce();
			expect(scheduler.runAll).toHaveBeenCalledWith("import", { dryRun: false });
		});
	});

	describe("run-export-all callback", () => {
		it("invokes scheduler.runAll('export', { dryRun: false })", async () => {
			const { deps, commands, scheduler } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-export-all")!;
			await cmd.callback();

			expect(scheduler.runAll).toHaveBeenCalledOnce();
			expect(scheduler.runAll).toHaveBeenCalledWith("export", { dryRun: false });
		});
	});

	describe("run-import-select callback", () => {
		it("calls selectRule with only import-direction rules from ruleStore", async () => {
			const { deps, commands, selectRule } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-import-select")!;
			await cmd.callback();

			expect(selectRule).toHaveBeenCalledOnce();
			const passedRules = (selectRule as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof importRule[];
			expect(passedRules.every((r) => r.direction === "import")).toBe(true);
		});

		it("calls scheduler.runOnce with the selected rule id and dryRun: false", async () => {
			const { deps, commands, scheduler } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-import-select")!;
			await cmd.callback();

			expect(scheduler.runOnce).toHaveBeenCalledOnce();
			expect(scheduler.runOnce).toHaveBeenCalledWith(importRule.id, { dryRun: false });
		});
	});

	describe("run-export-select callback", () => {
		it("calls selectRule with only export-direction rules from ruleStore", async () => {
			const { deps, commands, selectRule } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-export-select")!;
			await cmd.callback();

			expect(selectRule).toHaveBeenCalledOnce();
			const passedRules = (selectRule as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof exportRule[];
			expect(passedRules.every((r) => r.direction === "export")).toBe(true);
		});

		it("calls scheduler.runOnce with the selected rule id and dryRun: false on pick", async () => {
			const { deps, commands, scheduler } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-export-select")!;
			await cmd.callback();

			expect(scheduler.runOnce).toHaveBeenCalledOnce();
			expect(scheduler.runOnce).toHaveBeenCalledWith(exportRule.id, { dryRun: false });
		});
	});

	describe("run-import-dry-run-select callback", () => {
		it("calls selectRule with import rules and passes dryRun: true to runOnce", async () => {
			const { deps, commands, scheduler, selectRule } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-import-dry-run-select")!;
			await cmd.callback();

			const passedRules = (selectRule as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof importRule[];
			expect(passedRules.every((r) => r.direction === "import")).toBe(true);

			expect(scheduler.runOnce).toHaveBeenCalledOnce();
			expect(scheduler.runOnce).toHaveBeenCalledWith(importRule.id, { dryRun: true });
		});
	});

	describe("run-export-dry-run-select callback", () => {
		it("calls selectRule with export rules and passes dryRun: true to runOnce", async () => {
			const { deps, commands, scheduler, selectRule } = makeDeps();
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-export-dry-run-select")!;
			await cmd.callback();

			const passedRules = (selectRule as ReturnType<typeof vi.fn>).mock.calls[0][0] as typeof exportRule[];
			expect(passedRules.every((r) => r.direction === "export")).toBe(true);

			expect(scheduler.runOnce).toHaveBeenCalledOnce();
			expect(scheduler.runOnce).toHaveBeenCalledWith(exportRule.id, { dryRun: true });
		});
	});

	describe("export-this-note callback", () => {
		it("calls notices.noActiveNote() and does NOT invoke scheduler when no active file", async () => {
			const { deps, commands, scheduler, notices } = makeDeps({
				vaultIo: { getActiveFile: vi.fn(() => null) },
			});
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "export-this-note")!;
			await cmd.callback();

			expect(notices.noActiveNote).toHaveBeenCalledOnce();
			expect(scheduler.runOnce).not.toHaveBeenCalled();
		});

		it("calls scheduler.runOnce when there is an active TFile", async () => {
			const activeFile = new TFile();
			activeFile.path = "Notes/active.md";

			const { deps, commands, scheduler, notices } = makeDeps({
				vaultIo: { getActiveFile: vi.fn(() => activeFile) },
			});
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "export-this-note")!;
			await cmd.callback();

			expect(notices.noActiveNote).not.toHaveBeenCalled();
			expect(scheduler.runOnce).toHaveBeenCalledOnce();
		});
	});

	describe("cancel selectRule (returns undefined)", () => {
		it("does not invoke scheduler.runOnce when selectRule returns undefined (run-import-select)", async () => {
			const cancelSelectRule = vi.fn(async () => undefined) as NonNullable<CommandRegistryDeps["selectRule"]>;
			const { deps, commands, scheduler } = makeDeps({ selectRule: cancelSelectRule });
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-import-select")!;
			await cmd.callback();

			expect(scheduler.runOnce).not.toHaveBeenCalled();
		});

		it("does not invoke scheduler.runOnce when selectRule returns undefined (run-export-select)", async () => {
			const cancelSelectRule = vi.fn(async () => undefined) as NonNullable<CommandRegistryDeps["selectRule"]>;
			const { deps, commands, scheduler } = makeDeps({ selectRule: cancelSelectRule });
			new CommandRegistry(deps).registerAll();

			const cmd = commands.find((c) => c.id === "run-export-select")!;
			await cmd.callback();

			expect(scheduler.runOnce).not.toHaveBeenCalled();
		});

		it("does not invoke scheduler.runOnce when selectRule returns undefined (dry-run variants)", async () => {
			const cancelSelectRule = vi.fn(async () => undefined) as NonNullable<CommandRegistryDeps["selectRule"]>;
			const { deps, commands, scheduler } = makeDeps({ selectRule: cancelSelectRule });
			new CommandRegistry(deps).registerAll();

			const importDryRun = commands.find((c) => c.id === "run-import-dry-run-select")!;
			const exportDryRun = commands.find((c) => c.id === "run-export-dry-run-select")!;

			await importDryRun.callback();
			await exportDryRun.callback();

			expect(scheduler.runOnce).not.toHaveBeenCalled();
		});
	});
});
