import { normalizeContour, signedArea } from "./contours.ts"
import { selfIntersections } from "./intersections.ts"
import {
	assertFinitePoint,
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Contour, Point } from "./types.ts"
import { cross, distance, dot, subtract } from "./vector.ts"

export type StrokeJoin = "miter" | "round" | "bevel"

export interface StrokeExpansionOptions {
	readonly width: number
	readonly cap: "butt" | "round" | "square"
	readonly join: StrokeJoin
	/** Optional join intent aligned with the input contour's points. */
	readonly vertexJoins?: readonly StrokeJoin[]
	readonly miterLimit: number
	readonly dashArray?: readonly number[]
	readonly dashOffset?: number
	readonly tolerances?: Partial<GeometryTolerances>
}

interface CenterlineRun {
	readonly points: readonly Point[]
	readonly vertexJoins: readonly StrokeJoin[]
	readonly closed: boolean
}

interface MeasuredCenterline {
	readonly points: readonly Point[]
	readonly vertexJoins: readonly StrokeJoin[]
	readonly segmentEnds: readonly number[]
	readonly total: number
	readonly closed: boolean
}

const add = (point: Point, vector: Point, amount = 1): Point => ({
	x: point.x + vector.x * amount,
	y: point.y + vector.y * amount,
})

const scale = (point: Point, amount: number): Point => ({
	x: point.x * amount,
	y: point.y * amount,
})

const unit = (from: Point, to: Point): Point => {
	const vector = subtract(to, from)
	const magnitude = Math.hypot(vector.x, vector.y)
	return scale(vector, 1 / magnitude)
}

const normal = (direction: Point, side: 1 | -1): Point => ({
	x: -direction.y * side,
	y: direction.x * side,
})

const modulo = (value: number, divisor: number): number =>
	((value % divisor) + divisor) % divisor

function measuredCenterline(
	contour: Contour,
	options: StrokeExpansionOptions,
	tolerances: GeometryTolerances,
): MeasuredCenterline | null {
	const points: Point[] = []
	const vertexJoins: StrokeJoin[] = []
	for (const [index, point] of contour.points.entries()) {
		assertFinitePoint(point, `contour.points[${index}]`)
		const previous = points.at(-1)
		if (
			previous === undefined ||
			distance(previous, point) > tolerances.distance
		) {
			points.push(point)
			vertexJoins.push(options.vertexJoins?.[index] ?? options.join)
		}
	}
	if (
		contour.closed &&
		points.length > 1 &&
		points[0] !== undefined &&
		points.at(-1) !== undefined &&
		distance(points[0], points.at(-1) as Point) <= tolerances.distance
	) {
		points.pop()
		vertexJoins.pop()
	}
	if (points.length < 2) return null

	const segmentEnds: number[] = []
	let total = 0
	const segmentCount = points.length - (contour.closed ? 0 : 1)
	for (let index = 0; index < segmentCount; index += 1) {
		const from = points[index]
		const to = points[(index + 1) % points.length]
		if (from === undefined || to === undefined) continue
		total += distance(from, to)
		if (!Number.isFinite(total))
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"Centerline length exceeds finite geometry range.",
			)
		segmentEnds.push(total)
	}
	return total <= tolerances.distance
		? null
		: { points, vertexJoins, segmentEnds, total, closed: contour.closed }
}

function pointAtDistance(line: MeasuredCenterline, position: number): Point {
	const target = Math.max(0, Math.min(line.total, position))
	let startDistance = 0
	for (const [index, endDistance] of line.segmentEnds.entries()) {
		if (target <= endDistance || index === line.segmentEnds.length - 1) {
			const from = line.points[index]
			const to = line.points[(index + 1) % line.points.length]
			if (from === undefined || to === undefined) break
			const length = endDistance - startDistance
			const amount = length === 0 ? 0 : (target - startDistance) / length
			return {
				x: from.x + (to.x - from.x) * amount,
				y: from.y + (to.y - from.y) * amount,
			}
		}
		startDistance = endDistance
	}
	return line.points[0] as Point
}

