// HakobiPlugin — lifecycle wiring for all Phase 1-3 modules (T3.11).
//
// WHY this file exists:
// main.ts is intentionally thin: it owns ONLY lifecycle orchestration
// (construction, wiring, registration) and delegates all logic to the
// dedicated modules below. The order of construction in onload() follows
// the downward-only dependency direction required by the constitution:
//
//   NodeFs → VaultIo → AuditLog + Rotation → RuleStore → DeviceStore
//   → InFlightRegistry → ImportRunner + ExportRunner → StatusBar
//   → Scheduler → SettingsTab → CommandRegistry
//
// Known limitation (Phase 4 follow-up):
//   The Scheduler's onRuleChanged / onRuleRemoved hooks are NOT wired into
//   the subtabs' onSave callbacks in this phase. Rule changes (add/update/remove)
//   are persisted via RuleStore directly from the subtabs, but the Scheduler does
//   not learn about them until the user reloads the plugin or restarts Obsidian.
//   A Phase 4 task will wire scheduler.onRuleChanged from subtab onSave closures.
//
// Known limitation (Phase 4 follow-up):
//   The chooseFsFolder seam for ImportRuleEditor / ExportRuleEditor is wired with
//   a Notice-based no-op fallback ("Folder picker not implemented in this build.")
//   because Electron's dialog.showOpenDialog requires import access that varies
//   by Obsidian version. Full Electron wiring is a Phase 4 concern.

import { Plugin, Menu } from "obsidian";

import { NodeFs } from "./fs/NodeFs";
import { VaultIo } from "./vault/VaultIo";
import { AuditLog } from "./audit/AuditLog";
import { Rotation } from "./audit/Rotation";
import { RuleStore } from "./persistence/RuleStore";
import { DeviceStore } from "./persistence/DeviceStore";
import { InFlightRegistry } from "./scheduler/InFlightRegistry";
import { Scheduler } from "./scheduler/Scheduler";
import { ImportRunner } from "./runner/ImportRunner";
import { ExportRunner } from "./runner/ExportRunner";
import { StatusBar } from "./ui/StatusBar";
import { CommandRegistry } from "./ui/CommandRegistry";
import * as Notices from "./ui/Notices";
import { HeaderSection } from "./settings/HeaderSection";
import { GeneralSubtab, ConfirmModal } from "./settings/subtabs/GeneralSubtab";
import { ImportSubtab } from "./settings/subtabs/ImportSubtab";
import { ExportSubtab } from "./settings/subtabs/ExportSubtab";
import { HakobiSettingsTab } from "./settings/SettingsTab";
import { ImportRuleEditor } from "./settings/editor/ImportRuleEditor";
import { ExportRuleEditor } from "./settings/editor/ExportRuleEditor";
import { validateRuleAtRunTime } from "./domain/scope";

import type { GlobalSettings } from "./types/index";
import type { ImportRule } from "./domain/rule";
import type { ExportRule } from "./domain/rule";

export default class HakobiPlugin extends Plugin {
  private scheduler!: Scheduler;
  // Hold a reference to settingsTab so StatusBar.openSettings can deep-link.
  private settingsTab!: HakobiSettingsTab;
  // Hold globalSettings in memory after load; refreshed by saveGlobalSettings.
  private globalSettings: GlobalSettings = {
    perFileTimeoutMs: 10000,
    auditRetentionDays: 90,
    auditMaxBytes: 10485760,
    stabilityCheckMs: 2000,
  };

