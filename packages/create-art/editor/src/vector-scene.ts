import type {
	VectorContour,
	VectorNode,
	VectorObject,
	VectorPoint,
} from "./vector-editing.ts"
import { lowerCornerProfiles } from "@create-art/vector-geometry"

export interface VectorBounds {
	readonly minX: number
	readonly minY: number
	readonly maxX: number
	readonly maxY: number
}

export const VECTOR_ELLIPSE_KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

const number = (value: number): string => Number(value.toFixed(3)).toString()

function vectorSegmentCommand(
	from: VectorPoint & Partial<Pick<VectorNode, "outgoing">>,
	to: VectorPoint & Partial<Pick<VectorNode, "incoming">>,
): string {
	if (from.outgoing === undefined && to.incoming === undefined)
		return `L ${number(to.x)} ${number(to.y)}`
	const outgoing = from.outgoing ?? { x: 0, y: 0 }
	const incoming = to.incoming ?? { x: 0, y: 0 }
	return `C ${number(from.x + outgoing.x)} ${number(from.y + outgoing.y)} ${number(to.x + incoming.x)} ${number(to.y + incoming.y)} ${number(to.x)} ${number(to.y)}`
}

/** Paints one prospective Pen segment exactly as it would be committed. */
export function vectorPenSegmentPath(
	from: VectorPoint & Partial<Pick<VectorNode, "outgoing">>,
	to: VectorPoint & Partial<Pick<VectorNode, "incoming">>,
): string {
	const start = `M ${number(from.x)} ${number(from.y)}`
	return `${start} ${vectorSegmentCommand(from, to)}`
}

export function vectorContourPath(contour: VectorContour): string {
	const nodes = contour.nodes.some(({ corner }) => corner !== undefined)
		? lowerCornerProfiles({
				closed: contour.closed,
				points: contour.nodes.map((node) => ({
					id: node.id,
					point: { x: node.x, y: node.y },
					...(node.incoming === undefined
						? {}
						: {
								incoming: {
									x: node.x + node.incoming.x,
									y: node.y + node.incoming.y,
								},
							}),
					...(node.outgoing === undefined
						? {}
						: {
								outgoing: {
									x: node.x + node.outgoing.x,
									y: node.y + node.outgoing.y,
								},
							}),
					...(node.corner === undefined ? {} : { corner: node.corner }),
				})),
			}).points.map((node) => ({
				id: node.id,
				mode: "hard" as const,
				x: node.point.x,
				y: node.point.y,
				...(node.incoming === undefined
					? {}
					: {
							incoming: {
								x: node.incoming.x - node.point.x,
								y: node.incoming.y - node.point.y,
							},
						}),
				...(node.outgoing === undefined
					? {}
					: {
							outgoing: {
								x: node.outgoing.x - node.point.x,
								y: node.outgoing.y - node.point.y,
							},
						}),
			}))
		: contour.nodes
	const first = nodes[0]
	if (first === undefined) return ""
	const commands = [`M ${number(first.x)} ${number(first.y)}`]
	for (let index = 1; index < nodes.length; index += 1) {
		const previous = nodes[index - 1]
		const point = nodes[index]
		if (previous !== undefined && point !== undefined)
			commands.push(vectorSegmentCommand(previous, point))
	}
	if (contour.closed && nodes.length > 1) {
		const last = nodes.at(-1)
		if (last !== undefined) commands.push(vectorSegmentCommand(last, first))
		commands.push("Z")
	}
	return commands.join(" ")
}

export function vectorObjectPath(
	object: Pick<VectorObject, "contours">,
): string {
	return object.contours.map(vectorContourPath).join(" ")
}

export function vectorBounds(
	points: readonly VectorPoint[],
): VectorBounds | null {
	if (points.length === 0) return null
	return {
		minX: Math.min(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxX: Math.max(...points.map((point) => point.x)),
		maxY: Math.max(...points.map((point) => point.y)),
	}
}

export function vectorShapeNodes(
	kind: "rect" | "ellipse",
	bounds: VectorBounds,
	id: (index: number) => string = (index) => `point:${index}`,
): readonly VectorNode[] {
	const { minX, minY, maxX, maxY } = bounds
	if (maxX <= minX || maxY <= minY) return []
	if (kind === "rect")
		return [
			{ id: id(0), mode: "hard", x: minX, y: maxY },
			{ id: id(1), mode: "hard", x: maxX, y: maxY },
			{ id: id(2), mode: "hard", x: maxX, y: minY },
			{ id: id(3), mode: "hard", x: minX, y: minY },
		]
	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	const handleX = ((maxX - minX) / 2) * VECTOR_ELLIPSE_KAPPA
	const handleY = ((maxY - minY) / 2) * VECTOR_ELLIPSE_KAPPA
	return [
		{
			id: id(0),
			mode: "soft",
			x: centerX,
			y: maxY,
			incoming: { x: -handleX, y: 0 },
			outgoing: { x: handleX, y: 0 },
		},
		{
			id: id(1),
			mode: "soft",
			x: maxX,
			y: centerY,
			incoming: { x: 0, y: handleY },
			outgoing: { x: 0, y: -handleY },
		},
		{
			id: id(2),
			mode: "soft",
			x: centerX,
			y: minY,
			incoming: { x: handleX, y: 0 },
			outgoing: { x: -handleX, y: 0 },
		},
		{
			id: id(3),
			mode: "soft",
			x: minX,
			y: centerY,
			incoming: { x: 0, y: -handleY },
			outgoing: { x: 0, y: handleY },
		},
	]
}

export function translateVectorObject(
	object: VectorObject,
	delta: VectorPoint,
): VectorObject {
	return {
		...object,
		contours: object.contours.map((contour) => ({
			...contour,
			nodes: contour.nodes.map((node) => ({
				...node,
				x: node.x + delta.x,
				y: node.y + delta.y,
			})),
		})),
	}
}

export function scaleVectorObject(
	object: VectorObject,
	anchor: VectorPoint,
	scale: VectorPoint,
): VectorObject {
	return {
		...object,
		contours: object.contours.map((contour) => ({
			...contour,
			nodes: contour.nodes.map((node) => ({
				...node,
				x: anchor.x + (node.x - anchor.x) * scale.x,
				y: anchor.y + (node.y - anchor.y) * scale.y,
				...(node.incoming === undefined
					? {}
					: {
							incoming: {
								x: node.incoming.x * scale.x,
								y: node.incoming.y * scale.y,
							},
						}),
				...(node.outgoing === undefined
					? {}
					: {
							outgoing: {
								x: node.outgoing.x * scale.x,
								y: node.outgoing.y * scale.y,
							},
						}),
			})),
		})),
	}
}

export function rotateVectorObject(
	object: VectorObject,
	anchor: VectorPoint,
	degrees: number,
): VectorObject {
	const radians = (degrees * Math.PI) / 180
	const cosine = Math.cos(radians)
	const sine = Math.sin(radians)
	const rotate = (point: VectorPoint): VectorPoint => ({
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine,
	})
	return {
		...object,
		contours: object.contours.map((contour) => ({
			...contour,
			nodes: contour.nodes.map((node) => {
				const position = rotate({
					x: node.x - anchor.x,
					y: node.y - anchor.y,
				})
				return {
					...node,
					x: anchor.x + position.x,
					y: anchor.y + position.y,
					...(node.incoming === undefined
						? {}
						: { incoming: rotate(node.incoming) }),
					...(node.outgoing === undefined
						? {}
						: { outgoing: rotate(node.outgoing) }),
				}
			}),
		})),
	}
}
