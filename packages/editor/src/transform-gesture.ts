import type { TransformHandle } from "./canvas-cursor.ts"
import type { SelectionBounds } from "./outline-selection.ts"

export interface TransformResizeScale {
	readonly anchorX: number
	readonly anchorY: number
	readonly scaleX: number
	readonly scaleY: number
}

/** Resolves a resize from the original bounds, so modifier changes never compound. */
export function resolveTransformResize(input: {
	readonly bounds: SelectionBounds
	readonly handle: Exclude<TransformHandle, "inside">
	readonly targetX: number
	readonly targetY: number
	readonly shiftKey?: boolean
	readonly altKey?: boolean
}): TransformResizeScale {
	const { bounds, handle } = input
	const movesWest = handle.includes("west")
	const movesEast = handle.includes("east")
	const movesNorth = handle.includes("north")
	const movesSouth = handle.includes("south")
	const centerX = (bounds.minX + bounds.maxX) / 2
	const centerY = (bounds.minY + bounds.maxY) / 2
	const anchorX = input.altKey ? centerX : movesWest ? bounds.maxX : bounds.minX
	const anchorY = input.altKey
		? centerY
		: movesSouth
			? bounds.maxY
			: bounds.minY
	const sourceX = movesWest ? bounds.minX : bounds.maxX
	const sourceY = movesSouth ? bounds.minY : bounds.maxY
	let scaleX =
		movesWest || movesEast
			? sourceX === anchorX
				? 1
				: (input.targetX - anchorX) / (sourceX - anchorX)
			: 1
	let scaleY =
		movesNorth || movesSouth
			? sourceY === anchorY
				? 1
				: (input.targetY - anchorY) / (sourceY - anchorY)
			: 1
	if (
		input.shiftKey &&
		(movesWest || movesEast) &&
		(movesNorth || movesSouth)
	) {
		const uniform =
			Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
		scaleX = uniform
		scaleY = uniform
	}
	return { anchorX, anchorY, scaleX, scaleY }
}
