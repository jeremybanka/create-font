import { readFile } from "node:fs/promises"

import { describe, expect, test } from "vitest"

describe("Create Design Vello Hybrid WebAssembly bindings", () => {
	test("exports the versioned browser scene ABI", async () => {
		const web = (await import("../dist/web/create_design_vello_wasm.js")) as {
			default(input: { module_or_path: BufferSource }): Promise<unknown>
			abiVersion(): number
		}
		const bytes = await readFile(
			new URL("../dist/web/create_design_vello_wasm_bg.wasm", import.meta.url),
		)
		await web.default({ module_or_path: bytes })
		expect(web.abiVersion()).toBe(1)
	})
})
