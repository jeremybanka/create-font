import type { HotbarSlots } from "@create-art/editor"

export const DESIGN_HOTBAR_STORAGE_KEY = "create-design:action-hotbar:v1"
export const DESIGN_ALTERNATE_HOTBAR_STORAGE_KEY =
	"create-design:alternate-action-hotbar:v1"

export const DEFAULT_DESIGN_HOTBAR_SLOTS: HotbarSlots = [
	"tool-select",
	"tool-direct",
	"tool-pen",
	"tool-rect",
	"tool-ellipse",
	"tool-transform",
	"undo",
	"redo",
	"duplicate-offset",
	"group-selection",
	"align-center",
	"export-pdf",
]

export const DEFAULT_DESIGN_ALTERNATE_HOTBAR_SLOTS: HotbarSlots = Array.from(
	{ length: 12 },
	() => null,
)
