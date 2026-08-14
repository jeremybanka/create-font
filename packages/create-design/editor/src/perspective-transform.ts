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
	readonly cornerAcquisition?: PerspectiveCornerAcquisition
}

export type PerspectiveCornerAcquisition = "horizontal" | "vertical"

export interface PerspectiveCornerAcquisitionState {
	readonly choice: PerspectiveCornerAcquisition | null
	readonly latched: PerspectiveCornerAcquisition | null
	readonly shiftKey: boolean
}

type PerspectiveCornerHandle = Extract<
	PerspectiveHandle,
	"nw" | "ne" | "se" | "sw"
>

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
	source: PerspectiveQuad,
	handle: PerspectiveHandle,
	delta: DesignPointLike,
	modifiers: PerspectiveModifiers,
): DesignPointLike {
	if (!modifiers.shiftKey) return delta
	if (handle.length === 2) {
		const acquisition =
			modifiers.cornerAcquisition ??
			dominantCornerAcquisition(source, handle, delta) ??
			"horizontal"
		const direction = cornerSideDirection(source, handle, acquisition)
		const amount = delta.x * direction.x + delta.y * direction.y
		return { x: direction.x * amount, y: direction.y * amount }
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

const CORNER_INDEX = { nw: 0, ne: 1, se: 2, sw: 3 } as const
const HORIZONTAL_CORNER_MATE = { nw: 1, ne: 0, se: 3, sw: 2 } as const
const VERTICAL_CORNER_MATE = { nw: 3, ne: 2, se: 1, sw: 0 } as const

function cornerSideMate(
	handle: PerspectiveCornerHandle,
	acquisition: PerspectiveCornerAcquisition,
): number {
	return acquisition === "horizontal"
		? HORIZONTAL_CORNER_MATE[handle]
		: VERTICAL_CORNER_MATE[handle]
}

function cornerSideDirection(
	source: PerspectiveQuad,
	handle: PerspectiveCornerHandle,
	acquisition: PerspectiveCornerAcquisition,
): DesignPointLike {
	const corner = source[CORNER_INDEX[handle]]
	const mate = source[cornerSideMate(handle, acquisition)]
	const dx = corner.x - mate.x
	const dy = corner.y - mate.y
	const length = Math.hypot(dx, dy)
	return length <= MINIMUM_CAGE_SIZE
		? acquisition === "horizontal"
			? { x: 1, y: 0 }
			: { x: 0, y: 1 }
		: { x: dx / length, y: dy / length }
}

function dominantCornerAcquisition(
	source: PerspectiveQuad,
	handle: PerspectiveCornerHandle,
	delta: DesignPointLike,
): PerspectiveCornerAcquisition | null {
	if (
		Math.abs(delta.x) <= Number.EPSILON &&
		Math.abs(delta.y) <= Number.EPSILON
	)
		return null
	const horizontal = cornerSideDirection(source, handle, "horizontal")
	const vertical = cornerSideDirection(source, handle, "vertical")
	const horizontalAmount = Math.abs(
		delta.x * horizontal.x + delta.y * horizontal.y,
	)
	const verticalAmount = Math.abs(delta.x * vertical.x + delta.y * vertical.y)
	return horizontalAmount >= verticalAmount ? "horizontal" : "vertical"
}

/**
 * Tracks the adjacent side selected by a corner gesture. Acquisition follows
 * the current dominant pointer axis until Shift is pressed. Shift freezes the
 * current choice (or the first meaningful choice if held before movement), and
 * releasing Shift resumes dynamic acquisition at the current pointer.
 */
export function resolvePerspectiveCornerAcquisition(
	previous: PerspectiveCornerAcquisitionState | null,
	source: PerspectiveQuad,
	handle: PerspectiveCornerHandle,
	delta: DesignPointLike,
	shiftKey: boolean,
): PerspectiveCornerAcquisitionState {
	const dynamic = dominantCornerAcquisition(source, handle, delta)
	if (!shiftKey)
		return {
			choice: dynamic ?? previous?.choice ?? null,
			latched: null,
			shiftKey: false,
		}
	const latched = previous?.shiftKey
		? (previous.latched ?? previous.choice ?? dynamic)
		: (previous?.choice ?? dynamic)
	return {
		choice: latched,
		latched,
		shiftKey: true,
	}
}

/**
 * Resolves a cage gesture. Side handles shear parallel to their edge. Corner
 * handles move one projective control. With Alt, the incident side selected by
 * the gesture resizes about its midpoint: the dragged endpoint follows the
 * gesture while its side-mate moves by the opposite delta. Shift projects the
 * delta onto the latched side as well as keeping that side acquired. Alt on an
 * edge continues to mirror its skew across the cage center.
 */
export function resolvePerspectiveQuad(
	bounds: Bounds,
	handle: PerspectiveHandle,
	start: DesignPointLike,
	current: DesignPointLike,
	modifiers: PerspectiveModifiers,
	source: PerspectiveQuad = perspectiveQuadFromBounds(bounds),
): PerspectiveQuad {
	const rawDelta = { x: current.x - start.x, y: current.y - start.y }
	const delta = constrainedDelta(bounds, source, handle, rawDelta, modifiers)
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
		const index = CORNER_INDEX[handle]
		move(index, delta.x, delta.y)
		if (modifiers.altKey) {
			const acquisition =
				modifiers.cornerAcquisition ??
				dominantCornerAcquisition(source, handle, rawDelta) ??
				"horizontal"
			const mate = cornerSideMate(handle, acquisition)
			move(mate, -delta.x, -delta.y)
		}
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

function unitSquareHomographyFor(quad: PerspectiveQuad): Homography | null {
	if (!validPerspectiveQuad(quad)) return null
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

type Matrix3 = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
]

const homographyMatrix = (homography: Homography): Matrix3 => [
	homography.a,
	homography.b,
	homography.c,
	homography.d,
	homography.e,
	homography.f,
	homography.g,
	homography.h,
	1,
]

function inverseMatrix(matrix: Matrix3): Matrix3 | null {
	const [a, b, c, d, e, f, g, h, i] = matrix
	const inverse: Matrix3 = [
		e * i - f * h,
		c * h - b * i,
		b * f - c * e,
		f * g - d * i,
		a * i - c * g,
		c * d - a * f,
		d * h - e * g,
		b * g - a * h,
		a * e - b * d,
	]
	const determinant = a * inverse[0] + b * inverse[3] + c * inverse[6]
	if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON)
		return null
	return [
		inverse[0] / determinant,
		inverse[1] / determinant,
		inverse[2] / determinant,
		inverse[3] / determinant,
		inverse[4] / determinant,
		inverse[5] / determinant,
		inverse[6] / determinant,
		inverse[7] / determinant,
		inverse[8] / determinant,
	]
}

function multiplyMatrices(outer: Matrix3, inner: Matrix3): Matrix3 {
	return [
		outer[0] * inner[0] + outer[1] * inner[3] + outer[2] * inner[6],
		outer[0] * inner[1] + outer[1] * inner[4] + outer[2] * inner[7],
		outer[0] * inner[2] + outer[1] * inner[5] + outer[2] * inner[8],
		outer[3] * inner[0] + outer[4] * inner[3] + outer[5] * inner[6],
		outer[3] * inner[1] + outer[4] * inner[4] + outer[5] * inner[7],
		outer[3] * inner[2] + outer[4] * inner[5] + outer[5] * inner[8],
		outer[6] * inner[0] + outer[7] * inner[3] + outer[8] * inner[6],
		outer[6] * inner[1] + outer[7] * inner[4] + outer[8] * inner[7],
		outer[6] * inner[2] + outer[7] * inner[5] + outer[8] * inner[8],
	]
}

function homographyBetween(
	source: PerspectiveQuad,
	target: PerspectiveQuad,
): Homography | null {
	const sourceHomography = unitSquareHomographyFor(source)
	const targetHomography = unitSquareHomographyFor(target)
	if (sourceHomography === null || targetHomography === null) return null
	const inverseSource = inverseMatrix(homographyMatrix(sourceHomography))
	if (inverseSource === null) return null
	const matrix = multiplyMatrices(
		homographyMatrix(targetHomography),
		inverseSource,
	)
	const scale = matrix[8]
	if (!Number.isFinite(scale) || Math.abs(scale) <= Number.EPSILON) return null
	const normalized = matrix.map((value) => value / scale)
	if (normalized.some((value) => !Number.isFinite(value))) return null
	return {
		a: normalized[0]!,
		b: normalized[1]!,
		c: normalized[2]!,
		d: normalized[3]!,
		e: normalized[4]!,
		f: normalized[5]!,
		g: normalized[6]!,
		h: normalized[7]!,
	}
}

function mapPoint(
	homography: Homography,
	point: DesignPointLike,
): DesignPointLike | null {
	const denominator = homography.g * point.x + homography.h * point.y + 1
	if (Math.abs(denominator) <= MINIMUM_CAGE_SIZE) return null
	const mapped = {
		x:
			(homography.a * point.x + homography.b * point.y + homography.c) /
			denominator,
		y:
			(homography.d * point.x + homography.e * point.y + homography.f) /
			denominator,
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
	depth = 0,
): readonly DesignPointLike[] | null {
	const samples = [0, 0.25, 0.5, 0.75, 1].map((t) =>
		mapPoint(homography, evaluateCubic(cubic, t)),
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
	const left = flattenMappedCubic(split.left, homography, depth + 1)
	const right = flattenMappedCubic(split.right, homography, depth + 1)
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
		const segment = flattenMappedCubic(cubicFor(from, to), homography)
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
	sourceQuad: PerspectiveQuad = perspectiveQuadFromBounds(bounds),
): PerspectiveBakeResult {
	const homography = homographyBetween(sourceQuad, quad)
	if (homography === null)
		return {
			ok: false,
			error:
				"The perspective cage is degenerate or crosses its projective horizon.",
		}
	const baked: DesignObject[] = []
	for (const object of objects) {
		const source = projectDesignObjectContours(object)
		const contours = source.map((contour) => bakeContour(contour, homography))
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
