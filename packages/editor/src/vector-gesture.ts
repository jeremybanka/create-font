import type { VectorBounds } from "./vector-scene.ts"
import type { VectorHandleKind, VectorPoint } from "./vector-editing.ts"

export type VectorGestureTool =
	| "select"
	| "pen"
	| "rect"
	| "ellipse"
	| "transform"

export type VectorTransformHandle =
	| "move"
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "rotation"

export interface VectorGestureModifiers {
	readonly shiftKey: boolean
	readonly altKey: boolean
	readonly additive: boolean
}

export interface VectorSnapGuide {
	readonly id: string
	readonly axis: "x" | "y" | "line"
	readonly points: readonly [number, number, number, number]
	readonly label?: string
}

export interface VectorGesturePolicy {
	readonly yAxis: "up" | "down"
	readonly thresholdPixels?: number
	readonly rotationSnapDegrees?: number
	readonly round?: (value: number) => number
}

interface VectorGesturePointer {
	readonly world: VectorPoint
	readonly rawWorld?: VectorPoint
	readonly screen: VectorPoint
	readonly modifiers: VectorGestureModifiers
	readonly snaps?: readonly VectorSnapGuide[]
}

export type VectorGestureDown =
	| Readonly<{
			readonly type: "pointer-down"
			readonly tool: "select"
			readonly pointerId: number
			readonly pointer: VectorGesturePointer
			readonly targetId: string | null
	  }>
	| Readonly<{
			readonly type: "pointer-down"
			readonly tool: "pen"
			readonly pointerId: number
			readonly pointer: VectorGesturePointer
			readonly targetId?: string | null
	  }>
	| Readonly<{
			readonly type: "pointer-down"
			readonly tool: "rect" | "ellipse"
			readonly pointerId: number
			readonly pointer: VectorGesturePointer
	  }>
	| Readonly<{
			readonly type: "pointer-down"
			readonly tool: "transform"
			readonly pointerId: number
			readonly pointer: VectorGesturePointer
			readonly targetId: string
			readonly bounds: VectorBounds
			readonly handle: VectorTransformHandle
	  }>

type WithoutPointer<Event> = Event extends unknown
	? Omit<Event, "type" | "pointerId" | "pointer">
	: never

export type VectorGestureDownInput = WithoutPointer<VectorGestureDown>

export type VectorGestureEvent =
	| VectorGestureDown
	| Readonly<{
			readonly type: "pointer-move" | "pointer-up"
			readonly pointerId: number
			readonly pointer: VectorGesturePointer
	  }>
	| Readonly<{
			readonly type: "modifiers"
			readonly pointerId: number
			readonly modifiers: VectorGestureModifiers
	  }>
	| Readonly<{
			readonly type: "pointer-cancel"
			readonly pointerId: number
	  }>

interface VectorGestureBase {
	readonly pointerId: number
	readonly startWorld: VectorPoint
	readonly rawStartWorld: VectorPoint
	readonly currentWorld: VectorPoint
	readonly rawCurrentWorld: VectorPoint
	readonly startScreen: VectorPoint
	readonly currentScreen: VectorPoint
	readonly modifiers: VectorGestureModifiers
	readonly snaps: readonly VectorSnapGuide[]
}

export type VectorGestureState =
	| Readonly<
			VectorGestureBase & {
				readonly tool: "select"
				readonly targetId: string | null
			}
	  >
	| Readonly<
			VectorGestureBase & {
				readonly tool: "pen"
				readonly targetId: string | null
			}
	  >
	| Readonly<
			VectorGestureBase & {
				readonly tool: "rect" | "ellipse"
			}
	  >
	| Readonly<
			VectorGestureBase & {
				readonly tool: "transform"
				readonly targetId: string
				readonly bounds: VectorBounds
				readonly handle: VectorTransformHandle
			}
	  >

export type VectorGesturePreview =
	| Readonly<{
			readonly kind: "select-move"
			readonly targetId: string
			readonly delta: VectorPoint
			readonly snaps: readonly VectorSnapGuide[]
	  }>
	| Readonly<{
			readonly kind: "select-marquee"
			readonly bounds: VectorBounds
			readonly additive: boolean
	  }>
	| Readonly<{
			readonly kind: "pen"
			readonly point: VectorPoint
			readonly mode: "hard" | "soft"
			readonly handles: Readonly<
				Partial<Record<VectorHandleKind, VectorPoint>>
			> | null
			readonly distancePixels: number
			readonly snaps: readonly VectorSnapGuide[]
	  }>
	| Readonly<{
			readonly kind: "shape"
			readonly shape: "rect" | "ellipse"
			readonly bounds: VectorBounds
			readonly valid: boolean
			readonly snaps: readonly VectorSnapGuide[]
	  }>
	| Readonly<{
			readonly kind: "transform"
			readonly targetId: string
			readonly handle: VectorTransformHandle
			readonly bounds: VectorBounds
			readonly anchor: VectorPoint
			readonly delta: VectorPoint
			readonly scale: VectorPoint
			readonly rotationDegrees: number
			readonly snaps: readonly VectorSnapGuide[]
	  }>

