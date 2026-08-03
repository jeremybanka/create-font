import type { MasterId } from "@create-font/states"

import { constrainVectorToEightRays } from "./curve-editing.ts"
import {
	projectAuthoringPoint,
	type AuthoringLayerTransform,
} from "./authoring-projection.ts"

export interface PenPoint {
	readonly x: number
	readonly y: number
}

export interface PenHandlePair {
	readonly incoming: PenPoint
	readonly outgoing: PenPoint
}

export type PenHandleKind = keyof PenHandlePair

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

export type PenLayerTransform = AuthoringLayerTransform

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
	| "open-endpoint"
	| "segment"
export type PenPointerAction =
	| "close"
	| "consume"
	| "place"
	| "resume"
	| "split"

export type PenEndpointSide = "first" | "last"
export type PenDirection = "append" | "prepend"

export type PenAuthoringContext =
	| Readonly<{ kind: "point"; direction: PenDirection }>
	| Readonly<{ kind: "endpoint"; side: PenEndpointSide }>
	| Readonly<{ kind: "closure"; direction: PenDirection }>

export interface PenEndpointResolution {
	readonly mode: "soft" | "hard"
	readonly incoming?: PenPoint
	readonly outgoing?: PenPoint
}

export interface PenEndpointHandleTarget {
	readonly pointId: string
	readonly handle: "incoming" | "outgoing"
}

/** Chooses which handle follows the pointer for a Pen authoring operation. */
export function penDraggedHandle(context: PenAuthoringContext): PenHandleKind {
	return context.kind === "endpoint" && context.side === "first"
		? "incoming"
		: "outgoing"
}

/** Resolves an open node to the endpoint represented by the drawing context. */
export function resolvePenEndpointSide(input: {
	readonly pointIndex: number
	readonly pointCount: number
	readonly direction: PenDirection
}): PenEndpointSide {
	if (
		input.pointCount < 1 ||
		input.pointIndex < 0 ||
		input.pointIndex >= input.pointCount
	) {
		throw new TypeError("Pen endpoint index is outside the open contour.")
	}
	if (input.pointCount === 1) {
		return input.direction === "prepend" ? "first" : "last"
	}
	if (input.pointIndex === 0) return "first"
	if (input.pointIndex === input.pointCount - 1) return "last"
	throw new TypeError("The selected node is not an open contour endpoint.")
}

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
	readonly shiftKey?: boolean
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
	const rawOutgoing = {
		x: canonicalZero(dxPixels / input.worldScale),
		y: canonicalZero(-dyPixels / input.worldScale),
	}
	const outgoing = input.shiftKey
		? constrainVectorToEightRays(rawOutgoing)
		: rawOutgoing
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

/** Assigns the pointer-side vector to the handle owned by the drawing context. */
export function penGestureHandles(
	gesture: PenGestureResolution | null,
	draggedHandle: PenHandleKind,
): PenHandlePair | null {
	if (gesture === null || gesture.handles === null) return null
	if (draggedHandle === "outgoing") return gesture.handles
	return {
		incoming: gesture.handles.outgoing,
		outgoing: gesture.handles.incoming,
	}
}

/** Resolves endpoint handle authoring without assuming which end is active. */
export function resolvePenEndpoint(input: {
	readonly side: PenEndpointSide
	readonly mode: "soft" | "hard"
	readonly incoming?: PenPoint
	readonly outgoing?: PenPoint
	readonly gesture: PenGestureResolution
	readonly altKey?: boolean
}): PenEndpointResolution {
	if (input.incoming !== undefined && !finitePoint(input.incoming)) {
		throw new TypeError("Incoming endpoint handle must be finite.")
	}
	if (input.outgoing !== undefined && !finitePoint(input.outgoing)) {
		throw new TypeError("Outgoing endpoint handle must be finite.")
	}
	const forwardKind = input.side === "first" ? "incoming" : "outgoing"
	const connectedKind = input.side === "first" ? "outgoing" : "incoming"
	const forward = input[forwardKind]
	const connected = input[connectedKind]
	if (input.gesture.kind === "click") {
		if (input.mode === "hard") {
			return {
				mode: "hard",
				...(input.incoming === undefined ? {} : { incoming: input.incoming }),
				...(input.outgoing === undefined ? {} : { outgoing: input.outgoing }),
			}
		}
		return {
			mode: "hard",
			...(connected === undefined ? {} : { [connectedKind]: connected }),
		}
	}

	const dragged = input.gesture.handles.outgoing
	const harden =
		input.mode === "hard" || (input.altKey === true && forward !== undefined)
	if (harden) {
		return {
			mode: "hard",
			...(connected === undefined ? {} : { [connectedKind]: connected }),
			[forwardKind]: dragged,
		}
	}
	if (connected === undefined) {
		return { mode: "soft", [forwardKind]: dragged }
	}
	const connectedLength = Math.hypot(connected.x, connected.y)
	const draggedLength = Math.hypot(dragged.x, dragged.y)
	const rotatedConnected =
		draggedLength === 0
			? connected
			: {
					x: canonicalZero((-dragged.x / draggedLength) * connectedLength),
					y: canonicalZero((-dragged.y / draggedLength) * connectedLength),
				}
	return {
		mode: "soft",
		[connectedKind]: rotatedConnected,
		[forwardKind]: dragged,
	}
}

/** Maps the authored node and dragged handle endpoints into candidate layers. */
export function penLayerCoordinates(
	point: PenPoint,
	gesture: PenGestureResolution,
	transforms: readonly PenLayerTransform[],
	draggedHandle: PenHandleKind = "outgoing",
): readonly PenLayerCoordinate[] {
	if (!finitePoint(point)) throw new TypeError("Pen point must be finite.")
	const handles = penGestureHandles(gesture, draggedHandle)
	return Object.freeze(
		transforms.map(({ masterId, xScale }) => {
			const transform = { masterId, xScale }
			let projected: PenPoint
			try {
				projected = projectAuthoringPoint(point, transform)
			} catch {
				throw new TypeError(
					"Pen layer transform scale must be positive and finite.",
				)
			}
			const x = Math.round(projected.x)
			const y = Math.round(projected.y)
			if (handles === null) return { masterId, x, y }
			const projectedIncoming = projectAuthoringPoint(
				{
					x: point.x + handles.incoming.x,
					y: point.y + handles.incoming.y,
				},
				transform,
			)
			const incoming = {
				x: canonicalZero(projectedIncoming.x - x),
				y: canonicalZero(handles.incoming.y),
			}
			return {
				masterId,
				x,
				y,
				incoming,
				outgoing: {
					x: canonicalZero(-incoming.x),
					y: canonicalZero(-incoming.y),
				},
			}
		}),
	)
}

/** Identifies the existing endpoint control that remains visible while replaced. */
export function penEndpointHandleBeingReplaced(
	endpoint:
		| Readonly<{ pointId: string; side: PenEndpointSide }>
		| null
		| undefined,
	gesture: PenGestureResolution | null,
): PenEndpointHandleTarget | null {
	if (
		endpoint === null ||
		endpoint === undefined ||
		gesture?.kind !== "curve"
	) {
		return null
	}
	return {
		pointId: endpoint.pointId,
		handle: endpoint.side === "first" ? "incoming" : "outgoing",
	}
}

/** Makes Pen hit-target precedence explicit and independently testable. */
export function penPointerAction(target: PenPointerTarget): PenPointerAction {
	switch (target) {
		case "segment":
			return "split"
		case "first-node":
			return "close"
		case "open-endpoint":
			return "resume"
		case "control":
			return "consume"
		case "background":
		case "typed-glyph":
			return "place"
	}
}
