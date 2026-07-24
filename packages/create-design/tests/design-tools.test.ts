import { describe, expect, it } from "vitest"

import { DESIGN_TOOLS } from "../src/design-tools.ts"

describe("create-design tool registration", () => {
	it("does not expose the deferred Rule tool or its shortcut", () => {
		expect(Object.keys(DESIGN_TOOLS)).toEqual([
			"select",
			"transform",
			"pen",
			"rect",
			"ellipse",
		])
		expect("rule" in DESIGN_TOOLS).toBe(false)
		expect(
			Object.values(DESIGN_TOOLS).some((tool) => String(tool.key) === "L"),
		).toBe(false)
	})
})
