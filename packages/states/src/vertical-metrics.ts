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
	return guides.flatMap((guide) =>
		guide.kind === "line" &&
		y >= guide.overshoot.minY &&
		y <= guide.overshoot.maxY
			? [guide]
			: [],
	)
}
