import { describe, expect, it } from "vitest"

import { createFontEditorState, type EditorFontSource } from "../src/index.ts"
import { serializeVariableFont } from "@create-font/target"
import { makeGeometricOEditorFont, oGlyphId } from "./fixtures/geometric-o.ts"

function withGlyphContours(
	contours: EditorFontSource["glyphs"][number]["layers"][number]["contours"],
): EditorFontSource {
	const source = makeGeometricOEditorFont()
	return {
		...source,
		glyphs: source.glyphs.map((glyph) =>
			glyph.id === oGlyphId
				? {
						...glyph,
						layers: glyph.layers.map((layer) => ({ ...layer, contours })),
					}
				: glyph,
		),
	}
}

function glyphsStyleOpenCornerSource(): EditorFontSource {
	return withGlyphContours([
		{
			id: "contour:open-corner",
			closed: true,
			points: [
				{ id: "point:a", mode: "hard", x: 0, y: 0 },
				{ id: "point:overflow-in", mode: "hard", x: 120, y: 0 },
				{ id: "point:overflow-out", mode: "hard", x: 100, y: -20 },
				{ id: "point:d", mode: "hard", x: 100, y: 100 },
				{ id: "point:e", mode: "hard", x: 0, y: 100 },
			],
		},
	])
}

function separateOverlapSource(): EditorFontSource {
	return withGlyphContours([
		{
			id: "contour:horizontal",
			closed: true,
			points: [
				{ id: "point:h0", mode: "hard", x: 0, y: 40 },
				{ id: "point:h1", mode: "hard", x: 100, y: 40 },
				{ id: "point:h2", mode: "hard", x: 100, y: 60 },
				{ id: "point:h3", mode: "hard", x: 0, y: 60 },
			],
		},
		{
			id: "contour:vertical",
			closed: true,
			points: [
				{ id: "point:v0", mode: "hard", x: 40, y: 0 },
				{ id: "point:v1", mode: "hard", x: 60, y: 0 },
				{ id: "point:v2", mode: "hard", x: 60, y: 100 },
				{ id: "point:v3", mode: "hard", x: 40, y: 100 },
			],
		},
	])
}

describe("font open corners", () => {
	it("infers Glyphs-style overflow nodes without mutating source metadata", () => {
		const editor = createFontEditorState({ key: "open-corners/inferred" })
		editor.actions.load(glyphsStyleOpenCornerSource())
		const authoredBefore = editor.read.editorGlyphSource(oGlyphId)!
		expect(authoredBefore.layers[0]?.contours[0]?.points).toHaveLength(5)
		expect(authoredBefore.layers[0]!.contours[0]!.points[1]).toEqual(
			expect.objectContaining({ x: 120, y: 0 }),
		)

		const compilation = editor.read.compilation()
		expect(compilation.ok).toBe(true)
		if (!compilation.ok) return
		const exported = compilation.source.glyphs.find(
			(glyph) => glyph.name === "O",
		)!
		expect(exported.contours[0]).toEqual([
			{ x: 0, y: 0, onCurve: true },
			{ x: 100, y: 0, onCurve: true },
			{ x: 100, y: 100, onCurve: true },
			{ x: 0, y: 100, onCurve: true },
		])
		expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(authoredBefore)
		const firstBytes = serializeVariableFont(compilation.font)
		const secondBytes = serializeVariableFont(compilation.font)
		expect(firstBytes).toEqual(secondBytes)
		expect(firstBytes.byteLength).toBeGreaterThan(1_000)
	})

	it("preserves ordinary separate-contour overlaps without guessing intent", () => {
		const editor = createFontEditorState({ key: "open-corners/overlap" })
		editor.actions.load(separateOverlapSource())
		const authored = editor.read.editorGlyphSource(oGlyphId)!
		const compilation = editor.read.compilation()
		expect(compilation.ok).toBe(true)
		if (!compilation.ok) return
		const exported = compilation.source.glyphs.find(
			(glyph) => glyph.name === "O",
		)!
		expect(exported.contours).toHaveLength(2)
		expect(exported.contours.map((contour) => contour.length)).toEqual([4, 4])
		expect(exported.contours[0]?.[0]).toEqual({
			x: 0,
			y: 40,
			onCurve: true,
		})
		expect(editor.read.editorGlyphSource(oGlyphId)).toEqual(authored)
	})
})
