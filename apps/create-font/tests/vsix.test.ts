import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { buildFeaVsix } from "../src/vsix.ts"

const roots: string[] = []

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe(`feature VSIX`, () => {
	it(`bundles the language client, server, and platform-independent parser Wasm`, async () => {
		const outdir = await mkdtemp(join(tmpdir(), `create-font-vsix-`))
		roots.push(outdir)
		const result = await buildFeaVsix({
			outdir,
			packageRoot: resolve(import.meta.dirname, `..`),
		})

		expect((await stat(result.vsixPath)).size).toBeGreaterThan(100_000)
		expect(
			(
				await stat(
					join(
						result.buildRoot,
						`dist`,
						`node_modules`,
						`@create-font`,
						`fea-rs-wasm`,
						`dist`,
						`node`,
						`create_font_fea_rs_wasm_bg.wasm`,
					),
				)
			).size,
		).toBeGreaterThan(100_000)
		expect(
			await readFile(join(result.buildRoot, `dist`, `server.mjs`), `utf8`),
		).toContain(`create-font-fea-lsp`)
	}, 30_000)
})
