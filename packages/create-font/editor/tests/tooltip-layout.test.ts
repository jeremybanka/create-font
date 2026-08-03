import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("tooltip layout", () => {
	it("resets the browser popover inset before applying floating coordinates", async () => {
		const css = await readFile(
			new URL("../src/TooltipButton.module.css", import.meta.url),
			"utf8",
		)
		const tooltipRule = css.match(/> tooltip-popover \{(?<rule>[\s\S]*?)\n\t\}/)

		expect(tooltipRule?.groups?.rule).toContain("inset: auto;")
	})
})
