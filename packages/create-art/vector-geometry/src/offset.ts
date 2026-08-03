import { normalizeContour, type NormalizeContourOptions } from "./contours.ts"
import {
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Contour, Point } from "./types.ts"
import { add, cross, distance, length, scale, subtract } from "./vector.ts"

export interface OffsetContourOptions {
	readonly tolerances?: Partial<GeometryTolerances>
	readonly join?: "bevel" | "miter"
	readonly miterLimit?: number
}

interface OffsetSegment {
	readonly start: Point
	readonly end: Point
	readonly direction: Point
	readonly normal: Point
}

const offsetSegments = (
	points: readonly Point[],
	closed: boolean,
	amount: number,
): readonly OffsetSegment[] => {
	const count = Math.max(0, points.length - (closed ? 0 : 1))
	const segments: OffsetSegment[] = []
	for (let index = 0; index < count; index += 1) {
		const start = points[index]
		const end = points[(index + 1) % points.length]
		if (start === undefined || end === undefined) continue
		const vector = subtract(end, start)
		const vectorLength = length(vector)
		const direction = scale(vector, 1 / vectorLength)
		const normal = { x: -direction.y, y: direction.x }
		const offset = scale(normal, amount)
		segments.push({
			start: add(start, offset),
			end: add(end, offset),
			direction,
			normal,
		})
	}
	return segments
}

const infiniteLineIntersection = (
	firstPoint: Point,
	firstDirection: Point,
	secondPoint: Point,
	secondDirection: Point,
	parallelTolerance: number,
): Point | null => {
	const determinant = cross(firstDirection, secondDirection)
	if (Math.abs(determinant) <= parallelTolerance) return null
	const parameter =
		cross(subtract(secondPoint, firstPoint), secondDirection) / determinant
	return add(firstPoint, scale(firstDirection, parameter))
}

const appendJoin = (
	result: Point[],
	vertex: Point,
	previous: OffsetSegment,
	next: OffsetSegment,
	amount: number,
	join: "bevel" | "miter",
	miterLimit: number,
	tolerances: GeometryTolerances,
): void => {
	const previousPoint = previous.end
	const nextPoint = next.start
	if (distance(previousPoint, nextPoint) <= tolerances.distance) {
		result.push(nextPoint)
		return
	}
	const intersection = infiniteLineIntersection(
		previousPoint,
		previous.direction,
		nextPoint,
		next.direction,
		tolerances.parameter,
	)
	const acceptableMiter =
		join === "miter" &&
		intersection !== null &&
		distance(vertex, intersection) <=
			Math.abs(amount) * miterLimit + tolerances.distance
	if (acceptableMiter && intersection !== null) {
		result.push(intersection)
	} else {
		result.push(previousPoint, nextPoint)
	}
}

/**
 * Builds a deterministic piecewise-linear parallel offset.
 *
 * Positive distance is to the left of contour direction. Miter joins that
 * exceed the configured limit fall back to bevel. This primitive does not
 * remove loops or perform boolean cleanup after an offset collapses or
 * self-intersects.
 */
export function offsetContour(
	contour: Contour,
	amount: number,
	options: OffsetContourOptions = {},
): Contour {
	if (!Number.isFinite(amount)) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Offset distance must be finite.",
			{ amount },
		)
	}
	const toleranceOverrides: Partial<GeometryTolerances> = {
		...options.tolerances,
		...(options.miterLimit === undefined
			? {}
			: { miterLimit: options.miterLimit }),
	}
	const tolerances = resolveGeometryTolerances(toleranceOverrides)
	const normalizeOptions: NormalizeContourOptions = {
		tolerances,
		orientation: "preserve",
	}
	const normalized = normalizeContour(contour, normalizeOptions)
	if (Math.abs(amount) <= tolerances.distance) return normalized
	const segments = offsetSegments(normalized.points, normalized.closed, amount)
	const join = options.join ?? "miter"
	const points: Point[] = []
	if (normalized.closed) {
		for (let index = 0; index < normalized.points.length; index += 1) {
			const vertex = normalized.points[index]
			const previous = segments[(index - 1 + segments.length) % segments.length]
			const next = segments[index]
			if (
				vertex !== undefined &&
				previous !== undefined &&
				next !== undefined
			) {
				appendJoin(
					points,
					vertex,
					previous,
					next,
					amount,
					join,
					tolerances.miterLimit,
					tolerances,
				)
			}
		}
	} else {
		const firstSegment = segments[0]
		const lastSegment = segments.at(-1)
		if (firstSegment !== undefined) points.push(firstSegment.start)
		for (let index = 1; index + 1 < normalized.points.length; index += 1) {
			const vertex = normalized.points[index]
			const previous = segments[index - 1]
			const next = segments[index]
			if (
				vertex !== undefined &&
				previous !== undefined &&
				next !== undefined
			) {
				appendJoin(
					points,
					vertex,
					previous,
					next,
					amount,
					join,
					tolerances.miterLimit,
					tolerances,
				)
			}
		}
		if (lastSegment !== undefined) points.push(lastSegment.end)
	}
	return normalizeContour(
		{ points, closed: normalized.closed },
		normalizeOptions,
	)
}
