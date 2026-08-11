import type {
	CanvasPoint,
	VectorHandleKind,
	VectorNode,
} from "@create-art/editor"

import { projectDesignVectorObject } from "./design-vector-adapter.ts"
import type { Bounds } from "@create-design/model"
import {
	projectDesignEffectiveHierarchy,
	visibleObjectBounds,
} from "@create-design/model"
import type { DesignDocument, DesignObject } from "./types.ts"

/** Measures signed document-space travel along the initial inward axis. */
export function designInwardDistances(
	anchor: CanvasPoint,
	start: CanvasPoint,
	current: CanvasPoint,
): Readonly<{ start: number; current: number }> | null {
	const inward = {
		x: start.x - anchor.x,
		y: start.y - anchor.y,
	}
	const startDistance = Math.hypot(inward.x, inward.y)
	if (startDistance <= Number.EPSILON) return { start: 0, current: 0 }
	return {
		start: startDistance,
		current:
			((current.x - anchor.x) * inward.x + (current.y - anchor.y) * inward.y) /
			startDistance,
	}
}

/**
 * Maps the fixed visual handle inset onto the full authored corner amount.
 * Travel farther inward retains the existing one-unit-per-unit response, while
 * outward travel reaches canonical sharp state at the authored perimeter and
 * stays sharp after crossing it.
 */
export function designCornerAmountFromInwardDrag(
	originalAmount: number,
	startDistance: number,
	currentDistance: number,
): number {
	if (currentDistance >= startDistance || startDistance <= Number.EPSILON)
		return Math.max(0, originalAmount + currentDistance - startDistance)
	if (currentDistance <= startDistance * 1e-6) return 0
	return Math.max(0, originalAmount * (currentDistance / startDistance))
}

export type DesignDirectSelectionTarget =
	| Readonly<{
			readonly kind: "node"
			readonly objectId: string
			readonly contourId: string
			readonly pointId: string
	  }>
	| Readonly<{
			readonly kind: "handle"
			readonly objectId: string
			readonly contourId: string
			readonly pointId: string
			readonly handle: VectorHandleKind
	  }>
	| Readonly<{
			readonly kind: "contour"
			readonly objectId: string
			readonly contourId: string
	  }>
	| Readonly<{
			readonly kind: "segment"
			readonly objectId: string
			readonly contourId: string
			readonly segmentIndex: number
	  }>

export function directSelectionKey(
	target: DesignDirectSelectionTarget,
): string {
	if (target.kind === "node")
		return `${target.objectId}:${target.contourId}:node:${target.pointId}`
	if (target.kind === "handle")
		return `${target.objectId}:${target.contourId}:handle:${target.pointId}:${target.handle}`
	if (target.kind === "contour")
		return `${target.objectId}:${target.contourId}:contour`
	return `${target.objectId}:${target.contourId}:segment:${target.segmentIndex}`
}

export function toggleDirectSelection(
	selection: readonly DesignDirectSelectionTarget[],
	target: DesignDirectSelectionTarget,
	additive: boolean,
): readonly DesignDirectSelectionTarget[] {
	if (!additive) return [target]
	const key = directSelectionKey(target)
	return selection.some((candidate) => directSelectionKey(candidate) === key)
		? selection.filter((candidate) => directSelectionKey(candidate) !== key)
		: [...selection, target]
}

export function toggleObjectSelection(
	selection: readonly string[],
	objectId: string,
	additive: boolean,
): readonly string[] {
	if (!additive) return selection.includes(objectId) ? selection : [objectId]
	return selection.includes(objectId)
		? selection.filter((candidate) => candidate !== objectId)
		: [...selection, objectId]
}

export function selectableObjectIds(
	objects: readonly DesignObject[],
): readonly string[] {
	return objects.flatMap((object) =>
		object.hidden || object.locked ? [] : [object.id],
	)
}

export function selectionBounds(
	objects: readonly DesignObject[],
	boundsForObject: (
		object: DesignObject,
	) => Bounds | null = visibleObjectBounds,
): Bounds | null {
	const bounds = objects.flatMap((object) => {
		if (object.hidden) return []
		const value = boundsForObject(object)
		return value === null ? [] : [value]
	})
	if (bounds.length === 0) return null
	return {
		minX: Math.min(...bounds.map((value) => value.minX)),
		minY: Math.min(...bounds.map((value) => value.minY)),
		maxX: Math.max(...bounds.map((value) => value.maxX)),
		maxY: Math.max(...bounds.map((value) => value.maxY)),
	}
}

