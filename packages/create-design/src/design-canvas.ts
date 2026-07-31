import {
	rankAxisCandidate,
	rankPointCandidate,
	type CanvasPoint,
	type CanvasView,
	type CanvasViewport,
} from "@create-font/editor/shared"

import {
	objectBounds,
	projectDesignObjectContours,
	translateObject,
	type Bounds,
} from "./geometry.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "./types.ts"

export const DESIGN_MIN_ZOOM = 0.2
export const DESIGN_MAX_ZOOM = 8

interface PointerCaptureTarget {
	hasPointerCapture?(pointerId: number): boolean
	releasePointerCapture(pointerId: number): void
	setPointerCapture(pointerId: number): void
}

function pointerCaptureTarget(value: unknown): PointerCaptureTarget | null {
	if (
		typeof value !== "object" ||
		value === null ||
		!("setPointerCapture" in value) ||
		typeof value.setPointerCapture !== "function" ||
		!("releasePointerCapture" in value) ||
		typeof value.releasePointerCapture !== "function"
	)
		return null
	return value as PointerCaptureTarget
}

export function captureDesignPointer(
	target: unknown,
	pointerId: number,
): boolean {
	const captureTarget = pointerCaptureTarget(target)
	if (captureTarget === null || !Number.isInteger(pointerId)) return false
	try {
		captureTarget.setPointerCapture(pointerId)
		return true
	} catch {
		return false
	}
}

export function releaseDesignPointer(
	target: unknown,
	pointerId: number,
): boolean {
	const captureTarget = pointerCaptureTarget(target)
	if (captureTarget === null || !Number.isInteger(pointerId)) return false
	if (captureTarget.hasPointerCapture?.(pointerId) === false) return false
	try {
		captureTarget.releasePointerCapture(pointerId)
		return true
	} catch {
		return false
	}
}

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

const pointOnCubic = (
	from: DesignPoint,
	to: DesignPoint,
	amount: number,
): CanvasPoint => {
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	const inverse = 1 - amount
	return {
		x:
			inverse ** 3 * from.x +
			3 * inverse ** 2 * amount * (from.x + first.x) +
			3 * inverse * amount ** 2 * (to.x + second.x) +
			amount ** 3 * to.x,
		y:
			inverse ** 3 * from.y +
			3 * inverse ** 2 * amount * (from.y + first.y) +
			3 * inverse * amount ** 2 * (to.y + second.y) +
			amount ** 3 * to.y,
	}
}

function flattenedContour(contour: DesignContour): readonly CanvasPoint[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const flattened: CanvasPoint[] = [first]
	const segmentCount = contour.points.length - (contour.closed ? 0 : 1)
	for (let index = 0; index < segmentCount; index += 1) {
		const from = contour.points[index]
		const to = contour.points[(index + 1) % contour.points.length]
		if (from === undefined || to === undefined) continue
		const curved = from.outgoing !== undefined || to.incoming !== undefined
		const steps = curved ? 16 : 1
		for (let step = 1; step <= steps; step += 1)
			flattened.push(pointOnCubic(from, to, step / steps))
	}
	return flattened
}

function contourContainsPoint(
	contour: DesignContour,
	point: CanvasPoint,
): boolean {
	if (!contour.closed || contour.points.length < 3) return false
	const polygon = flattenedContour(contour)
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

function nearestSegmentPoint(
	point: CanvasPoint,
	from: CanvasPoint,
	to: CanvasPoint,
): CanvasPoint {
	const x = to.x - from.x
	const y = to.y - from.y
	const denominator = x * x + y * y
	if (denominator === 0) return from
	const amount = Math.max(
		0,
		Math.min(
			1,
			((point.x - from.x) * x + (point.y - from.y) * y) / denominator,
		),
	)
	return { x: from.x + x * amount, y: from.y + y * amount }
}

function objectSegmentCandidates(
	object: DesignObject,
	point: CanvasPoint,
	priority: number,
) {
	return projectDesignObjectContours(object).flatMap(
		(contour, contourIndex) => {
		const flattened = flattenedContour(contour)
		const segmentCount = flattened.length - (contour.closed ? 0 : 1)
		return Array.from({ length: segmentCount }, (_, segmentIndex) => {
			const from = flattened[segmentIndex]
			const to = flattened[(segmentIndex + 1) % flattened.length]
			if (from === undefined || to === undefined) return []
			const nearest = nearestSegmentPoint(point, from, to)
			return [
				{
					id: `${object.id}:${contourIndex}:${segmentIndex}`,
					priority,
					...nearest,
					object,
				},
			]
		}).flat()
		},
	)
}

export function nearestDesignObject(
	objects: readonly DesignObject[],
	point: CanvasPoint,
	worldScale: number,
	maxDistancePixels = 12,
): DesignObjectHit | null {
	const containing = objects.flatMap((object, index) => {
		if (
			object.hidden ||
			object.locked ||
			object.appearance.fill === undefined
		)
			return []
		const filled = projectDesignObjectContours(object).reduce(
			(inside, contour) => contourContainsPoint(contour, point) !== inside,
			false,
		)
		return filled ? [{ object, index }] : []
	})
	const topmost = containing.toSorted(
		(left, right) => right.index - left.index,
	)[0]
	if (topmost !== undefined)
		return { object: topmost.object, distancePixels: 0 }

	const ranked = rankPointCandidate(
		point,
		objects.flatMap((object, index) =>
			object.hidden ||
				object.locked ||
				(object.appearance.fill === undefined &&
					object.appearance.stroke === undefined)
				? []
				: objectSegmentCandidates(object, point, objects.length - index),
		),
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
	document: Pick<DesignDocument, "page">,
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
	]
	const yTargets = [
		{ id: "page:top", value: 0 },
		{ id: "page:center-y", value: document.page.height / 2 },
		{ id: "page:bottom", value: document.page.height },
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
