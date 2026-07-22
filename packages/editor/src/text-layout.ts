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

export interface TextLinePosition {
	readonly textStart: number
	readonly textEnd: number
	readonly breakEnd: number
	readonly width: number
	readonly baseline: number
}

export interface TextSelectionRect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface TextCanvasLayout {
	readonly glyphs: readonly PositionedGlyph[]
	readonly carets: readonly CaretPosition[]
	readonly lines: readonly TextLinePosition[]
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
	const lines: TextLinePosition[] = []
	let x = 0
	let line = 0
	let lineTextStart = 0
	let baseline = metrics.ascender
	carets.set(0, { textIndex: 0, x, baseline })

	for (const item of run) {
		carets.set(item.textStart, { textIndex: item.textStart, x, baseline })
		if (item.kind === "line-break") {
			lines.push({
				textStart: lineTextStart,
				textEnd: item.textStart,
				breakEnd: item.textEnd,
				width: x,
				baseline,
			})
			x = 0
			line += 1
			lineTextStart = item.textEnd
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
	const lastTextIndex = run.at(-1)?.textEnd ?? 0
	lines.push({
		textStart: lineTextStart,
		textEnd: lastTextIndex,
		breakEnd: lastTextIndex,
		width: x,
		baseline,
	})

	return Object.freeze({
		glyphs: Object.freeze(glyphs),
		carets: Object.freeze([...carets.values()]),
		lines: Object.freeze(lines),
		lineCount: line + 1,
		lineHeight,
	})
}

/** Derives non-interactive, line-aware canvas rectangles from UTF-16 offsets. */
export function textSelectionRects(
	layout: TextCanvasLayout,
	metrics: TextLayoutMetrics,
	selectionStart: number,
	selectionEnd: number,
): readonly TextSelectionRect[] {
	const start = Math.max(0, Math.min(selectionStart, selectionEnd))
	const end = Math.max(start, Math.max(selectionStart, selectionEnd))
	if (start === end) return Object.freeze([])
	const carets = new Map(layout.carets.map((caret) => [caret.textIndex, caret]))
	const newlineWidth = Math.max(1, layout.lineHeight * 0.24)
	const rectangles: TextSelectionRect[] = []
	for (const line of layout.lines) {
		const contentStart = Math.max(start, line.textStart)
		const contentEnd = Math.min(end, line.textEnd)
		const selectsContent = contentStart < contentEnd
		const selectsBreak =
			line.textEnd < line.breakEnd &&
			start < line.breakEnd &&
			end > line.textEnd
		if (!selectsContent && !selectsBreak) continue
		const startX = selectsContent
			? (carets.get(contentStart)?.x ?? 0)
			: line.width
		const contentEndX = selectsContent
			? (carets.get(contentEnd)?.x ?? line.width)
			: startX
		const endX = selectsBreak
			? Math.max(contentEndX, line.width) + newlineWidth
			: contentEndX
		rectangles.push(
			Object.freeze({
				x: startX,
				y: line.baseline - metrics.ascender,
				width: Math.max(1, endX - startX),
				height: metrics.ascender - metrics.descender,
			}),
		)
	}
	return Object.freeze(rectangles)
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
