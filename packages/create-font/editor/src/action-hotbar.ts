import type { HotbarSlots } from "@create-art/editor"

export const HOTBAR_STORAGE_KEY = "create-font:action-hotbar:v1"
export const ALTERNATE_HOTBAR_STORAGE_KEY =
	"create-font:alternate-action-hotbar:v1"

export const DEFAULT_HOTBAR_SLOTS: HotbarSlots = [
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

export const DEFAULT_ALTERNATE_HOTBAR_SLOTS: HotbarSlots = Array.from(
	{ length: 12 },
	() => null,
)
