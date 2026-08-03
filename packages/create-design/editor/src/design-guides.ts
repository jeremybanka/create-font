import type { CanvasView } from "@create-art/editor"

import type { DesignDocument, DesignGuide } from "./types.ts"

export interface DesignRulerTick {
	readonly value: number
	readonly major: boolean
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
	return (guide.axis === "x" ? view.x : view.y) + guide.value * worldScale
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
	change: Readonly<Partial<Pick<DesignGuide, "value" | "locked">>>,
): DesignDocument {
	const current = document.guides.find((guide) => guide.id === id)
	if (
		current === undefined ||
		(current.locked && change.locked === undefined) ||
		((change.value === undefined || change.value === current.value) &&
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
