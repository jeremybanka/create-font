import type { DesignContour, DesignObject, DesignPoint } from "./types.ts"

export interface Bounds {
	readonly minX: number
	readonly minY: number
	readonly maxX: number
	readonly maxY: number
}

export const ELLIPSE_KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

export function rectangleContour(bounds: Bounds): DesignContour {
	return {
		closed: true,
		points: [
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			{ x: bounds.minX, y: bounds.maxY },
		],
	}
}

export function ellipseContour(bounds: Bounds): DesignContour {
	const centerX = (bounds.minX + bounds.maxX) / 2
	const centerY = (bounds.minY + bounds.maxY) / 2
	const handleX = ((bounds.maxX - bounds.minX) / 2) * ELLIPSE_KAPPA
	const handleY = ((bounds.maxY - bounds.minY) / 2) * ELLIPSE_KAPPA
	return {
		closed: true,
		points: [
			{
				x: centerX,
				y: bounds.minY,
				incoming: { x: -handleX, y: 0 },
				outgoing: { x: handleX, y: 0 },
			},
			{
				x: bounds.maxX,
				y: centerY,
				incoming: { x: 0, y: -handleY },
				outgoing: { x: 0, y: handleY },
			},
			{
				x: centerX,
				y: bounds.maxY,
				incoming: { x: handleX, y: 0 },
				outgoing: { x: -handleX, y: 0 },
			},
			{
				x: bounds.minX,
				y: centerY,
				incoming: { x: 0, y: handleY },
				outgoing: { x: 0, y: -handleY },
			},
		],
	}
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
	return object.contours.map(contourSvgPath).join(" ")
}

export function objectBounds(object: DesignObject): Bounds | null {
	const points = object.contours.flatMap((contour) => contour.points)
	if (points.length === 0) return null
	return {
		minX: Math.min(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxX: Math.max(...points.map((point) => point.x)),
		maxY: Math.max(...points.map((point) => point.y)),
	}
}

export function translateObject(
	object: DesignObject,
	x: number,
	y: number,
): DesignObject {
	return mapObjectPoints(object, (point) => ({
		...point,
		x: point.x + x,
		y: point.y + y,
	}))
}

export function scaleObject(
	object: DesignObject,
	anchor: Readonly<{ x: number; y: number }>,
	scaleX: number,
	scaleY: number,
): DesignObject {
	return mapObjectPoints(object, (point) => ({
		...point,
		x: anchor.x + (point.x - anchor.x) * scaleX,
		y: anchor.y + (point.y - anchor.y) * scaleY,
		...(point.incoming === undefined
			? {}
			: {
					incoming: {
						x: point.incoming.x * scaleX,
						y: point.incoming.y * scaleY,
					},
				}),
		...(point.outgoing === undefined
			? {}
			: {
					outgoing: {
						x: point.outgoing.x * scaleX,
						y: point.outgoing.y * scaleY,
					},
				}),
	}))
}

function mapObjectPoints(
	object: DesignObject,
	map: (point: DesignPoint) => DesignPoint,
): DesignObject {
	return {
		...object,
		contours: object.contours.map((contour) => ({
			...contour,
			points: contour.points.map(map),
		})),
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