export type VectorGestureCommitIntent =
	| Exclude<VectorGesturePreview, { readonly kind: "pen" }>
	| Readonly<{
			readonly kind: "pen-node"
			readonly targetId: string | null
			readonly point: VectorPoint
			readonly mode: "hard" | "soft"
			readonly handles: Readonly<
				Partial<Record<VectorHandleKind, VectorPoint>>
			> | null
			readonly distancePixels: number
	  }>

export interface VectorGestureTransition {
	readonly state: VectorGestureState | null
	readonly preview: VectorGesturePreview | null
	readonly intent: VectorGestureCommitIntent | null
	readonly canceled: boolean
}

const DEFAULT_THRESHOLD_PIXELS = 4
const DEFAULT_ROTATION_SNAP_DEGREES = 15
export const VECTOR_PEN_CLOSE_RADIUS_PIXELS = 10

export function shouldCloseVectorPen(
	points: readonly VectorPoint[],
	point: VectorPoint,
	worldScale: number,
	radiusPixels = VECTOR_PEN_CLOSE_RADIUS_PIXELS,
): boolean {
	const first = points[0]
	return (
		first !== undefined &&
		points.length >= 3 &&
		Math.hypot(point.x - first.x, point.y - first.y) * worldScale <=
			radiusPixels
	)
}

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

const pointerDistance = (state: VectorGestureBase): number =>
	Math.hypot(
		state.currentScreen.x - state.startScreen.x,
		state.currentScreen.y - state.startScreen.y,
	)

const boundsFrom = (a: VectorPoint, b: VectorPoint): VectorBounds => ({
	minX: canonicalZero(Math.min(a.x, b.x)),
	minY: canonicalZero(Math.min(a.y, b.y)),
	maxX: canonicalZero(Math.max(a.x, b.x)),
	maxY: canonicalZero(Math.max(a.y, b.y)),
})

const roundPoint = (
	point: VectorPoint,
	policy: VectorGesturePolicy,
): VectorPoint => {
	const round = policy.round ?? Math.round
	return { x: canonicalZero(round(point.x)), y: canonicalZero(round(point.y)) }
}

const constrainedRay = (vector: VectorPoint): VectorPoint => {
	const length = Math.hypot(vector.x, vector.y)
	if (length === 0) return { x: 0, y: 0 }
	const angle =
		Math.round(Math.atan2(vector.y, vector.x) / (Math.PI / 4)) * (Math.PI / 4)
	return {
		x: canonicalZero(Math.cos(angle) * length),
		y: canonicalZero(Math.sin(angle) * length),
	}
}

function shapePreview(
	state: Extract<VectorGestureState, { readonly tool: "rect" | "ellipse" }>,
	policy: VectorGesturePolicy,
): Extract<VectorGesturePreview, { readonly kind: "shape" }> {
	const anchor = roundPoint(state.startWorld, policy)
	const raw = {
		x: state.rawCurrentWorld.x - anchor.x,
		y: state.rawCurrentWorld.y - anchor.y,
	}
	let corner = roundPoint(state.currentWorld, policy)
	if (state.modifiers.shiftKey) {
		const side = (policy.round ?? Math.round)(
			Math.max(Math.abs(raw.x), Math.abs(raw.y)),
		)
		corner = {
			x: anchor.x + (raw.x < 0 ? -side : side),
			y: anchor.y + (raw.y < 0 ? -side : side),
		}
	}
	const opposite = state.modifiers.altKey
		? {
				x: anchor.x - (corner.x - anchor.x),
				y: anchor.y - (corner.y - anchor.y),
			}
		: anchor
	const bounds = boundsFrom(opposite, corner)
	return {
		kind: "shape",
		shape: state.tool,
		bounds,
		valid:
			pointerDistance(state) >=
				(policy.thresholdPixels ?? DEFAULT_THRESHOLD_PIXELS) &&
			bounds.maxX > bounds.minX &&
			bounds.maxY > bounds.minY,
		snaps: state.snaps,
	}
}

