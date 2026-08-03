import { flattenCubic } from "./cubic.ts"
import {
	assertFinitePoint,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Cubic, Point } from "./types.ts"
import {
	cross,
	distance,
	dot,
	interpolate,
	length,
	pointOnSegment,
	squaredLength,
	subtract,
} from "./vector.ts"

export interface PointIntersection {
	readonly kind: "cross" | "touch"
	readonly point: Point
	readonly firstParameter: number
	readonly secondParameter: number
}

export interface OverlapIntersection {
	readonly kind: "overlap"
	readonly start: Point
	readonly end: Point
	readonly firstRange: readonly [number, number]
	readonly secondRange: readonly [number, number]
}

export type SegmentIntersection = PointIntersection | OverlapIntersection

export type PolylineIntersection = SegmentIntersection & {
	readonly firstSegment: number
	readonly secondSegment: number
}

export type CubicIntersection = SegmentIntersection

const clampParameter = (value: number, tolerance: number): number => {
	if (value < 0 && value >= -tolerance) return 0
	if (value > 1 && value <= 1 + tolerance) return 1
	return value
}

const parameterOnSegment = (point: Point, start: Point, end: Point): number => {
	const segment = subtract(end, start)
	const denominator = squaredLength(segment)
	if (denominator === 0) return 0
	return dot(subtract(point, start), segment) / denominator
}

const pointIntersection = (
	firstStart: Point,
	firstEnd: Point,
	secondStart: Point,
	secondEnd: Point,
	firstParameter: number,
	secondParameter: number,
	parameterTolerance: number,
	forceTouch = false,
): PointIntersection => {
	const first = clampParameter(firstParameter, parameterTolerance)
	const second = clampParameter(secondParameter, parameterTolerance)
	const firstPoint = interpolate(firstStart, firstEnd, first)
	const secondPoint = interpolate(secondStart, secondEnd, second)
	const point = {
		x: (firstPoint.x + secondPoint.x) / 2,
		y: (firstPoint.y + secondPoint.y) / 2,
	}
	const endpoint =
		first <= parameterTolerance ||
		first >= 1 - parameterTolerance ||
		second <= parameterTolerance ||
		second >= 1 - parameterTolerance
	return {
		kind: forceTouch || endpoint ? "touch" : "cross",
		point,
		firstParameter: first,
		secondParameter: second,
	}
}

/**
 * Intersects two finite line segments.
 *
 * A single endpoint/degenerate contact is `touch`; a positive-length
 * collinear contact is `overlap`; every other interior contact is `cross`.
 */
export function intersectSegments(
	firstStart: Point,
	firstEnd: Point,
	secondStart: Point,
	secondEnd: Point,
	overrides: Partial<GeometryTolerances> = {},
): SegmentIntersection | null {
	assertFinitePoint(firstStart, "firstStart")
	assertFinitePoint(firstEnd, "firstEnd")
	assertFinitePoint(secondStart, "secondStart")
	assertFinitePoint(secondEnd, "secondEnd")
	const tolerances = resolveGeometryTolerances(overrides)
	const firstVector = subtract(firstEnd, firstStart)
	const secondVector = subtract(secondEnd, secondStart)
	const firstLength = length(firstVector)
	const secondLength = length(secondVector)
	const firstDegenerate = firstLength <= tolerances.distance
	const secondDegenerate = secondLength <= tolerances.distance

	if (firstDegenerate && secondDegenerate) {
		if (distance(firstStart, secondStart) > tolerances.distance) return null
		return pointIntersection(
			firstStart,
			firstEnd,
			secondStart,
			secondEnd,
			0,
			0,
			tolerances.parameter,
			true,
		)
	}
	if (firstDegenerate) {
		if (!pointOnSegment(firstStart, secondStart, secondEnd, tolerances)) {
			return null
		}
		return pointIntersection(
			firstStart,
			firstEnd,
			secondStart,
			secondEnd,
			0,
			parameterOnSegment(firstStart, secondStart, secondEnd),
			tolerances.parameter,
			true,
		)
	}
	if (secondDegenerate) {
		if (!pointOnSegment(secondStart, firstStart, firstEnd, tolerances)) {
			return null
		}
		return pointIntersection(
			firstStart,
			firstEnd,
			secondStart,
			secondEnd,
			parameterOnSegment(secondStart, firstStart, firstEnd),
			0,
			tolerances.parameter,
			true,
		)
	}

	const relativeStart = subtract(secondStart, firstStart)
	const determinant = cross(firstVector, secondVector)
	const determinantTolerance =
		tolerances.distance * Math.max(1, firstLength, secondLength)
	if (Math.abs(determinant) > determinantTolerance) {
		const firstParameter = cross(relativeStart, secondVector) / determinant
		const secondParameter = cross(relativeStart, firstVector) / determinant
		if (
			firstParameter < -tolerances.parameter ||
			firstParameter > 1 + tolerances.parameter ||
			secondParameter < -tolerances.parameter ||
			secondParameter > 1 + tolerances.parameter
		) {
			return null
		}
		return pointIntersection(
			firstStart,
			firstEnd,
			secondStart,
			secondEnd,
			firstParameter,
			secondParameter,
			tolerances.parameter,
		)
	}

	if (
		Math.abs(cross(relativeStart, firstVector)) >
		tolerances.distance * firstLength
	) {
		return null
	}
	const secondStartOnFirst = parameterOnSegment(
		secondStart,
		firstStart,
		firstEnd,
	)
	const secondEndOnFirst = parameterOnSegment(secondEnd, firstStart, firstEnd)
	const overlapStart = Math.max(
		0,
		Math.min(secondStartOnFirst, secondEndOnFirst),
	)
	const overlapEnd = Math.min(1, Math.max(secondStartOnFirst, secondEndOnFirst))
	if (overlapEnd < overlapStart - tolerances.parameter) return null
	if ((overlapEnd - overlapStart) * firstLength <= tolerances.distance) {
		const firstParameter = (overlapStart + overlapEnd) / 2
		const point = interpolate(firstStart, firstEnd, firstParameter)
		return pointIntersection(
			firstStart,
			firstEnd,
			secondStart,
			secondEnd,
			firstParameter,
			parameterOnSegment(point, secondStart, secondEnd),
			tolerances.parameter,
			true,
		)
	}
	const start = interpolate(firstStart, firstEnd, overlapStart)
	const end = interpolate(firstStart, firstEnd, overlapEnd)
	const secondAtStart = clampParameter(
		parameterOnSegment(start, secondStart, secondEnd),
		tolerances.parameter,
	)
	const secondAtEnd = clampParameter(
		parameterOnSegment(end, secondStart, secondEnd),
		tolerances.parameter,
	)
	return {
		kind: "overlap",
		start,
		end,
		firstRange: [overlapStart, overlapEnd],
		secondRange: [secondAtStart, secondAtEnd],
	}
}

