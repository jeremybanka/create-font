import {
	evaluateCubic,
	fitCubicContour,
	splitCubic,
	type Bounds,
	type Cubic,
} from "@create-art/vector-geometry"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
} from "@create-design/model"

import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "./types.ts"

export type PerspectiveHandle =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"

export type PerspectiveQuad = readonly [
	DesignPointLike,
	DesignPointLike,
	DesignPointLike,
	DesignPointLike,
]

export interface DesignPointLike {
	readonly x: number
	readonly y: number
}

export interface PerspectiveModifiers {
	readonly shiftKey: boolean
	readonly altKey: boolean
}

export const PERSPECTIVE_BAKE_MAX_ERROR = 0.25
const PERSPECTIVE_SAMPLE_ERROR = 0.05
const PERSPECTIVE_REFIT_ERROR =
	PERSPECTIVE_BAKE_MAX_ERROR - PERSPECTIVE_SAMPLE_ERROR
const MINIMUM_CAGE_SIZE = 1e-6
const MAX_SUBDIVISION_DEPTH = 18

export function perspectiveQuadFromBounds(bounds: Bounds): PerspectiveQuad {
	return [
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.maxY },
		{ x: bounds.minX, y: bounds.maxY },
	]
}

export function perspectiveHandlePoint(
	quad: PerspectiveQuad,
	handle: PerspectiveHandle,
): DesignPointLike {
	const [nw, ne, se, sw] = quad
	if (handle === "nw") return nw
	if (handle === "ne") return ne
	if (handle === "se") return se
	if (handle === "sw") return sw
	if (handle === "n") return midpoint(nw, ne)
	if (handle === "e") return midpoint(ne, se)
	if (handle === "s") return midpoint(sw, se)
	return midpoint(nw, sw)
}

const midpoint = (
	first: DesignPointLike,
	second: DesignPointLike,
): DesignPointLike => ({
	x: (first.x + second.x) / 2,
	y: (first.y + second.y) / 2,
})

function constrainedDelta(
	bounds: Bounds,
	handle: PerspectiveHandle,
	delta: DesignPointLike,
	shiftKey: boolean,
): DesignPointLike {
	if (!shiftKey) return delta
	if (handle.length === 2) {
		return Math.abs(delta.x) >= Math.abs(delta.y)
			? { x: delta.x, y: 0 }
			: { x: 0, y: delta.y }
	}
	const perpendicularSize =
		handle === "n" || handle === "s"
			? bounds.maxY - bounds.minY
			: bounds.maxX - bounds.minX
	const displacement = handle === "n" || handle === "s" ? delta.x : delta.y
	const angle = Math.atan2(displacement, perpendicularSize)
	const increment = Math.PI / 12
	const constrained =
		Math.tan(Math.round(angle / increment) * increment) * perpendicularSize
	return handle === "n" || handle === "s"
		? { x: constrained, y: 0 }
		: { x: 0, y: constrained }
}

/**
 * Resolves a cage gesture. Side handles shear parallel to their edge. Corner
 * handles move one projective control; Shift keeps its dominant axis. Alt
 * mirrors the corresponding opposite edge/corner around the cage center.
 */
export function resolvePerspectiveQuad(
	bounds: Bounds,
	handle: PerspectiveHandle,
	start: DesignPointLike,
	current: DesignPointLike,
	modifiers: PerspectiveModifiers,
): PerspectiveQuad {
	const source = perspectiveQuadFromBounds(bounds)
	const rawDelta = { x: current.x - start.x, y: current.y - start.y }
	const delta = constrainedDelta(bounds, handle, rawDelta, modifiers.shiftKey)
	const quad = source.map((point) => ({ ...point })) as [
		DesignPointLike,
		DesignPointLike,
		DesignPointLike,
		DesignPointLike,
	]
	const move = (index: number, x: number, y: number): void => {
		quad[index] = { x: quad[index]!.x + x, y: quad[index]!.y + y }
	}
	if (
		handle === "nw" ||
		handle === "ne" ||
		handle === "se" ||
		handle === "sw"
	) {
		const index = { nw: 0, ne: 1, se: 2, sw: 3 }[handle]
		move(index, delta.x, delta.y)
		if (modifiers.altKey) move((index + 2) % 4, -delta.x, -delta.y)
	} else if (handle === "n" || handle === "s") {
		const indices = handle === "n" ? ([0, 1] as const) : ([3, 2] as const)
		for (const index of indices) move(index, delta.x, 0)
		if (modifiers.altKey)
			for (const index of handle === "n"
				? ([3, 2] as const)
				: ([0, 1] as const))
				move(index, -delta.x, 0)
	} else {
		const indices = handle === "w" ? ([0, 3] as const) : ([1, 2] as const)
		for (const index of indices) move(index, 0, delta.y)
		if (modifiers.altKey)
			for (const index of handle === "w"
				? ([1, 2] as const)
				: ([0, 3] as const))
				move(index, 0, -delta.y)
	}
	return quad
}

