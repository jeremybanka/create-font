import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist/browser`)

await rm(resolve(packageRoot, `dist`), { force: true, recursive: true })

await build({
	configFile: false,
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	build: {
		emptyOutDir: true,
		lib: {
			cssFileName: `editor`,
			entry: resolve(packageRoot, `src/browser-build.ts`),
			fileName: `editor`,
			formats: [`es`],
		},
		minify: true,
		outDir: outdir,
		sourcemap: true,
	},
})
