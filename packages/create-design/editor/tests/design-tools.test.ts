import { describe, expect, it } from "vitest"

import { DESIGN_TOOLS } from "../src/design-tools.ts"

describe("create-design tool registration", () => {
	it("does not expose the deferred Rule tool or its shortcut", () => {
		expect(Object.keys(DESIGN_TOOLS)).toEqual([
			"select",
			"direct",
			"transform",
			"artboard",
			"pen",
			"knife",
			"rect",
			"ellipse",
			"text",
			"area-text",
			"guide",
		])
		expect(DESIGN_TOOLS.artboard).toMatchObject({
			label: "Artboard",
			key: "B",
		})
		expect(DESIGN_TOOLS.knife).toMatchObject({
			label: "Knife",
			key: "K",
			paletteIcon: "HobbyKnifeIcon",
		})
		expect("rule" in DESIGN_TOOLS).toBe(false)
		expect(DESIGN_TOOLS.guide).toMatchObject({ label: "Guide", key: "G" })
		expect(
			Object.values(DESIGN_TOOLS).some((tool) => String(tool.key) === "L"),
		).toBe(false)
	})

	it("assigns every tool a unique case-insensitive shortcut", () => {
		const shortcuts = Object.values(DESIGN_TOOLS).map(({ key }) =>
			key.toLowerCase(),
		)
		expect(new Set(shortcuts).size).toBe(shortcuts.length)
		expect(DESIGN_TOOLS.direct.key).toBe("A")
		expect(DESIGN_TOOLS.artboard.key).toBe("B")
	})
})
