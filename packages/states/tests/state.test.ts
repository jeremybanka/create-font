import { describe, expect, it } from "vitest"

import { createFontEditorState } from "../src/index.ts"
import {
	blackMasterId,
	makeGeometricOEditorFont,
	notdefGlyphId,
	oGlyphId,
	razorMasterId,
} from "./fixtures/geometric-o.ts"

function createLoadedEditor(key: string) {
	const editor = createFontEditorState({ key })
	editor.actions.load(makeGeometricOEditorFont())
	return editor
}

describe("font editor state", () => {
	it("projects the Razor/Black geometric O through trigraph ingestion", () => {
		const editor = createLoadedEditor("test/compile")
		const compilation = editor.read.compilation()

		expect(compilation.stage).toBe("compiled")
		if (!compilation.ok) return
		expect(compilation.source.axes).toEqual([
			{
				tag: "wght",
				name: "Weight",
				min: 100,
				default: 100,
				max: 900,
				hidden: false,
			},
		])
		expect(compilation.source.glyphs.map((glyph) => glyph.name)).toEqual([
			".notdef",
			"O",
		])
		expect(compilation.source.cmap).toEqual([{ codePoint: 0x4f, glyph: 1 }])

		const glyph = compilation.source.glyphs[1]
		expect(glyph?.contours).toHaveLength(2)
		expect(glyph?.contours.flat()).toHaveLength(16)
		expect(glyph?.variations).toHaveLength(1)
		expect(glyph?.variations[0]?.region).toEqual({ peak: { wght: 1 } })
		expect(glyph?.variations[0]?.deltas.points.slice(0, 8)).toEqual(
			Array.from({ length: 8 }, () => ({ x: 0, y: 0 })),
		)
		expect(glyph?.variations[0]?.deltas.points[8]).toEqual({ x: 0, y: -320 })
		expect(glyph?.variations[0]?.deltas.points[9]).toEqual({ x: 320, y: -320 })
		expect(glyph?.variations[0]?.deltas.phantom).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		})
	})

	it("round-trips serializable editor state", () => {
		const source = makeGeometricOEditorFont()
		const editor = createFontEditorState({ key: "test/round-trip" })

		expect(editor.read.editorSource()).toBeNull()
		editor.actions.load(source)
		expect(editor.read.editorSource()).toEqual(source)
	})

	it("keeps documents isolated even when their entity IDs match", () => {
		const first = createLoadedEditor("test/isolation/a")
		const second = createLoadedEditor("test/isolation/b")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[1]?.points[1]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")

		second.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 777, y: 444 }],
		})

		expect(
			first.silo.getState(first.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(460)
		expect(
			second.silo.getState(second.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(777)
	})

	it("records a multi-coordinate drag as undoable document history", () => {
		const editor = createLoadedEditor("test/history")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[1]?.points[1]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 700, y: 350 }],
		})
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(700)
		expect(
			editor.silo.getState(editor.atoms.pointY, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(350)

		editor.undo()
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(460)
		expect(
			editor.silo.getState(editor.atoms.pointY, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(440)

		editor.redo()
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(700)
	})

	it("inserts one shared point with coordinates in every layer", () => {
		const editor = createLoadedEditor("test/insert")
		const contourId = makeGeometricOEditorFont().glyphs[1]?.contours[0]?.id
		if (contourId === undefined) throw new Error("Fixture contour is missing.")

		editor.actions.insertPoint({
			glyphId: oGlyphId,
			contourId,
			at: 1,
			point: { id: "point:glyph:O:inserted", onCurve: true },
			coordinates: [
				{ masterId: razorMasterId, x: 700, y: 800 },
				{ masterId: blackMasterId, x: 700, y: 800 },
			],
		})

		const inserted = editor.silo.getState(editor.atoms.contourPointIds, [
			oGlyphId,
			contourId,
		])
		expect(inserted?.[1]).toBe("point:glyph:O:inserted")
		expect(editor.read.compilation().stage).toBe("compiled")

		editor.undo()
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).not.toContain("point:glyph:O:inserted")
	})

	it("derives horizontal phantom deltas from layer metrics", () => {
		const source = makeGeometricOEditorFont()
		for (const glyph of source.glyphs) {
			const layer = glyph.layers.find(
				(candidate) => candidate.masterId === blackMasterId,
			)
			if (layer === undefined) throw new Error("Black layer is missing.")
			Object.assign(layer, { advanceWidth: 1_100, leftSideBearing: 80 })
		}
		const editor = createFontEditorState({ key: "test/phantom" })
		editor.actions.load(source)

		const glyph = editor.read.glyphSource(oGlyphId)
		expect(glyph.ok).toBe(true)
		if (!glyph.ok) return
		expect(glyph.value.variations[0]?.deltas.phantom).toEqual({
			left: 20,
			right: 120,
			top: 0,
			bottom: 0,
		})
	})

	it("reports incomplete layers as projection failures", () => {
		const source = makeGeometricOEditorFont()
		const glyph = source.glyphs.find((candidate) => candidate.id === oGlyphId)
		const layer = glyph?.layers.find(
			(candidate) => candidate.masterId === blackMasterId,
		)
		if (layer === undefined) throw new Error("Black layer is missing.")
		Object.assign(layer, { points: layer.points.slice(1) })
		const editor = createFontEditorState({ key: "test/incomplete" })
		editor.actions.load(source)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage !== "projection-failed") return
		expect(compilation.projectionErrors).toContainEqual(
			expect.objectContaining({ code: "number.missing_or_nonfinite" }),
		)
	})

	it("keeps low-level ingestion failures distinct from projection failures", () => {
		const source = makeGeometricOEditorFont()
		Object.assign(source.names, { family: "" })
		const editor = createFontEditorState({ key: "test/ingestion" })
		editor.actions.load(source)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("ingestion-failed")
		if (compilation.stage !== "ingestion-failed") return
		expect(compilation.ingestionErrors).toContainEqual(
			expect.objectContaining({ code: "name.empty", path: "$.names.family" }),
		)
	})

	it("can atomically replace a loaded document", () => {
		const editor = createLoadedEditor("test/replace")
		const replacement = makeGeometricOEditorFont()
		Object.assign(replacement.names, { family: "Replacement O" })

		editor.actions.load(replacement)

		expect(editor.read.editorSource()?.names.family).toBe("Replacement O")
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("invalidates same-ID derived selectors when replacing geometry", () => {
		const editor = createLoadedEditor("test/replace-same-ids")
		const before = editor.read.glyphSource(oGlyphId)
		expect(before.ok && before.value.variations[0]?.deltas.points[8]?.y).toBe(
			-320,
		)

		const replacement = makeGeometricOEditorFont()
		const glyph = replacement.glyphs.find(
			(candidate) => candidate.id === oGlyphId,
		)
		const layer = glyph?.layers.find(
			(candidate) => candidate.masterId === blackMasterId,
		)
		const point = layer?.points[8]
		if (point === undefined) throw new Error("Replacement point is missing.")
		Object.assign(point, { y: 400 })

		editor.actions.load(replacement)

		const after = editor.read.glyphSource(oGlyphId)
		expect(after.ok && after.value.variations[0]?.deltas.points[8]?.y).toBe(
			-360,
		)
	})

	it("snapshots caller-owned input and freezes cached projections", () => {
		const source = makeGeometricOEditorFont()
		const editor = createFontEditorState({ key: "test/ownership" })
		editor.actions.load(source)
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("compiled")
		if (!compilation.ok) return

		Object.assign(source.names, { family: "Caller mutation" })

		expect(Object.isFrozen(source.names)).toBe(false)
		expect(editor.read.editorSource()?.names.family).toBe("Trigraph O Razor")
		expect(editor.read.compilation()).toBe(compilation)
		expect(compilation.source.names.family).toBe("Trigraph O Razor")
		expect(Object.isFrozen(compilation.source)).toBe(true)
		expect(Object.isFrozen(compilation.source.glyphs[1]?.contours)).toBe(true)
		expect(() =>
			Object.assign(compilation.source.names, { family: "Cache mutation" }),
		).toThrow()
	})

	it("does not serialize a half-present coordinate pair", () => {
		const editor = createLoadedEditor("test/partial-coordinate")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")

		editor.silo.setState(
			editor.atoms.pointY,
			[blackMasterId, oGlyphId, pointId],
			null,
		)

		expect(editor.read.editorSource()).toBeNull()
		expect(editor.read.compilation().stage).toBe("projection-failed")
	})

	it("diagnoses topology corruption even through the raw atom surface", () => {
		const editor = createLoadedEditor("test/topology-invariant")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const firstPointId = contour?.points[0]?.id
		if (contour === undefined || firstPointId === undefined) {
			throw new Error("Fixture topology is missing.")
		}
		editor.silo.setState(
			editor.atoms.contourPointIds,
			[oGlyphId, contour.id],
			[
				firstPointId,
				firstPointId,
				...contour.points.slice(2).map(({ id }) => id),
			],
		)

		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage !== "projection-failed") return
		expect(compilation.projectionErrors).toContainEqual(
			expect.objectContaining({ code: "topology.duplicate_point" }),
		)
		expect(editor.read.editorSource()).toBeNull()
	})

	it("keeps editor-only annotations out of lowering dependencies", () => {
		const editor = createLoadedEditor("test/editor-only")
		const glyphBefore = editor.read.glyphSource(oGlyphId)
		const layerBefore = editor.read.glyphLayer(blackMasterId, oGlyphId)
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")

		editor.silo.setState(editor.atoms.glyphEditor, oGlyphId, {
			note: "Selected for review",
			color: "#ff00ff",
		})
		editor.silo.setState(editor.atoms.pointEditor, [oGlyphId, pointId], {
			smooth: true,
		})

		expect(editor.read.glyphSource(oGlyphId)).toBe(glyphBefore)
		expect(editor.read.glyphLayer(blackMasterId, oGlyphId)).toBe(layerBefore)
		expect(editor.read.editorSource()?.glyphs[1]?.note).toBe(
			"Selected for review",
		)
	})

	it("rejects structurally ambiguous documents without a partial write", () => {
		const editor = createLoadedEditor("test/atomic-load")
		const malformed = makeGeometricOEditorFont()
		Object.assign(malformed, {
			glyphs: malformed.glyphs.map((glyph, index) =>
				index === 1 ? { ...glyph, id: notdefGlyphId } : glyph,
			),
		})

		expect(() => editor.actions.load(malformed)).toThrow(/Glyph IDs/)
		expect(editor.read.editorSource()?.glyphs[1]?.id).toBe(oGlyphId)
	})
})
