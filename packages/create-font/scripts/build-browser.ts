import { resolve } from "node:path"

import { build } from "vite"

export async function buildBrowserApplication(
	outdir: string,
	options: Readonly<{
		development?: boolean
		workspaceSources?: boolean
	}> = {},
): Promise<void> {
	const packageRoot = resolve(import.meta.dirname, `..`)
	const publicRoot = resolve(packageRoot, `public`)
	const development = options.development ?? false
	const workspaceSources = options.workspaceSources ?? false

	await build({
		configFile: false,
		define: {
			__CREATE_FONT_DEVELOPMENT__: JSON.stringify(development),
		},
		publicDir: false,
		resolve: workspaceSources
			? {
					alias: {
						"@create-font/editor/browser": resolve(
							packageRoot,
							`../font-editor/src/browser.ts`,
						),
					},
					conditions: [`development`],
				}
			: {},
		root: publicRoot,
		build: {
			assetsDir: ``,
			emptyOutDir: true,
			outDir: outdir,
			rollupOptions: {
				input: {
					glyphs: resolve(publicRoot, `glyphs/index.html`),
					index: resolve(publicRoot, `index.html`),
					info: resolve(publicRoot, `info/index.html`),
				},
				output: {
					assetFileNames: `[name].[ext]`,
					chunkFileNames: `chunks/[name]-[hash].js`,
					entryFileNames: `[name].js`,
				},
			},
		},
	})
}
