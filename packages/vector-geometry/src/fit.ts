import { evaluateCubic } from "./cubic.ts"
import {
	assertFinitePoint,
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Contour, Cubic, Point } from "./types.ts"
import { distance } from "./vector.ts"

export interface CubicFitOptions {
	/** Maximum source-sample distance from the fitted cubic. */
	readonly maxError: number
	/** Vertices at or above this turn remain exact corners. Defaults to 30°. */
	readonly cornerAngleDegrees?: number
	readonly tolerances?: Partial<GeometryTolerances>
}

const add = (left: Point, right: Point, scale = 1): Point => ({
	x: left.x + right.x * scale,
	y: left.y + right.y * scale,
})

const subtract = (left: Point, right: Point): Point => ({
	x: left.x - right.x,
	y: left.y - right.y,
})

const dot = (left: Point, right: Point): number =>
	left.x * right.x + left.y * right.y

const magnitude = (point: Point): number => Math.hypot(point.x, point.y)

const unit = (vector: Point): Point => {
	const length = magnitude(vector)
	return length === 0
		? { x: 0, y: 0 }
		: { x: vector.x / length, y: vector.y / length }
}

const negate = (point: Point): Point => ({ x: -point.x, y: -point.y })

function cleanPoints(
	contour: Contour,
	tolerances: GeometryTolerances,
): readonly Point[] {
	const points: Point[] = []
	for (const [index, point] of contour.points.entries()) {
		assertFinitePoint(point, `contour.points[${index}]`)
		const previous = points.at(-1)
		if (
			previous === undefined ||
			distance(previous, point) > tolerances.distance
		)
			points.push(point)
	}
	if (
		contour.closed &&
		points.length > 1 &&
		points[0] !== undefined &&
		points.at(-1) !== undefined &&
		distance(points[0], points.at(-1) as Point) <= tolerances.distance
	)
		points.pop()
	return points
}

function lineCubic(from: Point, to: Point): Cubic {
	const vector = subtract(to, from)
	return {
		p0: from,
		c1: add(from, vector, 1 / 3),
		c2: add(from, vector, 2 / 3),
		p3: to,
	}
}

function chordParameters(points: readonly Point[]): readonly number[] {
	const values = [0]
	let total = 0
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1]
		const point = points[index]
		if (previous === undefined || point === undefined) continue
		total += distance(previous, point)
		values.push(total)
	}
	if (total === 0) return values.map(() => 0)
	return values.map((value) => value / total)
}

const bernstein = (u: number) => {
	const inverse = 1 - u
	return {
		b0: inverse * inverse * inverse,
		b1: 3 * u * inverse * inverse,
		b2: 3 * u * u * inverse,
		b3: u * u * u,
	}
}

function generateCubic(
	points: readonly Point[],
	parameters: readonly number[],
	startTangent: Point,
	endTangent: Point,
): Cubic {
	const start = points[0] as Point
	const end = points.at(-1) as Point
	let c00 = 0
	let c01 = 0
	let c11 = 0
	let x0 = 0
	let x1 = 0
	for (const [index, point] of points.entries()) {
		const { b0, b1, b2, b3 } = bernstein(parameters[index] ?? 0)
		const first = { x: startTangent.x * b1, y: startTangent.y * b1 }
		const second = { x: endTangent.x * b2, y: endTangent.y * b2 }
		const fixed = {
			x: start.x * (b0 + b1) + end.x * (b2 + b3),
			y: start.y * (b0 + b1) + end.y * (b2 + b3),
		}
		const residual = subtract(point, fixed)
		c00 += dot(first, first)
		c01 += dot(first, second)
		c11 += dot(second, second)
		x0 += dot(first, residual)
		x1 += dot(second, residual)
	}
	const determinant = c00 * c11 - c01 * c01
	let startLength = determinant === 0 ? 0 : (x0 * c11 - x1 * c01) / determinant
	let endLength = determinant === 0 ? 0 : (c00 * x1 - c01 * x0) / determinant
	const segmentLength = distance(start, end)
	const minimum = segmentLength * 1e-6
	if (
		!Number.isFinite(startLength) ||
		!Number.isFinite(endLength) ||
		startLength < minimum ||
		endLength < minimum
	) {
		startLength = segmentLength / 3
		endLength = segmentLength / 3
	}
	return {
		p0: start,
		c1: add(start, startTangent, startLength),
		c2: add(end, endTangent, endLength),
		p3: end,
	}
}

