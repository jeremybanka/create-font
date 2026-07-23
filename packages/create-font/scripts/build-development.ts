import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const outdir = resolve(packageRoot, `dist/dev/public`)

await rm(outdir, { force: true, recursive: true })

const build = await Bun.build({
	conditions: [`development`],
	define: { __CREATE_FONT_DEVELOPMENT__: `false` },
	entrypoints: [
		resolve(packageRoot, `public/index.html`),
		resolve(packageRoot, `public/info/index.html`),
		resolve(packageRoot, `public/glyphs/index.html`),
	],
	outdir,
	splitting: true,
	target: `browser`,
})

const failures = build.success ? [] : build.logs
if (failures.length > 0) {
	for (const failure of failures) console.error(failure)
	process.exitCode = 1
}
