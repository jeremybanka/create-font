import {
	rankAxisCandidate,
	rankPointCandidate,
	type CanvasPoint,
	type CanvasView,
	type CanvasViewport,
} from "@create-font/editor/shared"

import { objectBounds, translateObject, type Bounds } from "./geometry.ts"
import type { DesignDocument, DesignObject } from "./types.ts"

export const DESIGN_MIN_ZOOM = 0.2
export const DESIGN_MAX_ZOOM = 8

export function designBaseScale(
	viewport: CanvasViewport,
	page: Readonly<{ width: number; height: number }>,
	padding = 48,
): number {
	if (
		!(viewport.width > padding * 2) ||
		!(viewport.height > padding * 2) ||
		!(page.width > 0) ||
		!(page.height > 0)
	)
		return 1
	return Math.min(
		(viewport.width - padding * 2) / page.width,
		(viewport.height - padding * 2) / page.height,
	)
}

export function initialDesignCanvasView(
	viewport: CanvasViewport,
	page: Readonly<{ width: number; height: number }>,
	baseScale = designBaseScale(viewport, page),
): CanvasView {
	return {
		x: (viewport.width - page.width * baseScale) / 2,
		y: (viewport.height - page.height * baseScale) / 2,
		zoom: 1,
	}
}

export function clampToPage(
	point: CanvasPoint,
	page: Readonly<{ width: number; height: number }>,
): CanvasPoint {
	return {
		x: Math.max(0, Math.min(page.width, point.x)),
		y: Math.max(0, Math.min(page.height, point.y)),
	}
}

interface DesignObjectHit {
	readonly object: DesignObject
	readonly distancePixels: number
}

export function nearestDesignObject(
	objects: readonly DesignObject[],
	point: CanvasPoint,
	worldScale: number,
	maxDistancePixels = 12,
): DesignObjectHit | null {
	const containing = objects.flatMap((object, index) => {
		if (object.hidden || object.locked) return []
		const bounds = objectBounds(object)
		if (
			bounds === null ||
			point.x < bounds.minX ||
			point.x > bounds.maxX ||
			point.y < bounds.minY ||
			point.y > bounds.maxY
		)
			return []
		return [{ object, index, bounds }]
	})
	const topmost = containing.toSorted(
		(left, right) => right.index - left.index,
	)[0]
	if (topmost !== undefined)
		return { object: topmost.object, distancePixels: 0 }

	const ranked = rankPointCandidate(
		point,
		objects.flatMap((object, index) => {
			if (object.hidden || object.locked) return []
			const bounds = objectBounds(object)
			if (bounds === null) return []
			return [
				{
					id: object.id,
					priority: objects.length - index,
					x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
					y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
					object,
				},
			]
		}),
		worldScale,
		maxDistancePixels,
	)
	return ranked === null
		? null
		: { object: ranked.object, distancePixels: ranked.distancePixels }
}

export interface DesignSnapResult {
	readonly object: DesignObject
	readonly x: number | null
	readonly y: number | null
}

const anchors = (bounds: Bounds, axis: "x" | "y") =>
	axis === "x"
		? [
				{ id: "min", value: bounds.minX },
				{ id: "center", value: (bounds.minX + bounds.maxX) / 2 },
				{ id: "max", value: bounds.maxX },
			]
		: [
				{ id: "min", value: bounds.minY },
				{ id: "center", value: (bounds.minY + bounds.maxY) / 2 },
				{ id: "max", value: bounds.maxY },
			]

export function snapDesignObject(
	object: DesignObject,
	document: Pick<DesignDocument, "guides" | "page">,
	worldScale: number,
	thresholdPixels = 7,
): DesignSnapResult {
	const bounds = objectBounds(object)
	if (bounds === null || !(worldScale > 0)) return { object, x: null, y: null }
	const threshold = thresholdPixels / worldScale
	const xTargets = [
		{ id: "page:left", value: 0 },
		{ id: "page:center-x", value: document.page.width / 2 },
		{ id: "page:right", value: document.page.width },
		...document.guides
			.filter((guide) => guide.axis === "x")
			.map((guide) => ({ id: guide.id, value: guide.value })),
	]
	const yTargets = [
		{ id: "page:top", value: 0 },
		{ id: "page:center-y", value: document.page.height / 2 },
		{ id: "page:bottom", value: document.page.height },
		...document.guides
			.filter((guide) => guide.axis === "y")
			.map((guide) => ({ id: guide.id, value: guide.value })),
	]
	const xSnap = rankAxisCandidate(
		0,
		anchors(bounds, "x").flatMap((anchor, anchorIndex) =>
			xTargets.map((target) => ({
				id: `${anchor.id}:${target.id}`,
				priority: anchorIndex,
				value: target.value - anchor.value,
				target: target.value,
			})),
		),
		threshold,
	)
	const ySnap = rankAxisCandidate(
		0,
		anchors(bounds, "y").flatMap((anchor, anchorIndex) =>
			yTargets.map((target) => ({
				id: `${anchor.id}:${target.id}`,
				priority: anchorIndex,
				value: target.value - anchor.value,
				target: target.value,
			})),
		),
		threshold,
	)
	return {
		object: translateObject(object, xSnap?.value ?? 0, ySnap?.value ?? 0),
		x: xSnap?.target ?? null,
		y: ySnap?.target ?? null,
	}
}
