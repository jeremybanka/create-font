import type { GlyphId, MasterId, PointId } from "@create-font/states"
import { describe, expect, it } from "vitest"

import { makeDemoFont } from "../src/demo-font.ts"
import {
	createEditorWorkspace,
	type EditorCanvasLayer,
} from "../src/editor-workspace.ts"
import {
	createFontVectorAdapter,
	createFontVectorDocumentAdapter,
	fontOutlineClipboardFromVector,
} from "../src/font-vector-adapter.ts"
import { vectorDocumentAdapterContract } from "../../../create-art/editor/tests/vector-document-adapter.contract.ts"

describe("font layer vector adapter", () => {
	it("commits compatible corner metadata across masters as one undoable edit", () => {
		const original = makeDemoFont()
		const originalGlyph = original.glyphs.find(
			(candidate) =>
				candidate.layers.length > 0 &&
				candidate.layers.every(
					(layer) =>
						layer.contours[0]?.closed === true &&
						layer.contours[0].points.length >= 3,
				),
		)
		if (originalGlyph === undefined)
			throw new Error("Compatible corner fixture is missing.")
		const source = {
			...original,
			glyphs: original.glyphs.map((glyph) =>
				glyph.id !== originalGlyph.id
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((candidateLayer) => ({
								...candidateLayer,
								contours: candidateLayer.contours.map(
									(candidateContour, index) => ({
										...candidateContour,
										points: candidateContour.points.map(
											(candidate, pointIndex) => {
												if (index !== 0 || pointIndex !== 0) return candidate
												const {
													incoming: _incoming,
													outgoing: _outgoing,
													...hard
												} = candidate
												return { ...hard, mode: "hard" as const }
											},
										),
									}),
								),
							})),
						},
			),
		}
		const glyph = source.glyphs.find(({ id }) => id === originalGlyph.id)
		const layer = glyph?.layers[0]
		const contour = layer?.contours[0]
		const point = contour?.points[0]
		if (
			glyph === undefined ||
			layer === undefined ||
			contour === undefined ||
			point === undefined
		)
			throw new Error("Compatible hard-corner fixture is missing.")
		const workspace = createEditorWorkspace(source)
		const adapter = createFontVectorAdapter(workspace, {
			glyphId: glyph.id,
			masterId: layer.masterId,
		})
		expect(
			adapter.apply({
				kind: "set-corner-profile",
				objectId: glyph.id,
				corners: [
					{
						contourId: contour.id,
						pointId: point.id,
						profile: "circular",
						amount: 12,
					},
				],
			}),
		).toEqual({ ok: true })
		const projected = workspace.font.read.editorGlyphSource(glyph.id)
		expect(
			projected?.layers.every(
				(candidateLayer) =>
					candidateLayer.contours[0]?.points[0]?.corner?.amount === 12,
			),
		).toBe(true)
		const compilation = workspace.font.read.compilation()
		expect(compilation.ok).toBe(true)
		if (compilation.ok) {
			const compiledGlyph = compilation.source.glyphs.find(
				(candidate) => candidate.name === glyph.name,
			)
			expect(compiledGlyph?.contours[0]?.length).toBeGreaterThan(
				contour.points.length,
			)
			expect(
				compiledGlyph?.variations.every(
					(variation) =>
						variation.deltas.points.length ===
						compiledGlyph.contours.flat().length,
				),
			).toBe(true)
		}
		workspace.font.undo(glyph.id)
		expect(
			workspace.font.read
				.editorGlyphSource(glyph.id)
				?.layers.every(
					(candidateLayer) =>
						candidateLayer.contours[0]?.points[0]?.corner === undefined,
				),
		).toBe(true)
		workspace.font.redo(glyph.id)
		expect(workspace.font.read.compilation().ok).toBe(true)
	})

	it("atomically rejects a corner that is collinear in one corresponding master", () => {
		const original = makeDemoFont()
		const originalGlyph = original.glyphs.find(
			(candidate) =>
				candidate.layers.length > 1 &&
				candidate.layers.every(
					(layer) =>
						layer.contours[0]?.closed === true &&
						layer.contours[0].points.length >= 3,
				),
		)
		if (originalGlyph === undefined)
			throw new Error("Compatible corner fixture is missing.")
		const source = {
			...original,
			glyphs: original.glyphs.map((glyph) =>
				glyph.id !== originalGlyph.id
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((layer, layerIndex) => ({
								...layer,
								contours: layer.contours.map((contour, contourIndex) => ({
									...contour,
									points: contour.points.map((point, pointIndex, points) => {
										if (contourIndex !== 0) return point
										const {
											incoming: _incoming,
											outgoing: _outgoing,
											...hard
										} = point
										const hardNode = { ...hard, mode: "hard" as const }
										if (pointIndex === 0) return { ...hardNode, x: 0, y: 0 }
										if (pointIndex === 1)
											return {
												...hardNode,
												x: layerIndex === 1 ? 100 : 0,
												y: layerIndex === 1 ? 0 : 100,
											}
										if (pointIndex === points.length - 1)
											return { ...hardNode, x: -100, y: 0 }
										return hardNode
									}),
								})),
							})),
						},
			),
		}
		const glyph = source.glyphs.find(({ id }) => id === originalGlyph.id)!
		const layer = glyph.layers[0]!
		const contour = layer.contours[0]!
		const point = contour.points[0]!
		const workspace = createEditorWorkspace(source)
		const result = createFontVectorAdapter(workspace, {
			glyphId: glyph.id,
			masterId: layer.masterId,
		}).apply({
			kind: "set-corner-profile",
			objectId: glyph.id,
			corners: [
				{
					contourId: contour.id,
					pointId: point.id,
					profile: "circular",
					amount: 12,
				},
			],
		})
		expect(result).toEqual({
			ok: false,
			error: expect.stringContaining("collinear-incidents"),
		})
		expect(
			workspace.font.read
				.editorGlyphSource(glyph.id)
				?.layers.every(
					(candidateLayer) =>
						candidateLayer.contours[0]?.points[0]?.corner === undefined,
				),
		).toBe(true)
		const imported = {
			...source,
			glyphs: source.glyphs.map((candidate) =>
				candidate.id !== glyph.id
					? candidate
					: {
							...candidate,
							layers: candidate.layers.map((candidateLayer) => ({
								...candidateLayer,
								contours: candidateLayer.contours.map(
									(candidateContour, contourIndex) => ({
										...candidateContour,
										points: candidateContour.points.map(
											(candidatePoint, pointIndex) =>
												contourIndex === 0 && pointIndex === 0
													? {
															...candidatePoint,
															corner: {
																profile: "circular" as const,
																amount: 12,
															},
														}
													: candidatePoint,
										),
									}),
								),
							})),
						},
			),
		}
		const compilation = createEditorWorkspace(imported).font.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage === "projection-failed")
			expect(
				compilation.projectionErrors.some(
					(error) => error.code === "geometry.corner_ineligible",
				),
			).toBe(true)
	})

	it("explicitly discards design appearance at the font outline boundary", () => {
		const outline = fontOutlineClipboardFromVector(
			{
				format: "create-vector.selection",
				version: 1,
				objects: [
					{
						id: "object:design",
						name: "Painted design object",
						style: {
							kind: "fill",
							swatchId: "swatch:coral",
							resolvedCss: "rgb(218 94 67)",
							source: { space: "rgb", r: 218, g: 94, b: 67 },
						},
						contours: [
							{
								id: "contour:design",
								closed: false,
								nodes: [
									{
										id: "point:design",
										mode: "hard",
										x: 10,
										y: 20,
									},
								],
							},
						],
					},
				],
			},
			"master:regular" as MasterId,
		)
		expect(outline.sourceApplication).toBe("create-design")
		expect(outline.layers[0]?.points[0]).toMatchObject({ x: 10, y: 20 })
		expect(JSON.stringify(outline)).not.toContain("swatch:coral")
		expect(JSON.stringify(outline)).not.toContain("resolvedCss")
	})

	it("projects opaque contour/point IDs with neutral style and clipboard geometry", () => {
		const source = makeDemoFont()
		const glyph = source.glyphs.find((candidate) =>
			candidate.layers.some((layer) => layer.contours.length > 0),
		)
		const layer = glyph?.layers[0]
		const contour = layer?.contours[0]
		const point = contour?.points[0]
		if (
			glyph === undefined ||
			layer === undefined ||
			contour === undefined ||
			point === undefined
		)
			throw new Error("Demo outline fixture is missing.")
		const canvasLayer = {
			masterId: layer.masterId,
			glyphId: glyph.id,
			contours: layer.contours.map((item) => ({
				id: item.id,
				closed: item.closed,
				nodes: item.points.map((node) => ({
					pointId: node.id,
					mode: node.mode,
					x: node.x,
					y: node.y,
					...(node.incoming === undefined ? {} : { incoming: node.incoming }),
					...(node.outgoing === undefined ? {} : { outgoing: node.outgoing }),
				})),
			})),
			advanceWidth: layer.advanceWidth,
			leftSideBearing: layer.leftSideBearing,
			xMin: 0,
			xMax: 100,
			outlineWidth: 100,
			rightSideBearing: 0,
		}
		const adapter = createFontVectorAdapter(createEditorWorkspace(source), {
			glyphId: glyph.id,
			masterId: layer.masterId,
		})
		const snapshot = adapter.project(canvasLayer, [
			{ kind: "node", pointId: point.id },
		])
		const object = snapshot.objects[0]
		if (object === undefined)
			throw new Error("Projected vector object is missing.")
		expect(object.style).toEqual({ kind: "neutral" })
		expect(object.contours[0]?.id).toBe(contour.id)
		expect(snapshot.selection).toEqual([
			{
				kind: "node",
				objectId: glyph.id,
				contourId: contour.id,
				pointId: point.id,
			},
		])
		expect(
			adapter.clipboard(canvasLayer, [{ kind: "node", pointId: point.id }])
				.objects[0]?.contours[0]?.nodes,
		).toHaveLength(1)
	})

	it("commits a transform atomically through glyph history and reports rejection", () => {
		const source = makeDemoFont()
		const glyph = source.glyphs.find((candidate) =>
			candidate.layers.some((layer) => layer.contours.length > 0),
		)
		const layer = glyph?.layers[0]
		const point = layer?.contours[0]?.points[0]
		if (glyph === undefined || layer === undefined || point === undefined)
			throw new Error("Demo outline fixture is missing.")
		const workspace = createEditorWorkspace(source)
		const context = {
			glyphId: glyph.id as GlyphId,
			masterId: layer.masterId as MasterId,
		}
		const adapter = createFontVectorAdapter(workspace, context)
		const result = adapter.apply({
			kind: "transform-controls",
			points: [{ pointId: point.id, x: point.x + 17, y: point.y - 9 }],
			handles: [],
		})
		expect(result).toEqual({ ok: true })
		const moved = workspace.font.read.layerNode(
			context.masterId,
			context.glyphId,
			point.id as PointId,
		)
		if (!moved.ok) throw new Error("Moved point projection failed.")
		expect(moved.value).toMatchObject({ x: point.x + 17, y: point.y - 9 })
		workspace.font.undo(context.glyphId)
		const restored = workspace.font.read.layerNode(
			context.masterId,
			context.glyphId,
			point.id as PointId,
		)
		if (!restored.ok) throw new Error("Restored point projection failed.")
		expect(restored.value).toMatchObject({ x: point.x, y: point.y })
		expect(
			adapter.apply({
				kind: "transform-controls",
				points: [{ pointId: "point:missing", x: 0, y: 0 }],
				handles: [],
			}),
		).toMatchObject({ ok: false })
	})

	it("routes Pen and shape topology intents through domain IDs and glyph history", () => {
		const source = makeDemoFont()
		const glyph = source.glyphs[0]
		const layer = glyph?.layers[0]
		if (glyph === undefined || layer === undefined)
			throw new Error("Demo glyph fixture is missing.")
		const workspace = createEditorWorkspace(source)
		const context = { glyphId: glyph.id, masterId: layer.masterId }
		const adapter = createFontVectorAdapter(workspace, context)
		const contourId = `contour:${glyph.id}:contract`
		const point = (index: number, x: number, y: number) => ({
			id: `point:${glyph.id}:contract:${index}`,
			mode: "hard" as const,
			x,
			y,
		})
		const first = point(0, 20, 30)
		const variants = source.masters.map((master) => ({
			variantId: master.id,
			nodes: [{ ...first, variantId: master.id }],
		}))
		expect(
			adapter.apply({
				kind: "create-contour",
				objectId: glyph.id,
				contour: { id: contourId, closed: false, nodes: [first] },
				variants,
			}),
		).toEqual({ ok: true })
		for (const [index, coordinates] of [
			[1, { x: 90, y: 30 }],
			[2, { x: 90, y: 100 }],
		] as const) {
			const node = point(index, coordinates.x, coordinates.y)
			expect(
				adapter.apply({
					kind: "insert-node",
					objectId: glyph.id,
					contourId,
					node,
					variants: source.masters.map((master) => ({
						...node,
						variantId: master.id,
					})),
				}),
			).toEqual({ ok: true })
		}
		expect(
			adapter.apply({
				kind: "close-contour",
				objectId: glyph.id,
				contourId,
			}),
		).toEqual({ ok: true })
		expect(
			workspace.font.read
				.editorGlyphSource(glyph.id)
				?.layers[0]?.contours.find((contour) => contour.id === contourId)
				?.closed,
		).toBe(true)
		workspace.font.undo(glyph.id)
		expect(
			workspace.font.read
				.editorGlyphSource(glyph.id)
				?.layers[0]?.contours.find((contour) => contour.id === contourId)
				?.closed,
		).toBe(false)
	})
})

