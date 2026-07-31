import {
	assertFinitePoint,
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
	snapCoordinate,
} from "./tolerances.ts"
import type { Contour, Orientation, Point } from "./types.ts"
import { cross, distance, dot, pointOnSegment, subtract } from "./vector.ts"

export interface WindingResult {
	readonly winding: number
	readonly classification: "boundary" | "inside" | "outside"
}

export interface NormalizeContourOptions {
	readonly tolerances?: Partial<GeometryTolerances>
	/** Closed-contour direction. Defaults to counter-clockwise. */
	readonly orientation?: "clockwise" | "counter-clockwise" | "preserve"
	/** Removes vertices on straight spans. Defaults to true. */
	readonly removeCollinear?: boolean
}

/**
 * Signed closed-contour area, computed as triangles relative to the first
 * point to retain useful precision for large translated coordinates.
 */
export function signedArea(points: readonly Point[]): number {
	if (points.length < 3) return 0
	const origin = points[0]
	if (origin === undefined) return 0
	assertFinitePoint(origin, "points[0]")
	let sum = 0
	let compensation = 0
	for (let index = 1; index + 1 < points.length; index += 1) {
		const first = points[index]
		const second = points[index + 1]
		if (first === undefined || second === undefined) continue
		assertFinitePoint(first, `points[${index}]`)
		assertFinitePoint(second, `points[${index + 1}]`)
		const triangle =
			((first.x - origin.x) * (second.y - origin.y) -
				(first.y - origin.y) * (second.x - origin.x)) /
			2
		const adjusted = triangle - compensation
		const next = sum + adjusted
		compensation = next - sum - adjusted
		sum = next
	}
	return sum
}

export function contourOrientation(
	points: readonly Point[],
	overrides: Partial<GeometryTolerances> = {},
): Orientation {
	const tolerances = resolveGeometryTolerances(overrides)
	const area = signedArea(points)
	if (Math.abs(area) <= tolerances.distance * tolerances.distance) {
		return "degenerate"
	}
	return area > 0 ? "counter-clockwise" : "clockwise"
}

/**
 * Computes the nonzero winding number and reports boundary points explicitly.
 */
export function windingNumber(
	point: Point,
	points: readonly Point[],
	overrides: Partial<GeometryTolerances> = {},
): WindingResult {
	assertFinitePoint(point)
	const tolerances = resolveGeometryTolerances(overrides)
	let winding = 0
	for (let index = 0; index < points.length; index += 1) {
		const start = points[index]
		const end = points[(index + 1) % points.length]
		if (start === undefined || end === undefined) continue
		assertFinitePoint(start, `points[${index}]`)
		assertFinitePoint(end, `points[${(index + 1) % points.length}]`)
		if (pointOnSegment(point, start, end, tolerances)) {
			return { winding, classification: "boundary" }
		}
		const side = cross(subtract(end, start), subtract(point, start))
		if (start.y <= point.y) {
			if (end.y > point.y && side > 0) winding += 1
		} else if (end.y <= point.y && side < 0) {
			winding -= 1
		}
	}
	return {
		winding,
		classification: winding === 0 ? "outside" : "inside",
	}
}

const snapPoint = (point: Point, grid: number): Point => ({
	x: snapCoordinate(point.x, grid),
	y: snapCoordinate(point.y, grid),
})

const lexicographicPoint = (left: Point, right: Point): number =>
	left.x - right.x || left.y - right.y

const compareRotations = (
	points: readonly Point[],
	leftStart: number,
	rightStart: number,
): number => {
	for (let offset = 0; offset < points.length; offset += 1) {
		const left = points[(leftStart + offset) % points.length]
		const right = points[(rightStart + offset) % points.length]
		if (left === undefined || right === undefined) continue
		const comparison = lexicographicPoint(left, right)
		if (comparison !== 0) return comparison
	}
	return 0
}

const rotateCanonical = (points: readonly Point[]): readonly Point[] => {
	if (points.length < 2) return points
	let best = 0
	for (let index = 1; index < points.length; index += 1) {
		const candidate = points[index]
		const current = points[best]
		if (
			candidate !== undefined &&
			current !== undefined &&
			(lexicographicPoint(candidate, current) < 0 ||
				(lexicographicPoint(candidate, current) === 0 &&
					compareRotations(points, index, best) < 0))
		) {
			best = index
		}
	}
	return [...points.slice(best), ...points.slice(0, best)]
}

const removeAdjacentDuplicates = (
	points: readonly Point[],
	closed: boolean,
	distanceTolerance: number,
): readonly Point[] => {
	const result: Point[] = []
	for (const point of points) {
		const previous = result.at(-1)
		if (
			previous === undefined ||
			distance(previous, point) > distanceTolerance
		) {
			result.push(point)
		}
	}
	const first = result[0]
	const last = result.at(-1)
	if (
		closed &&
		result.length > 1 &&
		first !== undefined &&
		last !== undefined &&
		distance(first, last) <= distanceTolerance
	) {
		result.pop()
	}
	return result
}