function cubicDerivatives(
	cubic: Cubic,
	parameter: number,
): readonly [Point, Point] {
	const inverse = 1 - parameter
	const first = {
		x:
			3 * inverse * inverse * (cubic.c1.x - cubic.p0.x) +
			6 * inverse * parameter * (cubic.c2.x - cubic.c1.x) +
			3 * parameter * parameter * (cubic.p3.x - cubic.c2.x),
		y:
			3 * inverse * inverse * (cubic.c1.y - cubic.p0.y) +
			6 * inverse * parameter * (cubic.c2.y - cubic.c1.y) +
			3 * parameter * parameter * (cubic.p3.y - cubic.c2.y),
	}
	const second = {
		x:
			6 * inverse * (cubic.c2.x - 2 * cubic.c1.x + cubic.p0.x) +
			6 * parameter * (cubic.p3.x - 2 * cubic.c2.x + cubic.c1.x),
		y:
			6 * inverse * (cubic.c2.y - 2 * cubic.c1.y + cubic.p0.y) +
			6 * parameter * (cubic.p3.y - 2 * cubic.c2.y + cubic.c1.y),
	}
	return [first, second]
}

function reparameterize(
	points: readonly Point[],
	parameters: readonly number[],
	cubic: Cubic,
): readonly number[] | null {
	const next = parameters.map((parameter, index) => {
		if (index === 0 || index === parameters.length - 1) return parameter
		const point = points[index] as Point
		const evaluated = evaluateCubic(cubic, parameter)
		const [first, second] = cubicDerivatives(cubic, parameter)
		const delta = subtract(evaluated, point)
		const denominator = dot(first, first) + dot(delta, second)
		if (Math.abs(denominator) <= Number.EPSILON) return parameter
		return Math.max(0, Math.min(1, parameter - dot(delta, first) / denominator))
	})
	for (let index = 1; index < next.length; index += 1) {
		if ((next[index] ?? 0) <= (next[index - 1] ?? 0)) return null
	}
	return next
}

function maximumError(
	points: readonly Point[],
	parameters: readonly number[],
	cubic: Cubic,
): Readonly<{ errorSquared: number; index: number }> {
	let errorSquared = 0
	let split = Math.floor(points.length / 2)
	for (let index = 1; index + 1 < points.length; index += 1) {
		const point = points[index]
		if (point === undefined) continue
		const evaluated = evaluateCubic(cubic, parameters[index] ?? 0)
		const delta = subtract(evaluated, point)
		const candidate = dot(delta, delta)
		if (candidate > errorSquared) {
			errorSquared = candidate
			split = index
		}
	}
	return { errorSquared, index: split }
}

function centerTangent(points: readonly Point[], index: number): Point {
	const previous = points[index - 1] as Point
	const next = points[index + 1] as Point
	return unit(subtract(previous, next))
}

function fitRange(
	points: readonly Point[],
	startTangent: Point,
	endTangent: Point,
	maxErrorSquared: number,
	depth = 0,
): readonly Cubic[] {
	if (points.length < 2) return []
	if (points.length === 2)
		return [lineCubic(points[0] as Point, points[1] as Point)]
	let parameters = chordParameters(points)
	let cubic = generateCubic(points, parameters, startTangent, endTangent)
	let measured = maximumError(points, parameters, cubic)
	if (measured.errorSquared <= maxErrorSquared) return [cubic]
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const nextParameters = reparameterize(points, parameters, cubic)
		if (nextParameters === null) break
		parameters = nextParameters
		cubic = generateCubic(points, parameters, startTangent, endTangent)
		measured = maximumError(points, parameters, cubic)
		if (measured.errorSquared <= maxErrorSquared) return [cubic]
	}
	if (depth >= 24)
		return points
			.slice(1)
			.map((point, index) => lineCubic(points[index] as Point, point))
	const split = Math.max(1, Math.min(points.length - 2, measured.index))
	const tangent = centerTangent(points, split)
	return [
		...fitRange(
			points.slice(0, split + 1),
			startTangent,
			tangent,
			maxErrorSquared,
			depth + 1,
		),
		...fitRange(
			points.slice(split),
			negate(tangent),
			endTangent,
			maxErrorSquared,
			depth + 1,
		),
	]
}

