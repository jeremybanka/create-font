import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist/browser`)

await rm(resolve(packageRoot, `dist`), { force: true, recursive: true })

await build({
	configFile: false,
	build: {
		emptyOutDir: true,
		lib: {
			cssFileName: `editor`,
			entry: {
				editor: resolve(packageRoot, `src/browser.ts`),
				shared: resolve(packageRoot, `src/shared.ts`),
			},
			fileName: (_format, entryName) => entryName,
			formats: [`es`],
		},
		minify: true,
		outDir: outdir,
		sourcemap: true,
	},
})