function penPreview(
	state: Extract<VectorGestureState, { readonly tool: "pen" }>,
	policy: VectorGesturePolicy,
): Extract<VectorGesturePreview, { readonly kind: "pen" }> {
	const distancePixels = pointerDistance(state)
	if (distancePixels < (policy.thresholdPixels ?? DEFAULT_THRESHOLD_PIXELS)) {
		return {
			kind: "pen",
			point: roundPoint(state.startWorld, policy),
			mode: "hard",
			handles: null,
			distancePixels,
			snaps: state.snaps,
		}
	}
	const screenVector = {
		x: state.currentScreen.x - state.startScreen.x,
		y:
			(state.currentScreen.y - state.startScreen.y) *
			(policy.yAxis === "up" ? -1 : 1),
	}
	const worldScreenRatio =
		Math.hypot(
			state.currentWorld.x - state.startWorld.x,
			state.currentWorld.y - state.startWorld.y,
		) / Math.max(distancePixels, Number.EPSILON)
	const raw = {
		x: screenVector.x * worldScreenRatio,
		y: screenVector.y * worldScreenRatio,
	}
	const outgoing = state.modifiers.shiftKey ? constrainedRay(raw) : raw
	return {
		kind: "pen",
		point: roundPoint(state.startWorld, policy),
		mode: "soft",
		handles: {
			incoming: {
				x: canonicalZero(-outgoing.x),
				y: canonicalZero(-outgoing.y),
			},
			outgoing,
		},
		distancePixels,
		snaps: state.snaps,
	}
}

const transformAnchor = (
	bounds: VectorBounds,
	handle: VectorTransformHandle,
	centered: boolean,
	yAxis: VectorGesturePolicy["yAxis"],
): VectorPoint => {
	const center = {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	}
	if (handle === "move" || handle === "rotation" || centered) return center
	return {
		x: handle.includes("w")
			? bounds.maxX
			: handle.includes("e")
				? bounds.minX
				: center.x,
		y: handle.includes("n")
			? yAxis === "down"
				? bounds.maxY
				: bounds.minY
			: handle.includes("s")
				? yAxis === "down"
					? bounds.minY
					: bounds.maxY
				: center.y,
	}
}

function transformPreview(
	state: Extract<VectorGestureState, { readonly tool: "transform" }>,
	policy: VectorGesturePolicy,
): Extract<VectorGesturePreview, { readonly kind: "transform" }> {
	const anchor = transformAnchor(
		state.bounds,
		state.handle,
		state.modifiers.altKey,
		policy.yAxis,
	)
	const delta = {
		x: state.currentWorld.x - state.startWorld.x,
		y: state.currentWorld.y - state.startWorld.y,
	}
	if (state.handle === "move") {
		return {
			kind: "transform",
			targetId: state.targetId,
			handle: state.handle,
			bounds: state.bounds,
			anchor,
			delta,
			scale: { x: 1, y: 1 },
			rotationDegrees: 0,
			snaps: state.snaps,
		}
	}
	if (state.handle === "rotation") {
		const startAngle = Math.atan2(
			state.startWorld.y - anchor.y,
			state.startWorld.x - anchor.x,
		)
		const currentAngle = Math.atan2(
			state.currentWorld.y - anchor.y,
			state.currentWorld.x - anchor.x,
		)
		let rotationDegrees = ((currentAngle - startAngle) * 180) / Math.PI
		if (state.modifiers.shiftKey) {
			const increment =
				policy.rotationSnapDegrees ?? DEFAULT_ROTATION_SNAP_DEGREES
			rotationDegrees = Math.round(rotationDegrees / increment) * increment
		}
		return {
			kind: "transform",
			targetId: state.targetId,
			handle: state.handle,
			bounds: state.bounds,
			anchor,
			delta: { x: 0, y: 0 },
			scale: { x: 1, y: 1 },
			rotationDegrees,
			snaps: state.snaps,
		}
	}
	const startX = state.startWorld.x - anchor.x
	const startY = state.startWorld.y - anchor.y
	let scaleX =
		state.handle === "n" || state.handle === "s"
			? 1
			: startX === 0
				? 1
				: (state.currentWorld.x - anchor.x) / startX
	let scaleY =
		state.handle === "e" || state.handle === "w"
			? 1
			: startY === 0
				? 1
				: (state.currentWorld.y - anchor.y) / startY
	if (state.modifiers.shiftKey) {
		const magnitude =
			Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
		if (state.handle !== "n" && state.handle !== "s") scaleX = magnitude
		if (state.handle !== "e" && state.handle !== "w") scaleY = magnitude
	}
	return {
		kind: "transform",
		targetId: state.targetId,
		handle: state.handle,
		bounds: state.bounds,
		anchor,
		delta: { x: 0, y: 0 },
		scale: { x: scaleX, y: scaleY },
		rotationDegrees: 0,
		snaps: state.snaps,
	}
}

