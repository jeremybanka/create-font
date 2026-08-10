import type { HotbarSlots } from "@create-art/editor"

export type FoleyAppearance = "system" | "light" | "dark"

export const FOLEY_APPEARANCE_STORAGE_KEY = "create-foley:appearance:v1"
export const FOLEY_HOTBAR_STORAGE_KEY = "create-foley:action-hotbar:v1"

export const DEFAULT_FOLEY_HOTBAR_SLOTS: HotbarSlots = [
	"play",
	"add-impact",
	"add-whoosh",
	"add-noise",
	"add-tone",
	"add-crackle",
	"duplicate",
	"undo",
	"redo",
	"toggle-loop",
	"export-wav",
	"save",
]

export function parseFoleyAppearance(value: string | null): FoleyAppearance {
	return value === "light" || value === "dark" || value === "system"
		? value
		: "system"
}

export function resolveFoleyAppearance(
	appearance: FoleyAppearance,
	systemPrefersLight: boolean,
): Exclude<FoleyAppearance, "system"> {
	return appearance === "system"
		? systemPrefersLight
			? "light"
			: "dark"
		: appearance
}
