import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createUiLayoutRpc } from "../src/server.ts"
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
})
