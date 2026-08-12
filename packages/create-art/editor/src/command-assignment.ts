export const HOTBAR_KEYS = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"0",
	"-",
	"=",
] as const

export type HotbarKey = (typeof HOTBAR_KEYS)[number]
export type HotbarSlot = string | null
export type HotbarSlots = readonly HotbarSlot[]
export type HotbarAssignmentMethod = "drag" | "keyboard"
export type HotbarKind = "primary" | "alternate"

export interface HotbarAssignmentResult {
	readonly slots: HotbarSlots
	readonly closePalette: boolean
}

export const HOTBAR_COMMAND_MIME = "application/x-create-art-command"

const HOTBAR_CODES = [
	"Digit1",
	"Digit2",
	"Digit3",
	"Digit4",
	"Digit5",
	"Digit6",
	"Digit7",
	"Digit8",
	"Digit9",
	"Digit0",
	"Minus",
	"Equal",
] as const

interface HotbarKeyboardEvent {
	readonly code: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly shiftKey: boolean
	readonly altKey: boolean
}

export function hotbarSlotIndexForKeyboardEvent(
	event: HotbarKeyboardEvent,
	kind: HotbarKind = "primary",
): number | null {
	if (
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		(kind === "primary" ? event.altKey : !event.altKey)
	)
		return null
	const index = HOTBAR_CODES.indexOf(
		event.code as (typeof HOTBAR_CODES)[number],
	)
	return index < 0 ? null : index
}

export const EMPTY_HOTBAR_SLOTS: HotbarSlots = HOTBAR_KEYS.map(() => null)

export function normalizeHotbarSlots(value: unknown): HotbarSlots | null {
	if (!Array.isArray(value) || value.length !== HOTBAR_KEYS.length) return null
	if (
		value.some(
			(slot) =>
				slot !== null && (typeof slot !== "string" || slot.length === 0),
		)
	)
		return null
	return value as HotbarSlots
}

export function parseHotbarSlots(value: string | null): HotbarSlots | null {
	if (value === null) return null
	try {
		return normalizeHotbarSlots(JSON.parse(value))
	} catch {
		return null
	}
}

export function assignHotbarSlot(
	slots: HotbarSlots,
	index: number,
	commandId: string | null,
): HotbarSlots {
	if (index < 0 || index >= HOTBAR_KEYS.length) return slots
	return slots.map((slot, slotIndex) =>
		slotIndex === index ? commandId : slot,
	)
}

export function assignPaletteCommandToHotbar(
	slots: HotbarSlots,
	index: number,
	commandId: string,
	method: HotbarAssignmentMethod,
): HotbarAssignmentResult {
	return {
		slots: assignHotbarSlot(slots, index, commandId),
		closePalette: method === "keyboard",
	}
}

export function swapHotbarSlots(
	slots: HotbarSlots,
	leftIndex: number,
	rightIndex: number,
): HotbarSlots {
	if (
		leftIndex < 0 ||
		leftIndex >= HOTBAR_KEYS.length ||
		rightIndex < 0 ||
		rightIndex >= HOTBAR_KEYS.length ||
		leftIndex === rightIndex
	)
		return slots
	return slots.map((slot, index) => {
		if (index === leftIndex) return slots[rightIndex] ?? null
		if (index === rightIndex) return slots[leftIndex] ?? null
		return slot
	})
}
