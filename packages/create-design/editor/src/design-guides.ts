import type { CanvasView } from "@create-art/editor"

import type { DesignDocument, DesignGuide } from "./types.ts"

export const DESIGN_GUIDES_VISIBLE_STORAGE_KEY =
	"create-design:guides-visible:v1"

export interface DesignRulerTick {
	readonly value: number
	readonly major: boolean
}

export type GuidePoint = Readonly<{ readonly x: number; readonly y: number }>

export function axisDesignGuide(
	id: string,
	axis: "x" | "y",
	value: number,
): DesignGuide {
	return {
		id,
		a: axis === "x" ? { x: value, y: 0 } : { x: 0, y: value },
		b: axis === "x" ? { x: value, y: 1 } : { x: 1, y: value },
	}
}

export function designGuideAxis(guide: DesignGuide): "x" | "y" | null {
	if (guide.a.x === guide.b.x) return "x"
	if (guide.a.y === guide.b.y) return "y"
	return null
}

export function designGuideAngle(guide: Pick<DesignGuide, "a" | "b">): number {
	const degrees = (Math.atan2(guide.b.y - guide.a.y, guide.b.x - guide.a.x) * 180) / Math.PI
	return ((degrees % 180) + 180) % 180
}

export function constrainGuidePointToAngle(
	a: GuidePoint,
	b: GuidePoint,
	incrementDegrees = 15,
): GuidePoint {
	const distance = Math.hypot(b.x - a.x, b.y - a.y)
	if (distance === 0) return b
	const angle = Math.atan2(b.y - a.y, b.x - a.x)
	const increment = (incrementDegrees * Math.PI) / 180
	const constrained = Math.round(angle / increment) * increment
	return { x: a.x + Math.cos(constrained) * distance, y: a.y + Math.sin(constrained) * distance }
}

export function projectPointToGuide(point: GuidePoint, guide: Pick<DesignGuide, "a" | "b">): GuidePoint {
	const dx = guide.b.x - guide.a.x
	const dy = guide.b.y - guide.a.y
	const lengthSquared = dx * dx + dy * dy
	if (lengthSquared === 0) return guide.a
	const t = ((point.x - guide.a.x) * dx + (point.y - guide.a.y) * dy) / lengthSquared
	return { x: guide.a.x + t * dx, y: guide.a.y + t * dy }
}

export function distanceToDesignGuide(point: GuidePoint, guide: Pick<DesignGuide, "a" | "b">): number {
	const projected = projectPointToGuide(point, guide)
	return Math.hypot(point.x - projected.x, point.y - projected.y)
}

export function translateDesignGuide(guide: DesignGuide, delta: GuidePoint): DesignGuide {
	return {
		...guide,
		a: { x: guide.a.x + delta.x, y: guide.a.y + delta.y },
		b: { x: guide.b.x + delta.x, y: guide.b.y + delta.y },
	}
}

/** Clip an infinite guide to an axis-aligned viewport. */
export function clipDesignGuideToBounds(
	guide: Pick<DesignGuide, "a" | "b">,
	bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
): readonly [number, number, number, number] | null {
	const dx = guide.b.x - guide.a.x
	const dy = guide.b.y - guide.a.y
	if (dx === 0 && dy === 0) return null
	let minimum = Number.NEGATIVE_INFINITY
	let maximum = Number.POSITIVE_INFINITY
	for (const [origin, direction, low, high] of [
		[guide.a.x, dx, bounds.minX, bounds.maxX],
		[guide.a.y, dy, bounds.minY, bounds.maxY],
	] as const) {
		if (direction === 0) {
			if (origin < low || origin > high) return null
			continue
		}
		const first = (low - origin) / direction
		const second = (high - origin) / direction
		minimum = Math.max(minimum, Math.min(first, second))
		maximum = Math.min(maximum, Math.max(first, second))
	}
	if (minimum > maximum) return null
	return [
		guide.a.x + minimum * dx,
		guide.a.y + minimum * dy,
		guide.a.x + maximum * dx,
		guide.a.y + maximum * dy,
	]
}

/** Choose readable, stable document-unit ticks for a screen-space ruler. */
export function designRulerTicks(
	minimum: number,
	maximum: number,
	worldScale: number,
	minimumSpacingPixels = 12,
): readonly DesignRulerTick[] {
	if (
		!Number.isFinite(minimum) ||
		!Number.isFinite(maximum) ||
		!(maximum >= minimum) ||
		!(worldScale > 0) ||
		!(minimumSpacingPixels > 0)
	)
		return []
	const desired = minimumSpacingPixels / worldScale
	const power = 10 ** Math.floor(Math.log10(desired))
	const step =
		[1, 2, 5, 10]
			.map((factor) => factor * power)
			.find((candidate) => candidate >= desired) ?? 10 * power
	const first = Math.ceil(minimum / step) * step
	const ticks: DesignRulerTick[] = []
	for (let value = first; value <= maximum + step * 1e-9; value += step) {
		const normalized = Number(value.toFixed(10))
		const majorRatio = normalized / (step * 5)
		ticks.push({
			value: normalized,
			major: Math.abs(majorRatio - Math.round(majorRatio)) < 1e-8,
		})
		if (ticks.length > 10_000) break
	}
	return ticks
}

/** View changes never rewrite guide coordinates. */
export function guideScreenPosition(
	guide: DesignGuide,
	view: CanvasView,
	worldScale: number,
): number {
	const axis = designGuideAxis(guide)
	const value = axis === "x" ? guide.a.x : guide.a.y
	return (axis === "x" ? view.x : view.y) + value * worldScale
}

export function addDesignGuide(
	document: DesignDocument,
	guide: DesignGuide,
): DesignDocument {
	return { ...document, guides: [...document.guides, guide] }
}

export function updateDesignGuide(
	document: DesignDocument,
	id: string,
	change: Readonly<Partial<Pick<DesignGuide, "a" | "b" | "locked">>>,
): DesignDocument {
	const current = document.guides.find((guide) => guide.id === id)
	if (
		current === undefined ||
		(current.locked && change.locked === undefined) ||
		((change.a === undefined || change.a === current.a) &&
			(change.b === undefined || change.b === current.b) &&
			(change.locked === undefined || change.locked === current.locked))
	)
		return document
	return {
		...document,
		guides: document.guides.map((guide) =>
			guide.id === id ? { ...guide, ...change } : guide,
		),
	}
}

/** Set every guide lock in one immutable document operation. */
export function setDesignGuidesLocked(
	document: DesignDocument,
	locked: boolean,
): DesignDocument {
	if (
		document.guides.length === 0 ||
		document.guides.every((guide) => Boolean(guide.locked) === locked)
	)
		return document
	return {
		...document,
		guides: document.guides.map((guide) => {
			const { locked: ignored, ...rest } = guide
			void ignored
			return locked ? { ...rest, locked: true } : rest
		}),
	}
}

export function deleteDesignGuide(
	document: DesignDocument,
	id: string,
): DesignDocument {
	const guide = document.guides.find((candidate) => candidate.id === id)
	if (guide?.locked) return document
	return {
		...document,
		guides: document.guides.filter((candidate) => candidate.id !== id),
	}
}
