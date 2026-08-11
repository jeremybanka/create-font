import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { resolveApplicationAssets } from "../src/application-assets.ts"

const fixtures: string[] = []

async function fixture(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "create-font-assets-"))
	fixtures.push(root)
	return root
}

async function writeIndex(root: string): Promise<void> {
	await mkdir(root, { recursive: true })
	await writeFile(resolve(root, "index.html"), "<!doctype html>")
}

afterEach(async () => {
	await Promise.all(
		fixtures
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe("create-font application assets", () => {
	it("uses bundled production assets", async () => {
		const root = await fixture()
		const assets = resolve(root, "dist/public")
		await writeIndex(assets)

		await expect(resolveApplicationAssets(resolve(root, "dist"))).resolves.toBe(
			assets,
		)
	})

	it("prefers development assets when running from source", async () => {
		const root = await fixture()
		const development = resolve(root, "dist/dev/public")
		await writeIndex(development)
		await writeIndex(resolve(root, "dist/public"))

		await expect(resolveApplicationAssets(resolve(root, "src"))).resolves.toBe(
			development,
		)
	})

	it("falls back to production assets when running from source", async () => {
		const root = await fixture()
		const production = resolve(root, "dist/public")
		await writeIndex(production)

		await expect(resolveApplicationAssets(resolve(root, "src"))).resolves.toBe(
			production,
		)
	})

	it("fails clearly instead of mounting an empty static application", async () => {
		const root = await fixture()

		await expect(
			resolveApplicationAssets(resolve(root, "src")),
		).rejects.toThrow(/browser assets are missing.*Build create-font/su)
	})
})