function turnAngle(
	points: readonly Point[],
	index: number,
	closed: boolean,
): number {
	if (!closed && (index === 0 || index === points.length - 1)) return Math.PI
	const previous = points[(index - 1 + points.length) % points.length]
	const point = points[index]
	const next = points[(index + 1) % points.length]
	if (previous === undefined || point === undefined || next === undefined)
		return 0
	const incoming = unit(subtract(point, previous))
	const outgoing = unit(subtract(next, point))
	return Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))))
}

function closedQuarterAnchors(points: readonly Point[]): readonly number[] {
	const segmentLengths = points.map((point, index) =>
		distance(point, points[(index + 1) % points.length] as Point),
	)
	const total = segmentLengths.reduce((sum, value) => sum + value, 0)
	const anchors = [0]
	for (let quarter = 1; quarter < 4; quarter += 1) {
		const target = (total * quarter) / 4
		let traversed = 0
		for (let index = 0; index < segmentLengths.length; index += 1) {
			traversed += segmentLengths[index] ?? 0
			if (traversed >= target) {
				anchors.push((index + 1) % points.length)
				break
			}
		}
	}
	return anchors
}

function spanPoints(
	points: readonly Point[],
	start: number,
	end: number,
	closed: boolean,
): readonly Point[] {
	if (!closed) return points.slice(start, end + 1)
	const result = [points[start] as Point]
	let index = start
	while (index !== end) {
		index = (index + 1) % points.length
		result.push(points[index] as Point)
	}
	return result
}

function anchorTangent(
	points: readonly Point[],
	index: number,
	closed: boolean,
	corner: boolean,
	direction: "forward" | "backward",
): Point {
	const point = points[index] as Point
	const previous = points[(index - 1 + points.length) % points.length] as Point
	const next = points[(index + 1) % points.length] as Point
	if (!closed && index === 0) return unit(subtract(next, point))
	if (!closed && index === points.length - 1)
		return unit(subtract(previous, point))
	if (corner)
		return direction === "forward"
			? unit(subtract(next, point))
			: unit(subtract(previous, point))
	const tangent = unit(subtract(next, previous))
	return direction === "forward" ? tangent : negate(tangent)
}

/**
 * Reconstructs a compact cubic path from a sampled contour.
 *
 * Fit error is measured in coordinate units from every source sample to its
 * fitted cubic. Vertices at the configured turn angle remain exact anchors;
 * smooth closed contours receive deterministic quarter-length anchors.
 */
export function fitCubicContour(
	contour: Contour,
	options: CubicFitOptions,
): readonly Cubic[] {
	if (!Number.isFinite(options.maxError) || options.maxError <= 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Cubic fit error must be finite and positive.",
			{ maxError: options.maxError },
		)
	const cornerAngleDegrees = options.cornerAngleDegrees ?? 30
	if (
		!Number.isFinite(cornerAngleDegrees) ||
		cornerAngleDegrees <= 0 ||
		cornerAngleDegrees >= 180
	)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Cubic fit corner angle must be between zero and 180 degrees.",
			{ cornerAngleDegrees },
		)
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const points = cleanPoints(contour, tolerances)
	const minimum = contour.closed ? 3 : 2
	if (points.length < minimum)
		throw new GeometryError(
			"DEGENERATE_CONTOUR",
			`Cubic fitting needs at least ${minimum} distinct points.`,
		)
	const cornerThreshold = (cornerAngleDegrees * Math.PI) / 180
	const corners = new Set(
		points.flatMap((_, index) =>
			turnAngle(points, index, contour.closed) >= cornerThreshold
				? [index]
				: [],
		),
	)
	const anchors = [
		...(contour.closed ? closedQuarterAnchors(points) : [0, points.length - 1]),
		...corners,
	].filter((index, position, values) => values.indexOf(index) === position)
	anchors.sort((left, right) => left - right)
	const segmentCount = contour.closed ? anchors.length : anchors.length - 1
	const result: Cubic[] = []
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const start = anchors[segment]
		const end = contour.closed
			? anchors[(segment + 1) % anchors.length]
			: anchors[segment + 1]
		if (start === undefined || end === undefined || start === end) continue
		result.push(
			...fitRange(
				spanPoints(points, start, end, contour.closed),
				anchorTangent(
					points,
					start,
					contour.closed,
					corners.has(start),
					"forward",
				),
				anchorTangent(
					points,
					end,
					contour.closed,
					corners.has(end),
					"backward",
				),
				options.maxError * options.maxError,
			),
		)
	}
	return result
}
