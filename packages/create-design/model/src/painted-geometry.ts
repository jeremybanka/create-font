import {
	boundsOfPoints,
	flattenCubic,
	windingNumber,
	type StrokeJoin,
} from "@create-art/vector-geometry"

import {
	designObjectFillRule,
	objectBounds,
	projectDesignObjectContours,
	type Bounds,
} from "./geometry.ts"
import type {
	DesignContour,
	DesignObject,
	DesignStroke,
} from "@create-design/source"

type Point = Readonly<{ readonly x: number; readonly y: number }>

type StrokePiece = Readonly<{
	from: Point
	to: Point
	run: number
}>

const CURVE_FLATNESS = 0.05
const EPSILON = 1e-7

function strokeJoinAtPoint(
	contour: DesignContour,
	index: number,
	authoredJoin: StrokeJoin,
): StrokeJoin {
	const point = contour.points[index]
	const previous =
		contour.points[(index - 1 + contour.points.length) % contour.points.length]
	const next = contour.points[(index + 1) % contour.points.length]
	if (point === undefined || previous === undefined || next === undefined)
		return authoredJoin
	const incoming =
		point.incoming === undefined
			? { x: point.x - previous.x, y: point.y - previous.y }
			: { x: -point.incoming.x, y: -point.incoming.y }
	const outgoing =
		point.outgoing === undefined
			? { x: next.x - point.x, y: next.y - point.y }
			: point.outgoing
	const incomingLength = Math.hypot(incoming.x, incoming.y)
	const outgoingLength = Math.hypot(outgoing.x, outgoing.y)
	if (incomingLength <= EPSILON || outgoingLength <= EPSILON)
		return authoredJoin
	const sine =
		(incoming.x * outgoing.y - incoming.y * outgoing.x) /
		(incomingLength * outgoingLength)
	const cosine =
		(incoming.x * outgoing.x + incoming.y * outgoing.y) /
		(incomingLength * outgoingLength)
	return Math.abs(sine) <= 1e-6 && cosine > 0 ? "miter" : authoredJoin
}

export function flattenDesignContour(
	contour: DesignContour,
	flatness = CURVE_FLATNESS,
): readonly Point[] {
	return flattenDesignContourForStroke(contour, "miter", flatness).points
}

export function flattenDesignContourForStroke(
	contour: DesignContour,
	authoredJoin: StrokeJoin,
	flatness = CURVE_FLATNESS,
): Readonly<{
	points: readonly Point[]
	vertexJoins: readonly StrokeJoin[]
}> {
	const first = contour.points[0]
	if (first === undefined) return { points: [], vertexJoins: [] }
	const flattened: Point[] = [first]
	const vertexJoins: StrokeJoin[] = [
		strokeJoinAtPoint(contour, 0, authoredJoin),
	]
	const segmentCount = contour.points.length - (contour.closed ? 0 : 1)
	for (let index = 0; index < segmentCount; index += 1) {
		const from = contour.points[index]
		const to = contour.points[(index + 1) % contour.points.length]
		if (from === undefined || to === undefined) continue
		if (from.outgoing === undefined && to.incoming === undefined) {
			flattened.push(to)
			vertexJoins.push(
				strokeJoinAtPoint(
					contour,
					(index + 1) % contour.points.length,
					authoredJoin,
				),
			)
			continue
		}
		const first = from.outgoing ?? { x: 0, y: 0 }
		const second = to.incoming ?? { x: 0, y: 0 }
		const segment = flattenCubic(
			{
				p0: from,
				c1: { x: from.x + first.x, y: from.y + first.y },
				c2: { x: to.x + second.x, y: to.y + second.y },
				p3: to,
			},
			{ flatness },
		).slice(1)
		flattened.push(...segment)
		vertexJoins.push(
			...segment.map((_, pointIndex) =>
				pointIndex === segment.length - 1
					? strokeJoinAtPoint(
							contour,
							(index + 1) % contour.points.length,
							authoredJoin,
						)
					: "miter",
			),
		)
	}
	return { points: flattened, vertexJoins }
}

function normalizedDashArray(stroke: DesignStroke): readonly number[] {
	if (stroke.dashArray.length === 0) return []
	return stroke.dashArray.length % 2 === 0
		? stroke.dashArray
		: [...stroke.dashArray, ...stroke.dashArray]
}

function modulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor
}

function dashPhase(
	distance: number,
	stroke: DesignStroke,
): Readonly<{ painted: boolean; remaining: number }> {
	const dash = normalizedDashArray(stroke)
	if (dash.length === 0)
		return { painted: true, remaining: Number.POSITIVE_INFINITY }
	const total = dash.reduce((sum, value) => sum + value, 0)
	let phase = modulo(distance + stroke.dashOffset, total)
	for (let index = 0; index < dash.length; index += 1) {
		const length = dash[index] ?? 0
		if (phase < length || index === dash.length - 1)
			return { painted: index % 2 === 0, remaining: length - phase }
		phase -= length
	}
	return { painted: true, remaining: total }
}

function interpolate(from: Point, to: Point, amount: number): Point {
	return {
		x: from.x + (to.x - from.x) * amount,
		y: from.y + (to.y - from.y) * amount,
	}
}

function strokePieces(
	contour: DesignContour,
	stroke: DesignStroke,
): readonly StrokePiece[] {
	const points = flattenDesignContour(contour)
	if (points.length < 2) return []
	const pieces: StrokePiece[] = []
	let distance = 0
	let run = 0
	let previousPainted = false
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index]
		const to = points[index + 1]
		if (from === undefined || to === undefined) continue
		const length = Math.hypot(to.x - from.x, to.y - from.y)
		if (length <= EPSILON) continue
		let local = 0
		while (local < length - EPSILON) {
			const phase = dashPhase(distance + local, stroke)
			const take = Math.min(length - local, phase.remaining)
			if (take <= EPSILON) {
				local += Math.min(EPSILON, length - local)
				continue
			}
			if (phase.painted) {
				if (!previousPainted) run += 1
				pieces.push({
					from: interpolate(from, to, local / length),
					to: interpolate(from, to, (local + take) / length),
					run,
				})
			}
			previousPainted = phase.painted
			local += take
		}
		distance += length
	}
	const first = pieces[0]
	const last = pieces.at(-1)
	if (
		contour.closed &&
		first !== undefined &&
		last !== undefined &&
		first.run !== last.run &&
		dashPhase(EPSILON, stroke).painted &&
		dashPhase(distance - EPSILON, stroke).painted
	) {
		return pieces.map((piece) =>
			piece.run === first.run ? { ...piece, run: last.run } : piece,
		)
	}
	return pieces
}

