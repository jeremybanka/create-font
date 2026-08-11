import { describe, expect, it } from "vitest"

import {
	ALTERNATE_HOTBAR_STORAGE_KEY,
	DEFAULT_ALTERNATE_HOTBAR_SLOTS,
	DEFAULT_HOTBAR_SLOTS,
} from "../src/action-hotbar.ts"

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

	it("starts the independently persisted alternate hotbar empty", () => {
		expect(DEFAULT_ALTERNATE_HOTBAR_SLOTS).toHaveLength(12)
		expect(DEFAULT_ALTERNATE_HOTBAR_SLOTS.every((slot) => slot === null)).toBe(
			true,
		)
		expect(ALTERNATE_HOTBAR_STORAGE_KEY).toBe(
			"create-font:alternate-action-hotbar:v1",
		)
	})
})