export type PerspectiveEligibility =
	| Readonly<{ eligible: true }>
	| Readonly<{ eligible: false; reason: string }>

export function perspectiveTransformEligibility(
	document: DesignDocument,
	objects: readonly DesignObject[],
): PerspectiveEligibility {
	if (objects.length === 0)
		return {
			eligible: false,
			reason: "Select one or more vector objects to distort.",
		}
	if (objects.some(({ hidden, locked }) => hidden || locked))
		return {
			eligible: false,
			reason: "Show and unlock every selected object before distorting it.",
		}
	if (objects.some(({ appearance }) => appearance.stroke !== undefined))
		return {
			eligible: false,
			reason: "Expand or remove strokes before using Perspective Transform.",
		}
	const unsupported = objects.find(
		({ geometry }) =>
			geometry.kind === "text" ||
			geometry.kind === "image" ||
			geometry.kind === "artboard-link",
	)
	if (unsupported !== undefined)
		return {
			eligible: false,
			reason:
				unsupported.geometry.kind === "text"
					? "Perspective Transform does not outline live text; convert it to paths first."
					: unsupported.geometry.kind === "image"
						? "Perspective Transform does not warp raster images yet."
						: "Perspective Transform does not expand linked artboards yet.",
		}
	const ids = new Set(objects.map(({ id }) => id))
	if (
		document.groups?.some(
			({ clippingPathId }) =>
				clippingPathId !== undefined && ids.has(clippingPathId),
		)
	)
		return {
			eligible: false,
			reason: "Release the clipping mask before using Perspective Transform.",
		}
	if (
		document.blends?.some(
			({ startObjectId, endObjectId }) =>
				ids.has(startObjectId) || ids.has(endObjectId),
		)
	)
		return {
			eligible: false,
			reason: "Expand the live blend before using Perspective Transform.",
		}
	return { eligible: true }
}

interface Homography {
	readonly a: number
	readonly b: number
	readonly c: number
	readonly d: number
	readonly e: number
	readonly f: number
	readonly g: number
	readonly h: number
}

function signedCross(
	first: DesignPointLike,
	second: DesignPointLike,
	third: DesignPointLike,
): number {
	return (
		(second.x - first.x) * (third.y - second.y) -
		(second.y - first.y) * (third.x - second.x)
	)
}

