import { Silo } from "atom.io"
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
import { subscribeToSettledState } from "../src/settled-subscription.ts"
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
	selectionForRigidTranslation,
	selectionOriginPosition,
	selectionScaleForDimension,
	translateSelectionControls,
} from "../src/outline-selection.ts"
import {
	projectSelectionTransformPreview,
	resolveTangentSlide,
	selectedTangentSlideConstraint,
} from "../src/select-editing.ts"

function previewGlyph(workspace: EditorWorkspace, index: number) {
	const item = workspace.font.silo.getState(workspace.ui.previewRun)[index]
	return item?.kind === "glyph" ? item.glyph : null
}

describe("editor workspace", () => {
	it("shares proportional scaling preference across editor lifecycle actions", () => {
		const workspace = createEditorWorkspace()
		expect(
			workspace.font.silo.getState(workspace.ui.constrainProportions),
		).toBe(false)

		workspace.actions.toggleConstrainProportions()
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		workspace.actions.exitGlyphEdit()

		expect(
			workspace.font.silo.getState(workspace.ui.constrainProportions),
		).toBe(true)
		workspace.actions.toggleConstrainProportions()
		expect(
			workspace.font.silo.getState(workspace.ui.constrainProportions),
		).toBe(false)
	})

	it("keeps visual debug state across editor lifecycle actions", () => {
		const workspace = createEditorWorkspace()
		expect(workspace.font.silo.getState(workspace.ui.visualDebug)).toEqual({
			"hit-targets": false,
		})

		workspace.actions.toggleVisualDebug("hit-targets")
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		workspace.actions.exitGlyphEdit()

		expect(workspace.font.silo.getState(workspace.ui.visualDebug)).toEqual({
			"hit-targets": true,
		})
	})
	it("coalesces a transaction into one external-store notification", async () => {
		const silo = new Silo({
			name: "test/settled-selector",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const firstAtom = silo.atom({ key: "first", default: 1 })
		const secondAtom = silo.atom({ key: "second", default: 2 })
		let computations = 0
		const sumSelector = silo.selector({
			key: "sum",
			get: ({ get }) => {
				computations += 1
				return get(firstAtom) + get(secondAtom)
			},
		})
		const setBoth = silo.runTransaction(
			silo.transaction<() => void>({
				key: "setBoth",
				do: ({ set }) => {
					set(firstAtom, 3)
					set(secondAtom, 4)
				},
			}),
		)
		expect(silo.getState(sumSelector)).toBe(3)
		let notifications = 0
		const unsubscribe = subscribeToSettledState(silo, sumSelector, () => {
			notifications += 1
			expect(silo.getState(sumSelector)).toBe(7)
		})

		setBoth()
		await Promise.resolve()
		unsubscribe()

		expect(notifications).toBe(1)
		expect(computations).toBe(3)
	})

	it("shares selector work and coalesces same-turn timeline-style updates", async () => {
		const silo = new Silo({
			name: "test/shared-settled-selector",
			lifespan: "ephemeral",
			isProduction: false,
		})
		const firstAtom = silo.atom({ key: "first", default: 1 })
		const secondAtom = silo.atom({ key: "second", default: 2 })
		let computations = 0
		const sumSelector = silo.selector({
			key: "sum",
			get: ({ get }) => {
				computations += 1
				return get(firstAtom) + get(secondAtom)
			},
		})
		expect(silo.getState(sumSelector)).toBe(3)
		let firstNotifications = 0
		let secondNotifications = 0
		const unsubscribeFirst = subscribeToSettledState(silo, sumSelector, () => {
			firstNotifications += 1
		})
		const unsubscribeSecond = subscribeToSettledState(silo, sumSelector, () => {
			secondNotifications += 1
		})

		silo.setState(firstAtom, 3)
		silo.setState(secondAtom, 4)
		await Promise.resolve()
		unsubscribeFirst()
		unsubscribeSecond()

		expect(firstNotifications).toBe(1)
		expect(secondNotifications).toBe(1)
		expect(computations).toBe(3)
	})

	it("notifies external-store subscribers once after replacing a source", async () => {
		const workspace = createEditorWorkspace()
		const selector = workspace.font.selectors.editorSource
		const source = workspace.font.silo.getState(selector)
		if (source === null) throw new Error("The editor source is missing.")
		const replacement = structuredClone(source)
		const layer = replacement.glyphs[0]?.layers[0]
		if (layer === undefined) throw new Error("The glyph layer is missing.")
		Object.assign(layer, { advanceWidth: layer.advanceWidth + 1 })
		const snapshots: Array<typeof source> = []
		const unsubscribe = subscribeToSettledState(
			workspace.font.silo,
			selector,
			() => {
				const snapshot = workspace.font.silo.getState(selector)
				if (snapshot !== null) snapshots.push(snapshot)
			},
		)

		workspace.actions.replaceSource(replacement)
		await Promise.resolve()
		unsubscribe()

		expect(snapshots).toHaveLength(1)
		expect(snapshots[0]?.glyphs[0]?.layers[0]?.advanceWidth).toBe(
			layer.advanceWidth,
		)
	})

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

	it("starts without an explicit glyph selection and derives typing focus from the caret", () => {
		const workspace = createEditorWorkspace()
		expect(
			workspace.font.silo.getState(workspace.ui.selectedGlyphId),
		).toBeNull()
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			aGlyphId,
		)

		workspace.font.silo.setState(workspace.ui.previewText, "A\nO")
		workspace.font.silo.setState(workspace.ui.caretIndex, 1)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			oGlyphId,
		)
		workspace.font.silo.setState(workspace.ui.caretIndex, 3)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBeNull()
		expect(workspace.font.silo.getState(workspace.ui.activeLayer)).toBeNull()
	})

	it("uses fallback glyphs as typing focus without manufacturing an O", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "X")
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			notdefGlyphId,
		)
		workspace.font.silo.setState(workspace.ui.caretIndex, 1)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBeNull()
	})

	it("keeps outline-edit focus explicit and recomputes typing focus on exit", () => {
		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.previewText, "AO")
		workspace.font.silo.setState(workspace.ui.caretIndex, 0)
		workspace.actions.enterGlyphEdit(1, oGlyphId)
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			oGlyphId,
		)

		workspace.actions.exitGlyphEdit()
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			aGlyphId,
		)
	})

	it("clears an explicit selection when source replacement removes it", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.selectGlyph(oGlyphId)
		workspace.actions.navigate("/glyphs")
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBe(
			oGlyphId,
		)
		const source = workspace.font.read.editorSource()
		if (source === null) throw new Error("Missing editor source.")
		workspace.actions.replaceSource({
			...source,
			glyphs: source.glyphs.filter((glyph) => glyph.id !== oGlyphId),
			cmap: source.cmap.filter((entry) => entry.glyphId !== oGlyphId),
		})
		expect(
			workspace.font.silo.getState(workspace.ui.selectedGlyphId),
		).toBeNull()
		expect(workspace.font.silo.getState(workspace.ui.activeGlyphId)).toBeNull()
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
		expect(workspace.font.silo.getState(workspace.ui.selectedGlyphId)).toBe(
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

	it("derives active-layer bounds and right side bearing after edits", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		workspace.font.silo.setState(workspace.ui.activeMasterId, razorMasterId)
		const before = workspace.font.silo.getState(workspace.ui.activeLayer)
		if (before === null) throw new Error("Missing active fixture layer.")
		expect(before.outlineWidth).toBe(before.xMax - before.xMin)
		expect(before.rightSideBearing).toBe(
			before.advanceWidth - before.leftSideBearing - before.outlineWidth,
		)

		workspace.font.actions.setHorizontalMetrics({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			advanceWidth: before.advanceWidth + 25,
		})
		const afterWidth = workspace.font.silo.getState(workspace.ui.activeLayer)
		expect(afterWidth?.rightSideBearing).toBe(before.rightSideBearing + 25)

		const firstPoint = before.contours[0]?.nodes[0]
		if (firstPoint === undefined) throw new Error("Missing fixture point.")
		workspace.font.actions.movePoints({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			points: [
				{ pointId: firstPoint.pointId, x: firstPoint.x - 20, y: firstPoint.y },
			],
		})
		const afterMove = workspace.font.silo.getState(workspace.ui.activeLayer)
		expect(afterMove?.outlineWidth).toBeGreaterThanOrEqual(before.outlineWidth)
		expect(afterMove?.rightSideBearing).toBe(
			(afterMove?.advanceWidth ?? 0) -
				(afterMove?.leftSideBearing ?? 0) -
				(afterMove?.outlineWidth ?? 0),
		)
	})

	it("uses zero outline width when deriving empty-glyph bearings", () => {
		const workspace = createEditorWorkspace()
		const [emptyGlyphId] = workspace.actions.addGlyphs(["empty-bearing-test"])
		if (emptyGlyphId === undefined) throw new Error("Glyph was not added.")
		workspace.actions.enterGlyphEdit(0, emptyGlyphId)
		const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
		expect(layer).toMatchObject({
			glyphId: emptyGlyphId,
			xMin: 0,
			xMax: 0,
			outlineWidth: 0,
		})
		expect(layer?.rightSideBearing).toBe(
			(layer?.advanceWidth ?? 0) - (layer?.leftSideBearing ?? 0),
		)
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

	it("caches editor-source projection independently for each glyph", () => {
		const workspace = createEditorWorkspace()
		const aBefore = workspace.font.read.editorGlyphSource(aGlyphId)
		const oBefore = workspace.font.read.editorGlyphSource(oGlyphId)
		const point = oBefore?.contours[0]?.points[0]
		const layerPoint = oBefore?.layers[0]?.points.find(
			(item) => item.pointId === point?.id,
		)
		if (oBefore === null || point === undefined || layerPoint === undefined) {
			throw new Error("Missing O fixture point.")
		}

		workspace.font.actions.movePoints({
			masterId: oBefore.layers[0]?.masterId ?? razorMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: layerPoint.x + 1, y: layerPoint.y }],
		})

		expect(workspace.font.read.editorGlyphSource(aGlyphId)).toBe(aBefore)
		expect(workspace.font.read.editorGlyphSource(oGlyphId)).not.toBe(oBefore)
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

	it("includes a soft handle pair's owner in a rigid translation", () => {
		const node = {
			pointId: "point:soft-pair" as const,
			mode: "soft" as const,
			x: 0,
			y: 0,
			incoming: { x: -10, y: 0 },
			outgoing: { x: 20, y: 0 },
		}
		const selection = selectionForRigidTranslation(
			[node],
			[
				{ kind: "handle", pointId: node.pointId, handle: "incoming" },
				{ kind: "handle", pointId: node.pointId, handle: "outgoing" },
			],
		)
		expect(selection).toEqual([
			{ kind: "handle", pointId: node.pointId, handle: "incoming" },
			{ kind: "handle", pointId: node.pointId, handle: "outgoing" },
			{ kind: "node", pointId: node.pointId },
		])
		expect(
			translateSelectionControls(
				resolveSelectionControls([node], selection),
				0,
				10,
			),
		).toEqual({
			points: [{ pointId: node.pointId, x: 0, y: 10 }],
			handles: [
				{
					pointId: node.pointId,
					handle: "incoming",
					x: -10,
					y: 10,
				},
				{
					pointId: node.pointId,
					handle: "outgoing",
					x: 20,
					y: 10,
				},
			],
		})
	})

	it("derives all nine selection origins including half-unit centers", () => {
		const bounds = { minX: -10, minY: -21, maxX: 91, maxY: 80 }
		expect(selectionOriginPosition(bounds, "bottom-left")).toEqual({
			x: -10,
			y: -21,
		})
		expect(selectionOriginPosition(bounds, "center")).toEqual({
			x: 40.5,
			y: 29.5,
		})
		expect(selectionOriginPosition(bounds, "top-right")).toEqual({
			x: 91,
			y: 80,
		})
		expect(
			selectionScaleForDimension(bounds, "top-right", "width", 202),
		).toEqual({ anchorX: 91, anchorY: 80, scaleX: 2, scaleY: 1 })
		expect(
			selectionScaleForDimension(bounds, "top-right", "width", 202, true),
		).toEqual({ anchorX: 91, anchorY: 80, scaleX: 2, scaleY: 2 })
		expect(
			selectionScaleForDimension(bounds, "bottom-left", "height", 50.5, true),
		).toEqual({ anchorX: -10, anchorY: -21, scaleX: 0.5, scaleY: 0.5 })
	})

	it("rejects undefined scaling from degenerate selection bounds", () => {
		const vertical = { minX: 12, minY: -5, maxX: 12, maxY: 25 }
		expect(
			selectionScaleForDimension(vertical, "center", "width", 20),
		).toBeNull()
		expect(
			selectionScaleForDimension(vertical, "center", "height", 60),
		).toEqual({ anchorX: 12, anchorY: 10, scaleX: 1, scaleY: 2 })
		expect(
			selectionScaleForDimension(vertical, "center", "height", 60, true),
		).toBeNull()
		expect(
			selectionScaleForDimension(vertical, "center", "height", Infinity),
		).toBeNull()
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
		workspace.actions.enterGlyphEdit(0, oGlyphId)
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
		workspace.actions.enterGlyphEdit(0, oGlyphId)
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

	it("slides beside an adjacent one-sided node using canonical layer geometry", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		workspace.font.silo.setState(workspace.ui.activeMasterId, razorMasterId)
		const contour = workspace.document.glyphs.find(
			(glyph) => glyph.id === oGlyphId,
		)?.contours[0]
		const pointId = contour?.points[0]?.id
		const neighborId = contour?.points[1]?.id
		if (pointId === undefined || neighborId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const targetId of [pointId, neighborId]) {
			workspace.font.actions.deleteSelection({
				masterId: razorMasterId,
				glyphId: oGlyphId,
				pointIds: [],
				handles: [{ pointId: targetId, handle: "outgoing" }],
			})
			workspace.font.actions.setNodeMode({
				glyphId: oGlyphId,
				pointId: targetId,
				mode: "soft",
			})
		}
		const beforeMove = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.find((node) => node.pointId === neighborId)
		if (beforeMove === undefined) throw new Error("Neighbor layer is missing.")
		workspace.font.actions.movePoints({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			points: [
				{
					pointId: neighborId,
					x: beforeMove.x + 37,
					y: beforeMove.y + 53,
				},
			],
		})
		const activeContour = workspace.font.silo.getState(workspace.ui.activeLayer)
			?.contours[0]
		const target = activeContour?.nodes.find((node) => node.pointId === pointId)
		const neighbor = activeContour?.nodes.find(
			(node) => node.pointId === neighborId,
		)
		const tangentNeighbor = activeContour?.tangentNodes?.find(
			(node) => node.pointId === neighborId,
		)
		if (
			activeContour === undefined ||
			target?.incoming === undefined ||
			neighbor?.incoming === undefined ||
			tangentNeighbor?.incoming === undefined
		) {
			throw new Error("Adjacent one-sided layer geometry is missing.")
		}
		const selection = selectedTangentSlideConstraint(
			[activeContour],
			[{ kind: "node", pointId }],
		)
		const constraint = selection?.constraint
		if (constraint === null || constraint === undefined) {
			throw new Error("Adjacent one-sided tangent constraint is missing.")
		}
		const reference = {
			x: tangentNeighbor.x + tangentNeighbor.incoming.x,
			y: tangentNeighbor.y + tangentNeighbor.incoming.y,
		}
		expect(constraint.end).toEqual(reference)
		expect(reference).not.toEqual({
			x: neighbor.x + neighbor.incoming.x,
			y: neighbor.y + neighbor.incoming.y,
		})
		const resolution = resolveTangentSlide(constraint, {
			x: (constraint.start.x + reference.x) / 2,
			y: (constraint.start.y + reference.y) / 2,
		})
		const next = resolution?.points[0]
		if (resolution === null || resolution === undefined || next === undefined) {
			throw new Error("Adjacent one-sided slide did not resolve.")
		}
		workspace.font.actions.slideSoftNode({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			pointId,
			x: next.x,
			y: next.y,
			handles: resolution.handles.map(({ handle, x, y }) => ({
				handle,
				x,
				y,
			})),
		})
		const after = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.find((node) => node.pointId === pointId)
		expect(after).toMatchObject({ x: next.x, y: next.y })
		expect(after?.incoming).toBeDefined()
		if (after?.incoming === undefined) return
		expect(after.x + after.incoming.x).toBeCloseTo(constraint.start.x)
		expect(after.y + after.incoming.y).toBeCloseTo(constraint.start.y)
	})

	it("matches isolated and mixed one-sided transform previews to commits", () => {
		const workspace = createEditorWorkspace()
		workspace.actions.enterGlyphEdit(0, oGlyphId)
		workspace.font.silo.setState(workspace.ui.activeMasterId, razorMasterId)
		const contour = workspace.document.glyphs.find(
			(glyph) => glyph.id === oGlyphId,
		)?.contours[0]
		const pointId = contour?.points[0]?.id
		const neighborId = contour?.points[1]?.id
		if (pointId === undefined || neighborId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const targetId of [pointId, neighborId]) {
			workspace.font.actions.deleteSelection({
				masterId: razorMasterId,
				glyphId: oGlyphId,
				pointIds: [],
				handles: [{ pointId: targetId, handle: "outgoing" }],
			})
			workspace.font.actions.setNodeMode({
				glyphId: oGlyphId,
				pointId: targetId,
				mode: "soft",
			})
		}
		const previewAndCommit = (
			deltas: readonly Readonly<{
				pointId: typeof pointId
				x: number
				y: number
			}>[],
		): void => {
			const activeContour = workspace.font.silo.getState(
				workspace.ui.activeLayer,
			)?.contours[0]
			if (activeContour?.tangentNodes === undefined) {
				throw new Error("Canonical tangent geometry is missing.")
			}
			const handles = deltas.map((delta) => {
				const node = activeContour.nodes.find(
					(candidate) => candidate.pointId === delta.pointId,
				)
				if (node?.incoming === undefined) {
					throw new Error("One-sided preview handle is missing.")
				}
				return {
					pointId: delta.pointId,
					handle: "incoming" as const,
					x: node.x + node.incoming.x + delta.x,
					y: node.y + node.incoming.y + delta.y,
				}
			})
			const result = { points: [], handles }
			const projected = projectSelectionTransformPreview(
				activeContour.tangentNodes,
				activeContour.closed,
				result,
			)
			workspace.font.actions.transformControls({
				masterId: razorMasterId,
				glyphId: oGlyphId,
				...result,
			})
			const committed = workspace.font.silo.getState(workspace.ui.activeLayer)
				?.contours[0]?.nodes
			for (const delta of deltas) {
				const previewNode = projected.find(
					(node) => node.pointId === delta.pointId,
				)
				const committedNode = committed?.find(
					(node) => node.pointId === delta.pointId,
				)
				if (
					previewNode?.incoming === undefined ||
					committedNode?.incoming === undefined
				) {
					throw new Error("Preview or committed handle is missing.")
				}
				expect(committedNode.x).toBeCloseTo(previewNode.x)
				expect(committedNode.y).toBeCloseTo(previewNode.y)
				expect(committedNode.incoming.x).toBeCloseTo(previewNode.incoming.x)
				expect(committedNode.incoming.y).toBeCloseTo(previewNode.incoming.y)
			}
		}

		previewAndCommit([{ pointId, x: 37, y: 53 }])
		previewAndCommit([
			{ pointId, x: -29, y: 17 },
			{ pointId: neighborId, x: 41, y: -23 },
		])
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
