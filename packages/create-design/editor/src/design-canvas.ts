import {
	rankAxisCandidate,
	type CanvasPoint,
	type CanvasView,
	type CanvasViewport,
} from "@create-art/editor"

import {
	projectDesignObjectContours,
	projectDesignEffectiveHierarchy,
	translateObject,
	type Bounds,
} from "@create-design/model"
import {
	objectCenterlineDistance,
	objectFillContainsPoint,
	objectStrokeDistance,
	visibleObjectBounds,
} from "@create-design/model"
import type {
	DesignArtboard,
	DesignDocument,
	DesignGuide,
	DesignObject,
} from "./types.ts"
import {
	designGuideAxis,
	distanceToDesignGuide,
	projectPointToGuide,
} from "./design-guides.ts"

export const DESIGN_MIN_ZOOM = 0.01
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
	boundsForText?: (object: DesignObject) => Bounds | null,
): DesignObjectHit | null {
	if (!(worldScale > 0)) return null
	const candidates: (DesignObjectHit & { readonly index: number })[] = []
	for (const [index, object] of objects.entries()) {
		if (object.hidden || object.locked) continue
		if (object.geometry.kind === "text" && boundsForText !== undefined) {
			const bounds = boundsForText(object)
			if (
				bounds !== null &&
				point.x >= bounds.minX &&
				point.x <= bounds.maxX &&
				point.y >= bounds.minY &&
				point.y <= bounds.maxY
			)
				candidates.push({ object, distancePixels: 0, index })
			continue
		}
		if (
			object.geometry.kind === "image" ||
			object.geometry.kind === "artboard-link"
		) {
			const bounds = visibleObjectBounds(object)
			if (
				bounds !== null &&
				point.x >= bounds.minX &&
				point.x <= bounds.maxX &&
				point.y >= bounds.minY &&
				point.y <= bounds.maxY
			)
				candidates.push({ object, distancePixels: 0, index })
			continue
		}
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
	readonly matches?: readonly DesignSnapMatch[]
}

export interface DesignGroupSnapResult {
	readonly objects: readonly DesignObject[]
	readonly x: number | null
	readonly y: number | null
	readonly matches: readonly DesignSnapMatch[]
}

export interface DesignPointSnapResult {
	readonly point: CanvasPoint
	readonly x: number | null
	readonly y: number | null
	readonly matches: readonly DesignSnapMatch[]
	readonly line?: Readonly<{
		readonly guide: DesignGuide
		readonly label: string
	}>
}

export type DesignSnapCategory =
	| "artboards"
	| "guides"
	| "objectBounds"
	| "anchors"
	| "controlPoints"

export type DesignSnapSettings = Readonly<{
	readonly enabled: Readonly<Record<DesignSnapCategory, boolean>>
	/** Maximum pointer-to-target distance in physical screen pixels. */
	readonly thresholdPixels: number
}>

export const DEFAULT_DESIGN_SNAP_SETTINGS: DesignSnapSettings = Object.freeze({
	enabled: Object.freeze({
		artboards: true,
		guides: true,
		objectBounds: true,
		anchors: true,
		controlPoints: true,
	}),
	thresholdPixels: 7,
})

export interface DesignSnapMatch {
	readonly axis: "x" | "y"
	readonly category: DesignSnapCategory
	readonly id: string
	readonly label: string
	readonly target: number
}

interface DesignSnapTarget {
	readonly category: DesignSnapCategory
	readonly id: string
	readonly label: string
	readonly priority: number
	readonly value: number
}

export interface DesignSnapScene {
	readonly artboards: readonly DesignArtboard[]
	readonly guides: readonly DesignGuide[]
	readonly objects: readonly DesignObject[]
}

/** Rotation is orthonormal, so only zoom changes an axis snap's pixel radius. */
export function designSnapThreshold(
	thresholdPixels: number,
	worldScale: number,
	rotationDegrees = 0,
): number {
	if (
		!(thresholdPixels >= 0) ||
		!(worldScale > 0) ||
		!Number.isFinite(rotationDegrees)
	)
		return 0
	return thresholdPixels / worldScale
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

const categoryPriority: Readonly<Record<DesignSnapCategory, number>> = {
	guides: 0,
	anchors: 1,
	controlPoints: 2,
	objectBounds: 3,
	artboards: 4,
}

function snapScene(
	scene: DesignSnapScene | DesignDocument | DesignArtboard,
): DesignSnapScene {
	if ("layers" in scene)
		return {
			artboards: scene.artboards,
			guides: scene.guides,
			objects: projectDesignEffectiveHierarchy(scene).visibleObjects,
		}
	if ("artboards" in scene)
		return {
			artboards: scene.artboards,
			guides: scene.guides,
			objects: scene.objects,
		}
	return { artboards: [scene], guides: [], objects: [] }
}

function target(
	category: DesignSnapCategory,
	id: string,
	label: string,
	value: number,
): DesignSnapTarget {
	return { category, id, label, priority: categoryPriority[category], value }
}

/**
 * Collect document-space snap targets. Hidden objects never participate;
 * locked objects and guides remain precision references even though gestures
 * cannot modify them. View pan and rotation intentionally do not enter this
 * function: an orthonormal view transform preserves screen distance, while
 * zoom is represented by `worldScale` at ranking time.
 */
export function designSnapTargets(
	sceneInput: DesignSnapScene | DesignDocument,
	axis: "x" | "y",
	settings: DesignSnapSettings = DEFAULT_DESIGN_SNAP_SETTINGS,
	excludedObjectIds: ReadonlySet<string> = new Set(),
): readonly DesignSnapTarget[] {
	const scene = snapScene(sceneInput)
	const targets: DesignSnapTarget[] = []
	if (settings.enabled.artboards)
		for (const artboard of scene.artboards) {
			const values =
				axis === "x"
					? ([
							["left", artboard.x],
							["center-x", artboard.x + artboard.width / 2],
							["right", artboard.x + artboard.width],
						] as const)
					: ([
							["top", artboard.y],
							["center-y", artboard.y + artboard.height / 2],
							["bottom", artboard.y + artboard.height],
						] as const)
			for (const [name, value] of values)
				targets.push(
					target(
						"artboards",
						`${artboard.id}:${name}`,
						`${artboard.name} ${name}`,
						value,
					),
				)
		}
	if (settings.enabled.guides)
		for (const guide of scene.guides)
			if (designGuideAxis(guide) === axis)
				targets.push(target("guides", guide.id, "Guide", guide.a[axis]))

	for (const object of scene.objects) {
		if (object.hidden || excludedObjectIds.has(object.id)) continue
		if (settings.enabled.objectBounds) {
			const bounds = visibleObjectBounds(object)
			if (bounds !== null)
				for (const anchor of anchors(bounds, axis))
					targets.push(
						target(
							"objectBounds",
							`${object.id}:bounds:${axis}:${anchor.id}`,
							`${object.name} ${anchor.id}`,
							anchor.value,
						),
					)
		}
		if (!settings.enabled.anchors && !settings.enabled.controlPoints) continue
		for (const contour of projectDesignObjectContours(object))
			for (const point of contour.points) {
				if (settings.enabled.anchors)
					targets.push(
						target(
							"anchors",
							`${object.id}:${point.id}:anchor:${axis}`,
							`${object.name} anchor`,
							point[axis],
						),
					)
				if (settings.enabled.controlPoints)
					for (const handle of ["incoming", "outgoing"] as const) {
						const vector = point[handle]
						if (vector !== undefined)
							targets.push(
								target(
									"controlPoints",
									`${object.id}:${point.id}:${handle}:${axis}`,
									`${object.name} ${handle} control`,
									point[axis] + vector[axis],
								),
							)
					}
			}
	}
	return targets
}

export function snapDesignObject(
	object: DesignObject,
	sceneInput: DesignSnapScene | DesignDocument | DesignArtboard,
	worldScale: number,
	settingsOrThreshold:
		| DesignSnapSettings
		| number = DEFAULT_DESIGN_SNAP_SETTINGS,
	interactionBounds: Bounds | null = visibleObjectBounds(object),
): DesignSnapResult {
	if (interactionBounds === null || !(worldScale > 0))
		return { object, x: null, y: null }
	const result = snapBoundsTranslation(
		interactionBounds,
		sceneInput,
		worldScale,
		settingsOrThreshold,
		new Set([object.id]),
	)
	return {
		object: translateObject(object, result.deltaX, result.deltaY),
		x: result.x,
		y: result.y,
		matches: result.matches,
	}
}

/** Snap a document-space pointer to the closest enabled target on each axis. */
export function snapDesignPoint(
	point: CanvasPoint,
	sceneInput: DesignSnapScene | DesignDocument | DesignArtboard,
	worldScale: number,
	settings: DesignSnapSettings = DEFAULT_DESIGN_SNAP_SETTINGS,
	excludedObjectIds: ReadonlySet<string> = new Set(),
): DesignPointSnapResult {
	if (!(worldScale > 0)) return { point, x: null, y: null, matches: [] }
	const threshold = designSnapThreshold(settings.thresholdPixels, worldScale)
	const scene = snapScene(sceneInput)
	const lineSnap = settings.enabled.guides
		? scene.guides
				.map((guide, index) => ({
					guide,
					index,
					distance: distanceToDesignGuide(point, guide),
				}))
				.filter(({ guide }) => designGuideAxis(guide) === null)
				.filter(({ distance }) => distance <= threshold)
				.toSorted(
					(left, right) =>
						left.distance - right.distance ||
						left.guide.id.localeCompare(right.guide.id) ||
						left.index - right.index,
				)[0]
		: undefined
	if (lineSnap !== undefined) {
		const projected = projectPointToGuide(point, lineSnap.guide)
		return {
			point: projected,
			x: projected.x,
			y: projected.y,
			matches: [],
			line: { guide: lineSnap.guide, label: "Guide" },
		}
	}
	const xSnap = rankAxisCandidate(
		point.x,
		designSnapTargets(scene, "x", settings, excludedObjectIds),
		threshold,
	)
	const ySnap = rankAxisCandidate(
		point.y,
		designSnapTargets(scene, "y", settings, excludedObjectIds),
		threshold,
	)
	const matches: DesignSnapMatch[] = []
	if (xSnap !== null)
		matches.push({
			axis: "x",
			category: xSnap.category,
			id: xSnap.id,
			label: xSnap.label,
			target: xSnap.value,
		})
	if (ySnap !== null)
		matches.push({
			axis: "y",
			category: ySnap.category,
			id: ySnap.id,
			label: ySnap.label,
			target: ySnap.value,
		})
	return {
		point: { x: xSnap?.value ?? point.x, y: ySnap?.value ?? point.y },
		x: xSnap?.value ?? null,
		y: ySnap?.value ?? null,
		matches,
	}
}

function combinedVisibleBounds(
	objects: readonly DesignObject[],
): Bounds | null {
	let result: Bounds | null = null
	for (const object of objects) {
		const bounds = visibleObjectBounds(object)
		if (bounds === null) continue
		result =
			result === null
				? bounds
				: {
						minX: Math.min(result.minX, bounds.minX),
						minY: Math.min(result.minY, bounds.minY),
						maxX: Math.max(result.maxX, bounds.maxX),
						maxY: Math.max(result.maxY, bounds.maxY),
					}
	}
	return result
}

/** Snap a multi-selected group rigidly from its combined painted bounds. */
export function snapDesignObjects(
	objects: readonly DesignObject[],
	sceneInput: DesignSnapScene | DesignDocument | DesignArtboard,
	worldScale: number,
	settingsOrThreshold:
		| DesignSnapSettings
		| number = DEFAULT_DESIGN_SNAP_SETTINGS,
	selectionBounds: Bounds | null = combinedVisibleBounds(objects),
): DesignGroupSnapResult {
	if (selectionBounds === null || !(worldScale > 0))
		return { objects, x: null, y: null, matches: [] }
	const result = snapBoundsTranslation(
		selectionBounds,
		sceneInput,
		worldScale,
		settingsOrThreshold,
		new Set(objects.map(({ id }) => id)),
	)
	return {
		objects: objects.map((object) =>
			translateObject(object, result.deltaX, result.deltaY),
		),
		x: result.x,
		y: result.y,
		matches: result.matches,
	}
}

function snapBoundsTranslation(
	bounds: Bounds,
	sceneInput: DesignSnapScene | DesignDocument | DesignArtboard,
	worldScale: number,
	settingsOrThreshold: DesignSnapSettings | number,
	excluded: ReadonlySet<string>,
) {
	const settings =
		typeof settingsOrThreshold === "number"
			? {
					...DEFAULT_DESIGN_SNAP_SETTINGS,
					thresholdPixels: settingsOrThreshold,
				}
			: settingsOrThreshold
	const threshold = designSnapThreshold(settings.thresholdPixels, worldScale)
	const scene = snapScene(sceneInput)
	const xTargets = designSnapTargets(scene, "x", settings, excluded)
	const yTargets = designSnapTargets(scene, "y", settings, excluded)
	const xSnap = rankAxisCandidate(
		0,
		anchors(bounds, "x").flatMap((anchor, anchorIndex) =>
			xTargets.map((target) => ({
				...target,
				id: `${anchor.id}:${target.id}`,
				priority: target.priority * 10 + anchorIndex,
				value: target.value - anchor.value,
				targetValue: target.value,
			})),
		),
		threshold,
	)
	const ySnap = rankAxisCandidate(
		0,
		anchors(bounds, "y").flatMap((anchor, anchorIndex) =>
			yTargets.map((target) => ({
				...target,
				id: `${anchor.id}:${target.id}`,
				priority: target.priority * 10 + anchorIndex,
				value: target.value - anchor.value,
				targetValue: target.value,
			})),
		),
		threshold,
	)
	const lineSnap = settings.enabled.guides
		? [
				{ x: bounds.minX, y: bounds.minY },
				{ x: bounds.maxX, y: bounds.minY },
				{
					x: (bounds.minX + bounds.maxX) / 2,
					y: (bounds.minY + bounds.maxY) / 2,
				},
				{ x: bounds.minX, y: bounds.maxY },
				{ x: bounds.maxX, y: bounds.maxY },
			]
				.flatMap((anchor, anchorIndex) =>
					scene.guides.flatMap((guide) => {
						if (designGuideAxis(guide) !== null) return []
						const projected = projectPointToGuide(anchor, guide)
						const deltaX = projected.x - anchor.x
						const deltaY = projected.y - anchor.y
						return [
							{
								guide,
								anchorIndex,
								deltaX,
								deltaY,
								distance: Math.hypot(deltaX, deltaY),
								projected,
							},
						]
					}),
				)
				.filter(({ distance }) => distance <= threshold)
				.toSorted(
					(left, right) =>
						left.distance - right.distance ||
						left.guide.id.localeCompare(right.guide.id) ||
						left.anchorIndex - right.anchorIndex,
				)[0]
		: undefined
	const axisDistance = Math.hypot(xSnap?.value ?? 0, ySnap?.value ?? 0)
	if (
		lineSnap !== undefined &&
		(xSnap === null && ySnap === null ? true : lineSnap.distance < axisDistance)
	)
		return {
			deltaX: lineSnap.deltaX,
			deltaY: lineSnap.deltaY,
			x: lineSnap.projected.x,
			y: lineSnap.projected.y,
			matches: [],
		}
	return {
		deltaX: xSnap?.value ?? 0,
		deltaY: ySnap?.value ?? 0,
		x: xSnap?.targetValue ?? null,
		y: ySnap?.targetValue ?? null,
		matches: [
			...(xSnap === null
				? []
				: [
						{
							axis: "x" as const,
							category: xSnap.category,
							id: xSnap.id,
							label: xSnap.label,
							target: xSnap.targetValue,
						},
					]),
			...(ySnap === null
				? []
				: [
						{
							axis: "y" as const,
							category: ySnap.category,
							id: ySnap.id,
							label: ySnap.label,
							target: ySnap.targetValue,
						},
					]),
		],
	}
}