function pointsForInterval(
	line: MeasuredCenterline,
	start: number,
	end: number,
	defaultJoin: StrokeJoin,
	tolerances: GeometryTolerances,
): CenterlineRun {
	const points = [pointAtDistance(line, start)]
	const vertexJoins = [defaultJoin]
	for (const [index, segmentEnd] of line.segmentEnds.entries()) {
		if (
			segmentEnd > start + tolerances.distance &&
			segmentEnd < end - tolerances.distance
		) {
			const point = line.points[(index + 1) % line.points.length]
			if (point !== undefined) {
				points.push(point)
				vertexJoins.push(
					line.vertexJoins[(index + 1) % line.points.length] ?? defaultJoin,
				)
			}
		}
	}
	points.push(pointAtDistance(line, end))
	vertexJoins.push(defaultJoin)
	return { points, vertexJoins, closed: false }
}

function centerlineRuns(
	contour: Contour,
	options: StrokeExpansionOptions,
	tolerances: GeometryTolerances,
): readonly CenterlineRun[] {
	const line = measuredCenterline(contour, options, tolerances)
	if (line === null) return []
	if (
		selfIntersections(line.points, {
			closed: line.closed,
			tolerances,
		}).length > 0
	)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Self-intersecting centerlines require boolean cleanup before expansion.",
		)
	const authoredDash = options.dashArray ?? []
	for (const [index, value] of authoredDash.entries()) {
		if (!Number.isFinite(value) || value < 0)
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"Stroke dash lengths must be finite and non-negative.",
				{ index, value },
			)
	}
	if (authoredDash.length === 0) {
		return [
			{
				points: line.points,
				vertexJoins: line.vertexJoins,
				closed: line.closed,
			},
		]
	}
	const dash =
		authoredDash.length % 2 === 0
			? [...authoredDash]
			: [...authoredDash, ...authoredDash]
	const patternLength = dash.reduce((sum, value) => sum + value, 0)
	if (patternLength <= tolerances.distance)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Stroke dash pattern must contain a positive length.",
			{ dashArray: authoredDash },
		)
	if (!Number.isFinite(options.dashOffset ?? 0))
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Stroke dash offset must be finite.",
			{ dashOffset: options.dashOffset },
		)

	let dashIndex = 0
	let phase = modulo(options.dashOffset ?? 0, patternLength)
	while (phase >= (dash[dashIndex] ?? 0) && dashIndex < dash.length - 1) {
		phase -= dash[dashIndex] ?? 0
		dashIndex += 1
	}
	let remaining = (dash[dashIndex] ?? 0) - phase
	const intervals: { start: number; end: number }[] = []
	let cursor = 0
	let guard = 0
	while (cursor < line.total - tolerances.distance) {
		while (remaining <= tolerances.distance) {
			dashIndex = (dashIndex + 1) % dash.length
			remaining = dash[dashIndex] ?? 0
			guard += 1
			if (guard > dash.length * 2)
				throw new GeometryError(
					"INVALID_ARGUMENT",
					"Stroke dash pattern could not be advanced deterministically.",
				)
		}
		guard = 0
		const take = Math.min(remaining, line.total - cursor)
		if (dashIndex % 2 === 0 && take > tolerances.distance) {
			const previous = intervals.at(-1)
			if (
				previous !== undefined &&
				cursor - previous.end <= tolerances.distance
			)
				previous.end = cursor + take
			else intervals.push({ start: cursor, end: cursor + take })
		}
		cursor += take
		remaining -= take
		if (remaining <= tolerances.distance) {
			dashIndex = (dashIndex + 1) % dash.length
			remaining = dash[dashIndex] ?? 0
		}
	}
	if (intervals.length === 0) return []
	const first = intervals[0]
	const last = intervals.at(-1)
	if (
		line.closed &&
		first !== undefined &&
		last !== undefined &&
		first.start <= tolerances.distance &&
		line.total - last.end <= tolerances.distance
	) {
		if (first === last)
			return [
				{
					points: line.points,
					vertexJoins: line.vertexJoins,
					closed: true,
				},
			]
		const tail = pointsForInterval(
			line,
			last.start,
			line.total,
			options.join,
			tolerances,
		)
		const head = pointsForInterval(line, 0, first.end, options.join, tolerances)
		intervals.pop()
		intervals.shift()
		return [
			{
				points: [...tail.points, ...head.points.slice(1)],
				vertexJoins: [...tail.vertexJoins, ...head.vertexJoins.slice(1)],
				closed: false,
			},
			...intervals.map(({ start, end }) =>
				pointsForInterval(line, start, end, options.join, tolerances),
			),
		]
	}
	return intervals.map(({ start, end }) =>
		pointsForInterval(line, start, end, options.join, tolerances),
	)
}

