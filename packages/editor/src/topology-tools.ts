import type { ContourId, PointId } from "@create-font/states"

import type { EditorCanvasContour } from "./editor-workspace.ts"

export const ENDPOINT_JOIN_RADIUS_PX = 24

export interface OpenEndpointTarget {
	readonly contourId: ContourId
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

export interface EndpointJoinCandidate {
	readonly sourceContourId: ContourId
	readonly sourcePointId: PointId
	readonly sourceX: number
	readonly sourceY: number
	readonly target: OpenEndpointTarget
}

export interface PointDragPreview {
	readonly origin: Readonly<{ x: number; y: number }>
	readonly target: {
		position(point: Readonly<{ x: number; y: number }>): unknown
		getLayer(): Readonly<{ batchDraw(): unknown }> | null
	}
	lastRawPoint: Readonly<{ x: number; y: number }> | null
	joinTarget: OpenEndpointTarget | null
}

/** Lets either half of a fresh Knife cut separate instead of rigidly moving both. */
export function hasSelectedCoincidentEndpointPeer(
	contours: readonly EditorCanvasContour[],
	pointId: PointId,
	selectedPointIds: ReadonlySet<PointId>,
): boolean {
	let source: Readonly<{ x: number; y: number }> | null = null
	const endpoints: Readonly<{ pointId: PointId; x: number; y: number }>[] = []
	for (const contour of contours) {
		if (contour.closed) continue
		const first = contour.nodes[0]
		const last = contour.nodes.at(-1)
		if (first === undefined || last === undefined) continue
		for (const endpoint of [first, last]) {
			endpoints.push(endpoint)
			if (endpoint.pointId === pointId) source = endpoint
		}
	}
	if (source === null) return false
	return endpoints.some(
		(endpoint) =>
			endpoint.pointId !== pointId &&
			selectedPointIds.has(endpoint.pointId) &&
			endpoint.x === source.x &&
			endpoint.y === source.y,
	)
}

/** Clears transient join state and optionally restores an uncommitted canvas node. */
export function finalizePointDragPreview(
	drag: PointDragPreview,
	restoreTarget: boolean,
): void {
	if (restoreTarget) {
		drag.target.position(drag.origin)
		drag.target.getLayer()?.batchDraw()
	}
	drag.lastRawPoint = null
	drag.joinTarget = null
}

export function resolveOpenEndpointTarget(
	contours: readonly EditorCanvasContour[],
	sourceContourId: ContourId,
	sourcePointId: PointId,
	pointer: Readonly<{ x: number; y: number }>,
	worldScale: number,
	maxDistancePx = ENDPOINT_JOIN_RADIUS_PX,
): OpenEndpointTarget | null {
	if (!(worldScale > 0) || !(maxDistancePx >= 0)) return null
	const sourceContour = contours.find(
		(contour) => contour.id === sourceContourId,
	)
	if (
		sourceContour === undefined ||
		sourceContour.closed ||
		![
			sourceContour.nodes[0]?.pointId,
			sourceContour.nodes.at(-1)?.pointId,
		].includes(sourcePointId)
	)
		return null
	let nearest: OpenEndpointTarget | null = null
	let nearestSquared = Number.POSITIVE_INFINITY
	for (const contour of contours) {
		if (contour.closed) continue
		if (contour.id === sourceContourId && sourceContour.nodes.length < 4)
			continue
		for (const point of [contour.nodes[0], contour.nodes.at(-1)]) {
			if (point === undefined || point.pointId === sourcePointId) continue
			const distanceSquared =
				(point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2
			if (distanceSquared * worldScale ** 2 > maxDistancePx ** 2) continue
			const key = `${contour.id}\u0000${point.pointId}`
			const nearestKey =
				nearest === null ? "" : `${nearest.contourId}\u0000${nearest.pointId}`
			if (
				distanceSquared < nearestSquared ||
				(distanceSquared === nearestSquared &&
					(nearest === null || key < nearestKey))
			) {
				nearest = {
					contourId: contour.id,
					pointId: point.pointId,
					x: point.x,
					y: point.y,
				}
				nearestSquared = distanceSquared
			}
		}
	}
	return nearest
}

/** Resolves one deterministic join owned by an endpoint moved in a group drag. */
export function resolveMovedEndpointJoin(
	contours: readonly EditorCanvasContour[],
	movedPoints: readonly Readonly<{ pointId: PointId; x: number; y: number }>[],
	worldScale: number,
	maxDistancePx = ENDPOINT_JOIN_RADIUS_PX,
): EndpointJoinCandidate | null {
	const movedIds = new Set(movedPoints.map((point) => point.pointId))
	const endpointOwners = new Map<
		PointId,
		Readonly<{ contourId: ContourId; pointId: PointId; pointCount: number }>
	>()
	for (const contour of contours) {
		if (contour.closed) continue
		for (const point of [contour.nodes[0], contour.nodes.at(-1)]) {
			if (point !== undefined)
				endpointOwners.set(point.pointId, {
					contourId: contour.id,
					pointId: point.pointId,
					pointCount: contour.nodes.length,
				})
		}
	}
	let winner: EndpointJoinCandidate | null = null
	let winnerDistance = Number.POSITIVE_INFINITY
	let winnerKey = ""
	for (const moved of movedPoints) {
		const source = endpointOwners.get(moved.pointId)
		if (source === undefined) continue
		for (const contour of contours) {
			if (contour.closed) continue
			if (
				contour.id === source.contourId &&
				Math.min(source.pointCount, contour.nodes.length) < 4
			)
				continue
			for (const point of [contour.nodes[0], contour.nodes.at(-1)]) {
				if (
					point === undefined ||
					point.pointId === source.pointId ||
					movedIds.has(point.pointId)
				)
					continue
				const distance = (point.x - moved.x) ** 2 + (point.y - moved.y) ** 2
				if (distance * worldScale ** 2 > maxDistancePx ** 2) continue
				const key = `${source.contourId}\u0000${source.pointId}\u0000${contour.id}\u0000${point.pointId}`
				if (
					distance > winnerDistance ||
					(distance === winnerDistance && winner !== null && key >= winnerKey)
				)
					continue
				winner = {
					sourceContourId: source.contourId,
					sourcePointId: source.pointId,
					sourceX: moved.x,
					sourceY: moved.y,
					target: {
						contourId: contour.id,
						pointId: point.pointId,
						x: point.x,
						y: point.y,
					},
				}
				winnerDistance = distance
				winnerKey = key
			}
		}
	}
	return winner
}
