import { readFile } from "node:fs/promises"

import { describe, expect, test } from "vitest"

type WasmApi = {
	abiVersion(): number
	formatFea(source: string, configuration: string): string
	parseFea(source: string): string
}

const source = "# comment\nfeature liga{sub f i by f_i;}liga;"

describe("fea-rs WebAssembly bindings", () => {
	test("loads and parses in Node", async () => {
		const api =
			(await import("../dist/node/create_font_fea_rs_wasm.js")) as WasmApi
		const parsed = JSON.parse(api.parseFea(source)) as {
			abiVersion: number
			root: { type: string }
		}
		expect(api.abiVersion()).toBe(1)
		expect(parsed.abiVersion).toBe(1)
		expect(parsed.root.type).toBe("node")
		expect(api.formatFea(source, "{}")).toBe(
			"# comment\nfeature liga {\n  sub f i by f_i;\n} liga;\n",
		)
		expect(() =>
			api.formatFea("feature liga { sub f by ; } liga;", "{}"),
		).toThrow("cannot format malformed Adobe feature source")
	})

	test("loads the web binding from raw Wasm bytes", async () => {
		const web =
			(await import("../dist/web/create_font_fea_rs_wasm.js")) as WasmApi & {
				default(input: BufferSource): Promise<unknown>
			}
		const bytes = await readFile(
			new URL("../dist/web/create_font_fea_rs_wasm_bg.wasm", import.meta.url),
		)
		await web.default(bytes)
		expect(web.abiVersion()).toBe(1)
		expect(JSON.parse(web.parseFea(source))).toMatchObject({
			abiVersion: 1,
			sourceLen: source.length,
		})
		for (let iteration = 0; iteration < 250; iteration += 1) {
			expect(JSON.parse(web.parseFea(source)).abiVersion).toBe(1)
		}
	})
})
