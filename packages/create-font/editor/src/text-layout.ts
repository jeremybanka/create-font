import type { PreviewRunGlyph, PreviewRunItem } from "./editor-workspace.ts"

export const PREVIEW_TEXT_WRAP_COLUMNS = 26 * 2 + 13

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

export interface TextLayoutOptions {
	readonly maxColumns?: number
}

interface TextRunLine {
	readonly glyphs: readonly PreviewRunGlyph[]
	readonly textStart: number
	readonly textEnd: number
	readonly breakEnd: number
}

interface TextWrapUnit {
	readonly glyphs: readonly PreviewRunGlyph[]
	readonly columns: number
	readonly whitespace: boolean
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
})

function textWrapUnits(glyphs: readonly PreviewRunGlyph[]): TextWrapUnit[] {
	if (glyphs.length === 0) return []
	const text = glyphs.map((glyph) => glyph.character).join("")
	const graphemes = [...graphemeSegmenter.segment(text)]
	const columnsAtBoundary = new Map(
		graphemes.map((grapheme, index) => [
			grapheme.index + grapheme.segment.length,
			index + 1,
		]),
	)
	const units: TextWrapUnit[] = []
	let pending: PreviewRunGlyph[] = []
	let boundary = 0
	let assignedColumns = 0
	for (const glyph of glyphs) {
		pending.push(glyph)
		boundary += glyph.character.length
		const totalColumns = columnsAtBoundary.get(boundary)
		if (totalColumns === undefined) continue
		const characters = pending.map((item) => item.character).join("")
		units.push({
			glyphs: pending,
			columns: totalColumns - assignedColumns,
			whitespace: /^\s+$/u.test(characters),
		})
		assignedColumns = totalColumns
		pending = []
	}
	if (pending.length > 0) {
		const characters = pending.map((item) => item.character).join("")
		units.push({
			glyphs: pending,
			columns: [...graphemeSegmenter.segment(characters)].length,
			whitespace: /^\s+$/u.test(characters),
		})
	}
	return units
}

function wrapGlyphLine(
	glyphs: readonly PreviewRunGlyph[],
	maxColumns: number | undefined,
): readonly (readonly PreviewRunGlyph[])[] {
	if (glyphs.length === 0) return [glyphs]
	if (maxColumns === undefined || !Number.isFinite(maxColumns)) return [glyphs]
	const limit = Math.max(1, Math.trunc(maxColumns))
	const lines: PreviewRunGlyph[][] = []
	let remaining = textWrapUnits(glyphs)
	while (remaining.length > 0) {
		let columns = 0
		let lastWhitespace = 0
		let overflow = remaining.length
		for (let index = 0; index < remaining.length; index += 1) {
			const unit = remaining[index]!
			if (columns + unit.columns > limit) {
				overflow = index
				break
			}
			columns += unit.columns
			if (unit.whitespace) lastWhitespace = index + 1
		}
		if (overflow === remaining.length) {
			lines.push(remaining.flatMap((unit) => unit.glyphs))
			break
		}
		const overflowUnit = remaining[overflow]!
		const breakIndex = overflowUnit.whitespace
			? overflow + 1
			: lastWhitespace > 0
				? lastWhitespace
				: Math.max(1, overflow)
		lines.push(remaining.slice(0, breakIndex).flatMap((unit) => unit.glyphs))
		remaining = remaining.slice(breakIndex)
	}
	return lines
}

function textRunLines(
	run: readonly PreviewRunItem[],
	maxColumns: number | undefined,
): readonly TextRunLine[] {
	const lines: TextRunLine[] = []
	let logicalGlyphs: PreviewRunGlyph[] = []
	let logicalStart = 0
	const appendLogicalLine = (textEnd: number, breakEnd: number): void => {
		const wrapped = wrapGlyphLine(logicalGlyphs, maxColumns)
		for (let index = 0; index < wrapped.length; index += 1) {
			const glyphs = wrapped[index]!
			const first = glyphs[0]
			const last = glyphs.at(-1)
			const final = index === wrapped.length - 1
			lines.push({
				glyphs,
				textStart: first?.textStart ?? logicalStart,
				textEnd: last?.textEnd ?? textEnd,
				breakEnd: final ? breakEnd : (last?.textEnd ?? textEnd),
			})
		}
		logicalGlyphs = []
		logicalStart = breakEnd
	}
	for (const item of run) {
		if (item.kind === "glyph") {
			logicalGlyphs.push(item)
			continue
		}
		appendLogicalLine(item.textStart, item.textEnd)
	}
	const textEnd = run.at(-1)?.textEnd ?? 0
	appendLogicalLine(textEnd, textEnd)
	return lines
}

export function layoutTextRun(
	run: readonly PreviewRunItem[],
	metrics: TextLayoutMetrics,
	fallbackAdvance: number,
	options: TextLayoutOptions = {},
): TextCanvasLayout {
	const designHeight = metrics.ascender - metrics.descender
	const lineHeight = designHeight * 1.25
	const glyphs: PositionedGlyph[] = []
	const carets = new Map<number, CaretPosition>()
	const lines: TextLinePosition[] = []
	const plannedLines = textRunLines(run, options.maxColumns)
	for (let lineIndex = 0; lineIndex < plannedLines.length; lineIndex += 1) {
		const line = plannedLines[lineIndex]!
		const baseline = metrics.ascender + lineIndex * lineHeight
		let x = 0
		carets.set(line.textStart, { textIndex: line.textStart, x, baseline })
		for (let glyphIndex = 0; glyphIndex < line.glyphs.length; glyphIndex += 1) {
			const item = line.glyphs[glyphIndex]!
			const advance =
				item.glyph?.advanceWidth ??
				item.sourcePreview?.advanceWidth ??
				fallbackAdvance
			if (glyphIndex > 0) x += item.kerningBefore ?? 0
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
		lines.push({
			textStart: line.textStart,
			textEnd: line.textEnd,
			breakEnd: line.breakEnd,
			width: x,
			baseline,
		})
	}

	return Object.freeze({
		glyphs: Object.freeze(glyphs),
		carets: Object.freeze([...carets.values()]),
		lines: Object.freeze(lines),
		lineCount: lines.length,
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
			? contentEnd === line.textEnd
				? line.width
				: (carets.get(contentEnd)?.x ?? line.width)
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
