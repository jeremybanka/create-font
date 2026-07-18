import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const outdir = resolve(packageRoot, `dist/browser`)

await rm(resolve(packageRoot, `dist`), { force: true, recursive: true })

const result = await Bun.build({
	entrypoints: [resolve(packageRoot, `src/browser.ts`)],
	minify: true,
	naming: {
		asset: `[name].[ext]`,
		entry: `editor.[ext]`,
	},
	outdir,
	sourcemap: `external`,
	target: `browser`,
})

if (!result.success) {
	for (const failure of result.logs) console.error(failure)
	process.exitCode = 1
}
