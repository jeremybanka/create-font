import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "vite"

const packageRoot = resolve(import.meta.dirname, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

await build({
	configFile: resolve(packageRoot, `vite.config.ts`),
	build: {
		emptyOutDir: true,
		minify: true,
		outDir: outdir,
		sourcemap: true,
		target: `es2024`,
	},
})
