export { canvasToolCursor } from "@create-art/editor"

export type TransformHandle =
	| "inside"
	| "rotation"
	| "north"
	| "north-east"
	| "east"
	| "south-east"
	| "south"
	| "south-west"
	| "west"
	| "north-west"

export type TransformResizeCursor =
	| "default"
	| "grab"
	| "ns-resize"
	| "ew-resize"
	| "nwse-resize"
	| "nesw-resize"

export function transformHandleCursor(
	handle: TransformHandle,
): TransformResizeCursor {
	switch (handle) {
		case "north":
		case "south":
			return "ns-resize"
		case "east":
		case "west":
			return "ew-resize"
		case "north-west":
		case "south-east":
			return "nwse-resize"
		case "north-east":
		case "south-west":
			return "nesw-resize"
		case "inside":
			return "default"
		case "rotation":
			return "grab"
	}
}
