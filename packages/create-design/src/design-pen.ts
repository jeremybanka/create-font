import type { DesignContour, DesignObject, DesignPoint } from "./types.ts"

export const DESIGN_PEN_DRAG_THRESHOLD_PIXELS = 4
export const DESIGN_PEN_CLOSE_RADIUS_PIXELS = 10

export interface DesignPenGesture {
	readonly anchor: DesignPoint
	readonly downScreen: DesignPoint
}

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

function constrainToEightRays(vector: DesignPoint): DesignPoint {
	const angle = Math.atan2(vector.y, vector.x)
	const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
	const length = Math.hypot(vector.x, vector.y)
	return {
		x: canonicalZero(Math.cos(snappedAngle) * length),
		y: canonicalZero(Math.sin(snappedAngle) * length),
	}
}

/** Resolves a Pen pointer gesture in design coordinates, whose y axis points down. */
export function resolveDesignPenPoint(input: {
	readonly gesture: DesignPenGesture
	readonly current: DesignPoint
	readonly currentScreen: DesignPoint
	readonly shiftKey?: boolean
	readonly thresholdPixels?: number
}): DesignPoint {
	const distancePixels = Math.hypot(
		input.currentScreen.x - input.gesture.downScreen.x,
		input.currentScreen.y - input.gesture.downScreen.y,
	)
	if (
		distancePixels < (input.thresholdPixels ?? DESIGN_PEN_DRAG_THRESHOLD_PIXELS)
	)
		return input.gesture.anchor
	const rawOutgoing = {
		x: canonicalZero(input.current.x - input.gesture.anchor.x),
		y: canonicalZero(input.current.y - input.gesture.anchor.y),
	}
	const outgoing = input.shiftKey
		? constrainToEightRays(rawOutgoing)
		: rawOutgoing
	return {
		...input.gesture.anchor,
		incoming: {
			x: canonicalZero(-outgoing.x),
			y: canonicalZero(-outgoing.y),
		},
		outgoing,
	}
}

export function shouldCloseDesignPen(
	points: readonly DesignPoint[],
	point: DesignPoint,
	worldScale: number,
	radiusPixels = DESIGN_PEN_CLOSE_RADIUS_PIXELS,
): boolean {
	const first = points[0]
	return (
		first !== undefined &&
		points.length >= 3 &&
		Math.hypot(point.x - first.x, point.y - first.y) * worldScale <=
			radiusPixels
	)
}

export function finishDesignPenContour(
	points: readonly DesignPoint[],
	closed: boolean,
): DesignContour | null {
	if (points.length < (closed ? 3 : 2)) return null
	return { closed, points }
}

export function cancelDesignPen(): readonly DesignPoint[] {
	return []
}

export function createDesignPenObject(input: {
	readonly id: string
	readonly name: string
	readonly fillId: string
	readonly points: readonly DesignPoint[]
	readonly closed: boolean
}): DesignObject | null {
	const contour = finishDesignPenContour(input.points, input.closed)
	return contour === null
		? null
		: {
				id: input.id,
				name: input.name,
				fillId: input.fillId,
				contours: [contour],
			}
}