function unitVector(from: Point, to: Point): Point | null {
	const length = Math.hypot(to.x - from.x, to.y - from.y)
	return length <= EPSILON
		? null
		: { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function add(left: Point, right: Point, scale = 1): Point {
	return { x: left.x + right.x * scale, y: left.y + right.y * scale }
}

function normal(direction: Point, side: 1 | -1): Point {
	return { x: -direction.y * side, y: direction.x * side }
}

function lineIntersection(
	first: Point,
	firstDirection: Point,
	second: Point,
	secondDirection: Point,
): Point | null {
	const denominator =
		firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x
	if (Math.abs(denominator) <= EPSILON) return null
	const delta = { x: second.x - first.x, y: second.y - first.y }
	const amount =
		(delta.x * secondDirection.y - delta.y * secondDirection.x) / denominator
	return add(first, firstDirection, amount)
}

function segmentDistance(point: Point, from: Point, to: Point): number {
	const direction = unitVector(from, to)
	if (direction === null) return Math.hypot(point.x - from.x, point.y - from.y)
	const length = Math.hypot(to.x - from.x, to.y - from.y)
	const amount = Math.max(
		0,
		Math.min(
			length,
			(point.x - from.x) * direction.x + (point.y - from.y) * direction.y,
		),
	)
	const nearest = add(from, direction, amount)
	return Math.hypot(point.x - nearest.x, point.y - nearest.y)
}

function polygonContainsPoint(
	polygon: readonly Point[],
	point: Point,
): boolean {
	let inside = false
	for (let index = 0; index < polygon.length; index += 1) {
		const from = polygon[index]
		const to = polygon[(index + 1) % polygon.length]
		if (from === undefined || to === undefined) continue
		if (
			from.y > point.y !== to.y > point.y &&
			point.x <
				((to.x - from.x) * (point.y - from.y)) / (to.y - from.y) + from.x
		)
			inside = !inside
	}
	return inside
}

function polygonDistance(polygon: readonly Point[], point: Point): number {
	if (polygonContainsPoint(polygon, point)) return 0
	return Math.min(
		...polygon.map((from, index) =>
			segmentDistance(
				point,
				from,
				polygon[(index + 1) % polygon.length] ?? from,
			),
		),
	)
}

function segmentBody(piece: StrokePiece, radius: number): readonly Point[] {
	const direction = unitVector(piece.from, piece.to)
	if (direction === null) return []
	const offset = normal(direction, 1)
	return [
		add(piece.from, offset, radius),
		add(piece.to, offset, radius),
		add(piece.to, offset, -radius),
		add(piece.from, offset, -radius),
	]
}

function capPolygon(
	point: Point,
	direction: Point,
	radius: number,
	start: boolean,
): readonly Point[] {
	const along = start ? { x: -direction.x, y: -direction.y } : direction
	const offset = normal(direction, 1)
	return [
		add(point, offset, radius),
		add(add(point, along, radius), offset, radius),
		add(add(point, along, radius), offset, -radius),
		add(point, offset, -radius),
	]
}

function joinPolygons(
	first: StrokePiece,
	second: StrokePiece,
	stroke: DesignStroke,
	radius: number,
): readonly (readonly Point[])[] {
	if (first.run !== second.run) return []
	const incoming = unitVector(first.from, first.to)
	const outgoing = unitVector(second.from, second.to)
	if (incoming === null || outgoing === null) return []
	const vertex = first.to
	return ([1, -1] as const).map((side) => {
		const firstEdge = add(vertex, normal(incoming, side), radius)
		const secondEdge = add(vertex, normal(outgoing, side), radius)
		if (stroke.join !== "miter") return [vertex, firstEdge, secondEdge]
		const miter = lineIntersection(firstEdge, incoming, secondEdge, outgoing)
		return miter !== null &&
			Math.hypot(miter.x - vertex.x, miter.y - vertex.y) <=
				stroke.miterLimit * radius + EPSILON
			? [firstEdge, miter, secondEdge]
			: [vertex, firstEdge, secondEdge]
	})
}

function contourStrokeDistance(
	contour: DesignContour,
	stroke: DesignStroke,
	point: Point,
): number {
	const radius = stroke.width / 2
	const pieces = strokePieces(contour, stroke)
	if (radius <= 0 || pieces.length === 0) return Number.POSITIVE_INFINITY
	let distance = Number.POSITIVE_INFINITY
	const firstByRun = new Map<number, number>()
	const lastByRun = new Map<number, number>()
	const cyclicRun =
		contour.closed && pieces[0]?.run === pieces.at(-1)?.run
			? pieces[0]?.run
			: undefined
	for (const [index, piece] of pieces.entries()) {
		firstByRun.set(piece.run, firstByRun.get(piece.run) ?? index)
		lastByRun.set(piece.run, index)
		distance = Math.min(
			distance,
			polygonDistance(segmentBody(piece, radius), point),
		)
	}
	for (const [index, piece] of pieces.entries()) {
		const direction = unitVector(piece.from, piece.to)
		if (direction === null) continue
		for (const [capPoint, start, applies] of [
			[piece.from, true, firstByRun.get(piece.run) === index],
			[piece.to, false, lastByRun.get(piece.run) === index],
		] as const) {
			if (!applies || piece.run === cyclicRun) continue
			if (stroke.cap === "round")
				distance = Math.min(
					distance,
					Math.max(
						0,
						Math.hypot(point.x - capPoint.x, point.y - capPoint.y) - radius,
					),
				)
			else if (stroke.cap === "square")
				distance = Math.min(
					distance,
					polygonDistance(
						capPolygon(capPoint, direction, radius, start),
						point,
					),
				)
		}
		const next = pieces[index + 1] ?? (contour.closed ? pieces[0] : undefined)
		if (next === undefined || next.run !== piece.run) continue
		if (stroke.join === "round")
			distance = Math.min(
				distance,
				Math.max(
					0,
					Math.hypot(point.x - piece.to.x, point.y - piece.to.y) - radius,
				),
			)
		else
			for (const polygon of joinPolygons(piece, next, stroke, radius))
				distance = Math.min(distance, polygonDistance(polygon, point))
	}
	return distance
}

export function objectFillContainsPoint(
	object: DesignObject,
	point: Point,
): boolean {
	if (object.appearance.fill === undefined) return false
	let totalWinding = 0
	for (const contour of projectDesignObjectContours(object)) {
		if (contour.points.length < 3) continue
		const result = windingNumber(point, flattenDesignContour(contour))
		if (result.classification === "boundary") return true
		totalWinding += result.winding
	}
	return designObjectFillRule(object) === "evenodd"
		? Math.abs(totalWinding) % 2 === 1
		: totalWinding !== 0
}

export function objectStrokeDistance(
	object: DesignObject,
	point: Point,
): number {
	const stroke = object.appearance.stroke
	if (stroke === undefined || stroke.width === 0)
		return Number.POSITIVE_INFINITY
	return Math.min(
		...projectDesignObjectContours(object).map((contour) =>
			contourStrokeDistance(contour, stroke, point),
		),
	)
}

export function objectCenterlineDistance(
	object: DesignObject,
	point: Point,
): number {
	return Math.min(
		...projectDesignObjectContours(object).flatMap((contour) => {
			const points = flattenDesignContour(contour)
			return points
				.slice(1)
				.map((to, index) => segmentDistance(point, points[index] ?? to, to))
		}),
	)
}

function includeCircle(points: Point[], center: Point, radius: number): void {
	points.push(
		{ x: center.x - radius, y: center.y - radius },
		{ x: center.x + radius, y: center.y + radius },
	)
}

function contourStrokeBounds(
	contour: DesignContour,
	stroke: DesignStroke,
): Bounds | null {
	const radius = stroke.width / 2
	const pieces = strokePieces(contour, stroke)
	if (radius <= 0 || pieces.length === 0) return null
	const points: Point[] = []
	const firstByRun = new Map<number, number>()
	const lastByRun = new Map<number, number>()
	const cyclicRun =
		contour.closed && pieces[0]?.run === pieces.at(-1)?.run
			? pieces[0]?.run
			: undefined
	for (const [index, piece] of pieces.entries()) {
		firstByRun.set(piece.run, firstByRun.get(piece.run) ?? index)
		lastByRun.set(piece.run, index)
		points.push(...segmentBody(piece, radius))
	}
	for (const [index, piece] of pieces.entries()) {
		const direction = unitVector(piece.from, piece.to)
		if (direction === null) continue
		for (const [capPoint, start, applies] of [
			[piece.from, true, firstByRun.get(piece.run) === index],
			[piece.to, false, lastByRun.get(piece.run) === index],
		] as const) {
			if (!applies || piece.run === cyclicRun) continue
			if (stroke.cap === "round") includeCircle(points, capPoint, radius)
			else if (stroke.cap === "square")
				points.push(...capPolygon(capPoint, direction, radius, start))
		}
		const next = pieces[index + 1] ?? (contour.closed ? pieces[0] : undefined)
		if (next === undefined || next.run !== piece.run) continue
		if (stroke.join === "round") includeCircle(points, piece.to, radius)
		else
			for (const polygon of joinPolygons(piece, next, stroke, radius))
				points.push(...polygon)
	}
	return boundsOfPoints(points)
}

function unionBounds(left: Bounds | null, right: Bounds | null): Bounds | null {
	if (left === null) return right
	if (right === null) return left
	return {
		minX: Math.min(left.minX, right.minX),
		minY: Math.min(left.minY, right.minY),
		maxX: Math.max(left.maxX, right.maxX),
		maxY: Math.max(left.maxY, right.maxY),
	}
}

export function visibleObjectBounds(object: DesignObject): Bounds | null {
	let bounds =
		object.appearance.fill === undefined ? null : objectBounds(object)
	const stroke = object.appearance.stroke
	if (stroke === undefined || stroke.width === 0) return bounds
	for (const contour of projectDesignObjectContours(object))
		bounds = unionBounds(bounds, contourStrokeBounds(contour, stroke))
	return bounds
}

export function objectBoundsFor(
	object: DesignObject,
	kind: "geometric" | "visible",
): Bounds | null {
	return kind === "geometric"
		? objectBounds(object)
		: visibleObjectBounds(object)
}
