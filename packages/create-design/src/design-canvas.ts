import {
	rankAxisCandidate,
	type CanvasPoint,
	type CanvasView,
	type CanvasViewport,
} from "@create-font/editor/shared"

import { translateObject, type Bounds } from "./geometry.ts"
import {
	objectCenterlineDistance,
	objectFillContainsPoint,
	objectStrokeDistance,
	visibleObjectBounds,
} from "./painted-geometry.ts"
import type { DesignArtboard, DesignObject } from "./types.ts"

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
	page: Readonly<{ x: number; y: number; width: number; height: number }>,
	baseScale = designBaseScale(viewport, page),
): CanvasView {
	return {
		x: (viewport.width - page.width * baseScale) / 2 - page.x * baseScale,
		y: (viewport.height - page.height * baseScale) / 2 - page.y * baseScale,
		zoom: 1,
	}
}

export function clampToPage(
	point: CanvasPoint,
	page: Readonly<{ x: number; y: number; width: number; height: number }>,
): CanvasPoint {
	return {
		x: Math.max(page.x, Math.min(page.x + page.width, point.x)),
		y: Math.max(page.y, Math.min(page.y + page.height, point.y)),
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
	if (!(worldScale > 0)) return null
	const candidates: (DesignObjectHit & { readonly index: number })[] = []
	for (const [index, object] of objects.entries()) {
		if (object.hidden || object.locked) continue
		const strokeVisible =
			object.appearance.stroke !== undefined &&
			object.appearance.stroke.width > 0
		if (object.appearance.fill === undefined && !strokeVisible) continue
		const fillHit = objectFillContainsPoint(object, point)
		const strokeDistance = objectStrokeDistance(object, point)
		if (fillHit || strokeDistance === 0)
			candidates.push({ object, distancePixels: 0, index })
		else {
			const centerlineDistance =
				object.appearance.fill === undefined
					? Number.POSITIVE_INFINITY
					: objectCenterlineDistance(object, point)
			const distancePixels =
				Math.min(strokeDistance, centerlineDistance) * worldScale
			if (distancePixels <= maxDistancePixels)
				candidates.push({ object, distancePixels, index })
		}
	}
	const ranked = candidates.toSorted(
		(left, right) =>
			left.distancePixels - right.distancePixels || right.index - left.index,
	)[0]
	return ranked === undefined
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
	artboard: DesignArtboard,
	worldScale: number,
	thresholdPixels = 7,
): DesignSnapResult {
	const bounds = visibleObjectBounds(object)
	if (bounds === null || !(worldScale > 0)) return { object, x: null, y: null }
	const threshold = thresholdPixels / worldScale
	const xTargets = [
		{ id: "artboard:left", value: artboard.x },
		{
			id: "artboard:center-x",
			value: artboard.x + artboard.width / 2,
		},
		{ id: "artboard:right", value: artboard.x + artboard.width },
	]
	const yTargets = [
		{ id: "artboard:top", value: artboard.y },
		{
			id: "artboard:center-y",
			value: artboard.y + artboard.height / 2,
		},
		{ id: "artboard:bottom", value: artboard.y + artboard.height },
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
