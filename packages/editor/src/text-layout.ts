import type { PreviewRunGlyph, PreviewRunItem } from "./editor-workspace.ts"

export interface TextLayoutMetrics {
	readonly ascender: number
	readonly descender: number
}

export interface PositionedGlyph {
	readonly item: PreviewRunGlyph
	readonly x: number
	readonly baseline: number
	readonly advance: number
}

export interface CaretPosition {
	readonly textIndex: number
	readonly x: number
	readonly baseline: number
}

export interface TextCanvasLayout {
	readonly glyphs: readonly PositionedGlyph[]
	readonly carets: readonly CaretPosition[]
	readonly lineCount: number
	readonly lineHeight: number
}

export function layoutTextRun(
	run: readonly PreviewRunItem[],
	metrics: TextLayoutMetrics,
	fallbackAdvance: number,
): TextCanvasLayout {
	const designHeight = metrics.ascender - metrics.descender
	const lineHeight = designHeight * 1.25
	const glyphs: PositionedGlyph[] = []
	const carets = new Map<number, CaretPosition>()
	let x = 0
	let line = 0
	let baseline = metrics.ascender
	carets.set(0, { textIndex: 0, x, baseline })

	for (const item of run) {
		carets.set(item.textStart, { textIndex: item.textStart, x, baseline })
		if (item.kind === "line-break") {
			x = 0
			line += 1
			baseline = metrics.ascender + line * lineHeight
			carets.set(item.textEnd, { textIndex: item.textEnd, x, baseline })
			continue
		}
		const advance =
			item.glyph?.advanceWidth ??
			item.sourcePreview?.advanceWidth ??
			fallbackAdvance
		x += item.kerningBefore ?? 0
		carets.set(item.textStart, { textIndex: item.textStart, x, baseline })
		glyphs.push({ item, x, baseline, advance })
		for (
			let textIndex = item.textStart + 1;
			textIndex < item.textEnd;
			textIndex += 1
		) {
			carets.set(textIndex, {
				textIndex,
				x:
					x +
					advance *
						((textIndex - item.textStart) / (item.textEnd - item.textStart)),
				baseline,
			})
		}
		x += advance
		carets.set(item.textEnd, { textIndex: item.textEnd, x, baseline })
	}

	return Object.freeze({
		glyphs: Object.freeze(glyphs),
		carets: Object.freeze([...carets.values()]),
		lineCount: line + 1,
		lineHeight,
	})
}

export function nearestCaretIndex(
	carets: readonly CaretPosition[],
	x: number,
	y: number,
): number {
	let nearest = carets[0]
	let nearestDistance = Number.POSITIVE_INFINITY
	for (const caret of carets) {
		const deltaX = caret.x - x
		const deltaY = caret.baseline - y
		const distance = deltaX * deltaX + deltaY * deltaY
		if (distance < nearestDistance) {
			nearest = caret
			nearestDistance = distance
		}
	}
	return nearest?.textIndex ?? 0
}
