import {
	boundsOfPoints,
	cubicBounds,
	type Bounds,
	type Cubic,
} from "@create-art/vector-geometry"

import type {
	DesignContour,
	DesignGeometry,
	DesignObject,
	DesignPoint,
	DesignTransform,
} from "./types.ts"

export type { Bounds } from "@create-art/vector-geometry"

export const IDENTITY_DESIGN_TRANSFORM: DesignTransform = Object.freeze({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: 0,
	f: 0,
})

export const ELLIPSE_KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

export function rectangleContour(
	bounds: Bounds,
	id = "contour:rectangle-projection",
): DesignContour {
	return {
		id,
		closed: true,
		points: [
			{ id: `${id}:point:0`, x: bounds.minX, y: bounds.minY },
			{ id: `${id}:point:1`, x: bounds.maxX, y: bounds.minY },
			{ id: `${id}:point:2`, x: bounds.maxX, y: bounds.maxY },
			{ id: `${id}:point:3`, x: bounds.minX, y: bounds.maxY },
		],
	}
}

export function ellipseContour(
	bounds: Bounds,
	id = "contour:ellipse-projection",
): DesignContour {
	const centerX = (bounds.minX + bounds.maxX) / 2
	const centerY = (bounds.minY + bounds.maxY) / 2
	const handleX = ((bounds.maxX - bounds.minX) / 2) * ELLIPSE_KAPPA
	const handleY = ((bounds.maxY - bounds.minY) / 2) * ELLIPSE_KAPPA
	return {
		id,
		closed: true,
		points: [
			{
				id: `${id}:point:0`,
				x: centerX,
				y: bounds.minY,
				incoming: { x: -handleX, y: 0 },
				outgoing: { x: handleX, y: 0 },
			},
			{
				id: `${id}:point:1`,
				x: bounds.maxX,
				y: centerY,
				incoming: { x: 0, y: -handleY },
				outgoing: { x: 0, y: handleY },
			},
			{
				id: `${id}:point:2`,
				x: centerX,
				y: bounds.maxY,
				incoming: { x: handleX, y: 0 },
				outgoing: { x: -handleX, y: 0 },
			},
			{
				id: `${id}:point:3`,
				x: bounds.minX,
				y: centerY,
				incoming: { x: 0, y: handleY },
				outgoing: { x: 0, y: -handleY },
			},
		],
	}
}

export function geometryContours(
	geometry: DesignGeometry,
	identityPrefix = "geometry-projection",
): readonly DesignContour[] {
	if (geometry.kind === "path") return geometry.contours
	if (geometry.kind === "rectangle") {
		return [
			rectangleContour(
				{
					minX: geometry.x,
					minY: geometry.y,
					maxX: geometry.x + geometry.width,
					maxY: geometry.y + geometry.height,
				},
				`${identityPrefix}:contour:0`,
			),
		]
	}
	return [
		ellipseContour(
			{
				minX: geometry.centerX - geometry.radiusX,
				minY: geometry.centerY - geometry.radiusY,
				maxX: geometry.centerX + geometry.radiusX,
				maxY: geometry.centerY + geometry.radiusY,
			},
			`${identityPrefix}:contour:0`,
		),
	]
}

function transformVector(
	transform: DesignTransform,
	vector: Readonly<{ x: number; y: number }>,
) {
	return {
		x: transform.a * vector.x + transform.c * vector.y,
		y: transform.b * vector.x + transform.d * vector.y,
	}
}

export function transformDesignPoint(
	transform: DesignTransform,
	point: DesignPoint,
): DesignPoint {
	return {
		id: point.id,
		x: transform.a * point.x + transform.c * point.y + transform.e,
		y: transform.b * point.x + transform.d * point.y + transform.f,
		...(point.incoming === undefined
			? {}
			: { incoming: transformVector(transform, point.incoming) }),
		...(point.outgoing === undefined
			? {}
			: { outgoing: transformVector(transform, point.outgoing) }),
	}
}

/**
 * Projects authored geometry into document-space contours. This is the single
 * intentional bake boundary used by renderers and interoperability adapters.
 */
export function projectDesignObjectContours(
	object: Pick<DesignObject, "id" | "geometry" | "transform">,
): readonly DesignContour[] {
	return geometryContours(object.geometry, object.id).map((contour) => ({
		...contour,
		points: contour.points.map((point) =>
			transformDesignPoint(object.transform, point),
		),
	}))
}

const pathNumber = (value: number): string =>
	Number(value.toFixed(3)).toString()

export function contourSvgPath(contour: DesignContour): string {
	const first = contour.points[0]
	if (first === undefined) return ""
	const commands = [`M ${pathNumber(first.x)} ${pathNumber(first.y)}`]
	for (let index = 1; index < contour.points.length; index += 1) {
		const previous = contour.points[index - 1]
		const point = contour.points[index]
		if (previous === undefined || point === undefined) continue
		commands.push(segmentSvgPath(previous, point))
	}
	if (contour.closed && contour.points.length > 1) {
		const last = contour.points.at(-1)
		if (last !== undefined) commands.push(segmentSvgPath(last, first))
		commands.push("Z")
	}
	return commands.join(" ")
}

