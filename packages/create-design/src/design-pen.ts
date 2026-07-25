import {
	reduceVectorGesture,
	shouldCloseVectorPen,
} from "@create-font/editor/shared"

import type { DesignContour, DesignObject, DesignPoint } from "./types.ts"

export const DESIGN_PEN_DRAG_THRESHOLD_PIXELS = 4
export const DESIGN_PEN_CLOSE_RADIUS_PIXELS = 10

export interface DesignPenGesture {
	readonly anchor: DesignPoint
	readonly downScreen: DesignPoint
}

/** Compatibility wrapper over the shared Pen gesture reducer. */
export function resolveDesignPenPoint(input: {
	readonly gesture: DesignPenGesture
	readonly current: DesignPoint
	readonly currentScreen: DesignPoint
	readonly shiftKey?: boolean
	readonly thresholdPixels?: number
}): DesignPoint {
	const screenDistance = Math.hypot(
		input.currentScreen.x - input.gesture.downScreen.x,
		input.currentScreen.y - input.gesture.downScreen.y,
	)
	const worldDelta = {
		x: input.current.x - input.gesture.anchor.x,
		y: input.current.y - input.gesture.anchor.y,
	}
	const worldDistance = Math.hypot(worldDelta.x, worldDelta.y)
	const sharedScreen =
		worldDistance === 0
			? input.currentScreen
			: {
					x:
						input.gesture.downScreen.x +
						(worldDelta.x / worldDistance) * screenDistance,
					y:
						input.gesture.downScreen.y +
						(worldDelta.y / worldDistance) * screenDistance,
				}
	const modifiers = {
		shiftKey: input.shiftKey ?? false,
		altKey: false,
		additive: false,
	}
	const policy = {
		yAxis: "down" as const,
		thresholdPixels: input.thresholdPixels ?? DESIGN_PEN_DRAG_THRESHOLD_PIXELS,
	}
	const started = reduceVectorGesture(
		null,
		{
			type: "pointer-down",
			tool: "pen",
			pointerId: 1,
			pointer: {
				world: input.gesture.anchor,
				screen: input.gesture.downScreen,
				modifiers,
			},
		},
		policy,
	)
	const moved = reduceVectorGesture(
		started.state,
		{
			type: "pointer-move",
			pointerId: 1,
			pointer: {
				world: input.current,
				screen: sharedScreen,
				modifiers,
			},
		},
		policy,
	)
	const preview = moved.preview
	if (preview?.kind !== "pen") return input.gesture.anchor
	const handles =
		preview.mode === "soft" && !(input.shiftKey ?? false)
			? {
					incoming: { x: -worldDelta.x, y: -worldDelta.y },
					outgoing: worldDelta,
				}
			: preview.handles
	return {
		...preview.point,
		...(handles?.incoming === undefined ? {} : { incoming: handles.incoming }),
		...(handles?.outgoing === undefined ? {} : { outgoing: handles.outgoing }),
	}
}

export function shouldCloseDesignPen(
	points: readonly DesignPoint[],
	point: DesignPoint,
	worldScale: number,
	radiusPixels = DESIGN_PEN_CLOSE_RADIUS_PIXELS,
): boolean {
	return shouldCloseVectorPen(points, point, worldScale, radiusPixels)
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
