// main.scope-wiring.test.ts — regression for #20.
//
// WHY this file exists:
// scope.ts refuses rules that touch the vault root, the Obsidian config dir
// and the plugin data dir — but only if it is handed an ABSOLUTE plugin dir.
// main.ts used to pass the vault-relative `manifest.dir`, so the guard
// silently matched nothing but the vault root. scope.test.ts cannot see that
// (it uses an absolute fixture); this test captures what main.ts actually
// wires into the runners and rule editors and asserts the guard fires.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Plugin } from "obsidian";
import type { ImportRule, ExportFolderRule, AbsolutePath, RuleId, VaultRelativePath } from "../src/domain/rule";
import type { ScopeViolation } from "../src/domain/scope";
import type { Result } from "../src/domain/rule";

// ── Capture the deps main.ts hands to each scope consumer ───────────────────
const captured: Record<string, Record<string, unknown>> = {};

function capturing<T extends new (deps: never) => object>(name: string, Orig: T): T {
  return class extends (Orig as unknown as new (deps: Record<string, unknown>) => object) {
    constructor(deps: Record<string, unknown>) {
      super(deps);
      captured[name] = deps;
    }
  } as unknown as T;
}

vi.mock("../src/runner/ImportRunner", async (orig) => {
  const m = await orig<typeof import("../src/runner/ImportRunner")>();
  return { ...m, ImportRunner: capturing("ImportRunner", m.ImportRunner) };
});
vi.mock("../src/runner/ExportRunner", async (orig) => {
  const m = await orig<typeof import("../src/runner/ExportRunner")>();
  return { ...m, ExportRunner: capturing("ExportRunner", m.ExportRunner) };
});
vi.mock("../src/settings/editor/ImportRuleEditor", async (orig) => {
  const m = await orig<typeof import("../src/settings/editor/ImportRuleEditor")>();
  return { ...m, ImportRuleEditor: capturing("ImportRuleEditor", m.ImportRuleEditor) };
});
vi.mock("../src/settings/editor/ExportRuleEditor", async (orig) => {
  const m = await orig<typeof import("../src/settings/editor/ExportRuleEditor")>();
  return { ...m, ExportRuleEditor: capturing("ExportRuleEditor", m.ExportRuleEditor) };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const VAULT = "/vault";
const RULE_BASE = {
  id: "550e8400-e29b-41d4-a716-446655440000" as RuleId,
  name: "into config dir",
  everyMinutes: 5,
  action: "copy" as const,
  onCollision: "skip" as const,
  flattenOnTarget: false,
  dryRun: false,
};
const importIntoConfigDir: ImportRule = {
  ...RULE_BASE,
  direction: "import",
  sourcePath: "/Users/me/Downloads" as AbsolutePath,
  destinationVaultPath: ".obsidian/plugins" as VaultRelativePath,
};
const exportFromPluginDir: ExportFolderRule = {
  ...RULE_BASE,
  direction: "export",
  sourceType: "folder",
  sourceVaultPath: ".obsidian/plugins/miyo-hakobi" as VaultRelativePath,
  destinationPath: "/Users/me/Backup" as AbsolutePath,
};

function testManifest(): never {
  // The obsidian mock ignores the manifest argument; onload reads plugin.manifest.
  return { id: "miyo-hakobi", dir: ".obsidian/plugins/miyo-hakobi" } as never;
}

async function loadPlugin(): Promise<void> {
  const { default: HakobiPlugin } = await import("../src/main");
  const app = new App();
  // Real Obsidian resolves vault-relative paths against the same base path.
  (app.vault.adapter as unknown as Record<string, unknown>)["getFullPath"] = vi.fn(
    (rel: string) => `${VAULT}/${rel}`,
  );
  const plugin = new HakobiPlugin(app, testManifest()) as InstanceType<typeof HakobiPlugin> & Plugin;
  Object.assign(plugin.manifest, { id: "miyo-hakobi", dir: ".obsidian/plugins/miyo-hakobi" });
  await plugin.onload();
}

function expectForbidden(r: Result<void, ScopeViolation>): void {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.reason).toBe("forbidden-path");
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("HakobiPlugin scope wiring (#20)", () => {
  beforeEach(async () => {
    for (const k of Object.keys(captured)) delete captured[k];
    await loadPlugin();
  });

  it("passes an absolute plugin dir inside the vault to both rule editors", () => {
    for (const name of ["ImportRuleEditor", "ExportRuleEditor"]) {
      expect(captured[name]?.["pluginDir"]).toBe(`${VAULT}/.obsidian/plugins/miyo-hakobi`);
    }
  });

  it("rule editors' save-time check refuses a rule targeting the config dir", async () => {
    const { validateRuleAtSave } = await import("../src/domain/scope");
    const deps = captured["ImportRuleEditor"] as { vaultRoot: string; pluginDir: string };
    expectForbidden(validateRuleAtSave(importIntoConfigDir, deps.vaultRoot, deps.pluginDir));
  });

  it("ImportRunner's run-time scope check refuses an import into the config dir", async () => {
    const validateScope = captured["ImportRunner"]?.["validateScope"] as (
      rule: ImportRule, fs: unknown, vault: unknown,
    ) => Promise<Result<void, ScopeViolation>>;
    expectForbidden(await validateScope(importIntoConfigDir, {}, {}));
  });

  it("ExportRunner's run-time scope check refuses an export of the plugin data dir", async () => {
    const validateScope = captured["ExportRunner"]?.["validateScope"] as (
      rule: ExportFolderRule,
    ) => Promise<Result<void, ScopeViolation>>;
    expectForbidden(await validateScope(exportFromPluginDir));
  });

  it("still accepts an ordinary import rule (guard is not over-broad)", async () => {
    const { validateRuleAtSave } = await import("../src/domain/scope");
    const deps = captured["ImportRuleEditor"] as { vaultRoot: string; pluginDir: string };
    const ok = validateRuleAtSave(
      { ...importIntoConfigDir, destinationVaultPath: "Inbox" as VaultRelativePath },
      deps.vaultRoot,
      deps.pluginDir,
    );
    expect(ok.ok).toBe(true);
  });
});