function lineIntersection(
	first: Point,
	firstDirection: Point,
	second: Point,
	secondDirection: Point,
	tolerances: GeometryTolerances,
): Readonly<{
	point: Point
	firstParameter: number
	secondParameter: number
}> | null {
	const determinant = cross(firstDirection, secondDirection)
	if (Math.abs(determinant) <= tolerances.parameter) return null
	const delta = subtract(second, first)
	const firstParameter = cross(delta, secondDirection) / determinant
	const secondParameter = cross(delta, firstDirection) / determinant
	return {
		point: add(first, firstDirection, firstParameter),
		firstParameter,
		secondParameter,
	}
}

function arc(
	center: Point,
	from: Point,
	to: Point,
	direction: 1 | -1,
	radius: number,
	tolerances: GeometryTolerances,
): readonly Point[] {
	const start = Math.atan2(from.y - center.y, from.x - center.x)
	const finish = Math.atan2(to.y - center.y, to.x - center.x)
	let sweep = finish - start
	while (direction > 0 && sweep <= 0) sweep += Math.PI * 2
	while (direction < 0 && sweep >= 0) sweep -= Math.PI * 2
	const ratio = Math.max(-1, Math.min(1, 1 - tolerances.flatness / radius))
	const maximumStep = 2 * Math.acos(ratio)
	const steps = Math.max(
		1,
		Math.min(4096, Math.ceil(Math.abs(sweep) / maximumStep)),
	)
	return Array.from({ length: steps + 1 }, (_, index) => {
		const angle = start + (sweep * index) / steps
		return {
			x: center.x + Math.cos(angle) * radius,
			y: center.y + Math.sin(angle) * radius,
		}
	})
}

function joinPoints(
	vertex: Point,
	incoming: Point,
	outgoing: Point,
	incomingLength: number,
	outgoingLength: number,
	side: 1 | -1,
	radius: number,
	join: StrokeJoin,
	options: StrokeExpansionOptions,
	tolerances: GeometryTolerances,
): readonly Point[] {
	const previousEdge = add(vertex, normal(incoming, side), radius)
	const nextEdge = add(vertex, normal(outgoing, side), radius)
	const turn = cross(incoming, outgoing)
	const intersection = lineIntersection(
		previousEdge,
		incoming,
		nextEdge,
		outgoing,
		tolerances,
	)
	if (Math.abs(turn) <= tolerances.parameter && dot(incoming, outgoing) > 0)
		return [nextEdge]
	const outer = turn * side < 0
	const withinLimit =
		intersection !== null &&
		distance(vertex, intersection.point) <=
			radius * options.miterLimit + tolerances.distance
	if (!outer) {
		const trimsBothOffsetRays =
			intersection !== null &&
			intersection.firstParameter <= tolerances.parameter &&
			intersection.firstParameter >= -incomingLength - tolerances.distance &&
			intersection.secondParameter >= -tolerances.parameter &&
			intersection.secondParameter <= outgoingLength + tolerances.distance
		return withinLimit && trimsBothOffsetRays ? [intersection.point] : [vertex]
	}
	if (join === "round")
		return arc(
			vertex,
			previousEdge,
			nextEdge,
			turn > 0 ? 1 : -1,
			radius,
			tolerances,
		)
	if (
		join === "miter" &&
		withinLimit &&
		intersection !== null &&
		intersection.firstParameter >= -tolerances.parameter &&
		intersection.secondParameter <= tolerances.parameter
	)
		return [intersection.point]
	return [previousEdge, nextEdge]
}

function sidePoints(
	points: readonly Point[],
	vertexJoins: readonly StrokeJoin[],
	closed: boolean,
	side: 1 | -1,
	radius: number,
	options: StrokeExpansionOptions,
	tolerances: GeometryTolerances,
): readonly Point[] {
	const result: Point[] = []
	if (!closed) {
		const first = points[0]
		const second = points[1]
		if (first === undefined || second === undefined) return []
		result.push(add(first, normal(unit(first, second), side), radius))
	}
	const start = closed ? 0 : 1
	const end = closed ? points.length : points.length - 1
	for (let index = start; index < end; index += 1) {
		const previous = points[(index - 1 + points.length) % points.length]
		const vertex = points[index]
		const next = points[(index + 1) % points.length]
		if (previous === undefined || vertex === undefined || next === undefined)
			continue
		result.push(
			...joinPoints(
				vertex,
				unit(previous, vertex),
				unit(vertex, next),
				distance(previous, vertex),
				distance(vertex, next),
				side,
				radius,
				vertexJoins[index] ?? options.join,
				options,
				tolerances,
			),
		)
	}
	if (!closed) {
		const last = points.at(-1)
		const previous = points.at(-2)
		if (last !== undefined && previous !== undefined)
			result.push(add(last, normal(unit(previous, last), side), radius))
	}
	return result
}

