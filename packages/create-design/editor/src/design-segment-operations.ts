import { splitCubic } from "@create-art/vector-geometry"

import type { DesignDirectSelectionTarget } from "./design-selection.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "./types.ts"

export interface DesignSegmentReference {
	readonly objectId: string
	readonly contourId: string
	readonly segmentIndex: number
	readonly parameter: number
}

export type DesignSegmentOperationResult =
	| Readonly<{
			ok: true
			document: DesignDocument
			objectSelection: readonly string[]
			directSelection: readonly DesignDirectSelectionTarget[]
			message: string
	  }>
	| Readonly<{ ok: false; error: string }>

const fail = (error: string): DesignSegmentOperationResult => ({
	ok: false,
	error,
})

function segmentContext(
	document: DesignDocument,
	reference: DesignSegmentReference,
):
	| Readonly<{
			object: DesignObject & {
				readonly geometry: Extract<DesignObject["geometry"], { kind: "path" }>
			}
			contour: DesignContour
			start: DesignPoint
			end: DesignPoint
			endIndex: number
	  }>
	| string {
	const object = document.objects.find(({ id }) => id === reference.objectId)
	if (object === undefined) return "The path object is no longer available."
	if (object.hidden) return `Show ${object.name} before editing its paths.`
	if (object.locked) return `Unlock ${object.name} before editing its paths.`
	if (object.geometry.kind !== "path")
		return "This operation requires ordinary authored path geometry."
	if (
		object.geometry.contours.some((contour) =>
			contour.points.some(
				(point) => point.corner !== undefined && point.corner.amount > 0,
			),
		)
	)
		return "Expand live corners before editing path segments."
	const contour = object.geometry.contours.find(
		(candidate) => candidate.id === reference.contourId,
	)
	if (contour === undefined) return "The path contour is no longer available."
	const segmentCount = Math.max(
		0,
		contour.points.length - (contour.closed ? 0 : 1),
	)
	if (
		!Number.isInteger(reference.segmentIndex) ||
		reference.segmentIndex < 0 ||
		reference.segmentIndex >= segmentCount
	)
		return "The path segment is no longer available."
	const endIndex = (reference.segmentIndex + 1) % contour.points.length
	const start = contour.points[reference.segmentIndex]
	const end = contour.points[endIndex]
	if (start === undefined || end === undefined)
		return "The path segment has missing endpoints."
	return {
		object: object as DesignObject & {
			readonly geometry: Extract<DesignObject["geometry"], { kind: "path" }>
		},
		contour,
		start,
		end,
		endIndex,
	}
}

const vectorLengthSquared = (vector: Readonly<{ x: number; y: number }>) =>
	vector.x * vector.x + vector.y * vector.y

function oppositeRays(
	first: Readonly<{ x: number; y: number }>,
	second: Readonly<{ x: number; y: number }>,
): boolean {
	const scale = Math.sqrt(
		vectorLengthSquared(first) * vectorLengthSquared(second),
	)
	if (scale <= Number.EPSILON) return true
	const cross = first.x * second.y - first.y * second.x
	const dot = first.x * second.x + first.y * second.y
	return Math.abs(cross) <= scale * 1e-9 && dot <= 0
}

function inferredMode(point: DesignPoint): "hard" | "soft" {
	return (
		point.mode ??
		(point.incoming === undefined && point.outgoing === undefined
			? "hard"
			: "soft")
	)
}

function withOutgoing(
	point: DesignPoint,
	outgoing: DesignPoint["outgoing"],
): DesignPoint {
	const { outgoing: _outgoing, ...rest } = point
	return outgoing === undefined ? rest : { ...rest, outgoing }
}

function withIncoming(
	point: DesignPoint,
	incoming: DesignPoint["incoming"],
): DesignPoint {
	const { incoming: _incoming, ...rest } = point
	return incoming === undefined ? rest : { ...rest, incoming }
}

