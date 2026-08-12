import {
	DEFAULT_GEOMETRY_TOLERANCES,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Point } from "./types.ts"
import { cross, subtract } from "./vector.ts"

export interface InferredCornerPoint<Id extends string = string> {
	readonly id: Id
	readonly point: Point
	readonly incoming?: Point
	readonly outgoing?: Point
	/** Any live corner profile makes this authored node ineligible for inference. */
	readonly corner?: unknown
}

export interface InferredCornerContour<
	ContourId extends string = string,
	PointId extends string = string,
> {
	readonly id: ContourId
	readonly points: readonly InferredCornerPoint<PointId>[]
	readonly closed: boolean
}

export interface InferredCorner<
	ContourId extends string = string,
	PointId extends string = string,
> {
	readonly firstContourId: ContourId
	readonly firstPointId: PointId
	readonly secondContourId: ContourId
	readonly secondPointId: PointId
	readonly intersection: Point
}

export interface LoweredInferredCorners<
	ContourId extends string = string,
	PointId extends string = string,
> {
	readonly contours: readonly InferredCornerContour<ContourId, PointId>[]
	readonly corners: readonly InferredCorner<ContourId, PointId>[]
	readonly overflowSegments: readonly Readonly<{
		start: Point
		end: Point
		pointId: PointId
	}>[]
}

interface Intersection {
	readonly point: Point
	readonly firstParameter: number
	readonly secondParameter: number
}

interface Candidate<PointId extends string> {
	readonly previousIndex: number
	readonly firstIndex: number
	readonly secondIndex: number
	readonly afterIndex: number
	readonly firstPointId: PointId
	readonly secondPointId: PointId
	readonly intersection: Point
}

const OVERFLOW_SAFETY_FACTOR = 2

function segmentIntersection(
	firstStart: Point,
	firstEnd: Point,
	secondStart: Point,
	secondEnd: Point,
	tolerances: GeometryTolerances,
): Intersection | null {
	const firstDirection = subtract(firstEnd, firstStart)
	const secondDirection = subtract(secondEnd, secondStart)
	const firstLength = Math.hypot(firstDirection.x, firstDirection.y)
	const secondLength = Math.hypot(secondDirection.x, secondDirection.y)
	const determinant = cross(firstDirection, secondDirection)
	if (
		Math.abs(determinant) <=
		tolerances.distance * Math.max(1, firstLength, secondLength)
	)
		return null
	const relative = subtract(secondStart, firstStart)
	const firstParameter = cross(relative, secondDirection) / determinant
	const secondParameter = cross(relative, firstDirection) / determinant
	return {
		point: {
			x: firstStart.x + firstDirection.x * firstParameter,
			y: firstStart.y + firstDirection.y * firstParameter,
		},
		firstParameter,
		secondParameter,
	}
}

function isStrictlyInterior(parameter: number, tolerances: GeometryTolerances) {
	const margin = Math.max(
		tolerances.parameter,
		DEFAULT_GEOMETRY_TOLERANCES.parameter,
	)
	return parameter > margin && parameter < 1 - margin
}

function distance(first: Point, second: Point): number {
	return Math.hypot(first.x - second.x, first.y - second.y)
}

function signedArea(points: readonly InferredCornerPoint[]): number {
	return points.reduce((area, point, index) => {
		const next = points[(index + 1) % points.length]!
		return area + point.point.x * next.point.y - next.point.x * point.point.y
	}, 0)
}

function replacementHasNonlocalIntersection<PointId extends string>(
	points: readonly InferredCornerPoint<PointId>[],
	candidate: Candidate<PointId>,
	tolerances: GeometryTolerances,
): boolean {
	const previous = points[candidate.previousIndex]!
	const after = points[candidate.afterIndex]!
	const localEdges = new Set([
		candidate.previousIndex,
		candidate.firstIndex,
		candidate.secondIndex,
	])
	for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex++) {
		if (localEdges.has(edgeIndex)) continue
		const edgeStart = points[edgeIndex]!
		const edgeEnd = points[(edgeIndex + 1) % points.length]!
		for (const [start, end] of [
			[previous.point, candidate.intersection],
			[candidate.intersection, after.point],
		] as const) {
			const intersection = segmentIntersection(
				start,
				end,
				edgeStart.point,
				edgeEnd.point,
				tolerances,
			)
			if (
				intersection !== null &&
				isStrictlyInterior(intersection.firstParameter, tolerances) &&
				intersection.secondParameter >= -tolerances.parameter &&
				intersection.secondParameter <= 1 + tolerances.parameter
			)
				return true
		}
	}
	return false
}

