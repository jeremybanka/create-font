import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateFontSourceService } from "@create-font/server"
import { describe, expect, it, vi } from "vitest"

import { createFontServerApp } from "../src/server.ts"

describe(`create-font RPC`, () => {
	const source = (family: string): CreateFontSourceService => ({
		readManifest: vi.fn(async () => ({ revision: family, units: [] })),
		readSnapshot: vi.fn(async () => ({ revision: family, units: [] })),
		readUnit: vi.fn(),
		writeUnit: vi.fn(),
		writeUnits: vi.fn(),
	})

	it("mounts UI layouts at the workspace root instead of the selected font root", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "font-ui-layout-rpc-"))
		await mkdir(join(workspaceRoot, "fonts"))
		await writeFile(join(workspaceRoot, "fonts", "ui.json"), "{")
		const app = createFontServerApp({
			root: import.meta.dirname,
			workspaceRoot,
		})
		const response = await app.handle(
			new Request("http://localhost/api/ui-layouts?product=create-font"),
		)
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			sources: readonly {
				origin: string
				issues: readonly { file: string; path: string }[]
			}[]
		}
		expect(
			body.sources.find(({ origin }) => origin === "project")?.issues[0],
		).toMatchObject({
			file: join(workspaceRoot, "fonts", "ui.json"),
			path: "$",
		})
	})

	it(`composes health, workspace, and build operations with the editor app`, async () => {
		const app = createFontServerApp({ root: import.meta.dirname })

		const health = await app
			.handle(new Request(`http://localhost/api/health`))
			.then((response) => response.json())
		expect(health).toEqual({
			ok: true,
			rpcVersion: 7,
		})

		const workspace = await app
			.handle(new Request(`http://localhost/api/workspace`))
			.then((response) => response.json())
		expect(workspace.root).toBe(import.meta.dirname)

		const build = await app
			.handle(
				new Request(`http://localhost/api/build`, {
					method: `POST`,
				}),
			)
			.then((response) => response.json())
		expect(build).toEqual(
			expect.objectContaining({
				ok: false,
			}),
		)
	})

	it(`serves a deterministic workspace inventory and isolated font routes`, async () => {
		const alpha = source(`alpha-revision`)
		const beta = source(`beta-revision`)
		let betaAvailable = true
		const app = createFontServerApp({
			activeProjectId: `beta`,
			projects: [
				{
					id: `alpha`,
					name: `Alpha`,
					path: `fonts/alpha`,
					root: `/workspace/fonts/alpha`,
					source: alpha,
				},
				{
					available: () => betaAvailable,
					id: `beta`,
					name: `Beta`,
					path: `fonts/beta`,
					root: `/workspace/fonts/beta`,
					source: beta,
				},
			],
			root: `/workspace/fonts/beta`,
			source: beta,
			workspaceRoot: `/workspace`,
		})

		const workspace = await app
			.handle(new Request(`http://localhost/api/workspace`))
			.then((response) => response.json())
		expect(workspace).toEqual(
			expect.objectContaining({
				activeProjectId: `beta`,
				name: `workspace`,
				projects: [
					{ id: `alpha`, name: `Alpha`, path: `fonts/alpha` },
					{ id: `beta`, name: `Beta`, path: `fonts/beta` },
				],
			}),
		)
		await expect(
			app
				.handle(
					new Request(`http://localhost/projects/alpha/api/source/snapshot`),
				)
				.then((response) => response.json()),
		).resolves.toEqual({ revision: `alpha-revision`, units: [] })
		await expect(
			app
				.handle(
					new Request(`http://localhost/projects/beta/api/source/snapshot`),
				)
				.then((response) => response.json()),
		).resolves.toEqual({ revision: `beta-revision`, units: [] })

		betaAvailable = false
		await expect(
			app
				.handle(new Request(`http://localhost/api/workspace`))
				.then((response) => response.json()),
		).resolves.toEqual(
			expect.objectContaining({
				activeProjectId: `alpha`,
				projects: [{ id: `alpha`, name: `Alpha`, path: `fonts/alpha` }],
			}),
		)
		await expect(
			app.handle(
				new Request(`http://localhost/projects/beta/api/source/snapshot`),
			),
		).resolves.toMatchObject({ status: 404 })
		for (const path of [
			`/projects/missing/api/source/snapshot`,
			`/projects/%2E%2E/api/source/snapshot`,
			`/projects/%2Fworkspace/api/source/snapshot`,
		]) {
			const status = await app
				.handle(new Request(`http://localhost${path}`))
				.then((response) => response.status)
			expect(status).toBeGreaterThanOrEqual(400)
		}
	})

	it(`rejects a project mount outside the workspace font directory`, () => {
		expect(() =>
			createFontServerApp({
				activeProjectId: `alpha`,
				projects: [
					{
						id: `alpha`,
						name: `Alpha`,
						path: `fonts/alpha`,
						root: `/outside/alpha`,
						source: source(`alpha`),
					},
				],
				workspaceRoot: `/workspace`,
			}),
		).toThrow(`Font routes must stay inside the workspace fonts directory.`)
	})

	it.each([`..`, `../alpha`, `alpha/beta`, `alpha\\beta`])(
		`rejects unsafe font route identity %s`,
		(id) => {
			expect(() =>
				createFontServerApp({
					activeProjectId: id,
					projects: [
						{
							id,
							name: id,
							path: `fonts/${id}`,
							root: `/workspace/fonts/alpha`,
							source: source(id),
						},
					],
				}),
			).toThrow(`Font route identities cannot contain path segments.`)
		},
	)
})
