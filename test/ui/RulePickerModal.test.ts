// RulePickerModal.test.ts — unit tests for the production rule-picker.
//
// Verifies the FuzzySuggestModal contract surface CommandRegistry depends on:
//   - getItems() returns the supplied rules verbatim
//   - getItemText(rule) returns rule.name (what the user sees in the list)
//   - onChooseItem(rule) resolves the Promise with that rule
//   - Closing without selection resolves the Promise with undefined
//   - The Promise resolves exactly once even if onClose fires after a pick
//   - .pick() factory wires construction + open in one call

import { describe, it, expect, vi } from "vitest";

import { App } from "obsidian";

import { RulePickerModal } from "../../src/ui/RulePickerModal";
import type { ImportRule, ExportFolderRule, Rule, RuleId } from "../../src/domain/rule";

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

describe("RulePickerModal", () => {
	it("getItems() returns the supplied rules verbatim", () => {
		const app = new App();
		const rules: Rule[] = [
			makeImportRule("r1", "Alpha"),
			makeExportRule("r2", "Beta"),
		];
		const modal = new RulePickerModal(app, rules, () => {});
		expect(modal.getItems()).toEqual(rules);
	});

	it("getItemText(rule) returns rule.name", () => {
		const app = new App();
		const rule = makeImportRule("r1", "My Voice Memos");
		const modal = new RulePickerModal(app, [rule], () => {});
		expect(modal.getItemText(rule)).toBe("My Voice Memos");
	});

	it("onChooseItem(rule) resolves with that rule", async () => {
		const app = new App();
		const ruleA = makeImportRule("r1", "Alpha");
		const ruleB = makeExportRule("r2", "Beta");

		const promise = new Promise<Rule | undefined>((resolve) => {
			const modal = new RulePickerModal(app, [ruleA, ruleB], resolve);
			modal.open();
			modal.onChooseItem(ruleB);
		});

		await expect(promise).resolves.toBe(ruleB);
	});

	it("closing without selection resolves with undefined", async () => {
		const app = new App();
		const rule = makeImportRule("r1", "Alpha");

		const promise = new Promise<Rule | undefined>((resolve) => {
			const modal = new RulePickerModal(app, [rule], resolve);
			modal.open();
			modal.close(); // simulate user pressing Esc / clicking outside
		});

		await expect(promise).resolves.toBeUndefined();
	});

	it("resolves exactly once even when onClose fires after a pick", async () => {
		const app = new App();
		const rule = makeImportRule("r1", "Alpha");

		let resolveCount = 0;
		let lastValue: Rule | undefined;
		const modal = new RulePickerModal(app, [rule], (r) => {
			resolveCount += 1;
			lastValue = r;
		});
		modal.open();
		modal.onChooseItem(rule);
		modal.close(); // would resolve again without the dedupe guard
		expect(resolveCount).toBe(1);
		expect(lastValue).toBe(rule);
	});

	it(".pick() factory constructs, opens, and resolves on selection", async () => {
		const app = new App();
		const ruleA = makeImportRule("r1", "Alpha");

		// We piggy-back on setPlaceholder (which .pick() calls when a placeholder
		// is supplied) to grab the modal instance the factory just constructed.
		// That lets us drive onChooseItem on the same instance the user would.
		let captured: RulePickerModal | undefined;
		const placeholderSpy = vi
			.spyOn(RulePickerModal.prototype, "setPlaceholder")
			.mockImplementation(function (this: RulePickerModal): RulePickerModal {
				captured = this;
				return this;
			});

		try {
			const promise = RulePickerModal.pick(app, [ruleA], "Pick a rule");
			expect(captured).toBeDefined();
			(captured as RulePickerModal).onChooseItem(ruleA);
			await expect(promise).resolves.toBe(ruleA);
		} finally {
			placeholderSpy.mockRestore();
		}
	});
});
