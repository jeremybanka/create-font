import { describe, expect, it } from "vitest"

import {
	assignHotbarSlot,
	DEFAULT_HOTBAR_SLOTS,
	hotbarSlotIndexForKeyboardEvent,
	normalizeHotbarSlots,
	parseHotbarSlots,
	swapHotbarSlots,
} from "../src/action-hotbar.ts"

const keyEvent = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({
	code,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...modifiers,
})

describe("action hotbar", () => {
	it("maps the twelve unmodified physical keys to stable slots", () => {
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Digit1"))).toBe(0)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Digit0"))).toBe(9)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Minus"))).toBe(10)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Equal"))).toBe(11)
		expect(
			hotbarSlotIndexForKeyboardEvent(keyEvent("Digit1", { shiftKey: true })),
		).toBeNull()
	})

	it("assigns, clears, and swaps slots without changing their count", () => {
		const assigned = assignHotbarSlot(DEFAULT_HOTBAR_SLOTS, 11, "add-glyphs")
		const cleared = assignHotbarSlot(assigned, 0, null)
		const swapped = swapHotbarSlots(cleared, 1, 11)

		expect(assigned[11]).toBe("add-glyphs")
		expect(cleared[0]).toBeNull()
		expect(swapped[1]).toBe("add-glyphs")
		expect(swapped[11]).toBe("pen")
		expect(swapped).toHaveLength(12)
	})

	it("round-trips valid layouts and rejects malformed recovery data", () => {
		expect(parseHotbarSlots(JSON.stringify(DEFAULT_HOTBAR_SLOTS))).toEqual(
			DEFAULT_HOTBAR_SLOTS,
		)
		expect(normalizeHotbarSlots(["select"])).toBeNull()
		expect(
			normalizeHotbarSlots([...DEFAULT_HOTBAR_SLOTS.slice(0, 11), 42]),
		).toBeNull()
		expect(parseHotbarSlots("not json")).toBeNull()
	})
})
