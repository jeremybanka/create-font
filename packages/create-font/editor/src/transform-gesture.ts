import type { TransformHandle } from "./canvas-cursor.ts"
import type { SelectionBounds } from "./outline-selection.ts"

export interface TransformResizeScale {
	readonly anchorX: number
	readonly anchorY: number
	readonly scaleX: number
	readonly scaleY: number
}

export const TRANSFORM_ROTATION_SNAP_DEGREES = 15

export interface TransformRotation {
	readonly pivotX: number
	readonly pivotY: number
	readonly angleRadians: number
}

/** Normalizes an angle to the stable signed range [-pi, pi). */
export function normalizeSignedAngle(angleRadians: number): number {
	if (!Number.isFinite(angleRadians)) return 0
	const turn = 2 * Math.PI
	return ((((angleRadians + Math.PI) % turn) + turn) % turn) - Math.PI
}

export function snapTransformAngle(
	angleRadians: number,
	incrementDegrees = TRANSFORM_ROTATION_SNAP_DEGREES,
): number {
	if (!Number.isFinite(incrementDegrees) || incrementDegrees <= 0)
		return normalizeSignedAngle(angleRadians)
	const increment = (incrementDegrees * Math.PI) / 180
	return normalizeSignedAngle(Math.round(angleRadians / increment) * increment)
}

/** Resolves rotation from immutable start geometry, including wraparound. */
export function resolveTransformRotation(input: {
	readonly bounds: SelectionBounds
	readonly startX: number
	readonly startY: number
	readonly targetX: number
	readonly targetY: number
	readonly shiftKey?: boolean
}): TransformRotation {
	const pivotX = (input.bounds.minX + input.bounds.maxX) / 2
	const pivotY = (input.bounds.minY + input.bounds.maxY) / 2
	const startX = input.startX - pivotX
	const startY = input.startY - pivotY
	const targetX = input.targetX - pivotX
	const targetY = input.targetY - pivotY
	const startLengthSquared = startX ** 2 + startY ** 2
	const targetLengthSquared = targetX ** 2 + targetY ** 2
	if (
		startLengthSquared <= Number.EPSILON ||
		targetLengthSquared <= Number.EPSILON ||
		![startX, startY, targetX, targetY].every(Number.isFinite)
	)
		return { pivotX, pivotY, angleRadians: 0 }
	const angleRadians = normalizeSignedAngle(
		Math.atan2(targetY, targetX) - Math.atan2(startY, startX),
	)
	return {
		pivotX,
		pivotY,
		angleRadians: input.shiftKey
			? snapTransformAngle(angleRadians)
			: angleRadians,
	}
}

/** Resolves a resize from the original bounds, so modifier changes never compound. */
export function resolveTransformResize(input: {
	readonly bounds: SelectionBounds
	readonly handle: Exclude<TransformHandle, "inside" | "rotation">
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
