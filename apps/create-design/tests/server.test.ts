import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "vitest"

import { createDesignServerApp } from "../src/server.ts"
import { initializeDesignSourceWorkspace } from "../src/source-service.ts"

describe(`create-design workspace RPC`, () => {
	test(`opens a trusted directory and serves a coherent source snapshot`, async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-server-`))
		const assets = await mkdtemp(join(tmpdir(), `create-design-assets-`))
		await writeFile(join(assets, `index.html`), `<h1>create-design</h1>`)
		const app = await createDesignServerApp({ assets, root })
		const health = await app.handle(new Request(`http://localhost/api/health`))
		expect(health.status).toBe(200)
		expect(await health.json()).toEqual({ ok: true, rpcVersion: 2 })
		const workspace = await app.handle(
			new Request(`http://localhost/api/workspace`),
		)
		expect(workspace.status).toBe(200)
		expect(await workspace.json()).toEqual({
			name: root.split(`/`).at(-1),
			activeProjectId: root.split(`/`).at(-1),
			projects: [
				{
					id: root.split(`/`).at(-1),
					name: root.split(`/`).at(-1),
					path: ".",
				},
			],
		})

		const response = await app.handle(
			new Request(`http://localhost/api/source/snapshot`),
		)
		expect(response.status).toBe(200)
		const snapshot = (await response.json()) as {
			revision: string
			units: readonly { path: string }[]
		}
		expect(snapshot.revision).toMatch(/^sha256:/)
		expect(
			snapshot.units.some(({ path }) => path === `create-design.json`),
		).toBe(true)
		const missingAsset = await app.handle(
			new Request(
				`http://localhost/api/source/asset?path=assets%2Fmissing.bin`,
			),
		)
		expect(missingAsset.status).toBe(404)
		expect(await missingAsset.json()).toMatchObject({
			code: `source.asset_not_found`,
		})
		const unavailableComparison = await app.handle(
			new Request(`http://localhost/api/source/comparison?baseRef=HEAD`),
		)
		expect(unavailableComparison.status).toBe(503)
		expect(await unavailableComparison.json()).toMatchObject({
			code: `source.git_unavailable`,
		})
		const application = await app.handle(new Request(`http://localhost/`))
		expect(application.status).toBe(200)
		expect(await application.text()).toContain(`create-design`)
	})

	test("serves isolated source sessions for every discovered design", async () => {
		const root = await mkdtemp(join(tmpdir(), `create-design-workspace-`))
		await Promise.all([
			initializeDesignSourceWorkspace(join(root, "designs", "alpha")),
			initializeDesignSourceWorkspace(join(root, "designs", "beta")),
		])
		const app = await createDesignServerApp({ root })
		const inventory = await app.handle(
			new Request("http://localhost/api/workspace"),
		)
		expect(await inventory.json()).toMatchObject({
			activeProjectId: "alpha",
			projects: [{ id: "alpha" }, { id: "beta" }],
		})
		for (const id of ["alpha", "beta"]) {
			const response = await app.handle(
				new Request(`http://localhost/projects/${id}/api/source/snapshot`),
			)
			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({
				revision: expect.any(String),
			})
		}
	})
})
