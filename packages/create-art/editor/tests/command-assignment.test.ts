import { describe, expect, it } from "vitest"

import {
	assignHotbarSlot,
	assignPaletteCommandToHotbar,
	hotbarSlotIndexForKeyboardEvent,
	normalizeHotbarSlots,
	parseHotbarSlots,
	swapHotbarSlots,
	type HotbarSlots,
} from "../src/index.ts"

const DEFAULT_SLOTS: HotbarSlots = [
	"select",
	"pen",
	"rect",
	"ellipse",
	"transform",
	"knife",
	"undo",
	"redo",
	"align-selection",
	"reverse-path",
	"make-node-first",
	"rule",
]

const keyEvent = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({
	code,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...modifiers,
})

describe("command assignment", () => {
	it("maps the twelve unmodified physical keys to stable slots", () => {
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Digit1"))).toBe(0)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Digit0"))).toBe(9)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Minus"))).toBe(10)
		expect(hotbarSlotIndexForKeyboardEvent(keyEvent("Equal"))).toBe(11)
		expect(
			hotbarSlotIndexForKeyboardEvent(keyEvent("Digit1", { shiftKey: true })),
		).toBeNull()
		expect(
			hotbarSlotIndexForKeyboardEvent(
				keyEvent("Digit1", { altKey: true }),
				"alternate",
			),
		).toBe(0)
		expect(
			hotbarSlotIndexForKeyboardEvent(keyEvent("Digit1"), "alternate"),
		).toBeNull()
	})

	it("assigns, clears, and swaps slots without changing their count", () => {
		const assigned = assignHotbarSlot(DEFAULT_SLOTS, 11, "add-glyphs")
		const cleared = assignHotbarSlot(assigned, 0, null)
		const swapped = swapHotbarSlots(cleared, 1, 11)

		expect(assigned[11]).toBe("add-glyphs")
		expect(cleared[0]).toBeNull()
		expect(swapped[1]).toBe("add-glyphs")
		expect(swapped[11]).toBe("pen")
		expect(swapped).toHaveLength(12)
	})

	it("round-trips valid layouts and rejects malformed recovery data", () => {
		expect(parseHotbarSlots(JSON.stringify(DEFAULT_SLOTS))).toEqual(
			DEFAULT_SLOTS,
		)
		expect(normalizeHotbarSlots(["select"])).toBeNull()
		expect(normalizeHotbarSlots([...DEFAULT_SLOTS.slice(0, 11), 42])).toBeNull()
		expect(parseHotbarSlots("not json")).toBeNull()
	})

	it("keeps drag assignment open while keyboard assignment completes the palette", () => {
		const drag = assignPaletteCommandToHotbar(
			DEFAULT_SLOTS,
			10,
			"add-glyphs",
			"drag",
		)
		const keyboard = assignPaletteCommandToHotbar(
			drag.slots,
			0,
			"pen",
			"keyboard",
		)

		expect(drag.closePalette).toBe(false)
		expect(drag.slots[10]).toBe("add-glyphs")
		expect(keyboard.closePalette).toBe(true)
		expect(keyboard.slots[0]).toBe("pen")
	})
})
