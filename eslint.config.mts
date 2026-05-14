import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...tseslint.configs.recommendedTypeChecked,
	...obsidianmd.configs.recommended,
	globalIgnores([
		"node_modules",
		"coverage",
		"dist",
		"build",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"vitest.config.ts",
		"vitest.live.config.ts",
		"main.js",
		"test/__mocks__/**",
		"test/**/*.test.ts",
		"test/**/helpers.ts",
		"test/live/_helpers/**",
		"test/fixtures/**",
		// eslint-disable-next-line obsidianmd/hardcoded-config-path -- glob pattern for test fixtures; Vault#configDir is unavailable at lint time
		"test/*/.obsidian/**",
		"claude-docker-home/**",
	]),
);