interface Segment {
	readonly start: Point
	readonly end: Point
	readonly index: number
}

const segmentsOf = (
	points: readonly Point[],
	closed: boolean,
): readonly Segment[] => {
	const count = Math.max(0, points.length - (closed ? 0 : 1))
	const segments: Segment[] = []
	for (let index = 0; index < count; index += 1) {
		const start = points[index]
		const end = points[(index + 1) % points.length]
		if (start !== undefined && end !== undefined) {
			segments.push({ start, end, index })
		}
	}
	return segments
}

const intersectionPoint = (intersection: SegmentIntersection): Point =>
	intersection.kind === "overlap" ? intersection.start : intersection.point

const compareIntersections = (
	left: PolylineIntersection,
	right: PolylineIntersection,
): number => {
	const pointLeft = intersectionPoint(left)
	const pointRight = intersectionPoint(right)
	return (
		left.firstSegment - right.firstSegment ||
		left.secondSegment - right.secondSegment ||
		(left.kind === right.kind ? 0 : left.kind.localeCompare(right.kind)) ||
		pointLeft.x - pointRight.x ||
		pointLeft.y - pointRight.y
	)
}

const deduplicateIntersections = (
	intersections: readonly PolylineIntersection[],
	tolerances: GeometryTolerances,
): readonly PolylineIntersection[] => {
	const result: PolylineIntersection[] = []
	for (const intersection of intersections) {
		const duplicate = result.some((existing) => {
			if (existing.kind !== intersection.kind) return false
			if (existing.kind === "overlap" && intersection.kind === "overlap") {
				return (
					distance(existing.start, intersection.start) <= tolerances.distance &&
					distance(existing.end, intersection.end) <= tolerances.distance
				)
			}
			if (existing.kind !== "overlap" && intersection.kind !== "overlap") {
				return (
					distance(existing.point, intersection.point) <= tolerances.distance
				)
			}
			return false
		})
		if (!duplicate) result.push(intersection)
	}
	return result
}

export function intersectPolylines(
	first: readonly Point[],
	second: readonly Point[],
	options: Readonly<{
		firstClosed?: boolean
		secondClosed?: boolean
		tolerances?: Partial<GeometryTolerances>
	}> = {},
): readonly PolylineIntersection[] {
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const intersections: PolylineIntersection[] = []
	for (const firstSegment of segmentsOf(first, options.firstClosed ?? false)) {
		for (const secondSegment of segmentsOf(
			second,
			options.secondClosed ?? false,
		)) {
			const intersection = intersectSegments(
				firstSegment.start,
				firstSegment.end,
				secondSegment.start,
				secondSegment.end,
				tolerances,
			)
			if (intersection !== null) {
				intersections.push({
					...intersection,
					firstSegment: firstSegment.index,
					secondSegment: secondSegment.index,
				})
			}
		}
	}
	intersections.sort(compareIntersections)
	return deduplicateIntersections(intersections, tolerances)
}

