import { describe, expect, it } from "vitest"

import {
	blackMasterId,
	notdefGlyphId,
	oGlyphId,
	weightAxisId,
} from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { contourToPath, resolveVariableGlyph } from "../src/geometry.ts"

describe("editor workspace", () => {
	it("evaluates the geometric O between the Razor and Black masters", () => {
		const workspace = createEditorWorkspace()

		workspace.actions.setPreviewCoordinate(weightAxisId, 100)
		const razor = workspace.font.silo.getState(workspace.ui.previewRun)[0]
			?.glyph
		workspace.actions.setPreviewCoordinate(weightAxisId, 500)
		const middle = workspace.font.silo.getState(workspace.ui.previewRun)[0]
			?.glyph
		workspace.actions.setPreviewCoordinate(weightAxisId, 900)
		const black = workspace.font.silo.getState(workspace.ui.previewRun)[0]
			?.glyph

		expect(razor?.contours[1]?.[0]?.y).toBe(752)
		expect(middle?.contours[1]?.[0]?.y).toBe(600)
		expect(black?.contours[1]?.[0]?.y).toBe(448)
		expect(black?.contours[0]?.[0]?.y).toBe(820)
	})

	it("maps O through cmap and every unsupported character to .notdef", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "OX")
		const run = workspace.font.silo.getState(workspace.ui.previewRun)

		expect(run.map((item) => item.glyphId)).toEqual([oGlyphId, notdefGlyphId])
	})

	it("shares master edits with the variable typing preview and undo history", () => {
		const workspace = createEditorWorkspace()
		const source = workspace.font.read.editorSource()
		const innerTop = source?.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.contours[1]?.points[0]?.id
		expect(innerTop).toBeDefined()
		if (innerTop === undefined) return

		workspace.actions.setPreviewCoordinate(weightAxisId, 900)
		workspace.font.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: innerTop, x: 500, y: 420 }],
		})
		expect(
			workspace.font.silo.getState(workspace.ui.previewRun)[0]?.glyph
				?.contours[1]?.[0]?.y,
		).toBe(420)

		workspace.font.undo()
		expect(
			workspace.font.silo.getState(workspace.ui.previewRun)[0]?.glyph
				?.contours[1]?.[0]?.y,
		).toBe(448)
	})

	it("does not invalidate an O preview when an unrelated glyph changes", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "O")
		const before = workspace.font.silo.getState(workspace.ui.previewRun)
		const notdefPoint = workspace.document.glyphs.find(
			(glyph) => glyph.id === notdefGlyphId,
		)?.contours[0]?.points[0]?.id
		expect(notdefPoint).toBeDefined()
		if (notdefPoint === undefined) return

		workspace.font.actions.movePoints({
			masterId: blackMasterId,
			glyphId: notdefGlyphId,
			points: [{ pointId: notdefPoint, x: 500, y: 800 }],
		})

		expect(workspace.font.silo.getState(workspace.ui.previewRun)).toBe(before)
	})

	it("writes valid closed quadratic SVG paths", () => {
		const workspace = createEditorWorkspace()
		const layer = workspace.font.read.glyphLayer(blackMasterId, oGlyphId)
		expect(layer.ok).toBe(true)
		if (!layer.ok) return
		const path = contourToPath(layer.value.contours[0] ?? [])

		expect(path).toMatch(/^M 500 820/)
		expect(path).toContain("Q 920 820 920 400")
		expect(path).toMatch(/Z$/)
	})

	it("derives sidebearing from the resolved xMin and left phantom origin", () => {
		const resolved = resolveVariableGlyph(
			oGlyphId,
			{
				name: "O",
				advanceWidth: 500,
				leftSideBearing: 50,
				contours: [[{ x: 100, y: 0, onCurve: true }]],
				variations: [
					{
						region: { peak: { wght: 1 } },
						deltas: {
							points: [{ x: 30, y: 0 }],
							phantom: { left: 10, right: 25 },
						},
					},
				],
			},
			[
				{
					id: weightAxisId,
					tag: "wght",
					name: "Weight",
					min: 100,
					default: 100,
					max: 900,
				},
			],
			{ [weightAxisId]: 900 },
		)

		expect(resolved?.leftSideBearing).toBe(70)
		expect(resolved?.advanceWidth).toBe(515)
	})
})
