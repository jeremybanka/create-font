import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createUiLayoutRpc } from "../src/server.ts"
import { prettyUiLayoutFile } from "../src/schema.ts"
import { fontLayout } from "./fixtures.ts"

describe("UI layout RPC", () => {
	it("exposes only product/origin contracts and reports conflicts", async () => {
		const root = await mkdtemp(join(tmpdir(), "ui-rpc-root-"))
		const home = await mkdtemp(join(tmpdir(), "ui-rpc-home-"))
		const app = createUiLayoutRpc({ root, home })
		const invalid = await app.handle(
			new Request("http://test/ui-layouts?product=../../etc"),
		)
		expect(invalid.status).toBe(400)
		const save = () =>
			app.handle(
				new Request("http://test/ui-layouts", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						product: "create-font",
						origin: "home",
						expectedRevision: null,
						layout: fontLayout,
					}),
				}),
			)
		expect((await save()).status).toBe(200)
		expect((await save()).status).toBe(409)
		const loaded = await app.handle(
			new Request("http://test/ui-layouts?product=create-font"),
		)
		expect((await loaded.json()).sources[0].layouts).toEqual([fontLayout])
	})

	it("uses the fixed Home contract through a symlinked config repository", async () => {
		const root = await mkdtemp(join(tmpdir(), "ui-rpc-root-"))
		const home = await mkdtemp(join(tmpdir(), "ui-rpc-home-"))
		const configRepository = await mkdtemp(join(tmpdir(), "ui-rpc-config-"))
		await mkdir(join(configRepository, "create-font"), { recursive: true })
		await symlink(configRepository, join(home, ".config"))
		const targetDirectory = await mkdtemp(join(tmpdir(), "ui-rpc-target-"))
		const target = join(targetDirectory, "font-ui.json")
		await writeFile(target, prettyUiLayoutFile([fontLayout]))
		const logical = join(configRepository, "create-font", "ui.json")
		await symlink(target, logical)
		const app = createUiLayoutRpc({ root, home })
		const loaded = await app.handle(
			new Request("http://test/ui-layouts?product=create-font"),
		)
		const loadedBody = await loaded.json()
		expect(loadedBody.sources[0].layouts).toEqual([fontLayout])
		const response = await app.handle(
			new Request("http://test/ui-layouts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					product: "create-font",
					origin: "home",
					expectedRevision: loadedBody.sources[0].revision,
					layout: { ...fontLayout, name: "RPC symlink" },
				}),
			}),
		)
		expect(response.status).toBe(200)
		expect((await lstat(logical)).isSymbolicLink()).toBe(true)
		expect(await readlink(logical)).toBe(target)
		expect(JSON.parse(await readFile(target, "utf8"))).toEqual([
			{ ...fontLayout, name: "RPC symlink" },
		])
		const traversal = await app.handle(
			new Request("http://test/ui-layouts?product=../../outside"),
		)
		expect(traversal.status).toBe(400)
	})

	it("reports a broken supported symlink as an I/O error", async () => {
		const root = await mkdtemp(join(tmpdir(), "ui-rpc-root-"))
		const home = await mkdtemp(join(tmpdir(), "ui-rpc-home-"))
		await symlink(join(home, "missing-config"), join(home, ".config"))
		const response = await createUiLayoutRpc({ root, home }).handle(
			new Request("http://test/ui-layouts?product=create-font"),
		)
		expect(response.status).toBe(500)
		expect((await response.json()).message).toMatch(/broken symbolic link/)
	})
})
