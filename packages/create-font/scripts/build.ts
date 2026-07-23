import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

const builds = await Promise.all([
	Bun.build({
		define: { __CREATE_FONT_DEVELOPMENT__: `false` },
		entrypoints: [
			resolve(packageRoot, `src/create-font-cli.ts`),
			resolve(packageRoot, `src/font-cli.ts`),
			resolve(packageRoot, `src/rpc.ts`),
			resolve(packageRoot, `src/server.ts`),
		],
		external: [`@create-font/*`],
		outdir,
		packages: `external`,
		sourcemap: `external`,
		target: `bun`,
	}),
	Bun.build({
		define: { __CREATE_FONT_DEVELOPMENT__: `false` },
		entrypoints: [resolve(packageRoot, `src/rpc-client.ts`)],
		external: [`@create-font/*`],
		outdir,
		packages: `external`,
		sourcemap: `external`,
		target: `browser`,
	}),
	Bun.build({
		define: { __CREATE_FONT_DEVELOPMENT__: `false` },
		entrypoints: [
			resolve(packageRoot, `public/index.html`),
			resolve(packageRoot, `public/info/index.html`),
			resolve(packageRoot, `public/glyphs/index.html`),
		],
		outdir: resolve(outdir, `public`),
		splitting: true,
		target: `browser`,
	}),
])

const failures = builds.flatMap((build) => (build.success ? [] : build.logs))
if (failures.length > 0) {
	for (const failure of failures) {
		console.error(failure)
	}
	process.exitCode = 1
}
