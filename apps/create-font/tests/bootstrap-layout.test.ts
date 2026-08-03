import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("bootstrap layout contract", () => {
	it("establishes border-box sizing before editor globals load", async () => {
		const css = await readFile(
			new URL("../public/bootstrap.css", import.meta.url),
			"utf8",
		)
		expect(css).toContain(
			"*,\n*::before,\n*::after {\n\tbox-sizing: border-box;",
		)
		expect(css.indexOf("box-sizing: border-box")).toBeLessThan(
			css.indexOf("bootstrap-screen {"),
		)
	})
})
