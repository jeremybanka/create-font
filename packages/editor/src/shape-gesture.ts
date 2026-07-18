import type {
	EditorHandleVectorSource,
	EditorLayerPointSource,
	MasterId,
	PointId,
} from "@create-font/states"

import {
	projectAuthoringPoint,
	type AuthoringLayerTransform,
	type AuthoringPoint,
} from "./authoring-projection.ts"

export type ShapeToolKind = "rect" | "ellipse"

export interface ShapeBounds {
	readonly minX: number
	readonly minY: number
	readonly maxX: number
	readonly maxY: number
}

export interface ShapeDragDirection {
	readonly x: -1 | 1 | null
	readonly y: -1 | 1 | null
}

export interface ShapeGestureResolution {
	readonly bounds: ShapeBounds
	readonly direction: ShapeDragDirection
	readonly distancePixels: number
	readonly valid: boolean
}

export interface ShapeGeometryPoint extends AuthoringPoint {
	readonly mode: "soft" | "hard"
	readonly incoming?: EditorHandleVectorSource
	readonly outgoing?: EditorHandleVectorSource
}

export const SHAPE_DRAG_THRESHOLD_PIXELS = 4
export const ELLIPSE_KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

const finitePoint = (point: AuthoringPoint): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y)

const sign = (value: number): -1 | 1 | null =>
	value < 0 ? -1 : value > 0 ? 1 : null

/** Resolves raw/snap candidates into final rounded bounds for preview and commit. */
export function resolveShapeGesture(input: {
	readonly anchor: AuthoringPoint
	readonly rawCandidate: AuthoringPoint
	readonly snappedCandidate: AuthoringPoint
	readonly downScreen: AuthoringPoint
	readonly currentScreen: AuthoringPoint
	readonly previousDirection?: ShapeDragDirection
	readonly shiftKey?: boolean
	readonly thresholdPixels?: number
}): ShapeGestureResolution {
	if (
		!finitePoint(input.anchor) ||
		!finitePoint(input.rawCandidate) ||
		!finitePoint(input.snappedCandidate) ||
		!finitePoint(input.downScreen) ||
		!finitePoint(input.currentScreen)
	) {
		throw new TypeError("Shape gesture coordinates must be finite.")
	}
	const anchor = {
		x: Math.round(input.anchor.x),
		y: Math.round(input.anchor.y),
	}
	const rawDelta = {
		x: input.rawCandidate.x - anchor.x,
		y: input.rawCandidate.y - anchor.y,
	}
	const direction = {
		x: sign(rawDelta.x) ?? input.previousDirection?.x ?? null,
		y: sign(rawDelta.y) ?? input.previousDirection?.y ?? null,
	} satisfies ShapeDragDirection
	let corner = {
		x: Math.round(input.snappedCandidate.x),
		y: Math.round(input.snappedCandidate.y),
	}
	if (input.shiftKey) {
		const side = Math.round(
			Math.max(Math.abs(rawDelta.x), Math.abs(rawDelta.y)),
		)
		corner = {
			x:
				direction.x === null
					? anchor.x
					: canonicalZero(anchor.x + direction.x * side),
			y:
				direction.y === null
					? anchor.y
					: canonicalZero(anchor.y + direction.y * side),
		}
	}
	const bounds = {
		minX: canonicalZero(Math.min(anchor.x, corner.x)),
		minY: canonicalZero(Math.min(anchor.y, corner.y)),
		maxX: canonicalZero(Math.max(anchor.x, corner.x)),
		maxY: canonicalZero(Math.max(anchor.y, corner.y)),
	}
	const distancePixels = Math.hypot(
		input.currentScreen.x - input.downScreen.x,
		input.currentScreen.y - input.downScreen.y,
	)
	return {
		bounds,
		direction,
		distancePixels,
		valid:
			distancePixels >=
				(input.thresholdPixels ?? SHAPE_DRAG_THRESHOLD_PIXELS) &&
			bounds.maxX > bounds.minX &&
			bounds.maxY > bounds.minY &&
			(!input.shiftKey || (direction.x !== null && direction.y !== null)),
	}
}

/** Emits the repository's clockwise outer-contour order. */
export function shapeGeometry(
	kind: ShapeToolKind,
	bounds: ShapeBounds,
): readonly ShapeGeometryPoint[] {
	const { minX, minY, maxX, maxY } = bounds
	if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
		throw new TypeError("Shape bounds must be finite.")
	}
	if (maxX <= minX || maxY <= minY) return Object.freeze([])
	if (kind === "rect") {
		return Object.freeze([
			{ mode: "hard", x: minX, y: maxY },
			{ mode: "hard", x: maxX, y: maxY },
			{ mode: "hard", x: maxX, y: minY },
			{ mode: "hard", x: minX, y: minY },
		])
	}
	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	const handleX = ((maxX - minX) / 2) * ELLIPSE_KAPPA
	const handleY = ((maxY - minY) / 2) * ELLIPSE_KAPPA
	return Object.freeze([
		{
			mode: "soft",
			x: centerX,
			y: maxY,
			incoming: { x: -handleX, y: 0 },
			outgoing: { x: handleX, y: 0 },
		},
		{
			mode: "soft",
			x: maxX,
			y: centerY,
			incoming: { x: 0, y: handleY },
			outgoing: { x: 0, y: -handleY },
		},
		{
			mode: "soft",
			x: centerX,
			y: minY,
			incoming: { x: handleX, y: 0 },
			outgoing: { x: -handleX, y: 0 },
		},
		{
			mode: "soft",
			x: minX,
			y: centerY,
			incoming: { x: 0, y: -handleY },
			outgoing: { x: 0, y: handleY },
		},
	])
}

function projectedVector(
	point: ShapeGeometryPoint,
	vector: EditorHandleVectorSource,
	projectedPoint: AuthoringPoint,
	transform: AuthoringLayerTransform,
): EditorHandleVectorSource {
	if (transform.xScale === 1) return { ...vector }
	const endpoint = projectAuthoringPoint(
		{ x: point.x + vector.x, y: point.y + vector.y },
		transform,
	)
	return {
		x: canonicalZero(endpoint.x - projectedPoint.x),
		y: canonicalZero(endpoint.y - projectedPoint.y),
	}
}

/** Projects absolute extrema/control endpoints into every destination master. */
export function shapeLayerCoordinates(
	points: readonly ShapeGeometryPoint[],
	pointIds: readonly PointId[],
	transforms: readonly AuthoringLayerTransform[],
): readonly {
	readonly masterId: MasterId
	readonly points: readonly EditorLayerPointSource[]
}[] {
	if (points.length !== pointIds.length) {
		throw new TypeError("Shape point IDs must match its geometry.")
	}
	return Object.freeze(
		transforms.map((transform) => ({
			masterId: transform.masterId,
			points: points.map((point, index) => {
				const pointId = pointIds[index]
				if (pointId === undefined) throw new Error("Shape point ID is missing.")
				const projected = projectAuthoringPoint(point, transform)
				return {
					pointId,
					x: projected.x,
					y: projected.y,
					...(point.incoming === undefined
						? {}
						: {
								incoming: projectedVector(
									point,
									point.incoming,
									projected,
									transform,
								),
							}),
					...(point.outgoing === undefined
						? {}
						: {
								outgoing: projectedVector(
									point,
									point.outgoing,
									projected,
									transform,
								),
							}),
				}
			}),
		})),
	)
}
