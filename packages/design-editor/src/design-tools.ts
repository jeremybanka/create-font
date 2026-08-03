import {
	BorderAllIcon,
	CircleIcon,
	CursorArrowIcon,
	Pencil1Icon,
	SquareIcon,
	TransformIcon,
} from "@radix-ui/react-icons"

import type { DesignTool } from "./types.ts"

export const DESIGN_TOOLS = {
	select: {
		label: "Select",
		key: "V",
		icon: CursorArrowIcon,
		paletteIcon: "CursorArrowIcon",
	},
	direct: {
		label: "Direct Selection",
		key: "A",
		icon: CursorArrowIcon,
		paletteIcon: "CursorArrowIcon",
	},
	transform: {
		label: "Transform",
		key: "F",
		icon: TransformIcon,
		paletteIcon: "TransformIcon",
	},
	artboard: {
		label: "Artboard",
		key: "A",
		icon: BorderAllIcon,
		paletteIcon: "SquareIcon",
	},
	pen: {
		label: "Pen",
		key: "Q",
		icon: Pencil1Icon,
		paletteIcon: "Pencil1Icon",
	},
	rect: {
		label: "Rectangle",
		key: "R",
		icon: SquareIcon,
		paletteIcon: "SquareIcon",
	},
	ellipse: {
		label: "Ellipse",
		key: "O",
		icon: CircleIcon,
		paletteIcon: "CircleIcon",
	},
} as const satisfies Record<
	DesignTool,
	{
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