function normalizedOutput(
	points: readonly Point[],
	orientation: "clockwise" | "counter-clockwise",
	tolerances: GeometryTolerances,
): Contour {
	try {
		return normalizeContour(
			{ points, closed: true },
			{ tolerances, orientation, removeCollinear: true },
		)
	} catch (error) {
		if (
			error instanceof GeometryError &&
			error.code === "DEGENERATE_CONTOUR" &&
			points.length >= 3
		)
			return { points, closed: true }
		throw error
	}
}

function expandRun(
	run: CenterlineRun,
	options: StrokeExpansionOptions,
	tolerances: GeometryTolerances,
): readonly Contour[] {
	const radius = options.width / 2
	let points = [...run.points]
	if (!run.closed && options.cap === "square") {
		const first = points[0]
		const second = points[1]
		const last = points.at(-1)
		const previous = points.at(-2)
		if (
			first !== undefined &&
			second !== undefined &&
			last !== undefined &&
			previous !== undefined
		) {
			points[0] = add(first, unit(first, second), -radius)
			points[points.length - 1] = add(last, unit(previous, last), radius)
		}
	}
	const left = sidePoints(
		points,
		run.vertexJoins,
		run.closed,
		1,
		radius,
		options,
		tolerances,
	)
	const right = sidePoints(
		points,
		run.vertexJoins,
		run.closed,
		-1,
		radius,
		options,
		tolerances,
	)
	if (run.closed) {
		const sourceArea = signedArea(points)
		return [
			normalizedOutput(
				left,
				sourceArea >= 0 ? "clockwise" : "counter-clockwise",
				tolerances,
			),
			normalizedOutput(
				right,
				sourceArea >= 0 ? "counter-clockwise" : "clockwise",
				tolerances,
			),
		]
	}
	const end = points.at(-1)
	const beforeEnd = points.at(-2)
	const start = points[0]
	const afterStart = points[1]
	if (
		end === undefined ||
		beforeEnd === undefined ||
		start === undefined ||
		afterStart === undefined
	)
		return []
	const endCap =
		options.cap === "round"
			? arc(
					end,
					left.at(-1) as Point,
					right.at(-1) as Point,
					-1,
					radius,
					tolerances,
				)
			: []
	const startCap =
		options.cap === "round"
			? arc(start, right[0] as Point, left[0] as Point, -1, radius, tolerances)
			: []
	return [
		normalizedOutput(
			[
				...left,
				...endCap.slice(1),
				...right.toReversed().slice(endCap.length === 0 ? 0 : 1),
				...startCap.slice(1),
			],
			"counter-clockwise",
			tolerances,
		),
	]
}

/**
 * Expands a polyline centerline into deterministic closed fill contours.
 *
 * Curves must be flattened by the caller. Round geometry stays within the
 * configured `flatness` chord-error tolerance. Coincident adjacent vertices
 * are ignored, wholly degenerate centerlines return no contours, and invalid
 * numeric/style input throws before returning partial output. Self-crossing
 * centerlines fail deterministically until a boolean-cleanup backend is
 * available.
 */
export function expandStroke(
	contour: Contour,
	options: StrokeExpansionOptions,
): readonly Contour[] {
	if (
		options.vertexJoins !== undefined &&
		options.vertexJoins.length !== contour.points.length
	)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Stroke vertex joins must align with the input contour points.",
			{
				pointCount: contour.points.length,
				joinCount: options.vertexJoins.length,
			},
		)
	if (!Number.isFinite(options.width) || options.width < 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Stroke width must be finite and non-negative.",
			{ width: options.width },
		)
	if (!Number.isFinite(options.miterLimit) || options.miterLimit < 1)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Stroke miter limit must be finite and at least one.",
			{ miterLimit: options.miterLimit },
		)
	const tolerances = resolveGeometryTolerances(options.tolerances)
	if (options.width <= tolerances.distance) return []
	return centerlineRuns(contour, options, tolerances).flatMap((run) =>
		expandRun(run, options, tolerances),
	)
}
