// Top-level type surface for Hakobi.
//
// WHY this module exists:
// Re-exports the Phase 1 domain and audit types so downstream phases
// (RuleStore, DeviceStore, settings UI, runner, transfer engines) import
// from a single, stable surface instead of reaching into individual
// internal modules. Also defines the persisted-state shapes
// (PluginData / GlobalSettings / DeviceState) referenced by the
// SDD `[ref: SDD/Application Data Models]` and the spec README.
//
// Keep this file dependency-free apart from type-only re-exports —
// it must not pull Obsidian or Node `fs` into modules that consume it.

import type { Rule, RuleId } from "../domain/rule";

// ---------------------------------------------------------------------------
// Phase 1 type re-exports
// ---------------------------------------------------------------------------

export type {
	Rule,
	RuleId,
	ImportRule,
	ExportRule,
	ExportFolderRule,
	ExportTagRule,
	ExportNoteRule,
	AbsolutePath,
	VaultRelativePath,
	ValidationError,
	Result,
} from "../domain/rule";

export type {
	AuditEntry,
	Direction,
	Operation,
	ErrorCode,
	Decision,
	ParseError,
} from "../audit/AuditEntry";

// ---------------------------------------------------------------------------
// Persisted state shapes (SDD/Application Data Models)
// ---------------------------------------------------------------------------

export interface PluginData {
	schemaVersion: 1;
	rules: Rule[];
	globalSettings: GlobalSettings;
}

export interface GlobalSettings {
	perFileTimeoutMs: number; // F11; default 10000
	auditRetentionDays: number; // F5; default 90
	auditMaxBytes: number; // F5; default 10485760 (10 MB)
	stabilityCheckMs: number; // mtime-stable window; default 2000
}

export interface DeviceState {
	schemaVersion: 1;
	deviceId: string; // UUID generated on first run, persisted
	ruleEnablement: Record<RuleId, boolean>;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
	perFileTimeoutMs: 10_000,
	auditRetentionDays: 90,
	auditMaxBytes: 10_485_760,
	stabilityCheckMs: 2_000,
};

// ---------------------------------------------------------------------------
// Legacy scaffold types
//
// `PluginSettings` / `DEFAULT_SETTINGS` are the original esbuild-template
// scaffold types still referenced by `src/main.ts` and `src/settings/SettingsTab.ts`.
// Phase 3 will rewire main.ts onto `PluginData` / `GlobalSettings` and remove
// these. Kept here as compatibility aliases so T1.11 does not bleed into
// Phase 3 scope.
// ---------------------------------------------------------------------------

export interface PluginSettings {
	exampleSetting: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	exampleSetting: "default",
};
