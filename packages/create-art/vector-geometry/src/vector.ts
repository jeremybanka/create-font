import {
	assertFinitePoint,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Bounds, Point } from "./types.ts"

export const add = (left: Point, right: Point): Point => ({
	x: left.x + right.x,
	y: left.y + right.y,
})

export const subtract = (left: Point, right: Point): Point => ({
	x: left.x - right.x,
	y: left.y - right.y,
})

export const scale = (point: Point, amount: number): Point => ({
	x: point.x * amount,
	y: point.y * amount,
})

export const dot = (left: Point, right: Point): number =>
	left.x * right.x + left.y * right.y

export const cross = (left: Point, right: Point): number =>
	left.x * right.y - left.y * right.x

export const squaredLength = (point: Point): number => dot(point, point)

export const length = (point: Point): number => Math.hypot(point.x, point.y)

export const squaredDistance = (left: Point, right: Point): number =>
	squaredLength(subtract(left, right))

export const distance = (left: Point, right: Point): number =>
	Math.hypot(left.x - right.x, left.y - right.y)

export const interpolate = (
	left: Point,
	right: Point,
	amount: number,
): Point => ({
	x: left.x + (right.x - left.x) * amount,
	y: left.y + (right.y - left.y) * amount,
})

export function boundsOfPoints(points: readonly Point[]): Bounds | null {
	if (points.length === 0) return null
	const first = points[0]
	if (first === undefined) return null
	assertFinitePoint(first, "points[0]")
	let minX = first.x
	let minY = first.y
	let maxX = first.x
	let maxY = first.y
	for (let index = 1; index < points.length; index += 1) {
		const point = points[index]
		if (point === undefined) continue
		assertFinitePoint(point, `points[${index}]`)
		minX = Math.min(minX, point.x)
		minY = Math.min(minY, point.y)
		maxX = Math.max(maxX, point.x)
		maxY = Math.max(maxY, point.y)
	}
	return { minX, minY, maxX, maxY }
}

export function pointOnSegment(
	point: Point,
	start: Point,
	end: Point,
	overrides: Partial<GeometryTolerances> = {},
): boolean {
	const tolerances = resolveGeometryTolerances(overrides)
	const segment = subtract(end, start)
	const relative = subtract(point, start)
	const segmentLength = length(segment)
	if (segmentLength <= tolerances.distance) {
		return distance(point, start) <= tolerances.distance
	}
	if (
		Math.abs(cross(segment, relative)) >
		tolerances.distance * segmentLength
	) {
		return false
	}
	const projection = dot(relative, segment) / squaredLength(segment)
	return (
		projection >= -tolerances.parameter &&
		projection <= 1 + tolerances.parameter
	)
}
