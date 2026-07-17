import { describe, expect, it } from "vitest"

import {
	aGlyphId,
	blackMasterId,
	notdefGlyphId,
	oGlyphId,
	razorMasterId,
	weightAxisId,
} from "../src/demo-font.ts"
import {
	deriveOneSidedSoftHandles,
	previewHandleDrag,
	toggledNodeMode,
} from "../src/curve-editing.ts"
import {
	createEditorWorkspace,
	type EditorWorkspace,
} from "../src/editor-workspace.ts"
import {
	combinedEditorPathPreview,
	contourEndpointNormal,
	contourStartDirection,
	contourToPath,
	editorSegmentCubic,
	editorContourToPath,
	nearestEditorSegment,
	resolveVariableGlyph,
} from "../src/geometry.ts"
import { layoutTextRun, nearestCaretIndex } from "../src/text-layout.ts"
import {
	canStartBoxSelectionOn,
	boundsOfControls,
	contourSelectionTargets,
	controlsInsideBounds,
	nearestAxisAlignment,
	resolveSelectionControls,
	scaleSelectionControls,
	translateSelectionControls,
} from "../src/outline-selection.ts"

function previewGlyph(workspace: EditorWorkspace, index: number) {
	const item = workspace.font.silo.getState(workspace.ui.previewRun)[index]
	return item?.kind === "glyph" ? item.glyph : null
}