  async onload(): Promise<void> {
    // ------------------------------------------------------------------
    // 1. NodeFs — timeout reads fresh from globalSettings on every call
    // ------------------------------------------------------------------
    const nodeFs = new NodeFs({
      timeoutMs: () => this.globalSettings.perFileTimeoutMs,
    });

    // ------------------------------------------------------------------
    // 2. VaultIo
    // ------------------------------------------------------------------
    const vaultIo = new VaultIo(this.app);

    // ------------------------------------------------------------------
    // 3. Resolve plugin data directory and vault root
    // ------------------------------------------------------------------
    const adapter = this.app.vault.adapter as unknown as {
      getBasePath(): string;
      getFullPath?(rel: string): string;
    };
    const vaultRoot = adapter.getBasePath();
    // this.manifest.dir is the vault-relative plugin directory, e.g.
    // ".obsidian/plugins/miyo-hakobi". adapter.getFullPath resolves a
    // vault-adapter-relative path to an absolute FS path (available on
    // Obsidian's FileSystemAdapter). Fall back to joining vaultRoot manually.
    const pluginDataDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    const resolvePluginPath = (rel: string): string => {
      if (adapter.getFullPath) {
        return adapter.getFullPath(`${pluginDataDir}/${rel}`);
      }
      return `${vaultRoot}/${pluginDataDir}/${rel}`;
    };
    const auditDir = resolvePluginPath("audit");

    // ------------------------------------------------------------------
    // 4. AuditLog + Rotation
    // ------------------------------------------------------------------
    const getAuditDir = (): string => auditDir;

    const auditLog = new AuditLog({ fs: nodeFs, getAuditDir });
    const rotation = new Rotation({ fs: nodeFs, getAuditDir });

    // ------------------------------------------------------------------
    // 5. RuleStore — backed by plugin.loadData / plugin.saveData
    // ------------------------------------------------------------------
    const ruleStore = new RuleStore({
      loadData: () => this.loadData() as Promise<unknown>,
      saveData: (d: unknown) => this.saveData(d),
    });

    // Load settings + rules; populate globalSettings before NodeFs is used
    const loadResult = await ruleStore.load();
    this.globalSettings = loadResult.globalSettings;

    // ------------------------------------------------------------------
    // 6. DeviceStore — backed by vault.adapter read/write/exists
    // ------------------------------------------------------------------
    const vaultAdapter = this.app.vault.adapter as unknown as {
      read(p: string): Promise<string>;
      write(p: string, d: string): Promise<void>;
      exists(p: string): Promise<boolean>;
    };

    const deviceStore = new DeviceStore({
      adapter: {
        read: (p: string) => vaultAdapter.read(p),
        write: (p: string, d: string) => vaultAdapter.write(p, d),
        exists: (p: string) => vaultAdapter.exists(p),
      },
      pluginDataDir: `${vaultRoot}/${pluginDataDir}`,
    });

    // ------------------------------------------------------------------
    // 7. InFlightRegistry
    // ------------------------------------------------------------------
    const inFlight = new InFlightRegistry();

    // ------------------------------------------------------------------
    // 8. ImportRunner
    // ------------------------------------------------------------------
    const importRunner = new ImportRunner({
      auditLog,
      nodeFs,
      vaultIo,
      validateScope: (rule: ImportRule, fs, vault) =>
        validateRuleAtRunTime(rule, fs, vault, vaultRoot, pluginDataDir),
      vaultRoot,
      pluginDir: pluginDataDir,
      nowFn: () => new Date(),
      globalSettings: {
        stabilityCheckMs: () => this.globalSettings.stabilityCheckMs,
      },
    });

    // ------------------------------------------------------------------
    // 9. ExportRunner
    // ------------------------------------------------------------------
    const exportRunner = new ExportRunner({
      auditLog,
      nodeFs,
      vaultIo,
      validateScope: (rule: ExportRule) =>
        validateRuleAtRunTime(
          rule,
          nodeFs,
          {
            existsAtVaultPath: (p: string) => vaultIo.existsAtVaultPath(p),
            resolveVaultPath: (p: string) => vaultIo.resolveVaultPath(p),
          },
          vaultRoot,
          pluginDataDir,
        ),
      nowFn: () => new Date(),
    });

    // ------------------------------------------------------------------
    // 10. Scheduler (StatusBar constructed next; Scheduler needs it)
    //     Wire StatusBar first so the Scheduler reference is already available.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // 11. StatusBar — opens settings on click. Uses settingsTab reference
    //     captured after construction (below).
    // ------------------------------------------------------------------
    const statusBar = new StatusBar({
      plugin: this,
      openSettings: (subtab) => {
        if (this.settingsTab) {
          // Try to open via Obsidian's built-in settings modal first.
          // app.setting is not in the TS types but is present at runtime.
          const setting = (this.app as unknown as Record<string, unknown>)["setting"] as
            | { open(): void; openTabById(id: string): void }
            | undefined;
          if (setting) {
            setting.open();
            setting.openTabById(this.manifest.id);
          }
          // Deep-link to the requested subtab.
          this.settingsTab.display(subtab);
        }
      },
    });

    // Now construct the Scheduler with all its deps
    this.scheduler = new Scheduler({
      plugin: this,
      ruleStore,
      deviceStore,
      importRunner,
      exportRunner,
      statusBar,
      auditLog,
      inFlight,
    });

    // ------------------------------------------------------------------
    // 12. Shared confirm seam — production wires ConfirmModal
    // ------------------------------------------------------------------
    const confirm = (msg: string): Promise<boolean> =>
      new ConfirmModal(this.app, msg).show();

    // ------------------------------------------------------------------
    // 13. Overflow menu seam — production wires Obsidian Menu
    // ------------------------------------------------------------------
    const openOverflowMenu = (
      anchor: HTMLElement,
      items: { label: string; onClick: () => void }[],
    ): void => {
      const menu = new Menu();
      for (const item of items) {
        menu.addItem((i) => i.setTitle(item.label).onClick(item.onClick));
      }
      // Position relative to anchor using a synthetic MouseEvent
      const rect = anchor.getBoundingClientRect();
      const evt = new MouseEvent("click", {
        clientX: rect.left,
        clientY: rect.bottom,
      });
      menu.showAtMouseEvent(evt);
    };

    // ------------------------------------------------------------------
    // 14. chooseFsFolder seam (Phase 4: wire Electron dialog)
    // ------------------------------------------------------------------
    const chooseFsFolder = async (): Promise<string | undefined> => {
      // TODO (Phase 4): wire Electron's dialog.showOpenDialog here.
      // For now, surface a Notice so the user knows what is missing.
      Notices.transient("Folder picker not implemented in this build.");
      return undefined;
    };

    // ------------------------------------------------------------------
    // 15. openInDefaultApp seam (GeneralSubtab)
    // ------------------------------------------------------------------
    const openInDefaultApp = async (absPath: string): Promise<void> => {
      // openWithDefaultApp is a prototype method on app that reads `this`, so
      // it must be invoked as a method — bare calls strip `this` and crash.
      const augmentedApp = this.app as unknown as {
        openWithDefaultApp?: (p: string) => Promise<void>;
      };
      if (typeof augmentedApp.openWithDefaultApp === "function") {
        await augmentedApp.openWithDefaultApp(absPath);
      } else {
        // Fallback: surface the path in a Notice
        Notices.transient(`Audit log path: ${absPath}`);
      }
    };

    // ------------------------------------------------------------------
    // 16. Audit file helpers for GeneralSubtab
    // ------------------------------------------------------------------
    // NOTE: date is computed inside the closure so it stays correct across
    // UTC month boundaries (the plugin can stay loaded for hours/days).
    const currentMonthAuditPath = (): string => {
      const d = new Date();
      const y = String(d.getUTCFullYear()).padStart(4, "0");
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      return `${auditDir}/${y}-${m}.ndjson`;
    };
    const auditFilePresent = async (): Promise<boolean> => {
      try {
        await nodeFs.lstat(currentMonthAuditPath());
        return true;
      } catch {
        return false;
      }
    };

    // ------------------------------------------------------------------
    // 17. Rule editors
    // ------------------------------------------------------------------
    const importRuleEditor = new ImportRuleEditor({
      ruleStore,
      deviceStore,
      vaultRoot,
      pluginDir: pluginDataDir,
      chooseFsFolder,
    });

    const exportRuleEditor = new ExportRuleEditor({
      ruleStore,
      deviceStore,
      vaultRoot,
      pluginDir: pluginDataDir,
      chooseFsFolder,
    });

    // ------------------------------------------------------------------
    // 18. Subtabs
    // ------------------------------------------------------------------
    const generalSubtab = new GeneralSubtab({
      ruleStore: {
        loadGlobalSettings: async () => {
          const s = await ruleStore.loadGlobalSettings();
          // Keep in-memory copy fresh when the user saves settings
          this.globalSettings = s;
          return s;
        },
        saveGlobalSettings: async (s) => {
          this.globalSettings = s;
          await ruleStore.saveGlobalSettings(s);
          // Trigger rotation check with new retention/size settings (best-effort)
          rotation.checkAndRotate({
            maxBytes: s.auditMaxBytes,
            retentionDays: s.auditRetentionDays,
          }).catch(() => undefined);
        },
      },
      auditLog,
      notices: Notices,
      auditFilePresent,
      currentMonthAuditPath,
      openInDefaultApp,
      confirm,
    });

    const importSubtab = new ImportSubtab({
      ruleStore,
      deviceStore,
      scheduler: this.scheduler,
      importRuleEditor,
      notices: Notices,
      confirm,
      openOverflowMenu,
    });

    const exportSubtab = new ExportSubtab({
      ruleStore,
      deviceStore,
      scheduler: this.scheduler,
      exportRuleEditor,
      notices: Notices,
      confirm,
      openOverflowMenu,
    });

    // ------------------------------------------------------------------
    // 19. HeaderSection — always gets containerEl from SettingsTab.render()
    // ------------------------------------------------------------------
    const headerSection = new HeaderSection({
      plugin: this,
      // containerEl is supplied by SettingsTab when it calls render(containerEl);
      // this placeholder element satisfies the type contract and is never rendered
      // into — SettingsTab always passes the real target via render(containerEl).
      // `activeWindow` is an Obsidian runtime global; fall back to `window` in
      // test environments (jsdom) where activeWindow is not defined.
      containerEl: (typeof activeWindow !== "undefined" ? activeWindow : window).document.createElement("div"),
    });

    // ------------------------------------------------------------------
    // 20. SettingsTab
    // ------------------------------------------------------------------
    this.settingsTab = new HakobiSettingsTab(this.app, this, {
      headerSection,
      generalSubtab,
      importSubtab,
      exportSubtab,
    });

    // ------------------------------------------------------------------
    // 21. CommandRegistry
    // ------------------------------------------------------------------
    const commandRegistry = new CommandRegistry({
      plugin: this,
      scheduler: this.scheduler,
      ruleStore,
      notices: Notices,
    });
    commandRegistry.registerAll();

    // ------------------------------------------------------------------
    // 22. Register settings tab with Obsidian
    // ------------------------------------------------------------------
    this.addSettingTab(this.settingsTab);

    // ------------------------------------------------------------------
    // 23. Start the scheduler (kicks off timers for enabled rules)
    // ------------------------------------------------------------------
    await this.scheduler.start();

    // Trigger initial rotation check (best-effort — errors are swallowed so a
    // missing audit directory on first run does not surface as an unhandled
    // rejection).
    rotation.checkAndRotate({
      maxBytes: this.globalSettings.auditMaxBytes,
      retentionDays: this.globalSettings.auditRetentionDays,
    }).catch(() => undefined);
  }

  onunload(): void {
    this.scheduler?.stop();
  }
}
