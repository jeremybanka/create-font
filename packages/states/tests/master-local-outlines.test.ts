import { describe, expect, it } from "vitest"

import {
	createFontEditorState,
	isLivePreviewCompatibilityError,
	type ContourId,
	type PointId,
} from "../src/index.ts"
import {
	blackMasterId,
	makeGeometricOEditorFont,
	oGlyphId,
	razorMasterId,
} from "./fixtures/geometric-o.ts"

function loadedEditor(key: string) {
	const editor = createFontEditorState({ key })
	editor.actions.load(makeGeometricOEditorFont())
	return editor
}

describe("master-local outlines", () => {
	it("edits topology only in the requested master", () => {
		const editor = loadedEditor("master-local/topology")
		const before = editor.read.editorGlyphSource(oGlyphId)
		const razorContour = before?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]
		const blackContour = before?.layers.find(
			(layer) => layer.masterId === blackMasterId,
		)?.contours[0]
		if (razorContour === undefined || blackContour === undefined)
			throw new Error("Fixture contours are missing.")

		editor.actions.insertPoint({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			contourId: razorContour.id,
			at: 1,
			point: { id: "point:glyph:O:razor-only" as PointId, mode: "hard" },
			coordinates: [{ masterId: razorMasterId, x: 700, y: 800 }],
		})

		const after = editor.read.editorGlyphSource(oGlyphId)
		expect(
			after?.layers.find((layer) => layer.masterId === razorMasterId)
				?.contours[0]?.points,
		).toHaveLength(5)
		expect(
			after?.layers.find((layer) => layer.masterId === blackMasterId)
				?.contours[0],
		).toEqual(blackContour)
	})

	it("reports ordinal path and node incompatibilities with stable locations", () => {
		const original = makeGeometricOEditorFont()
		const source = {
			...original,
			glyphs: original.glyphs.map((glyph) =>
				glyph.id !== oGlyphId
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((layer) =>
								layer.masterId !== blackMasterId
									? layer
									: {
											...layer,
											contours: layer.contours.map((contour, pathIndex) =>
												pathIndex === 0
													? { ...contour, points: contour.points.slice(0, -1) }
													: contour,
											),
										},
							),
						},
			),
		}

		const editor = createFontEditorState({ key: "master-local/compatibility" })
		editor.actions.load(source)
		const result = editor.read.glyphCompatibility(
			razorMasterId,
			blackMasterId,
			oGlyphId,
		)

		expect(result.compatible).toBe(false)
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "node-count",
					reference: expect.objectContaining({
						masterId: razorMasterId,
						pathIndex: 0,
					}),
					comparison: expect.objectContaining({
						masterId: blackMasterId,
						pathIndex: 0,
					}),
				}),
			]),
		)
		expect(editor.read.compilation().ok).toBe(false)
	})

	it("restacks one master's paths as one undoable edit", () => {
		const editor = loadedEditor("master-local/reorder")
		const before = editor.read.editorGlyphSource(oGlyphId)
		const razor = before?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)
		const black = before?.layers.find(
			(layer) => layer.masterId === blackMasterId,
		)
		const moved = razor?.contours[1]?.id
		if (razor === undefined || black === undefined || moved === undefined)
			throw new Error("Fixture paths are missing.")

		editor.actions.reorderContour({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			contourId: moved,
			toIndex: 0,
		})
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId)
				?.contours.map((contour) => contour.id),
		).toEqual([moved, razor.contours[0]?.id])
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)?.contours,
		).toEqual(black.contours)

		editor.undo(oGlyphId)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId)
				?.contours.map((contour) => contour.id),
		).toEqual(razor.contours.map((contour) => contour.id))
	})

	it("preserves authored path count and order in layer projection", () => {
		const editor = loadedEditor("master-local/path-preservation")
		const sourceLayer = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === razorMasterId)
		const projected = editor.read.glyphLayer(razorMasterId, oGlyphId)
		if (sourceLayer === undefined || !projected.ok)
			throw new Error("Fixture layer did not project.")

		expect(projected.value.contours).toHaveLength(sourceLayer.contours.length)
		expect(projected.value.contours.map((contour) => contour[0])).toEqual(
			sourceLayer.contours.map((contour) => {
				const first = contour.points[0]
				return first === undefined
					? undefined
					: { x: first.x, y: first.y, onCurve: true }
			}),
		)
	})

	it("allows master-local contour and point identifiers", () => {
		const original = makeGeometricOEditorFont()
		const source = {
			...original,
			glyphs: original.glyphs.map((glyph) =>
				glyph.id !== oGlyphId
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((layer) =>
								layer.masterId !== blackMasterId
									? layer
									: {
											...layer,
											contours: layer.contours.map((contour, pathIndex) => ({
												id: `contour:black:${pathIndex}` as ContourId,
												closed: contour.closed,
												points: contour.points.map((point, nodeIndex) => ({
													...point,
													id: `point:black:${pathIndex}:${nodeIndex}` as PointId,
												})),
											})),
										},
							),
						},
			),
		}

		const editor = createFontEditorState({ key: "master-local/identifiers" })
		expect(() => editor.actions.load(source)).not.toThrow()
		expect(
			editor.read.glyphCompatibility(razorMasterId, blackMasterId, oGlyphId)
				.compatible,
		).toBe(true)
	})

	it("freezes only incompatible glyphs in live preview while strict compilation stays strict", () => {
		const original = makeGeometricOEditorFont()
		const source = {
			...original,
			glyphs: original.glyphs.map((glyph) =>
				glyph.id !== oGlyphId
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((layer) =>
								layer.masterId !== blackMasterId
									? layer
									: {
											...layer,
											contours: layer.contours.map((contour, pathIndex) =>
												pathIndex === 0
													? { ...contour, points: contour.points.slice(0, -1) }
													: contour,
											),
										},
							),
						},
			),
		}
		const editor = createFontEditorState({ key: "master-local/live-fallback" })
		editor.actions.load(source)

		const strict = editor.read.compilation()
		expect(strict).toMatchObject({
			ok: false,
			stage: "projection-failed",
		})
		if (strict.ok || strict.stage !== "projection-failed")
			throw new Error("Strict compilation unexpectedly succeeded.")
		expect(strict.projectionErrors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "compatibility.node_count" }),
			]),
		)

		const live = editor.read.livePreviewCompilation()
		if (!live.ok)
			throw new Error(
				`Best-effort live compilation failed: ${JSON.stringify(live)}`,
			)
		const frozen = live.source.glyphs.find((glyph) => glyph.name === "O")
		const compatible = live.source.glyphs.find(
			(glyph) => glyph.name === ".notdef",
		)
		expect(frozen).toMatchObject({
			advanceWidth: 1_000,
			variations: [],
		})
		expect(compatible?.variations.length).toBeGreaterThan(0)
		expect(live.projectionWarnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "compatibility.node_count",
					entityId: oGlyphId,
					severity: "warning",
				}),
			]),
		)

		editor.actions.load(original)
		const recovered = editor.read.livePreviewCompilation()
		if (!recovered.ok) throw new Error("Live compilation did not recover.")
		expect(
			recovered.source.glyphs.find((glyph) => glyph.name === "O")?.variations
				.length,
		).toBeGreaterThan(0)
		expect(
			recovered.projectionWarnings.some((warning) =>
				warning.code.startsWith("compatibility."),
			),
		).toBe(false)
	})

	it("allowlists every typed topology compatibility error and nothing broader", () => {
		for (const code of [
			"compatibility.path_count",
			"compatibility.closure",
			"compatibility.node_count",
			"compatibility.flattened_count",
			"compatibility.flattened_pattern",
		]) {
			expect(isLivePreviewCompatibilityError({ code })).toBe(true)
		}
		for (const code of [
			"topology.open_contour",
			"curve.approximation_limit",
			"entity.missing",
			"compatibility.future_unknown",
		]) {
			expect(isLivePreviewCompatibilityError({ code })).toBe(false)
		}
	})
})