function vectorGesturePreview(
	state: VectorGestureState,
	policy: VectorGesturePolicy,
): VectorGesturePreview {
	if (state.tool === "pen") return penPreview(state, policy)
	if (state.tool === "rect" || state.tool === "ellipse")
		return shapePreview(state, policy)
	if (state.tool === "transform") return transformPreview(state, policy)
	const selection = state as Extract<
		VectorGestureState,
		{ readonly tool: "select" }
	>
	if (selection.targetId === null) {
		return {
			kind: "select-marquee",
			bounds: boundsFrom(selection.startWorld, selection.currentWorld),
			additive: selection.modifiers.additive,
		}
	}
	return {
		kind: "select-move",
		targetId: selection.targetId,
		delta: {
			x: selection.currentWorld.x - selection.startWorld.x,
			y: selection.currentWorld.y - selection.startWorld.y,
		},
		snaps: selection.snaps,
	}
}

function commitIntent(
	preview: VectorGesturePreview,
	state: VectorGestureState,
	policy: VectorGesturePolicy,
): VectorGestureCommitIntent | null {
	if (preview.kind === "pen")
		return {
			kind: "pen-node",
			targetId: state.tool === "pen" ? state.targetId : null,
			point: preview.point,
			mode: preview.mode,
			handles: preview.handles,
			distancePixels: preview.distancePixels,
		}
	if (preview.kind === "shape" && !preview.valid) return null
	if (
		preview.kind !== "select-marquee" &&
		pointerDistance(state) <
			(policy.thresholdPixels ?? DEFAULT_THRESHOLD_PIXELS)
	)
		return null
	return preview
}

function startState(event: VectorGestureDown): VectorGestureState {
	const common = {
		pointerId: event.pointerId,
		startWorld: event.pointer.world,
		rawStartWorld: event.pointer.rawWorld ?? event.pointer.world,
		currentWorld: event.pointer.world,
		rawCurrentWorld: event.pointer.rawWorld ?? event.pointer.world,
		startScreen: event.pointer.screen,
		currentScreen: event.pointer.screen,
		modifiers: event.pointer.modifiers,
		snaps: event.pointer.snaps ?? [],
	}
	if (event.tool === "select")
		return { ...common, tool: event.tool, targetId: event.targetId }
	if (event.tool === "pen")
		return {
			...common,
			tool: event.tool,
			targetId: event.targetId ?? null,
		}
	if (event.tool === "transform") {
		const transform = event as Extract<
			VectorGestureDown,
			{ readonly tool: "transform" }
		>
		return {
			...common,
			tool: transform.tool,
			targetId: transform.targetId,
			bounds: transform.bounds,
			handle: transform.handle,
		}
	}
	return { ...common, tool: event.tool }
}

export function reduceVectorGesture(
	state: VectorGestureState | null,
	event: VectorGestureEvent,
	policy: VectorGesturePolicy,
): VectorGestureTransition {
	if (event.type === "pointer-down") {
		const next = startState(event)
		return {
			state: next,
			preview: vectorGesturePreview(next, policy),
			intent: null,
			canceled: false,
		}
	}
	if (state === null || state.pointerId !== event.pointerId)
		return { state, preview: null, intent: null, canceled: false }
	if (event.type === "pointer-cancel")
		return { state: null, preview: null, intent: null, canceled: true }
	const next: VectorGestureState =
		event.type === "modifiers"
			? { ...state, modifiers: event.modifiers }
			: {
					...state,
					currentWorld: event.pointer.world,
					rawCurrentWorld: event.pointer.rawWorld ?? event.pointer.world,
					currentScreen: event.pointer.screen,
					modifiers: event.pointer.modifiers,
					snaps: event.pointer.snaps ?? [],
				}
	const preview = vectorGesturePreview(next, policy)
	if (event.type !== "pointer-up")
		return { state: next, preview, intent: null, canceled: false }
	return {
		state: null,
		preview: null,
		intent: commitIntent(preview, next, policy),
		canceled: false,
	}
}

/**
 * Rule persistence is intentionally outside this contract: create-font stores
 * angular glyph measurements while create-design stores page guides. Both use
 * the shared canvas point/line geometry, but neither is forced into a lossy
 * universal rule document type.
 */
