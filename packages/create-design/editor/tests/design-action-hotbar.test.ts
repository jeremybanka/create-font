import { describe, expect, it } from "vitest"

import { HOTBAR_KEYS, parseHotbarSlots } from "@create-art/editor"
import {
	DEFAULT_DESIGN_ALTERNATE_HOTBAR_SLOTS,
	DEFAULT_DESIGN_HOTBAR_SLOTS,
	DESIGN_ALTERNATE_HOTBAR_STORAGE_KEY,
	DESIGN_HOTBAR_STORAGE_KEY,
} from "../src/design-action-hotbar.ts"

describe("create-design action hotbar", () => {
	it("provides a complete application-specific authoring layout", () => {
		expect(DEFAULT_DESIGN_HOTBAR_SLOTS).toHaveLength(HOTBAR_KEYS.length)
		expect(DEFAULT_DESIGN_HOTBAR_SLOTS.slice(0, 6)).toEqual([
			"tool-select",
			"tool-direct",
			"tool-pen",
			"tool-rect",
			"tool-ellipse",
			"tool-transform",
		])
		expect(DESIGN_HOTBAR_STORAGE_KEY).toBe("create-design:action-hotbar:v1")
		expect(
			parseHotbarSlots(JSON.stringify(DEFAULT_DESIGN_HOTBAR_SLOTS)),
		).toEqual(DEFAULT_DESIGN_HOTBAR_SLOTS)
	})

	it("starts the independently persisted alternate hotbar empty", () => {
		expect(DEFAULT_DESIGN_ALTERNATE_HOTBAR_SLOTS).toHaveLength(
			HOTBAR_KEYS.length,
		)
		expect(
			DEFAULT_DESIGN_ALTERNATE_HOTBAR_SLOTS.every((slot) => slot === null),
		).toBe(true)
		expect(DESIGN_ALTERNATE_HOTBAR_STORAGE_KEY).toBe(
			"create-design:alternate-action-hotbar:v1",
		)
	})
})