function hardenForChangedHandle(
	point: DesignPoint,
	changed: "incoming" | "outgoing",
	vector: Readonly<{ x: number; y: number }>,
): DesignPoint {
	if (inferredMode(point) !== "soft") return point
	const opposite = changed === "incoming" ? point.outgoing : point.incoming
	return opposite === undefined || oppositeRays(opposite, vector)
		? point
		: { ...point, mode: "hard" }
}

function replaceObject(
	document: DesignDocument,
	object: DesignObject,
): DesignDocument {
	return {
		...document,
		objects: document.objects.map((candidate) =>
			candidate.id === object.id ? object : candidate,
		),
	}
}

export function addDesignSegmentHandles(
	document: DesignDocument,
	reference: DesignSegmentReference,
): DesignSegmentOperationResult {
	const context = segmentContext(document, reference)
	if (typeof context === "string") return fail(context)
	const { object, contour, start, end, endIndex } = context
	if (start.outgoing !== undefined || end.incoming !== undefined)
		return fail("That segment already has Bézier handles.")
	const delta = { x: end.x - start.x, y: end.y - start.y }
	if (
		!Number.isFinite(delta.x) ||
		!Number.isFinite(delta.y) ||
		vectorLengthSquared(delta) <= Number.EPSILON
	)
		return fail("A zero-length segment cannot receive Bézier handles.")
	const startOutgoing = { x: delta.x / 3, y: delta.y / 3 }
	const endIncoming = { x: -delta.x / 3, y: -delta.y / 3 }
	const nextStart = withOutgoing(
		hardenForChangedHandle(start, "outgoing", startOutgoing),
		startOutgoing,
	)
	const nextEnd = withIncoming(
		hardenForChangedHandle(end, "incoming", endIncoming),
		endIncoming,
	)
	const nextContour = {
		...contour,
		points: contour.points.map((point, index) =>
			index === reference.segmentIndex
				? nextStart
				: index === endIndex
					? nextEnd
					: point,
		),
	}
	const nextObject = {
		...object,
		geometry: {
			...object.geometry,
			contours: object.geometry.contours.map((candidate) =>
				candidate.id === contour.id ? nextContour : candidate,
			),
		},
	}
	return {
		ok: true,
		document: replaceObject(document, nextObject),
		objectSelection: [object.id],
		directSelection: [
			{
				kind: "handle",
				objectId: object.id,
				contourId: contour.id,
				pointId: start.id,
				handle: "outgoing",
			},
			{
				kind: "handle",
				objectId: object.id,
				contourId: contour.id,
				pointId: end.id,
				handle: "incoming",
			},
		],
		message: "Added Bézier handles without changing the segment shape.",
	}
}

function occupiedIds(document: DesignDocument): Set<string> {
	const ids = new Set<string>()
	for (const object of document.objects) {
		ids.add(object.id)
		if (object.geometry.kind !== "path") continue
		for (const contour of object.geometry.contours) {
			ids.add(contour.id)
			for (const point of contour.points) ids.add(point.id)
		}
	}
	return ids
}

function allocateId(
	prefix: "contour" | "point",
	nextId: () => string,
	occupied: Set<string>,
): string | null {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = `${prefix}:${nextId()}`
		if (!occupied.has(id)) {
			occupied.add(id)
			return id
		}
	}
	return null
}

