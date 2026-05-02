// RulePickerModal — Obsidian FuzzySuggestModal subclass for rule selection.
//
// WHY this file exists:
// CommandRegistry exposes 4 "select a rule" commands (run / dry-run × import /
// export). Each callback needs a way to ask the user to pick a rule from a
// fuzzy list. This module is the concrete production implementation of the
// `selectRule` seam — a thin Promise-returning wrapper around Obsidian's
// FuzzySuggestModal. The seam stays generic so unit tests can keep injecting
// a vi.fn() instead of spinning up a real modal.
//
// Resolution semantics:
//   - User picks an item → resolves with that Rule.
//   - User closes the modal without picking (Esc, click-outside) → undefined.
//   - The promise resolves exactly once; defensive guard against double-fire.

import { App, FuzzySuggestModal } from "obsidian";

import type { Rule } from "../domain/rule";

export class RulePickerModal extends FuzzySuggestModal<Rule> {
	private readonly rules: Rule[];
	private readonly resolveFn: (rule: Rule | undefined) => void;
	private resolved = false;

	/**
	 * Convenience factory: build the modal, open it, and return a Promise
	 * that resolves with the user's pick (or `undefined` on cancel).
	 */
	static pick(
		app: App,
		rules: Rule[],
		placeholder?: string,
	): Promise<Rule | undefined> {
		return new Promise((resolve) => {
			const modal = new RulePickerModal(app, rules, resolve);
			if (placeholder !== undefined) modal.setPlaceholder(placeholder);
			modal.open();
		});
	}

	constructor(
		app: App,
		rules: Rule[],
		resolve: (rule: Rule | undefined) => void,
	) {
		super(app);
		this.rules = rules;
		this.resolveFn = resolve;
	}

	getItems(): Rule[] {
		return this.rules;
	}

	getItemText(rule: Rule): string {
		return rule.name;
	}

	onChooseItem(rule: Rule): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveFn(rule);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			this.resolved = true;
			this.resolveFn(undefined);
		}
	}
}
