import { describe, expect, it } from "vitest"

import type { PreviewRunItem } from "../src/editor-workspace.ts"
import { PREVIEW_SAMPLES } from "../src/preview-tile.ts"
import { moveTextareaSelectionVertically } from "../src/textarea-selection.ts"
import {
	layoutTextRun,
	PREVIEW_TEXT_WRAP_COLUMNS,
	textSelectionRects,
} from "../src/text-layout.ts"

const metrics = { ascender: 800, descender: -200 }
const graphemeSegmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
})

function textRun(text: string): readonly PreviewRunItem[] {
	const run: PreviewRunItem[] = []
	let textOffset = 0
	for (const character of text) {
		const textStart = textOffset
		textOffset += character.length
		run.push(
			character === "\n"
				? { kind: "line-break", textStart, textEnd: textOffset }
				: {
						kind: "glyph",
						character,
						textStart,
						textEnd: textOffset,
						glyphId: "glyph:test",
						glyph: null,
						sourcePreview: null,
					},
		)
	}
	return run
}

describe("text layout wrapping", () => {
	it("softly wraps prose at word boundaries without changing its text", () => {
		const text = "one two three"
		const layout = layoutTextRun(textRun(text), metrics, 1, { maxColumns: 7 })
		const lines = layout.lines.map((line) =>
			text.slice(line.textStart, line.textEnd),
		)

		expect(lines).toEqual(["one two ", "three"])
		expect(lines.join("")).toBe(text)
		expect(layout.carets.find((caret) => caret.textIndex === 8)).toMatchObject({
			x: 0,
			baseline: 2_050,
		})
	})

	it("hard-wraps a word that is longer than the column limit", () => {
		const text = "abcdefgh"
		const run = textRun(text).map((item, index) =>
			item.kind === "glyph" && index === 3
				? { ...item, kerningBefore: -0.5 }
				: item,
		)
		const layout = layoutTextRun(run, metrics, 1, { maxColumns: 3 })
		expect(
			layout.lines.map((line) => text.slice(line.textStart, line.textEnd)),
		).toEqual(["abc", "def", "gh"])
		expect(layout.glyphs[3]).toMatchObject({ x: 0, baseline: 2_050 })
	})

	it("preserves explicit breaks while wrapping each logical line", () => {
		const text = "ab\ncdef"
		const layout = layoutTextRun(textRun(text), metrics, 1, { maxColumns: 3 })
		expect(
			layout.lines.map((line) => ({
				text: text.slice(line.textStart, line.textEnd),
				breakEnd: line.breakEnd,
			})),
		).toEqual([
			{ text: "ab", breakEnd: 3 },
			{ text: "cde", breakEnd: 6 },
			{ text: "f", breakEnd: 7 },
		])
	})

	it("counts extended Unicode graphemes as single columns", () => {
		const combiningText = "A\u0301BC"
		const combiningLayout = layoutTextRun(textRun(combiningText), metrics, 1, {
			maxColumns: 2,
		})
		expect(
			combiningLayout.lines.map((line) =>
				combiningText.slice(line.textStart, line.textEnd),
			),
		).toEqual(["A\u0301B", "C"])

		const familyText = "👨‍👩‍👧‍👦A"
		const familyLayout = layoutTextRun(textRun(familyText), metrics, 1, {
			maxColumns: 1,
		})
		expect(
			familyLayout.lines.map((line) =>
				familyText.slice(line.textStart, line.textEnd),
			),
		).toEqual(["👨‍👩‍👧‍👦", "A"])
	})

	it("wraps the Moby-Dick sample to the shared 65-column limit", () => {
		const text = PREVIEW_SAMPLES.moby
		const layout = layoutTextRun(textRun(text), metrics, 1, {
			maxColumns: PREVIEW_TEXT_WRAP_COLUMNS,
		})
		const lines = layout.lines.map((line) =>
			text.slice(line.textStart, line.textEnd),
		)

		expect(layout.lineCount).toBeGreaterThan(1)
		expect(lines.join("")).toBe(text)
		expect(
			lines.every(
				(line) =>
					[...graphemeSegmenter.segment(line.trimEnd())].length <=
					PREVIEW_TEXT_WRAP_COLUMNS,
			),
		).toBe(true)
	})

	it("keeps selections and vertical movement line-aware at soft wraps", () => {
		const text = "abcdef"
		const layout = layoutTextRun(textRun(text), metrics, 1, { maxColumns: 3 })

		expect(textSelectionRects(layout, metrics, 1, 6)).toEqual([
			{ x: 1, y: 0, width: 2, height: 1_000 },
			{ x: 0, y: 1_250, width: 3, height: 1_000 },
		])
		expect(
			moveTextareaSelectionVertically(
				{
					value: text,
					selectionStart: 1,
					selectionEnd: 1,
					selectionDirection: "none",
				},
				layout.carets,
				1,
				{ extend: false, preferredX: null },
			),
		).toEqual({
			focus: 4,
			preferredX: 1,
			selectionStart: 4,
			selectionEnd: 4,
			selectionDirection: "none",
		})
	})
})
