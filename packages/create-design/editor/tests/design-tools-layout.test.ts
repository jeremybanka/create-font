import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("create-design tools layout", () => {
	it("packs square icon controls into a wrapping toolbar", async () => {
		const css = await readFile(
			new URL("../src/DesignTileContent.module.css", import.meta.url),
			"utf8",
		)
		const toolbar = css.match(/> design-tools-tile \{(?<rule>[\s\S]*?)\n\t\}/)
			?.groups?.rule
		expect(toolbar).toContain("display: flex;")
		expect(toolbar).toContain("flex-wrap: wrap;")
		expect(toolbar).toContain("width: 28px;")
		expect(toolbar).toContain("height: 28px;")
	})
})
