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

export const HOTBAR_COMMAND_MIME = "application/x-create-font-command"

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
): number | null {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
		return null
	const index = HOTBAR_CODES.indexOf(
		event.code as (typeof HOTBAR_CODES)[number],
	)
	return index < 0 ? null : index
}