export function validPerspectiveQuad(quad: PerspectiveQuad): boolean {
	if (!quad.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
		return false
	const crosses = quad.map((point, index) =>
		signedCross(point, quad[(index + 1) % 4]!, quad[(index + 2) % 4]!),
	)
	return (
		crosses.every((value) => Math.abs(value) > MINIMUM_CAGE_SIZE) &&
		(crosses.every((value) => value > 0) || crosses.every((value) => value < 0))
	)
}

function homographyFor(
	bounds: Bounds,
	quad: PerspectiveQuad,
): Homography | null {
	if (!validPerspectiveQuad(quad)) return null
	const width = bounds.maxX - bounds.minX
	const height = bounds.maxY - bounds.minY
	if (width <= MINIMUM_CAGE_SIZE || height <= MINIMUM_CAGE_SIZE) return null
	const [p0, p1, p2, p3] = quad
	const dx1 = p1.x - p2.x
	const dx2 = p3.x - p2.x
	const dx3 = p0.x - p1.x + p2.x - p3.x
	const dy1 = p1.y - p2.y
	const dy2 = p3.y - p2.y
	const dy3 = p0.y - p1.y + p2.y - p3.y
	const denominator = dx1 * dy2 - dx2 * dy1
	let g = 0
	let h = 0
	if (Math.abs(dx3) > Number.EPSILON || Math.abs(dy3) > Number.EPSILON) {
		if (Math.abs(denominator) <= Number.EPSILON) return null
		g = (dx3 * dy2 - dx2 * dy3) / denominator
		h = (dx1 * dy3 - dx3 * dy1) / denominator
	}
	const a = p1.x - p0.x + g * p1.x
	const b = p3.x - p0.x + h * p3.x
	const d = p1.y - p0.y + g * p1.y
	const e = p3.y - p0.y + h * p3.y
	const cornerDenominators = [1, 1 + g, 1 + h, 1 + g + h]
	if (cornerDenominators.some((value) => value <= MINIMUM_CAGE_SIZE))
		return null
	return { a, b, c: p0.x, d, e, f: p0.y, g, h }
}

function mapPoint(
	homography: Homography,
	bounds: Bounds,
	point: DesignPointLike,
): DesignPointLike | null {
	const u = (point.x - bounds.minX) / (bounds.maxX - bounds.minX)
	const v = (point.y - bounds.minY) / (bounds.maxY - bounds.minY)
	const denominator = homography.g * u + homography.h * v + 1
	if (denominator <= MINIMUM_CAGE_SIZE) return null
	const mapped = {
		x: (homography.a * u + homography.b * v + homography.c) / denominator,
		y: (homography.d * u + homography.e * v + homography.f) / denominator,
	}
	return Number.isFinite(mapped.x) && Number.isFinite(mapped.y) ? mapped : null
}

const pointLineDistance = (
	point: DesignPointLike,
	start: DesignPointLike,
	end: DesignPointLike,
): number => {
	const dx = end.x - start.x
	const dy = end.y - start.y
	const lengthSquared = dx * dx + dy * dy
	if (lengthSquared === 0)
		return Math.hypot(point.x - start.x, point.y - start.y)
	const t = Math.max(
		0,
		Math.min(
			1,
			((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
		),
	)
	return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function flattenMappedCubic(
	cubic: Cubic,
	homography: Homography,
	bounds: Bounds,
	depth = 0,
): readonly DesignPointLike[] | null {
	const samples = [0, 0.25, 0.5, 0.75, 1].map((t) =>
		mapPoint(homography, bounds, evaluateCubic(cubic, t)),
	)
	if (samples.some((point) => point === null)) return null
	const [start, quarter, middle, threeQuarter, end] =
		samples as readonly DesignPointLike[]
	const error = Math.max(
		pointLineDistance(quarter!, start!, end!),
		pointLineDistance(middle!, start!, end!),
		pointLineDistance(threeQuarter!, start!, end!),
	)
	if (error <= PERSPECTIVE_SAMPLE_ERROR || depth >= MAX_SUBDIVISION_DEPTH)
		return [start!, end!]
	const split = splitCubic(cubic, 0.5)
	const left = flattenMappedCubic(split.left, homography, bounds, depth + 1)
	const right = flattenMappedCubic(split.right, homography, bounds, depth + 1)
	return left === null || right === null ? null : [...left, ...right.slice(1)]
}

const cubicFor = (from: DesignPoint, to: DesignPoint): Cubic => ({
	p0: from,
	c1: {
		x: from.x + (from.outgoing?.x ?? 0),
		y: from.y + (from.outgoing?.y ?? 0),
	},
	c2: { x: to.x + (to.incoming?.x ?? 0), y: to.y + (to.incoming?.y ?? 0) },
	p3: to,
})

function fittedPoints(
	cubics: readonly Cubic[],
	closed: boolean,
	idPrefix: string,
): readonly DesignPoint[] {
	if (closed)
		return cubics.map((cubic, index) => {
			const previous = cubics[(index - 1 + cubics.length) % cubics.length]!
			return {
				id: `${idPrefix}:point:${index}`,
				x: cubic.p0.x,
				y: cubic.p0.y,
				incoming: {
					x: previous.c2.x - cubic.p0.x,
					y: previous.c2.y - cubic.p0.y,
				},
				outgoing: { x: cubic.c1.x - cubic.p0.x, y: cubic.c1.y - cubic.p0.y },
			}
		})
	const result: DesignPoint[] = []
	for (const [index, cubic] of cubics.entries()) {
		if (index === 0)
			result.push({
				id: `${idPrefix}:point:0`,
				x: cubic.p0.x,
				y: cubic.p0.y,
				outgoing: { x: cubic.c1.x - cubic.p0.x, y: cubic.c1.y - cubic.p0.y },
			})
		const next = cubics[index + 1]
		result.push({
			id: `${idPrefix}:point:${index + 1}`,
			x: cubic.p3.x,
			y: cubic.p3.y,
			incoming: { x: cubic.c2.x - cubic.p3.x, y: cubic.c2.y - cubic.p3.y },
			...(next === undefined
				? {}
				: {
						outgoing: { x: next.c1.x - cubic.p3.x, y: next.c1.y - cubic.p3.y },
					}),
		})
	}
	return result
}

function bakeContour(
	contour: DesignContour,
	homography: Homography,
	bounds: Bounds,
): DesignContour | null {
	const first = contour.points[0]
	if (first === undefined) return { ...contour, points: [] }
	const count = contour.closed
		? contour.points.length
		: contour.points.length - 1
	let samples: readonly DesignPointLike[] = []
	for (let index = 0; index < count; index += 1) {
		const from = contour.points[index]
		const to = contour.points[(index + 1) % contour.points.length]
		if (from === undefined || to === undefined) continue
		const segment = flattenMappedCubic(cubicFor(from, to), homography, bounds)
		if (segment === null) return null
		samples = samples.length === 0 ? segment : [...samples, ...segment.slice(1)]
	}
	if (contour.closed && samples.length > 1) samples = samples.slice(0, -1)
	const minimum = contour.closed ? 3 : 2
	if (samples.length < minimum) return null
	try {
		const fit = fitCubicContour(
			{ points: samples, closed: contour.closed },
			{ maxError: PERSPECTIVE_REFIT_ERROR, cornerAngleDegrees: 30 },
		)
		if (fit.length > 0)
			return {
				...contour,
				points: fittedPoints(fit, contour.closed, contour.id),
			}
	} catch {
		// The deterministic polyline remains within the sampling error contract.
	}
	return {
		...contour,
		points: samples.map((point, index) => ({
			id: `${contour.id}:point:${index}`,
			x: point.x,
			y: point.y,
			mode: "hard" as const,
		})),
	}
}

export type PerspectiveBakeResult =
	| Readonly<{ ok: true; objects: readonly DesignObject[] }>
	| Readonly<{ ok: false; error: string }>

/** Bakes the homography to ordinary document-space paths; no affine field lies. */
export function bakePerspectiveObjects(
	objects: readonly DesignObject[],
	bounds: Bounds,
	quad: PerspectiveQuad,
): PerspectiveBakeResult {
	const homography = homographyFor(bounds, quad)
	if (homography === null)
		return {
			ok: false,
			error:
				"The perspective cage is degenerate or crosses its projective horizon.",
		}
	const baked: DesignObject[] = []
	for (const object of objects) {
		const source = projectDesignObjectContours(object)
		const contours = source.map((contour) =>
			bakeContour(contour, homography, bounds),
		)
		if (contours.some((contour) => contour === null))
			return {
				ok: false,
				error: `Could not distort ${object.name} without invalid geometry.`,
			}
		baked.push({
			...object,
			geometry: {
				kind: "path",
				...(object.geometry.kind === "path" &&
				object.geometry.fillRule !== undefined
					? { fillRule: object.geometry.fillRule }
					: {}),
				contours: contours as readonly DesignContour[],
			},
			transform: IDENTITY_DESIGN_TRANSFORM,
		})
	}
	return { ok: true, objects: baked }
}
