// Module declaration for binary assets imported through esbuild's `dataurl`
// loader. The loader returns the asset as an inlined `data:` URI string, so the
// default export is typed as `string`.
//
// WHY this file exists: Hakobi inlines its plugin hanko into `main.js` at
// build time so that the official Obsidian Community Plugins installer and
// BRAT (`src/features/BetaPlugins.ts:31-35`) — which only fetch `main.js`,
// `manifest.json`, and `styles.css` — can install the plugin without 404'ing
// on a sibling `assets/*.png` file.

declare module "*.png" {
	const src: string;
	export default src;
}
