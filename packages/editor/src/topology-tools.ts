import type { ContourId, PointId } from "@create-font/states"

import type { EditorCanvasContour } from "./editor-workspace.ts"

export const ENDPOINT_JOIN_RADIUS_PX = 24

export interface OpenEndpointTarget {
	readonly contourId: ContourId
	readonly pointId: PointId
	readonly x: number
	readonly y: number
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
	let nearest: OpenEndpointTarget | null = null
	let nearestSquared = Number.POSITIVE_INFINITY
	for (const contour of contours) {
		if (contour.closed || contour.id === sourceContourId) continue
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
