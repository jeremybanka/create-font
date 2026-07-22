import { describe, expect, it } from "vitest"

import type { PreviewRunItem } from "../src/editor-workspace.ts"
import { layoutTextRun, textSelectionRects } from "../src/text-layout.ts"

const metrics = { ascender: 800, descender: -200 }

function glyph(textStart: number, textEnd: number): PreviewRunItem {
	return {
		kind: "glyph",
		character: "?",
		textStart,
		textEnd,
		glyphId: "glyph:test",
		glyph: null,
		sourcePreview: null,
	}
}

describe("text selection geometry", () => {
	it("maps UTF-16 offsets across explicit breaks and empty lines", () => {
		const layout = layoutTextRun(
			[
				glyph(0, 2),
				{ kind: "line-break", textStart: 2, textEnd: 3 },
				{ kind: "line-break", textStart: 3, textEnd: 4 },
				glyph(4, 5),
			],
			metrics,
			1_000,
		)

		expect(textSelectionRects(layout, metrics, 1, 5)).toEqual([
			{ x: 500, y: 0, width: 800, height: 1_000 },
			{ x: 0, y: 1_250, width: 300, height: 1_000 },
			{ x: 0, y: 2_500, width: 1_000, height: 1_000 },
		])
	})

	it("renders reversed and forward ranges identically and omits carets", () => {
		const layout = layoutTextRun([glyph(0, 2)], metrics, 1_000)
		expect(textSelectionRects(layout, metrics, 2, 1)).toEqual(
			textSelectionRects(layout, metrics, 1, 2),
		)
		expect(textSelectionRects(layout, metrics, 1, 1)).toEqual([])
	})
})