vectorDocumentAdapterContract("font", () => {
	const source = makeDemoFont()
	const glyph = source.glyphs.find((candidate) =>
		candidate.layers.some((layer) => layer.contours.length > 0),
	)
	const sourceLayer = glyph?.layers[0]
	const sourcePoint = sourceLayer?.contours[0]?.points[0]
	if (
		glyph === undefined ||
		sourceLayer === undefined ||
		sourcePoint === undefined
	)
		throw new Error("Demo outline fixture is missing.")
	const workspace = createEditorWorkspace(source)
	workspace.font.silo.setState(workspace.ui.selectedGlyphId, glyph.id)
	workspace.font.silo.setState(
		workspace.ui.activeMasterId,
		sourceLayer.masterId,
	)
	const document: EditorCanvasLayer = {
		masterId: sourceLayer.masterId,
		glyphId: glyph.id,
		contours: sourceLayer.contours.map((contour) => ({
			id: contour.id,
			closed: contour.closed,
			nodes: contour.points.map((point) => ({
				pointId: point.id,
				mode: point.mode,
				x: point.x,
				y: point.y,
				...(point.incoming === undefined ? {} : { incoming: point.incoming }),
				...(point.outgoing === undefined ? {} : { outgoing: point.outgoing }),
			})),
		})),
		advanceWidth: sourceLayer.advanceWidth,
		leftSideBearing: sourceLayer.leftSideBearing,
		xMin: 0,
		xMax: 0,
		outlineWidth: 0,
		rightSideBearing: 0,
	}
	const selection = Object.freeze([
		{ kind: "node" as const, pointId: sourcePoint.id },
	])
	return {
		adapter: createFontVectorDocumentAdapter(workspace, {
			glyphId: glyph.id,
			masterId: sourceLayer.masterId,
		}),
		document,
		selection,
		selectedObjectId: glyph.id,
		update: () => ({
			kind: "transform-controls" as const,
			points: [
				{
					pointId: sourcePoint.id,
					x: sourcePoint.x + 13,
					y: sourcePoint.y - 7,
				},
			],
			handles: [],
		}),
		remove: (_object, projectedSelection) => ({
			kind: "delete" as const,
			objectIds: [],
			controls: projectedSelection,
		}),
		invalid: {
			kind: "transform-controls" as const,
			points: [{ pointId: "point:missing", x: 0, y: 0 }],
			handles: [],
		},
		assertUpdated: (layer: typeof document) => {
			expect(
				layer.contours
					.flatMap((contour) => contour.nodes)
					.find((point) => point.pointId === sourcePoint.id),
			).toMatchObject({ x: sourcePoint.x + 13, y: sourcePoint.y - 7 })
		},
		assertDeleted: (layer: typeof document) => {
			expect(
				layer.contours
					.flatMap((contour) => contour.nodes)
					.some((point) => point.pointId === sourcePoint.id),
			).toBe(false)
		},
	}
})