const collinearMiddle = (
	previous: Point,
	point: Point,
	next: Point,
	distanceTolerance: number,
): boolean => {
	const span = subtract(next, previous)
	const relative = subtract(point, previous)
	const spanLength = Math.hypot(span.x, span.y)
	if (spanLength <= distanceTolerance) return true
	if (Math.abs(cross(span, relative)) > distanceTolerance * spanLength) {
		return false
	}
	return dot(relative, subtract(point, next)) <= 0
}

const removeCollinearPoints = (
	points: readonly Point[],
	closed: boolean,
	distanceTolerance: number,
): readonly Point[] => {
	let current = [...points]
	let changed = true
	while (changed) {
		changed = false
		if (current.length <= (closed ? 3 : 2)) break
		const next: Point[] = []
		for (let index = 0; index < current.length; index += 1) {
			if (!closed && (index === 0 || index === current.length - 1)) {
				const point = current[index]
				if (point !== undefined) next.push(point)
				continue
			}
			const previous = current[(index - 1 + current.length) % current.length]
			const point = current[index]
			const following = current[(index + 1) % current.length]
			if (
				previous !== undefined &&
				point !== undefined &&
				following !== undefined &&
				collinearMiddle(previous, point, following, distanceTolerance)
			) {
				changed = true
				continue
			}
			if (point !== undefined) next.push(point)
		}
		current = next
	}
	return current
}

export function normalizeContour(
	contour: Contour,
	options: NormalizeContourOptions = {},
): Contour {
	const tolerances = resolveGeometryTolerances(options.tolerances)
	for (const [index, point] of contour.points.entries()) {
		assertFinitePoint(point, `contour.points[${index}]`)
	}
	let points = contour.points.map((point) =>
		snapPoint(point, tolerances.normalization),
	)
	points = [
		...removeAdjacentDuplicates(points, contour.closed, tolerances.distance),
	]
	if (options.removeCollinear ?? true) {
		points = [
			...removeCollinearPoints(points, contour.closed, tolerances.distance),
		]
	}
	const minimum = contour.closed ? 3 : 2
	if (points.length < minimum) {
		throw new GeometryError(
			"DEGENERATE_CONTOUR",
			`${contour.closed ? "Closed" : "Open"} contour needs at least ${minimum} distinct points.`,
			{ pointCount: points.length },
		)
	}
	if (contour.closed) {
		const orientation = contourOrientation(points, tolerances)
		if (orientation === "degenerate") {
			throw new GeometryError(
				"DEGENERATE_CONTOUR",
				"Closed contour has no stable orientation at the configured tolerance.",
				{ pointCount: points.length },
			)
		}
		const desired = options.orientation ?? "counter-clockwise"
		if (desired !== "preserve" && desired !== orientation) {
			points.reverse()
		}
		points = [...rotateCanonical(points)]
	}
	return { points, closed: contour.closed }
}

const compareContours = (left: Contour, right: Contour): number => {
	if (left.closed !== right.closed) return left.closed ? -1 : 1
	const count = Math.min(left.points.length, right.points.length)
	for (let index = 0; index < count; index += 1) {
		const leftPoint = left.points[index]
		const rightPoint = right.points[index]
		if (leftPoint === undefined || rightPoint === undefined) continue
		const comparison = lexicographicPoint(leftPoint, rightPoint)
		if (comparison !== 0) return comparison
	}
	return left.points.length - right.points.length
}

/**
 * Canonicalizes a contour set, infers nesting by nonzero containment, assigns
 * counter-clockwise outer/island and clockwise hole winding, then sorts by
 * nesting depth and coordinates.
 */
export function normalizeContours(
	contours: readonly Contour[],
	options: Omit<NormalizeContourOptions, "orientation"> = {},
): readonly Contour[] {
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const normalized = contours.map((contour) =>
		normalizeContour(contour, {
			...options,
			orientation: contour.closed ? "counter-clockwise" : "preserve",
		}),
	)
	const depths = normalized.map((contour, contourIndex) => {
		if (!contour.closed) return 0
		const probe = contour.points[0]
		if (probe === undefined) return 0
		let depth = 0
		for (let otherIndex = 0; otherIndex < normalized.length; otherIndex += 1) {
			if (otherIndex === contourIndex) continue
			const other = normalized[otherIndex]
			if (
				other?.closed &&
				windingNumber(probe, other.points, tolerances).classification ===
					"inside"
			) {
				depth += 1
			}
		}
		return depth
	})
	const oriented = normalized.map((contour, index) =>
		contour.closed
			? normalizeContour(contour, {
					...options,
					orientation:
						(depths[index] ?? 0) % 2 === 0 ? "counter-clockwise" : "clockwise",
				})
			: contour,
	)
	return oriented
		.map((contour, index) => ({
			contour,
			depth: depths[index] ?? 0,
		}))
		.sort(
			(left, right) =>
				left.depth - right.depth ||
				compareContours(left.contour, right.contour),
		)
		.map(({ contour }) => contour)
}
