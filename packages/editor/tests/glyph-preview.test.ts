import { describe, expect, it } from "vitest"

import {
	blackMasterId,
	makeDemoFont,
	oGlyphId,
	razorMasterId,
} from "../src/demo-font.ts"
import { createGlyphPreview } from "../src/glyph-preview.ts"

describe(`glyph preview`, () => {
	it(`renders the selected master from the glyph's real contours`, () => {
		const source = makeDemoFont()
		const glyph = source.glyphs.find((candidate) => candidate.id === oGlyphId)
		expect(glyph).toBeDefined()
		if (glyph === undefined) return

		const razor = createGlyphPreview(
			glyph,
			razorMasterId,
			source.metrics,
			source.metadata.unitsPerEm,
		)
		const black = createGlyphPreview(
			glyph,
			blackMasterId,
			source.metrics,
			source.metadata.unitsPerEm,
		)

		expect(razor?.path).toContain(`M 500 752`)
		expect(black?.path).toContain(`M 500 448`)
		expect(razor?.path).not.toBe(black?.path)
	})

	it(`keeps blank glyphs blank inside a finite square viewport`, () => {
		const source = makeDemoFont()
		const template = source.glyphs[0]
		expect(template).toBeDefined()
		if (template === undefined) return
		const blank = {
			...template,
			name: `space`,
			contours: [],
			layers: template.layers.map((layer) => ({
				...layer,
				advanceWidth: 320,
				leftSideBearing: 0,
				points: [],
			})),
		}

		const preview = createGlyphPreview(
			blank,
			razorMasterId,
			source.metrics,
			source.metadata.unitsPerEm,
		)
		const viewBox = preview?.viewBox.split(` `).map(Number)

		expect(preview?.path).toBe(``)
		expect(viewBox).toHaveLength(4)
		expect(viewBox?.every(Number.isFinite)).toBe(true)
		expect(viewBox?.[2]).toBe(viewBox?.[3])
	})
})
