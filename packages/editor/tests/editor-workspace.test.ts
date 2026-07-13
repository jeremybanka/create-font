import { describe, expect, it } from "vitest"

import {
	blackMasterId,
	notdefGlyphId,
	oGlyphId,
	weightAxisId,
} from "../src/demo-font.ts"
import { previewHandleDrag, toggledNodeMode } from "../src/curve-editing.ts"
import {
	createEditorWorkspace,
	type EditorWorkspace,
} from "../src/editor-workspace.ts"
import {
	contourStartDirection,
	contourToPath,
	editorContourToPath,
	resolveVariableGlyph,
} from "../src/geometry.ts"
import { layoutTextRun, nearestCaretIndex } from "../src/text-layout.ts"

function previewGlyph(workspace: EditorWorkspace, index: number) {
	const item = workspace.font.silo.getState(workspace.ui.previewRun)[index]
	return item?.kind === "glyph" ? item.glyph : null
}

describe("editor workspace", () => {
	it("evaluates the geometric O between the Razor and Black masters", () => {
		const workspace = createEditorWorkspace()

		workspace.actions.setPreviewCoordinate(weightAxisId, 100)
		const razor = previewGlyph(workspace, 0)
		workspace.actions.setPreviewCoordinate(weightAxisId, 500)
		const middle = previewGlyph(workspace, 0)
		workspace.actions.setPreviewCoordinate(weightAxisId, 900)
		const black = previewGlyph(workspace, 0)

		expect(razor?.contours[1]?.[0]?.y).toBe(752)
		expect(middle?.contours[1]?.[0]?.y).toBe(600)
		expect(black?.contours[1]?.[0]?.y).toBe(448)
		expect(black?.contours[0]?.[0]?.y).toBe(820)
	})

	it("maps O through cmap and every unsupported character to .notdef", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "OX")
		const run = workspace.font.silo.getState(workspace.ui.previewRun)

		expect(
			run.flatMap((item) => (item.kind === "glyph" ? [item.glyphId] : [])),
		).toEqual([oGlyphId, notdefGlyphId])
	})

	it("lays out explicit line breaks and caret stops in one canvas", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "O\nO")
		const run = workspace.font.silo.getState(workspace.ui.previewRun)
		const layout = layoutTextRun(
			run,
			workspace.document.metrics,
			workspace.document.metadata.unitsPerEm,
		)

		expect(run.map((item) => item.kind)).toEqual([
			"glyph",
			"line-break",
			"glyph",
		])
		expect(layout.glyphs[1]?.x).toBe(0)
		expect(layout.glyphs[1]?.baseline).toBeGreaterThan(
			layout.glyphs[0]?.baseline ?? 0,
		)
		expect(layout.carets.find((caret) => caret.textIndex === 2)?.x).toBe(0)
		expect(
			nearestCaretIndex(layout.carets, 0, layout.glyphs[1]?.baseline ?? 0),
		).toBe(2)
	})

	it("enters and exits outline editing for one text occurrence", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(0, oGlyphId)

		expect(workspace.font.silo.getState(workspace.ui.editingTextIndex)).toBe(0)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			oGlyphId,
		)

		workspace.actions.exitGlyphEdit()
		expect(
			workspace.font.silo.getState(workspace.ui.editingTextIndex),
		).toBeNull()
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
		expect(previewGlyph(workspace, 0)?.contours[1]?.[0]?.y).toBe(420)

		workspace.font.undo(oGlyphId)
		expect(previewGlyph(workspace, 0)?.contours[1]?.[0]?.y).toBe(448)
	})

	it("does not invalidate an O preview when an unrelated glyph changes", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "O")
		const before = workspace.font.silo.getState(workspace.ui.previewRun)
		const layerBefore = workspace.font.silo.getState(workspace.ui.activeLayer)
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
		expect(workspace.font.silo.getState(workspace.ui.activeLayer)).toBe(
			layerBefore,
		)
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

	it("derives contour direction from the first distinct node", () => {
		expect(
			contourStartDirection([
				{ x: 10, y: 20 },
				{ x: 10, y: 20 },
				{ x: 10, y: 30 },
			]),
		).toEqual({ x: 10, y: 20, angle: 90 })
		expect(contourStartDirection([])).toBeNull()
	})

	it("writes node-owned handles as closed cubic paths", () => {
		const path = editorContourToPath([
			{ x: 0, y: 0, outgoing: { x: 20, y: 0 } },
			{ x: 40, y: 40, incoming: { x: 0, y: -20 } },
		])

		expect(path).toBe("M 0 0 C 20 0 40 20 40 40 L 0 0 Z")
		expect(
			contourStartDirection([
				{ x: 10, y: 20, outgoing: { x: -5, y: 5 } },
				{ x: 20, y: 20 },
			]),
		).toEqual({ x: 10, y: 20, angle: 135 })
	})

	it("previews soft handles as one line and hard handles independently", () => {
		const node = {
			pointId: "point:test" as const,
			mode: "soft" as const,
			x: 0,
			y: 0,
			incoming: { x: -10, y: 0 },
			outgoing: { x: 20, y: 0 },
		}
		expect(previewHandleDrag(node, "incoming", { x: 0, y: 10 })).toEqual({
			...node,
			incoming: { x: 0, y: 10 },
			outgoing: { x: 0, y: -20 },
		})
		expect(
			previewHandleDrag({ ...node, mode: "hard" }, "incoming", {
				x: 0,
				y: 10,
			}),
		).toEqual({
			...node,
			mode: "hard",
			incoming: { x: 0, y: 10 },
		})
	})

	it("toggles node modes in both directions", () => {
		expect(toggledNodeMode("soft")).toBe("hard")
		expect(toggledNodeMode("hard")).toBe("soft")
	})

	it("projects a mode toggle into the active layer and undo history", () => {
		const workspace = createEditorWorkspace()
		const pointId = workspace.document.glyphs.find(
			(glyph) => glyph.id === oGlyphId,
		)?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")

		workspace.font.actions.setNodeMode({
			glyphId: oGlyphId,
			pointId,
			mode: "hard",
		})
		expect(
			workspace.font.silo
				.getState(workspace.ui.activeLayer)
				?.contours.flat()
				.find((point) => point.pointId === pointId)?.mode,
		).toBe("hard")

		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.silo
				.getState(workspace.ui.activeLayer)
				?.contours.flat()
				.find((point) => point.pointId === pointId)?.mode,
		).toBe("soft")
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