export function selfIntersections(
	points: readonly Point[],
	options: Readonly<{
		closed?: boolean
		tolerances?: Partial<GeometryTolerances>
	}> = {},
): readonly PolylineIntersection[] {
	const closed = options.closed ?? false
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const segments = segmentsOf(points, closed)
	const intersections: PolylineIntersection[] = []
	for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
		const first = segments[firstIndex]
		if (first === undefined) continue
		for (
			let secondIndex = firstIndex + 1;
			secondIndex < segments.length;
			secondIndex += 1
		) {
			const second = segments[secondIndex]
			if (second === undefined) continue
			const adjacent =
				secondIndex === firstIndex + 1 ||
				(closed && firstIndex === 0 && secondIndex === segments.length - 1)
			if (adjacent) continue
			const intersection = intersectSegments(
				first.start,
				first.end,
				second.start,
				second.end,
				tolerances,
			)
			if (intersection !== null) {
				intersections.push({
					...intersection,
					firstSegment: first.index,
					secondSegment: second.index,
				})
			}
		}
	}
	intersections.sort(compareIntersections)
	return deduplicateIntersections(intersections, tolerances)
}

const remapIntersection = (
	intersection: SegmentIntersection,
	firstStart: number,
	firstEnd: number,
	secondStart: number,
	secondEnd: number,
): CubicIntersection => {
	const remapFirst = (parameter: number): number =>
		firstStart + (firstEnd - firstStart) * parameter
	const remapSecond = (parameter: number): number =>
		secondStart + (secondEnd - secondStart) * parameter
	if (intersection.kind === "overlap") {
		return {
			...intersection,
			firstRange: [
				remapFirst(intersection.firstRange[0]),
				remapFirst(intersection.firstRange[1]),
			],
			secondRange: [
				remapSecond(intersection.secondRange[0]),
				remapSecond(intersection.secondRange[1]),
			],
		}
	}
	return {
		...intersection,
		firstParameter: remapFirst(intersection.firstParameter),
		secondParameter: remapSecond(intersection.secondParameter),
	}
}

/**
 * Approximate cubic/cubic intersections after adaptive flattening.
 *
 * Intersection coordinates and parameters inherit the configured flattening
 * error. Results are deterministically ordered by source parameters.
 */
export function intersectCubicCurves(
	first: Cubic,
	second: Cubic,
	overrides: Partial<GeometryTolerances> = {},
): readonly CubicIntersection[] {
	const tolerances = resolveGeometryTolerances(overrides)
	const firstPoints = flattenCubic(first, tolerances)
	const secondPoints = flattenCubic(second, tolerances)
	const found: CubicIntersection[] = []
	for (
		let firstIndex = 0;
		firstIndex + 1 < firstPoints.length;
		firstIndex += 1
	) {
		const firstStart = firstPoints[firstIndex]
		const firstEnd = firstPoints[firstIndex + 1]
		if (firstStart === undefined || firstEnd === undefined) continue
		for (
			let secondIndex = 0;
			secondIndex + 1 < secondPoints.length;
			secondIndex += 1
		) {
			const secondStart = secondPoints[secondIndex]
			const secondEnd = secondPoints[secondIndex + 1]
			if (secondStart === undefined || secondEnd === undefined) continue
			const intersection = intersectSegments(
				firstStart,
				firstEnd,
				secondStart,
				secondEnd,
				tolerances,
			)
			if (intersection === null) continue
			found.push(
				remapIntersection(
					intersection,
					firstStart.parameter,
					firstEnd.parameter,
					secondStart.parameter,
					secondEnd.parameter,
				),
			)
		}
	}
	found.sort((left, right) => {
		const leftFirst =
			left.kind === "overlap" ? left.firstRange[0] : left.firstParameter
		const rightFirst =
			right.kind === "overlap" ? right.firstRange[0] : right.firstParameter
		const leftSecond =
			left.kind === "overlap" ? left.secondRange[0] : left.secondParameter
		const rightSecond =
			right.kind === "overlap" ? right.secondRange[0] : right.secondParameter
		return leftFirst - rightFirst || leftSecond - rightSecond
	})
	const result: CubicIntersection[] = []
	for (const intersection of found) {
		const point = intersectionPoint(intersection)
		if (
			result.some(
				(existing) =>
					existing.kind === intersection.kind &&
					distance(intersectionPoint(existing), point) <= tolerances.distance,
			)
		) {
			continue
		}
		result.push(intersection)
	}
	return result
}
