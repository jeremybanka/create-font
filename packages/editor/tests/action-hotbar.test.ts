import { describe, expect, it } from "vitest"

import {
	assignHotbarSlot,
	assignPaletteCommandToHotbar,
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
	it("places both shape tools in the default authoring group", () => {
		expect(DEFAULT_HOTBAR_SLOTS.slice(0, 5)).toEqual([
			"select",
			"pen",
			"rect",
			"ellipse",
			"transform",
		])
	})

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

	it("keeps drag assignment open while keyboard assignment completes the palette", () => {
		const firstDrag = assignPaletteCommandToHotbar(
			DEFAULT_HOTBAR_SLOTS,
			10,
			"add-glyphs",
			"drag",
		)
		const secondDrag = assignPaletteCommandToHotbar(
			firstDrag.slots,
			11,
			"rect",
			"drag",
		)
		const keyboard = assignPaletteCommandToHotbar(
			secondDrag.slots,
			0,
			"pen",
			"keyboard",
		)

		expect(firstDrag.closePalette).toBe(false)
		expect(secondDrag.slots.slice(10)).toEqual(["add-glyphs", "rect"])
		expect(secondDrag.closePalette).toBe(false)
		expect(keyboard.closePalette).toBe(true)
		expect(keyboard.slots[0]).toBe("pen")
	})
})
