import { rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, `..`)
const outdir = resolve(packageRoot, `dist`)

await rm(outdir, { force: true, recursive: true })

const builds = await Promise.all([
	Bun.build({
		entrypoints: [
			resolve(packageRoot, `src/cli.ts`),
			resolve(packageRoot, `src/rpc.ts`),
			resolve(packageRoot, `src/server.ts`),
		],
		outdir,
		sourcemap: `external`,
		target: `bun`,
	}),
	Bun.build({
		entrypoints: [resolve(packageRoot, `src/rpc-client.ts`)],
		outdir,
		sourcemap: `external`,
		target: `browser`,
	}),
	Bun.build({
		entrypoints: [
			resolve(packageRoot, `public/index.html`),
			resolve(packageRoot, `public/info/index.html`),
			resolve(packageRoot, `public/glyphs/index.html`),
		],
		outdir: resolve(outdir, `public`),
		splitting: true,
		target: `browser`,
	}),
	Bun.build({
		entrypoints: [resolve(packageRoot, `public/source-session.worker.ts`)],
		outdir: resolve(outdir, `public`),
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
