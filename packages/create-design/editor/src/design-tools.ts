import {
	BorderAllIcon,
	CircleIcon,
	CursorArrowIcon,
	Pencil1Icon,
	SquareIcon,
	TextIcon,
	TransformIcon,
} from "@radix-ui/react-icons"

import type { DesignTool } from "./types.ts"

export const DESIGN_TOOLS = {
	select: {
		label: "Select",
		description: "Select and move complete objects.",
		key: "V",
		icon: CursorArrowIcon,
		paletteIcon: "CursorArrowIcon",
	},
	direct: {
		label: "Direct Selection",
		description: "Select and edit individual path points and handles.",
		key: "A",
		icon: CursorArrowIcon,
		paletteIcon: "CursorArrowIcon",
	},
	transform: {
		label: "Transform",
		description: "Transform the current object selection with canvas handles.",
		key: "F",
		icon: TransformIcon,
		paletteIcon: "TransformIcon",
	},
	artboard: {
		label: "Artboard",
		description: "Draw and edit artboards on the canvas.",
		key: "B",
		icon: BorderAllIcon,
		paletteIcon: "SquareIcon",
	},
	pen: {
		label: "Pen",
		description: "Draw editable vector paths point by point.",
		key: "Q",
		icon: Pencil1Icon,
		paletteIcon: "Pencil1Icon",
	},
	rect: {
		label: "Rectangle",
		description: "Draw rectangular vector objects.",
		key: "R",
		icon: SquareIcon,
		paletteIcon: "SquareIcon",
	},
	ellipse: {
		label: "Ellipse",
		description: "Draw elliptical vector objects.",
		key: "O",
		icon: CircleIcon,
		paletteIcon: "CircleIcon",
	},
	text: {
		label: "Type",
		description: "Place and edit point text.",
		key: "T",
		icon: TextIcon,
		paletteIcon: "Pencil1Icon",
	},
	"area-text": {
		label: "Area Type",
		description: "Draw a frame for flowing area text.",
		key: "Y",
		icon: TextIcon,
		paletteIcon: "SquareIcon",
	},
	guide: {
		label: "Guide",
		description: "Plot an infinite snapping guide through two points.",
		key: "G",
		icon: Pencil1Icon,
		paletteIcon: "Pencil1Icon",
	},
} as const satisfies Record<
	DesignTool,
	{
		readonly description: string
		readonly label: string
		readonly key: string
		readonly icon: typeof CursorArrowIcon
		readonly paletteIcon:
			| "CircleIcon"
			| "CursorArrowIcon"
			| "Pencil1Icon"
			| "SquareIcon"
			| "TransformIcon"
	}
>
