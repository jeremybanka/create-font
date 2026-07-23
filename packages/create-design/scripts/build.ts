import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

const result = await Bun.build({
	conditions: [`development`],
	entrypoints: [resolve(packageRoot, `public/index.html`)],
	minify: true,
	outdir,
	splitting: true,
	target: `browser`,
})

if (!result.success) {
	for (const failure of result.logs) console.error(failure)
	process.exitCode = 1
}