function candidatesForContour<PointId extends string>(
	points: readonly InferredCornerPoint<PointId>[],
	tolerances: GeometryTolerances,
): Candidate<PointId>[] {
	if (points.length < 4) return []
	const candidates: Candidate<PointId>[] = []
	const originalArea = signedArea(points)
	if (Math.abs(originalArea) <= tolerances.distance) return []
	for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
		const previousIndex = (firstIndex - 1 + points.length) % points.length
		const secondIndex = (firstIndex + 1) % points.length
		const afterIndex = (firstIndex + 2) % points.length
		const previous = points[previousIndex]!
		const first = points[firstIndex]!
		const second = points[secondIndex]!
		const after = points[afterIndex]!
		if (
			[previous, first, second, after].some(
				(point) =>
					point.incoming !== undefined ||
					point.outgoing !== undefined ||
					point.corner !== undefined,
			)
		)
			continue
		const intersection = segmentIntersection(
			previous.point,
			first.point,
			second.point,
			after.point,
			tolerances,
		)
		if (
			intersection === null ||
			!isStrictlyInterior(intersection.firstParameter, tolerances) ||
			!isStrictlyInterior(intersection.secondParameter, tolerances)
		)
			continue
		const firstOverflow = distance(first.point, intersection.point)
		const secondOverflow = distance(second.point, intersection.point)
		const firstVisible = distance(previous.point, intersection.point)
		const secondVisible = distance(intersection.point, after.point)
		if (
			firstOverflow <= tolerances.distance ||
			secondOverflow <= tolerances.distance ||
			firstVisible < firstOverflow * OVERFLOW_SAFETY_FACTOR ||
			secondVisible < secondOverflow * OVERFLOW_SAFETY_FACTOR
		)
			continue
		const candidate: Candidate<PointId> = {
			previousIndex,
			firstIndex,
			secondIndex,
			afterIndex,
			firstPointId: first.id,
			secondPointId: second.id,
			intersection: intersection.point,
		}
		if (replacementHasNonlocalIntersection(points, candidate, tolerances))
			continue
		const replacement = points.flatMap((point, index) =>
			index === secondIndex
				? []
				: [
						index === firstIndex
							? { ...point, point: intersection.point }
							: point,
					],
		)
		const replacementArea = signedArea(replacement)
		if (
			Math.abs(replacementArea) <= tolerances.distance ||
			Math.sign(replacementArea) !== Math.sign(originalArea)
		)
			continue
		candidates.push(candidate)
	}
	return candidates
}

/**
 * Recognizes a conservative, geometry-only open-corner idiom within one closed
 * contour: two consecutive overflow nodes bridge straight segments whose
 * incident edges cross strictly inside both segments. Ambiguous and nonlocal
 * geometry is deliberately left unchanged.
 */
export function lowerInferredCorners<
	ContourId extends string,
	PointId extends string,
>(
	contours: readonly InferredCornerContour<ContourId, PointId>[],
	overrides: Partial<GeometryTolerances> = {},
): LoweredInferredCorners<ContourId, PointId> {
	const tolerances = resolveGeometryTolerances(overrides)
	const corners: InferredCorner<ContourId, PointId>[] = []
	const overflowSegments: { start: Point; end: Point; pointId: PointId }[] = []
	const loweredContours = contours.map((contour) => {
		if (!contour.closed) return contour
		const candidates = candidatesForContour(contour.points, tolerances)
		const neighborhoodCounts = new Map<number, number>()
		for (const candidate of candidates)
			for (const index of [
				candidate.previousIndex,
				candidate.firstIndex,
				candidate.secondIndex,
				candidate.afterIndex,
			])
				neighborhoodCounts.set(index, (neighborhoodCounts.get(index) ?? 0) + 1)
		const accepted = candidates.filter((candidate) =>
			[
				candidate.previousIndex,
				candidate.firstIndex,
				candidate.secondIndex,
				candidate.afterIndex,
			].every((index) => neighborhoodCounts.get(index) === 1),
		)
		const byFirstIndex = new Map(
			accepted.map((candidate) => [candidate.firstIndex, candidate]),
		)
		const consumed = new Set(accepted.map((candidate) => candidate.secondIndex))
		for (const candidate of accepted) {
			const first = contour.points[candidate.firstIndex]!
			const second = contour.points[candidate.secondIndex]!
			corners.push({
				firstContourId: contour.id,
				firstPointId: first.id,
				secondContourId: contour.id,
				secondPointId: second.id,
				intersection: candidate.intersection,
			})
			overflowSegments.push(
				{ start: candidate.intersection, end: first.point, pointId: first.id },
				{ start: first.point, end: second.point, pointId: first.id },
				{
					start: second.point,
					end: candidate.intersection,
					pointId: second.id,
				},
			)
		}
		if (accepted.length === 0) return contour
		return {
			...contour,
			points: contour.points.flatMap((point, index) => {
				if (consumed.has(index)) return []
				const candidate = byFirstIndex.get(index)
				return [
					candidate === undefined
						? point
						: { ...point, point: candidate.intersection },
				]
			}),
		}
	})
	return { contours: loweredContours, corners, overflowSegments }
}