describe("editor workspace", () => {
	it("loads a compiled demo font with a variable A", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "A")

		expect(workspace.font.read.compilation().stage).toBe("compiled")
		expect(previewGlyph(workspace, 0)?.contours).toHaveLength(2)
		expect(previewGlyph(workspace, 0)?.contours[0]).toHaveLength(8)
		expect(previewGlyph(workspace, 0)?.contours[1]).toHaveLength(3)
	})

	it("evaluates the geometric O between the Razor and Black masters", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "O")

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

	it("maps A and O through cmap and every unsupported character to .notdef", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "AOX")
		const run = workspace.font.silo.getState(workspace.ui.previewRun)

		expect(
			run.flatMap((item) => (item.kind === "glyph" ? [item.glyphId] : [])),
		).toEqual([aGlyphId, oGlyphId, notdefGlyphId])
	})

	it("adds unique named glyphs and maps single characters", () => {
		const workspace = createEditorWorkspace()
		const added = workspace.actions.addGlyphs(["B", "C", "B", "Aacute"])
		const source = workspace.font.read.editorSource()

		expect(added).toEqual(["glyph:B", "glyph:C", "glyph:Aacute"])
		expect(source?.glyphs.map((glyph) => glyph.name)).toEqual([
			".notdef",
			"A",
			"O",
			"B",
			"C",
			"Aacute",
		])
		expect(source?.cmap).toContainEqual({
			codePoint: "B".codePointAt(0),
			glyphId: "glyph:B",
		})
		expect(source?.cmap.some((entry) => entry.glyphId === "glyph:Aacute")).toBe(
			false,
		)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			"glyph:Aacute",
		)

		workspace.font.silo.setState(workspace.ui.previewText, "B")
		const item = workspace.font.silo.getState(workspace.ui.previewRun)[0]
		expect(item?.kind === "glyph" ? item.glyphId : null).toBe("glyph:B")
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

	it("enters, switches, and exits outline editing occurrences", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(0, oGlyphId)

		expect(workspace.font.silo.getState(workspace.ui.editingTextIndex)).toBe(0)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			oGlyphId,
		)

		workspace.actions.enterGlyphEdit(1, notdefGlyphId)
		expect(workspace.font.silo.getState(workspace.ui.editingTextIndex)).toBe(1)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			notdefGlyphId,
		)

		workspace.actions.exitGlyphEdit()
		expect(
			workspace.font.silo.getState(workspace.ui.editingTextIndex),
		).toBeNull()
	})

	it("shares master edits with the variable typing preview and undo history", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "O")
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

	it("writes broken editor contours without a closing segment", () => {
		const path = editorContourToPath(
			[
				{ x: 0, y: 0, outgoing: { x: 20, y: 0 } },
				{ x: 40, y: 40, incoming: { x: 0, y: -20 } },
			],
			false,
		)

		expect(path).toBe("M 0 0 C 20 0 40 20 40 40")
	})

	it("derives a deterministic non-destructive overlap preview", () => {
		const contours = [
			{
				closed: true,
				nodes: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 },
					{ x: 100, y: 100 },
				],
			},
			{
				closed: true,
				nodes: [
					{ x: 50, y: 0 },
					{ x: 150, y: 0 },
					{ x: 150, y: 100 },
				],
			},
		]
		const first = combinedEditorPathPreview(contours)
		const second = combinedEditorPathPreview(contours)
		expect(first).toEqual(second)
		expect(first).toMatchObject({
			fillRule: "nonzero",
			sourceContourCount: 2,
			nonDestructive: true,
		})
		expect(first.path.match(/M /g)).toHaveLength(2)
	})

	it("derives endpoint markers from the normal to an open path's tangent", () => {
		const contour = [
			{ x: 0, y: 0, outgoing: { x: 20, y: 0 } },
			{ x: 40, y: 40, incoming: { x: 0, y: -20 } },
		]

		expect(contourEndpointNormal(contour, 0, false)).toEqual({ x: 0, y: 1 })
		expect(contourEndpointNormal(contour, 1, false)).toEqual({ x: 1, y: 0 })
		expect(contourEndpointNormal(contour, 0, true)).toBeNull()
	})

	it("falls back to the adjacent segment for a handleless endpoint normal", () => {
		expect(
			contourEndpointNormal(
				[
					{ x: 10, y: 20 },
					{ x: 40, y: 20 },
				],
				0,
				false,
			),
		).toEqual({ x: 0, y: 1 })
	})

	it("box-selects nodes and handle endpoints independently", () => {
		const controls = controlsInsideBounds(
			[
				{
					pointId: "point:test",
					mode: "hard",
					x: 100,
					y: 100,
					incoming: { x: -40, y: 0 },
					outgoing: { x: 40, y: 0 },
				},
			],
			{ minX: 50, minY: 90, maxX: 110, maxY: 110 },
		)

		expect(controls).toEqual([
			{ kind: "node", pointId: "point:test" },
			{ kind: "handle", pointId: "point:test", handle: "incoming" },
		])
	})

	it("resolves, bounds, aligns, translates, and scales mixed controls deterministically", () => {
		const nodes = [
			{
				pointId: "point:first" as const,
				mode: "hard" as const,
				x: 10,
				y: 20,
				outgoing: { x: 12, y: 0 },
			},
			{
				pointId: "point:second" as const,
				mode: "hard" as const,
				x: 12,
				y: 80,
			},
		]
		const selection = [
			{ kind: "handle", pointId: nodes[0]!.pointId, handle: "outgoing" },
			{ kind: "node", pointId: nodes[1]!.pointId },
		] as const
		const controls = resolveSelectionControls(nodes, selection)

		expect(controls.map(({ x, y }) => ({ x, y }))).toEqual([
			{ x: 22, y: 20 },
			{ x: 12, y: 80 },
		])
		expect(boundsOfControls(controls)).toEqual({
			minX: 12,
			minY: 20,
			maxX: 22,
			maxY: 80,
		})
		expect(nearestAxisAlignment(controls)).toMatchObject({
			axis: "vertical",
			coordinate: 17,
			handles: [{ x: 17, y: 20 }],
			points: [{ x: 17, y: 80 }],
		})
		expect(nearestAxisAlignment([...controls].reverse())).toMatchObject({
			axis: "vertical",
			coordinate: 17,
		})
		expect(translateSelectionControls(controls, 3, -4)).toMatchObject({
			handles: [{ x: 25, y: 16 }],
			points: [{ x: 15, y: 76 }],
		})
		expect(
			scaleSelectionControls(controls, {
				anchorX: 12,
				anchorY: 20,
				scaleX: 2,
				scaleY: 0.5,
			}),
		).toMatchObject({
			handles: [{ x: 32, y: 20 }],
			points: [{ x: 12, y: 50 }],
		})
	})

	it("uses a stable vertical tie break and returns complete contour targets", () => {
		const nodes = [
			{ pointId: "point:a" as const, mode: "hard" as const, x: 0, y: 0 },
			{
				pointId: "point:b" as const,
				mode: "hard" as const,
				x: 10,
				y: 10,
				incoming: { x: -2, y: 0 },
			},
		]
		const controls = resolveSelectionControls(nodes, [
			{ kind: "node", pointId: nodes[0]!.pointId },
			{ kind: "node", pointId: nodes[1]!.pointId },
		])
		expect(nearestAxisAlignment(controls)?.axis).toBe("vertical")
		expect(contourSelectionTargets(nodes)).toEqual([
			{ kind: "node", pointId: "point:a" },
			{ kind: "node", pointId: "point:b" },
			{ kind: "handle", pointId: "point:b", handle: "incoming" },
		])
	})

	it("finds nearest line and cubic segments in authored geometry", () => {
		const line = [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		]
		expect(nearestEditorSegment(line, false, { x: 25, y: 7 })).toMatchObject({
			segmentIndex: 0,
			amount: 0.25,
			x: 25,
			y: 0,
			distance: 7,
		})
		const curve = [
			{ x: 0, y: 0, outgoing: { x: 0, y: 100 } },
			{ x: 100, y: 0, incoming: { x: 0, y: 100 } },
		]
		const nearest = nearestEditorSegment(curve, false, { x: 50, y: 76 })
		expect(nearest?.segmentIndex).toBe(0)
		expect(nearest?.amount).toBeCloseTo(0.5, 3)
		expect(nearest?.x).toBeCloseTo(50, 3)
		expect(nearest?.y).toBeCloseTo(75, 3)
		expect(editorSegmentCubic(curve, 0, false)).not.toBeNull()
	})

	it("starts box selection over inactive glyph occurrences", () => {
		expect(canStartBoxSelectionOn("canvas-background")).toBe(true)
		expect(canStartBoxSelectionOn("typed-glyph")).toBe(true)
		expect(canStartBoxSelectionOn("outline-node")).toBe(false)
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
		expect(
			previewHandleDrag(
				{
					pointId: node.pointId,
					mode: node.mode,
					x: node.x,
					y: node.y,
					incoming: node.incoming,
				},
				"incoming",
				{ x: 0, y: 25 },
			),
		).toEqual({
			pointId: node.pointId,
			mode: node.mode,
			x: node.x,
			y: node.y,
			incoming: { x: -25, y: 0 },
		})
	})

	it("derives a one-sided soft handle angle from the handleless side", () => {
		const nodes = deriveOneSidedSoftHandles(
			[
				{
					pointId: "point:first" as const,
					mode: "soft" as const,
					x: 0,
					y: 0,
					incoming: { x: -20, y: 0 },
				},
				{
					pointId: "point:next" as const,
					mode: "hard" as const,
					x: 10,
					y: 10,
					incoming: { x: -10, y: 0 },
				},
			],
			false,
		)
		expect(nodes[0]?.incoming).toEqual({ x: 0, y: -20 })
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
				?.contours.flatMap((contour) => contour.nodes)
				.find((point) => point.pointId === pointId)?.mode,
		).toBe("hard")

		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.silo
				.getState(workspace.ui.activeLayer)
				?.contours.flatMap((contour) => contour.nodes)
				.find((point) => point.pointId === pointId)?.mode,
		).toBe("soft")
	})

	it("keeps a deleted handle absent when toggling its node back to soft", () => {
		const workspace = createEditorWorkspace()
		const contour = workspace.document.glyphs.find(
			(glyph) => glyph.id === oGlyphId,
		)?.contours[0]
		const pointId = contour?.points[0]?.id
		const nextPointId = contour?.points[1]?.id
		if (pointId === undefined || nextPointId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}

		workspace.font.actions.deleteSelection({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			pointIds: [],
			handles: [{ pointId, handle: "outgoing" }],
		})
		workspace.font.actions.setNodeMode({
			glyphId: oGlyphId,
			pointId,
			mode: "soft",
		})

		const nodes = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((candidate) => candidate.nodes)
		const node = nodes?.find((candidate) => candidate.pointId === pointId)
		const next = nodes?.find((candidate) => candidate.pointId === nextPointId)
		if (node?.incoming === undefined || next === undefined) {
			throw new Error("Softened layer nodes did not project.")
		}
		expect(node.mode).toBe("soft")
		expect(node.outgoing).toBeUndefined()
		const tangent = {
			x: next.x + (next.incoming?.x ?? 0) - node.x,
			y: next.y + (next.incoming?.y ?? 0) - node.y,
		}
		expect(
			node.incoming.x * tangent.y - node.incoming.y * tangent.x,
		).toBeCloseTo(0)
		expect(
			node.incoming.x * tangent.x + node.incoming.y * tangent.y,
		).toBeLessThanOrEqual(0)
		const originalLength = Math.hypot(node.incoming.x, node.incoming.y)

		workspace.font.actions.movePoints({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: node.x + 40, y: node.y - 60 }],
		})
		const movedNodes = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((candidate) => candidate.nodes)
		const moved = movedNodes?.find((candidate) => candidate.pointId === pointId)
		const nextAfterMove = movedNodes?.find(
			(candidate) => candidate.pointId === nextPointId,
		)
		if (moved?.incoming === undefined || nextAfterMove === undefined) {
			throw new Error("Moved one-sided soft node did not project.")
		}
		const movedTangent = {
			x: nextAfterMove.x + (nextAfterMove.incoming?.x ?? 0) - moved.x,
			y: nextAfterMove.y + (nextAfterMove.incoming?.y ?? 0) - moved.y,
		}
		expect(
			moved.incoming.x * movedTangent.y - moved.incoming.y * movedTangent.x,
		).toBeCloseTo(0)
		expect(Math.hypot(moved.incoming.x, moved.incoming.y)).toBeCloseTo(
			originalLength,
		)
		expect(moved.incoming).not.toEqual(node.incoming)
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