function segmentSvgPath(from: DesignPoint, to: DesignPoint): string {
	if (from.outgoing === undefined && to.incoming === undefined) {
		return `L ${pathNumber(to.x)} ${pathNumber(to.y)}`
	}
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	return [
		"C",
		pathNumber(from.x + first.x),
		pathNumber(from.y + first.y),
		pathNumber(to.x + second.x),
		pathNumber(to.y + second.y),
		pathNumber(to.x),
		pathNumber(to.y),
	].join(" ")
}

export function objectSvgPath(object: DesignObject): string {
	return projectDesignObjectContours(object).map(contourSvgPath).join(" ")
}

function cubicForSegment(from: DesignPoint, to: DesignPoint): Cubic {
	const outgoing = from.outgoing ?? { x: 0, y: 0 }
	const incoming = to.incoming ?? { x: 0, y: 0 }
	return {
		p0: from,
		c1: { x: from.x + outgoing.x, y: from.y + outgoing.y },
		c2: { x: to.x + incoming.x, y: to.y + incoming.y },
		p3: to,
	}
}

export function objectBounds(object: DesignObject): Bounds | null {
	const contours = projectDesignObjectContours(object)
	const points = contours.flatMap((contour) => contour.points)
	if (points.length === 0) return null
	let bounds = boundsOfPoints(points)
	if (bounds === null) return null
	for (const contour of contours) {
		const count = contour.closed
			? contour.points.length
			: Math.max(0, contour.points.length - 1)
		for (let index = 0; index < count; index += 1) {
			const from = contour.points[index]
			const to = contour.points[(index + 1) % contour.points.length]
			if (from === undefined || to === undefined) continue
			const segmentBounds = cubicBounds(cubicForSegment(from, to))
			bounds = {
				minX: Math.min(bounds.minX, segmentBounds.minX),
				minY: Math.min(bounds.minY, segmentBounds.minY),
				maxX: Math.max(bounds.maxX, segmentBounds.maxX),
				maxY: Math.max(bounds.maxY, segmentBounds.maxY),
			}
		}
	}
	return bounds
}

export function translateObject(
	object: DesignObject,
	x: number,
	y: number,
): DesignObject {
	return {
		...object,
		transform: {
			...object.transform,
			e: object.transform.e + x,
			f: object.transform.f + y,
		},
	}
}

export function scaleObject(
	object: DesignObject,
	anchor: Readonly<{ x: number; y: number }>,
	scaleX: number,
	scaleY: number,
): DesignObject {
	const transform = object.transform
	return {
		...object,
		transform: {
			a: scaleX * transform.a,
			b: scaleY * transform.b,
			c: scaleX * transform.c,
			d: scaleY * transform.d,
			e: anchor.x + scaleX * (transform.e - anchor.x),
			f: anchor.y + scaleY * (transform.f - anchor.y),
		},
	}
}

export function rotateObject(
	object: DesignObject,
	anchor: Readonly<{ x: number; y: number }>,
	degrees: number,
): DesignObject {
	const radians = (degrees * Math.PI) / 180
	const cosine = Math.cos(radians)
	const sine = Math.sin(radians)
	const transform = object.transform
	const offsetX = transform.e - anchor.x
	const offsetY = transform.f - anchor.y
	return {
		...object,
		transform: {
			a: cosine * transform.a - sine * transform.b,
			b: sine * transform.a + cosine * transform.b,
			c: cosine * transform.c - sine * transform.d,
			d: sine * transform.c + cosine * transform.d,
			e: anchor.x + cosine * offsetX - sine * offsetY,
			f: anchor.y + sine * offsetX + cosine * offsetY,
		},
	}
}

/** Explicitly bakes the current transform and any live shape into path geometry. */
export function bakeDesignObject(object: DesignObject): DesignObject {
	return {
		...object,
		geometry: { kind: "path", contours: projectDesignObjectContours(object) },
		transform: IDENTITY_DESIGN_TRANSFORM,
	}
}

export function normalizedBounds(
	first: Readonly<{ x: number; y: number }>,
	second: Readonly<{ x: number; y: number }>,
	square = false,
	fromCenter = false,
): Bounds {
	let x = second.x
	let y = second.y
	if (square) {
		const side = Math.max(Math.abs(x - first.x), Math.abs(y - first.y))
		x = first.x + Math.sign(x - first.x || 1) * side
		y = first.y + Math.sign(y - first.y || 1) * side
	}
	const opposite = fromCenter
		? { x: first.x - (x - first.x), y: first.y - (y - first.y) }
		: first
	return {
		minX: Math.min(opposite.x, x),
		minY: Math.min(opposite.y, y),
		maxX: Math.max(opposite.x, x),
		maxY: Math.max(opposite.y, y),
	}
}
