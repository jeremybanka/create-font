export type TransformHandle =
	| "inside"
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
	}
}
