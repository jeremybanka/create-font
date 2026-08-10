import { parseHotbarSlots } from "@create-art/editor"
import { describe, expect, it } from "vitest"

import { DEFAULT_SPRITE_HOTBAR_SLOTS } from "../src/action-hotbar.ts"

describe("create-sprites action hotbar", () => {
	it("provides a complete default keyboard row", () => {
		expect(DEFAULT_SPRITE_HOTBAR_SLOTS).toHaveLength(12)
		expect(new Set(DEFAULT_SPRITE_HOTBAR_SLOTS).size).toBe(12)
	})

	it("round-trips through the shared persisted-slot contract", () => {
		expect(
			parseHotbarSlots(JSON.stringify(DEFAULT_SPRITE_HOTBAR_SLOTS)),
		).toEqual(DEFAULT_SPRITE_HOTBAR_SLOTS)
	})
})
