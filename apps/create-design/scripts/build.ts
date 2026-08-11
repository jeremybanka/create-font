import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

const externalPackage = /^[^./]|^\.[^./]|^\.\.[^/]/

await Promise.all([
	build({
		configFile: false,
		build: {
			emptyOutDir: false,
			lib: {
				entry: {
					"create-design-cli": resolve(packageRoot, `src/create-design-cli.ts`),
					"design-cli": resolve(packageRoot, `src/design-cli.ts`),
				},
				fileName: (_format, entryName) => `${entryName}.js`,
				formats: [`es`],
			},
			outDir: outdir,
			rollupOptions: { external: externalPackage },
			sourcemap: true,
			target: `node22`,
		},
	}),
	build({
		configFile: resolve(packageRoot, `vite.config.ts`),
		build: {
			// The editor is a single-route application whose production bundle is
			// intentionally loaded as one chunk.
			chunkSizeWarningLimit: 1_400,
			emptyOutDir: false,
			minify: true,
			outDir: outdir,
			// HarfBuzz's universal wrapper dynamically imports this only in Node.
			// Keep it external in this browser-only build so Vite does not shim it.
			rolldownOptions: { external: ["module"] },
			sourcemap: true,
			target: `es2024`,
		},
	}),
])