export function marqueeObjectIds(
	objects: readonly DesignObject[],
	bounds: Bounds,
	boundsForObject: (
		object: DesignObject,
	) => Bounds | null = visibleObjectBounds,
): readonly string[] {
	return objects.flatMap((object) => {
		if (object.hidden || object.locked) return []
		const objectBounds = boundsForObject(object)
		if (objectBounds === null) return []
		return objectBounds.maxX >= bounds.minX &&
			objectBounds.minX <= bounds.maxX &&
			objectBounds.maxY >= bounds.minY &&
			objectBounds.minY <= bounds.maxY
			? [object.id]
			: []
	})
}

export function marqueeDirectSelection(
	document: DesignDocument,
	bounds: Bounds,
): readonly DesignDirectSelectionTarget[] {
	return projectDesignEffectiveHierarchy(document).editableObjects.flatMap(
		(object) => {
			if (object.hidden || object.locked || object.geometry.kind !== "path")
				return []
			return projectDesignVectorObject(document, object).contours.flatMap(
				(contour) =>
					contour.nodes.flatMap((node) =>
						node.x >= bounds.minX &&
						node.x <= bounds.maxX &&
						node.y >= bounds.minY &&
						node.y <= bounds.maxY
							? [
									{
										kind: "node" as const,
										objectId: object.id,
										contourId: contour.id,
										pointId: node.id,
									},
								]
							: [],
					),
			)
		},
	)
}

const squaredDistance = (first: CanvasPoint, second: CanvasPoint): number =>
	(first.x - second.x) ** 2 + (first.y - second.y) ** 2

function lineDistanceSquared(
	point: CanvasPoint,
	start: CanvasPoint,
	end: CanvasPoint,
): number {
	const x = end.x - start.x
	const y = end.y - start.y
	const length = x * x + y * y
	if (length === 0) return squaredDistance(point, start)
	const amount = Math.max(
		0,
		Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / length),
	)
	return squaredDistance(point, {
		x: start.x + amount * x,
		y: start.y + amount * y,
	})
}

function cubicPoint(
	from: VectorNode,
	to: VectorNode,
	amount: number,
): CanvasPoint {
	const inverse = 1 - amount
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	const c1 = { x: from.x + first.x, y: from.y + first.y }
	const c2 = { x: to.x + second.x, y: to.y + second.y }
	return {
		x:
			inverse ** 3 * from.x +
			3 * inverse ** 2 * amount * c1.x +
			3 * inverse * amount ** 2 * c2.x +
			amount ** 3 * to.x,
		y:
			inverse ** 3 * from.y +
			3 * inverse ** 2 * amount * c1.y +
			3 * inverse * amount ** 2 * c2.y +
			amount ** 3 * to.y,
	}
}

function segmentDistanceSquared(
	point: CanvasPoint,
	from: VectorNode,
	to: VectorNode,
): number {
	if (from.outgoing === undefined && to.incoming === undefined)
		return lineDistanceSquared(point, from, to)
	let distance = Number.POSITIVE_INFINITY
	let previous: CanvasPoint = from
	for (let index = 1; index <= 16; index += 1) {
		const current = cubicPoint(from, to, index / 16)
		distance = Math.min(distance, lineDistanceSquared(point, previous, current))
		previous = current
	}
	return distance
}

export function nearestDirectSelectionTarget(
	document: Pick<DesignDocument, "swatches">,
	objects: readonly DesignObject[],
	point: CanvasPoint,
	worldScale: number,
	options: Readonly<{ contour?: boolean; maxDistancePixels?: number }> = {},
): DesignDirectSelectionTarget | null {
	if (!(worldScale > 0)) return null
	const maximum = (options.maxDistancePixels ?? 10) / worldScale
	let best:
		| Readonly<{
				target: DesignDirectSelectionTarget
				distance: number
				priority: number
				stack: number
		  }>
		| undefined
	const consider = (
		target: DesignDirectSelectionTarget,
		distance: number,
		priority: number,
		stack: number,
	): void => {
		if (distance > maximum) return
		if (
			best === undefined ||
			distance < best.distance ||
			(distance === best.distance && priority < best.priority) ||
			(priority === best.priority &&
				distance === best.distance &&
				stack > best.stack)
		)
			best = { target, distance, priority, stack }
	}
	for (const [stack, object] of objects.entries()) {
		if (object.hidden || object.locked || object.geometry.kind !== "path")
			continue
		const projected = projectDesignVectorObject(document, object)
		for (const contour of projected.contours) {
			for (const node of contour.nodes) {
				for (const handle of ["incoming", "outgoing"] as const) {
					const vector = node[handle]
					if (vector === undefined) continue
					consider(
						{
							kind: "handle",
							objectId: object.id,
							contourId: contour.id,
							pointId: node.id,
							handle,
						},
						Math.sqrt(
							squaredDistance(point, {
								x: node.x + vector.x,
								y: node.y + vector.y,
							}),
						),
						0,
						stack,
					)
				}
				consider(
					{
						kind: "node",
						objectId: object.id,
						contourId: contour.id,
						pointId: node.id,
					},
					Math.sqrt(squaredDistance(point, node)),
					1,
					stack,
				)
			}
			const count = contour.closed
				? contour.nodes.length
				: Math.max(0, contour.nodes.length - 1)
			for (let segmentIndex = 0; segmentIndex < count; segmentIndex += 1) {
				const from = contour.nodes[segmentIndex]
				const to = contour.nodes[(segmentIndex + 1) % contour.nodes.length]
				if (from === undefined || to === undefined) continue
				consider(
					options.contour
						? { kind: "contour", objectId: object.id, contourId: contour.id }
						: {
								kind: "segment",
								objectId: object.id,
								contourId: contour.id,
								segmentIndex,
							},
					Math.sqrt(segmentDistanceSquared(point, from, to)),
					2,
					stack,
				)
			}
		}
	}
	return best?.target ?? null
}

