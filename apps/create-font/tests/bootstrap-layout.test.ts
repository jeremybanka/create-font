import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("bootstrap layout contract", () => {
	it("holds the editor canvas geometry and color before its artifact loads", async () => {
		const css = await readFile(
			new URL("../public/bootstrap.css", import.meta.url),
			"utf8",
		)
		expect(css).toContain(
			"html,\nbody,\n#app {\n\tdisplay: block;\n\twidth: 100%;\n\theight: 100%;",
		)
		expect(css).toContain("background: #1c1d1a;")
		expect(css).toContain("background: #f4f3ef;")
		expect(css).not.toContain("bootstrap-screen")
	})
})
