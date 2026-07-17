import type {
	EditorFontMetricsSource,
	VerticalAlignmentMetricId,
} from "./types.ts"

export const MAX_OVERSHOOT_DEPTH = 16_383

export interface VerticalMetricLine {
	readonly kind: "line"
	readonly id: VerticalAlignmentMetricId
	readonly label: string
	readonly y: number
	readonly overshoot: Readonly<{ minY: number; maxY: number }>
}

export interface VerticalMetricBand {
	readonly kind: "band"
	readonly id: "lineGap" | "underlineThickness"
	readonly label: string
	readonly minY: number
	readonly maxY: number
}

export type VerticalMetricGuide = VerticalMetricLine | VerticalMetricBand

export interface VerticalOvershootBandSegment {
	readonly minY: number
	readonly maxY: number
	readonly lines: readonly VerticalMetricLine[]
}

export interface VerticalMetricAlignment {
	readonly kind: "line" | "overshoot"
	readonly lines: readonly VerticalMetricLine[]
}

export function zeroOvershoots(): EditorFontMetricsSource["overshoots"] {
	return Object.freeze({
		baseline: 0,
		ascender: 0,
		descender: 0,
		winAscent: 0,
		winDescent: 0,
		xHeight: 0,
		capHeight: 0,
		underlinePosition: 0,
	})
}

function interval(y: number, depth: number, direction: "above" | "below") {
	return direction === "above"
		? Object.freeze({ minY: y, maxY: y + depth })
		: Object.freeze({ minY: y - depth, maxY: y })
}

/** Resolves every editor-visible vertical metric and alignment zone. */
export function resolveVerticalMetricGuides(
	metrics: EditorFontMetricsSource,
): readonly VerticalMetricGuide[] {
	const line = (
		id: VerticalAlignmentMetricId,
		label: string,
		y: number,
		direction: "above" | "below",
	): VerticalMetricLine => ({
		kind: "line",
		id,
		label,
		y,
		overshoot: interval(y, metrics.overshoots[id], direction),
	})
	const band = (
		id: VerticalMetricBand["id"],
		label: string,
		first: number,
		second: number,
	): VerticalMetricBand => ({
		kind: "band",
		id,
		label,
		minY: Math.min(first, second),
		maxY: Math.max(first, second),
	})

	return Object.freeze([
		line("baseline", "Baseline", 0, "below"),
		line("ascender", "Ascender", metrics.ascender, "above"),
		line("descender", "Descender", metrics.descender, "below"),
		line("winAscent", "Windows ascent", metrics.winAscent, "above"),
		line("winDescent", "Windows descent", -metrics.winDescent, "below"),
		line("xHeight", "x-height", metrics.xHeight, "above"),
		line("capHeight", "Cap height", metrics.capHeight, "above"),
		line(
			"underlinePosition",
			"Underline position",
			metrics.underlinePosition,
			"below",
		),
		band(
			"lineGap",
			"Line gap",
			metrics.ascender,
			metrics.ascender + metrics.lineGap,
		),
		band(
			"underlineThickness",
			"Underline thickness",
			metrics.underlinePosition,
			metrics.underlinePosition - metrics.underlineThickness,
		),
	])
}

export function matchingVerticalMetrics(
	y: number,
	guides: readonly VerticalMetricGuide[],
): readonly VerticalMetricLine[] {
	return Object.freeze(
		guides.flatMap((guide) =>
			guide.kind === "line" &&
			y >= guide.overshoot.minY &&
			y <= guide.overshoot.maxY
				? [guide]
				: [],
		),
	)
}

/** Classifies a coordinate without losing coincident or overlapping matches. */
export function resolveVerticalMetricAlignment(
	y: number,
	guides: readonly VerticalMetricGuide[],
): VerticalMetricAlignment | null {
	const lines = matchingVerticalMetrics(y, guides)
	if (lines.length === 0) return null
	return Object.freeze({
		kind: lines.some((line) => line.y === y) ? "line" : "overshoot",
		lines,
	})
}

/**
 * Splits overshoot coverage into non-overlapping spans. Coincident and partially
 * overlapping zones therefore paint each y slice once while retaining every
 * metric identity that covers it.
 */
export function resolveVerticalOvershootBandSegments(
	guides: readonly VerticalMetricGuide[],
): readonly VerticalOvershootBandSegment[] {
	const lines = guides.filter(
		(guide): guide is VerticalMetricLine =>
			guide.kind === "line" && guide.overshoot.minY < guide.overshoot.maxY,
	)
	const boundaries = [
		...new Set(
			lines.flatMap((line) => [line.overshoot.minY, line.overshoot.maxY]),
		),
	].sort((first, second) => first - second)

	return Object.freeze(
		boundaries.slice(0, -1).flatMap((minY, index) => {
			const maxY = boundaries[index + 1]
			if (maxY === undefined || minY === maxY) return []
			const coveringLines = lines.filter(
				(line) => line.overshoot.minY < maxY && line.overshoot.maxY > minY,
			)
			return coveringLines.length === 0
				? []
				: [
						Object.freeze({
							minY,
							maxY,
							lines: Object.freeze(coveringLines),
						}),
					]
		}),
	)
}
