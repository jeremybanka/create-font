import {
	reduceVectorGesture,
	shouldCloseVectorPen,
} from "@create-font/editor/shared"

import type { DesignAppearance, DesignObject, DesignPoint } from "./types.ts"
import { IDENTITY_DESIGN_TRANSFORM } from "./geometry.ts"

export const DESIGN_PEN_DRAG_THRESHOLD_PIXELS = 4
export const DESIGN_PEN_CLOSE_RADIUS_PIXELS = 10

export type DesignPenPoint = Omit<DesignPoint, "id"> & {
	readonly id?: string
}

export interface DesignPenGesture {
	readonly anchor: DesignPenPoint
	readonly downScreen: DesignPenPoint
}

/** Compatibility wrapper over the shared Pen gesture reducer. */
export function resolveDesignPenPoint(input: {
	readonly gesture: DesignPenGesture
	readonly current: DesignPenPoint
	readonly currentScreen: DesignPenPoint
	readonly shiftKey?: boolean
	readonly thresholdPixels?: number
}): DesignPenPoint {
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
	points: readonly DesignPenPoint[],
	point: DesignPenPoint,
	worldScale: number,
	radiusPixels = DESIGN_PEN_CLOSE_RADIUS_PIXELS,
): boolean {
	return shouldCloseVectorPen(points, point, worldScale, radiusPixels)
}

export function finishDesignPenContour(
	points: readonly DesignPenPoint[],
	closed: boolean,
): Readonly<{
	readonly closed: boolean
	readonly points: readonly DesignPenPoint[]
}> | null {
	if (points.length < (closed ? 3 : 2)) return null
	return { closed, points }
}

export function cancelDesignPen(): readonly DesignPenPoint[] {
	return []
}

export function createDesignPenObject(input: {
	readonly id: string
	readonly name: string
	readonly appearance: DesignAppearance
	readonly points: readonly DesignPenPoint[]
	readonly closed: boolean
}): DesignObject | null {
	const contour = finishDesignPenContour(input.points, input.closed)
	return contour === null
		? null
		: {
				id: input.id,
				name: input.name,
				geometry: {
					kind: "path",
					contours: [
						{
							...contour,
							id: `${input.id}:contour:0`,
							points: contour.points.map((point, index) => ({
								...point,
								id: point.id ?? `${input.id}:contour:0:point:${index}`,
							})),
						},
					],
				},
				transform: IDENTITY_DESIGN_TRANSFORM,
				appearance: input.appearance,
			}
}
