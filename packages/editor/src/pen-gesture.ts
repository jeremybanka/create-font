import type { MasterId } from "@create-font/states"

export interface PenPoint {
	readonly x: number
	readonly y: number
}

export interface PenHandlePair {
	readonly incoming: PenPoint
	readonly outgoing: PenPoint
}

export type PenGestureResolution =
	| {
			readonly kind: "click"
			readonly mode: "hard"
			readonly handles: null
			readonly distancePixels: number
	  }
	| {
			readonly kind: "curve"
			readonly mode: "soft"
			readonly handles: PenHandlePair
			readonly distancePixels: number
	  }

export interface PenLayerTransform {
	readonly masterId: MasterId
	readonly xScale: number
}

export interface PenLayerCoordinate extends PenPoint {
	readonly masterId: MasterId
	readonly incoming?: PenPoint
	readonly outgoing?: PenPoint
}

export type PenPointerTarget =
	| "background"
	| "typed-glyph"
	| "control"
	| "first-node"
	| "segment"
export type PenPointerAction = "close" | "consume" | "place" | "split"

export const PEN_DRAG_THRESHOLD_PIXELS = 4

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

const finitePoint = (point: PenPoint): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y)

/** Resolves click versus curve from CSS-pixel movement and converts y to font space. */
export function resolvePenGesture(input: {
	readonly downScreen: PenPoint
	readonly currentScreen: PenPoint
	readonly worldScale: number
	readonly thresholdPixels?: number
}): PenGestureResolution {
	if (
		!finitePoint(input.downScreen) ||
		!finitePoint(input.currentScreen) ||
		!Number.isFinite(input.worldScale) ||
		input.worldScale <= 0
	) {
		throw new TypeError("Pen gesture coordinates and scale must be finite.")
	}
	const dxPixels = input.currentScreen.x - input.downScreen.x
	const dyPixels = input.currentScreen.y - input.downScreen.y
	const distancePixels = Math.hypot(dxPixels, dyPixels)
	if (distancePixels < (input.thresholdPixels ?? PEN_DRAG_THRESHOLD_PIXELS)) {
		return { kind: "click", mode: "hard", handles: null, distancePixels }
	}
	const outgoing = {
		x: canonicalZero(dxPixels / input.worldScale),
		y: canonicalZero(-dyPixels / input.worldScale),
	}
	return {
		kind: "curve",
		mode: "soft",
		handles: {
			incoming: {
				x: canonicalZero(-outgoing.x),
				y: canonicalZero(-outgoing.y),
			},
			outgoing,
		},
		distancePixels,
	}
}

/** Maps the authored node and its dragged handle endpoints into every master. */
export function penLayerCoordinates(
	point: PenPoint,
	gesture: PenGestureResolution,
	transforms: readonly PenLayerTransform[],
): readonly PenLayerCoordinate[] {
	if (!finitePoint(point)) throw new TypeError("Pen point must be finite.")
	return Object.freeze(
		transforms.map(({ masterId, xScale }) => {
			if (!Number.isFinite(xScale) || xScale <= 0) {
				throw new TypeError(
					"Pen layer transform scale must be positive and finite.",
				)
			}
			const mapX = (x: number): number => 500 + (x - 500) * xScale
			const x = Math.round(mapX(point.x))
			const y = Math.round(point.y)
			if (gesture.handles === null) return { masterId, x, y }
			const outgoing = {
				x: canonicalZero(mapX(point.x + gesture.handles.outgoing.x) - x),
				y: canonicalZero(gesture.handles.outgoing.y),
			}
			return {
				masterId,
				x,
				y,
				incoming: {
					x: canonicalZero(-outgoing.x),
					y: canonicalZero(-outgoing.y),
				},
				outgoing,
			}
		}),
	)
}

/** Makes Pen hit-target precedence explicit and independently testable. */
export function penPointerAction(target: PenPointerTarget): PenPointerAction {
	switch (target) {
		case "segment":
			return "split"
		case "first-node":
			return "close"
		case "control":
			return "consume"
		case "background":
		case "typed-glyph":
			return "place"
	}
}
