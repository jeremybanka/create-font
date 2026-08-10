import { describe, expect, it } from "vitest"

import { DEFAULT_HOTBAR_SLOTS } from "../src/action-hotbar.ts"

describe("action hotbar", () => {
	it("places both shape tools in the default authoring group", () => {
		expect(DEFAULT_HOTBAR_SLOTS.slice(0, 5)).toEqual([
			"select",
			"pen",
			"rect",
			"ellipse",
			"transform",
		])
	})
})