export function cutDesignSegment(
	document: DesignDocument,
	reference: DesignSegmentReference,
	nextId: () => string,
): DesignSegmentOperationResult {
	const context = segmentContext(document, reference)
	if (typeof context === "string") return fail(context)
	if (
		!Number.isFinite(reference.parameter) ||
		reference.parameter <= 0.001 ||
		reference.parameter >= 0.999
	)
		return fail("Cut inside the segment, away from its endpoints.")
	const { object, contour, start, end, endIndex } = context
	const cubic = {
		p0: { x: start.x, y: start.y },
		c1: {
			x: start.x + (start.outgoing?.x ?? 0),
			y: start.y + (start.outgoing?.y ?? 0),
		},
		c2: {
			x: end.x + (end.incoming?.x ?? 0),
			y: end.y + (end.incoming?.y ?? 0),
		},
		p3: { x: end.x, y: end.y },
	}
	if (
		[cubic.p0, cubic.c1, cubic.c2, cubic.p3].some(
			(point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
		) ||
		(cubic.p0.x === cubic.c1.x &&
			cubic.p0.y === cubic.c1.y &&
			cubic.p0.x === cubic.c2.x &&
			cubic.p0.y === cubic.c2.y &&
			cubic.p0.x === cubic.p3.x &&
			cubic.p0.y === cubic.p3.y)
	)
		return fail("A degenerate segment cannot be cut.")
	const occupied = occupiedIds(document)
	const leftId = allocateId("point", nextId, occupied)
	const rightId = allocateId("point", nextId, occupied)
	const rightContourId = contour.closed
		? null
		: allocateId("contour", nextId, occupied)
	if (
		leftId === null ||
		rightId === null ||
		(!contour.closed && rightContourId === null)
	)
		return fail("Could not allocate unique path identifiers for the cut.")

	const straight = start.outgoing === undefined && end.incoming === undefined
	const split = splitCubic(cubic, reference.parameter)
	const point = straight
		? {
				x: start.x + (end.x - start.x) * reference.parameter,
				y: start.y + (end.y - start.y) * reference.parameter,
			}
		: split.point
	const startOutgoing = straight
		? undefined
		: {
				x: split.left.c1.x - split.left.p0.x,
				y: split.left.c1.y - split.left.p0.y,
			}
	const endIncoming = straight
		? undefined
		: {
				x: split.right.c2.x - split.right.p3.x,
				y: split.right.c2.y - split.right.p3.y,
			}
	const nextStart = withOutgoing(
		startOutgoing === undefined
			? start
			: hardenForChangedHandle(start, "outgoing", startOutgoing),
		startOutgoing,
	)
	const nextEnd = withIncoming(
		endIncoming === undefined
			? end
			: hardenForChangedHandle(end, "incoming", endIncoming),
		endIncoming,
	)
	const left: DesignPoint = {
		id: leftId,
		mode: "hard",
		x: point.x,
		y: point.y,
		...(straight
			? {}
			: {
					incoming: {
						x: split.left.c2.x - point.x,
						y: split.left.c2.y - point.y,
					},
				}),
	}
	const right: DesignPoint = {
		id: rightId,
		mode: "hard",
		x: point.x,
		y: point.y,
		...(straight
			? {}
			: {
					outgoing: {
						x: split.right.c1.x - point.x,
						y: split.right.c1.y - point.y,
					},
				}),
	}
	const updated = contour.points.map((candidate, index) =>
		index === reference.segmentIndex
			? nextStart
			: index === endIndex
				? nextEnd
				: candidate,
	)
	let replacement: readonly DesignContour[]
	if (contour.closed) {
		const traversal =
			endIndex === 0
				? updated
				: [
						...updated.slice(endIndex),
						...updated.slice(0, reference.segmentIndex + 1),
					]
		replacement = [
			{
				...contour,
				closed: false,
				points: [right, ...traversal, left],
			},
		]
	} else {
		replacement = [
			{
				...contour,
				points: [...updated.slice(0, reference.segmentIndex + 1), left],
			},
			{
				id: rightContourId!,
				closed: false,
				points: [right, ...updated.slice(endIndex)],
			},
		]
	}
	const contourIndex = object.geometry.contours.indexOf(contour)
	const nextObject = {
		...object,
		geometry: {
			...object.geometry,
			contours: [
				...object.geometry.contours.slice(0, contourIndex),
				...replacement,
				...object.geometry.contours.slice(contourIndex + 1),
			],
		},
	}
	return {
		ok: true,
		document: replaceObject(document, nextObject),
		objectSelection: [object.id],
		directSelection: [
			{
				kind: "node",
				objectId: object.id,
				contourId: contour.id,
				pointId: left.id,
			},
			{
				kind: "node",
				objectId: object.id,
				contourId: contour.closed ? contour.id : rightContourId!,
				pointId: right.id,
			},
		],
		message: `Cut ${object.name}; the two new endpoints are selected.`,
	}
}