function selectedControls(
	objectId: string,
	contours: readonly Readonly<{
		readonly id: string
		readonly closed: boolean
		readonly nodes: readonly VectorNode[]
	}>[],
	selection: readonly DesignDirectSelectionTarget[],
): Readonly<{ points: ReadonlySet<string>; handles: ReadonlySet<string> }> {
	const points = new Set<string>()
	const handles = new Set<string>()
	for (const target of selection) {
		if (target.objectId !== objectId) continue
		const contour = contours.find(
			(candidate) => candidate.id === target.contourId,
		)
		if (contour === undefined) continue
		if (target.kind === "node") points.add(target.pointId)
		else if (target.kind === "handle")
			handles.add(`${target.pointId}:${target.handle}`)
		else if (target.kind === "contour")
			for (const node of contour.nodes) points.add(node.id)
		else {
			const first = contour.nodes[target.segmentIndex]
			const second =
				contour.nodes[(target.segmentIndex + 1) % contour.nodes.length]
			if (first !== undefined) points.add(first.id)
			if (second !== undefined) points.add(second.id)
		}
	}
	return { points, handles }
}

/** Updates selected controls in local space while preserving the object transform. */
export function translateDirectSelection(
	document: DesignDocument,
	selection: readonly DesignDirectSelectionTarget[],
	delta: CanvasPoint,
): DesignDocument {
	if (selection.length === 0 || (delta.x === 0 && delta.y === 0))
		return document
	let changed = false
	const objects = document.objects.map((object) => {
		if (object.hidden || object.locked || object.geometry.kind !== "path")
			return object
		const projected = projectDesignVectorObject(document, object)
		const controls = selectedControls(object.id, projected.contours, selection)
		if (controls.points.size === 0 && controls.handles.size === 0) return object
		const determinant =
			object.transform.a * object.transform.d -
			object.transform.b * object.transform.c
		if (Math.abs(determinant) <= Number.EPSILON) return object
		const localDelta = {
			x:
				(object.transform.d * delta.x - object.transform.c * delta.y) /
				determinant,
			y:
				(-object.transform.b * delta.x + object.transform.a * delta.y) /
				determinant,
		}
		changed = true
		return {
			...object,
			geometry: {
				...object.geometry,
				contours: object.geometry.contours.map((contour) => ({
					...contour,
					points: contour.points.map((point) => ({
						...point,
						...(controls.points.has(point.id)
							? {
									x: point.x + localDelta.x,
									y: point.y + localDelta.y,
								}
							: {}),
						...(point.incoming === undefined ||
						controls.points.has(point.id) ||
						!controls.handles.has(`${point.id}:incoming`)
							? {}
							: {
									incoming: {
										x: point.incoming.x + localDelta.x,
										y: point.incoming.y + localDelta.y,
									},
								}),
						...(point.outgoing === undefined ||
						controls.points.has(point.id) ||
						!controls.handles.has(`${point.id}:outgoing`)
							? {}
							: {
									outgoing: {
										x: point.outgoing.x + localDelta.x,
										y: point.outgoing.y + localDelta.y,
									},
								}),
					})),
				})),
			},
		}
	})
	return changed ? { ...document, objects } : document
}

export function directSelectionDescription(
	selection: readonly DesignDirectSelectionTarget[],
): string {
	if (selection.length === 0) return "No direct controls selected."
	const counts = new Map<DesignDirectSelectionTarget["kind"], number>()
	for (const target of selection)
		counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1)
	return [...counts]
		.map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
		.join(", ")
}
