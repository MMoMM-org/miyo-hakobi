# [0.2.0](https://github.com/MMoMM-org/miyo-hakobi/compare/0.1.3...0.2.0) (2026-05-08)


### Features

* **settings:** inline hanko as data URI for BRAT/manual install compat ([0351722](https://github.com/MMoMM-org/miyo-hakobi/commit/0351722b8fdd3ba37cf98d2a94f5b51f33b10e5e))

## [0.1.3](https://github.com/MMoMM-org/miyo-hakobi/compare/0.1.2...0.1.3) (2026-05-07)


### Bug Fixes

* **settings:** drop # from tags placeholder for sentence-case rule ([9dcf304](https://github.com/MMoMM-org/miyo-hakobi/commit/9dcf3042e4b714c74dc0aaba6c2f7f763530162f)), closes [#Project](https://github.com/MMoMM-org/miyo-hakobi/issues/Project)

## [0.1.2](https://github.com/MMoMM-org/miyo-hakobi/compare/0.1.1...0.1.2) (2026-05-07)


### Bug Fixes

* **plugin-review:** address ObsidianReviewBot findings ([83c6a4f](https://github.com/MMoMM-org/miyo-hakobi/commit/83c6a4f5480ed35465f915aaea9be922bd7bac2c)), closes [obsidianmd/obsidian-releases#12587](https://github.com/obsidianmd/obsidian-releases/issues/12587)

## [0.1.1](https://github.com/MMoMM-org/miyo-hakobi/compare/0.1.0...0.1.1) (2026-05-06)


### Bug Fixes

* **manifest:** align description with community-plugins.json entry ([5ac2053](https://github.com/MMoMM-org/miyo-hakobi/commit/5ac2053166d8c229a51edb0fc0ce0c1039d6deae)), closes [obsidianmd/obsidian-releases#12587](https://github.com/obsidianmd/obsidian-releases/issues/12587)

# [0.1.0](https://github.com/MMoMM-org/miyo-hakobi/compare/0.0.0...0.1.0) (2026-05-06)


### Bug Fixes

* **audit:** remove unspecified numeric range validation (T1.6) ([b4f186b](https://github.com/MMoMM-org/miyo-hakobi/commit/b4f186b1b3ad8f69633401e6b2af30c0998677ed))
* **ci:** point release pipeline at the main branch ([5651898](https://github.com/MMoMM-org/miyo-hakobi/commit/5651898bfdb350997430b853c0c89e4ff57d23c0))
* **ci:** route all logging through allowlisted log.* wrapper ([ecb66e4](https://github.com/MMoMM-org/miyo-hakobi/commit/ecb66e4d025b597983cec4036543d342bd931bd2))
* **domain:** address sanitize code-quality review (T1.1) ([5bbfd89](https://github.com/MMoMM-org/miyo-hakobi/commit/5bbfd89118e7c0aa064950772094331954c602f4))
* **domain:** correct sanitize byte-cap and dead-code regex (T1.1 review) ([b1f15cb](https://github.com/MMoMM-org/miyo-hakobi/commit/b1f15cb30deb489f82a2fcec86bb5374cb8f092b))
* **domain:** tighten rule validation per code-quality review (T1.4) ([6d5eced](https://github.com/MMoMM-org/miyo-hakobi/commit/6d5ecedbade071ab59d9559d9318ad03bdd2f633))
* **fs:** address PathSafe code-quality review (T1.5) ([bf06925](https://github.com/MMoMM-org/miyo-hakobi/commit/bf0692518ea2aa199ae40141b778117f42b59eae))
* **fs:** collapse IoDiskFullError into IoUnknownError per T1.7 spec ([f666025](https://github.com/MMoMM-org/miyo-hakobi/commit/f6660254eae2d52525dbd4796884333cba3d5396))
* **lifecycle:** explicit timer + DOM listener assertions (T4.1) ([f4ffa86](https://github.com/MMoMM-org/miyo-hakobi/commit/f4ffa86c2be7c130cbb1b97a6cd4577e28fd7e6b))
* **main:** live-month audit path + closure stabilityCheckMs (T3.11) ([44a4428](https://github.com/MMoMM-org/miyo-hakobi/commit/44a44282fc7b2c9a3f2e3a1b6329464798660ae7))
* **persistence:** null-safe ruleEnablement guard + cover recovery branches (T2.2 review) ([2ee76e7](https://github.com/MMoMM-org/miyo-hakobi/commit/2ee76e7459267b73061b66c126f7a35ede9de30c))
* **persistence:** sync rules in loadGlobalSettings (T2.1 review) ([0a5f706](https://github.com/MMoMM-org/miyo-hakobi/commit/0a5f706cd955aa0df8b402483c7877795f4c73c8))
* **persist:** vault-relative path for DeviceStore + add vault folder picker ([6cfc79c](https://github.com/MMoMM-org/miyo-hakobi/commit/6cfc79c6378e1325283f451fe87be4ce78c85c03))
* **runner:** audit lstat failures + assertNever scope violations (T2.5 review) ([9c5176b](https://github.com/MMoMM-org/miyo-hakobi/commit/9c5176b88639ea506f53af80f8221b041b2119ba))
* **runner:** correct rule-partial summary operation + drop dead deps (T2.6 review) ([ced0357](https://github.com/MMoMM-org/miyo-hakobi/commit/ced035754797475aca6d059857df0483dc193403))
* **runner:** map ScopeViolation reason to specific audit errorCode ([a05ee04](https://github.com/MMoMM-org/miyo-hakobi/commit/a05ee0404cf745732c058c0895f3293d043336b9))
* **scheduler:** wire registerInterval cleanup in mock + assert _runCleanup (T2.4) ([bb4fa24](https://github.com/MMoMM-org/miyo-hakobi/commit/bb4fa2442cfd482dbe277a4cb8a88621d775b60c))
* **scheduler:** wire subtab mutations to scheduler hooks ([c64c34d](https://github.com/MMoMM-org/miyo-hakobi/commit/c64c34d78e901eed4e0661a23314aee2009dd1ea))
* **settings:** Browse updates input + drop dead helper (T3.7 review) ([51d6eb8](https://github.com/MMoMM-org/miyo-hakobi/commit/51d6eb85f9751321fbd3bc14b0434f73fcfa7797))
* **settings:** explicit headerSection.render(containerEl) contract (T3.10) ([acb6148](https://github.com/MMoMM-org/miyo-hakobi/commit/acb6148063546579a416738962de6ec32337de7a))
* **settings:** guard authorUrl anchor + drop dead null guard (T3.4 review) ([47216e4](https://github.com/MMoMM-org/miyo-hakobi/commit/47216e4ed6837115b866267f4056eeeb4fda13d1))
* **settings:** show inline error for validateRule failures (T3.6 review) ([5111c58](https://github.com/MMoMM-org/miyo-hakobi/commit/5111c58c5ba83e9961bf2b3f6be57e3f686aca25))
* **settings:** tighten numeric input validation (T3.5 review) ([cefe38e](https://github.com/MMoMM-org/miyo-hakobi/commit/cefe38ef6b2626062e60684b1ebc79a1e723c1a4))
* **settings:** wire run notices + cover async isEnabled in ExportSubtab (T3.9 review) ([c911763](https://github.com/MMoMM-org/miyo-hakobi/commit/c911763cf50d548efad358b6c7ff01c98ac58cf5))
* **test:** drop vacuous URL-literal grep patterns from Phase 1 invariants (T1.11) ([49ab24c](https://github.com/MMoMM-org/miyo-hakobi/commit/49ab24c60286bf5d5f7e28eafc54ba51a0a9d3b5))
* **types:** drop unspecified eval test and DEFAULT_GLOBAL_SETTINGS per T1.11 spec ([7c42884](https://github.com/MMoMM-org/miyo-hakobi/commit/7c4288425e9f0db410fb94a46a8096db034e2aca))
* **ui:** defer undefined-resolution in pickers so onChooseItem can win the race ([0172d89](https://github.com/MMoMM-org/miyo-hakobi/commit/0172d8925c02a4754fb20b644fa9589ee81dc68d))
* **ui:** preserve this-binding when invoking Obsidian DOM helpers ([8f7223d](https://github.com/MMoMM-org/miyo-hakobi/commit/8f7223dbe92822d442e5e507121c7c5dc603110e))
* **ui:** show-audit-log button uses vault-relative path ([a48735c](https://github.com/MMoMM-org/miyo-hakobi/commit/a48735c6d1b82f9b05a3a87f0053f5a74842df86))
* **vault:** drop unused not-file variant per T1.8 spec compliance ([c863f2e](https://github.com/MMoMM-org/miyo-hakobi/commit/c863f2e21fb4332e7b974e09409cc841aa1c9cf8))
* **vault:** guard writeBinary against TFolder collisions (T1.8) ([3dd3bec](https://github.com/MMoMM-org/miyo-hakobi/commit/3dd3bec71a44c3a47394f4e30dfad85211b6cd00))
* **vault:** preserve leading slash in resolveVaultPath ([7556578](https://github.com/MMoMM-org/miyo-hakobi/commit/75565787fd84eee52929f26ef8f2129c6f75f02c))


### Features

* **audit:** add AuditEntry types + serialize/parse (T1.6) ([51ca203](https://github.com/MMoMM-org/miyo-hakobi/commit/51ca203f22ac0605395392e894c98d122d44c6ad)), closes [Models#AuditEntry](https://github.com/Models/issues/AuditEntry)
* **audit:** add AuditLog with NDJSON append/iterate/purge + Rotation policy (T1.10) ([37c62ee](https://github.com/MMoMM-org/miyo-hakobi/commit/37c62eea3fd1ba3025a5c13377b98334e127beba))
* **domain:** add default-deny scope checks (T1.2) ([f787ed9](https://github.com/MMoMM-org/miyo-hakobi/commit/f787ed993f6a79ce0173f5cd2c985f0f3896e75a))
* **domain:** add filename sanitization (T1.1) ([cfbb096](https://github.com/MMoMM-org/miyo-hakobi/commit/cfbb0967f00b745133ebe5913eec31359ea6a740))
* **domain:** add rule schema and validator (T1.4) ([321d0e8](https://github.com/MMoMM-org/miyo-hakobi/commit/321d0e839d8285e86ddddb2be46cec6b15afcd41))
* **domain:** add ruleId UUID v4 generator (T1.3) ([edd61b6](https://github.com/MMoMM-org/miyo-hakobi/commit/edd61b6145f6a1e0374a5b89a124583c5a45adb1))
* **fs:** add NodeFs adapter with global IO timeout (T1.7) ([eb2b2f1](https://github.com/MMoMM-org/miyo-hakobi/commit/eb2b2f12343496839382d5ff175add892b33a1b7))
* **fs:** add PathSafe path expansion + normalization (T1.5) ([13fc3bc](https://github.com/MMoMM-org/miyo-hakobi/commit/13fc3bc3c5b9b3ea7f6838988c8646d9f198d78e))
* **main:** rewire HakobiPlugin with full Phase 1-3 lifecycle (T3.11) ([2b8273b](https://github.com/MMoMM-org/miyo-hakobi/commit/2b8273b5b3620d8ae607bbc82953d8785e1a5bfd))
* **persistence:** add DeviceStore (T2.2) ([00dd619](https://github.com/MMoMM-org/miyo-hakobi/commit/00dd6199ec7d02c6743e101835d004ff13839c34))
* **persistence:** add RuleStore (T2.1) ([27ca1a8](https://github.com/MMoMM-org/miyo-hakobi/commit/27ca1a8832def45c0564f6d2cde82a793c299371))
* **runner:** add AtomicWriter for temp-then-rename + collision suffix (T1.9) ([dc0dba2](https://github.com/MMoMM-org/miyo-hakobi/commit/dc0dba2ca875db2fab9ecf163e3998fe2a53c6f6))
* **runner:** add ExportRunner with folder/tag/note dispatch + mtime preserve (T2.6) ([53d2100](https://github.com/MMoMM-org/miyo-hakobi/commit/53d2100b955a5aabc13e9d4b53b2ece39d896a40))
* **runner:** add ImportRunner with sanitize/scope/atomic write (T2.5) ([702416b](https://github.com/MMoMM-org/miyo-hakobi/commit/702416b61185ac9a4bdb7946ca97e553f303d3b3))
* **runner:** return RunStats so scheduler can log file counts ([611f9ab](https://github.com/MMoMM-org/miyo-hakobi/commit/611f9abbaaf1fdcfd5c66522e9235a7de4e3a237))
* **scheduler:** add InFlightRegistry (T2.3) ([eb1799d](https://github.com/MMoMM-org/miyo-hakobi/commit/eb1799d5bd8aec8f09c4a8bf575c556acf6fb846))
* **scheduler:** add Scheduler with overlap-skip + reschedule (T2.4) ([29732f4](https://github.com/MMoMM-org/miyo-hakobi/commit/29732f4ff393a529586730a4ae30ae80f8eb6208))
* **scheduler:** initial run on plugin start with grace period ([3fb869c](https://github.com/MMoMM-org/miyo-hakobi/commit/3fb869ce9689acce76971fab4bf704b34e3dab92))
* **settings:** add ExportRuleEditor with folder/tag/note variants (T3.7) ([99b06ba](https://github.com/MMoMM-org/miyo-hakobi/commit/99b06ba687fff61d885b0c6befba52afbd446dc1))
* **settings:** add ExportSubtab with source-type-specific summaries (T3.9) ([f36d93d](https://github.com/MMoMM-org/miyo-hakobi/commit/f36d93d3baffe8d9c1dd93d912268f823d67c496))
* **settings:** add GeneralSubtab with global settings + audit-log buttons (T3.5) ([007cda5](https://github.com/MMoMM-org/miyo-hakobi/commit/007cda5a9b61d11af544843968b520755adf0d95))
* **settings:** add HeaderSection with manifest-driven content (T3.4) ([91a949a](https://github.com/MMoMM-org/miyo-hakobi/commit/91a949aa570e369e473efb45a6d6a1003108c1ea))
* **settings:** add ImportRuleEditor (T3.6) ([39b19aa](https://github.com/MMoMM-org/miyo-hakobi/commit/39b19aac86896ad3d217da4e3fe05adfd054933a))
* **settings:** add SettingsTab orchestrator with header + 3 subtabs (T3.10) ([762c3b0](https://github.com/MMoMM-org/miyo-hakobi/commit/762c3b04809f14e2bd74881f832ac2cb6ee87c05))
* **settings:** ADR-10 settings redesign + DOM listener lifecycle ([af62abc](https://github.com/MMoMM-org/miyo-hakobi/commit/af62abc15782db3435031a7c9b828f330a49e772))
* **types:** re-export Phase 1 surface + add Phase 1 invariant tests (T1.11) ([833a582](https://github.com/MMoMM-org/miyo-hakobi/commit/833a582213011140d92a6f40116ece630b742eff))
* **ui:** add CommandRegistry with 7 PRD/F7 commands (T3.3) ([e68bc40](https://github.com/MMoMM-org/miyo-hakobi/commit/e68bc40d278c8a719ff6b0b8c935ab872141ae3b))
* **ui:** add Notices helper for centralized user-facing copy (T3.1) ([385c21e](https://github.com/MMoMM-org/miyo-hakobi/commit/385c21e1c7b99ac2999c8934d579159372e23219))
* **ui:** add StatusBar with idle/running/failed states (T3.2) ([d3a368b](https://github.com/MMoMM-org/miyo-hakobi/commit/d3a368b6dd303cd63d956799b9bf178caec28d8d))
* **ui:** wire folder picker + rule picker; honest F12 defer ([ca8d5c6](https://github.com/MMoMM-org/miyo-hakobi/commit/ca8d5c6125f7cd3053c78c6eafa19413409779dd))
* **vault:** add VaultIo adapter for Obsidian Vault API (T1.8) ([6084ded](https://github.com/MMoMM-org/miyo-hakobi/commit/6084dedddaa30ccfd388b8a0a0a48e3fc30dddc4))
