import { describe, expect, it } from "vitest"

import { createFontEditorState } from "../src/index.ts"
import {
	blackMasterId,
	makeGeometricOEditorFont,
	notdefGlyphId,
	oGlyphId,
	razorMasterId,
} from "./fixtures/geometric-o.ts"

function loaded(key: string) {
	const editor = createFontEditorState({ key })
	editor.actions.load(makeGeometricOEditorFont())
	return editor
}

function firstPoint(
	editor: ReturnType<typeof loaded>,
	masterId: typeof razorMasterId | typeof blackMasterId,
) {
	const glyph = editor.read.editorGlyphSource(oGlyphId)
	const point = glyph?.layers.find((layer) => layer.masterId === masterId)
		?.contours[0]?.points[0]
	if (point === undefined) throw new Error("Fixture point is missing.")
	return point
}

function firstContourPoints(
	editor: ReturnType<typeof loaded>,
	masterId: typeof razorMasterId | typeof blackMasterId,
) {
	const glyph = editor.read.editorGlyphSource(oGlyphId)
	const points = glyph?.layers.find((layer) => layer.masterId === masterId)
		?.contours[0]?.points
	if (points === undefined) throw new Error("Fixture points are missing.")
	return points
}

describe("font editor state", () => {
	it("persists glyph rules in history while excluding them from compilation", () => {
		const editor = loaded("state/rules")
		const rule = {
			id: "rule:measure" as const,
			a: { x: 0, y: 50 },
			b: { x: 500, y: 50 },
		}
		editor.actions.setGlyphRules({ glyphId: oGlyphId, rules: [rule] })
		expect(editor.read.editorGlyphSource(oGlyphId)?.rules).toEqual([rule])
		const compilation = editor.read.compilation()
		expect(compilation.ok).toBe(true)
		if (compilation.ok)
			expect(compilation.source.glyphs[1]).not.toHaveProperty("rules")
		editor.undo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)?.rules).toBeUndefined()
		editor.redo(oGlyphId)
		expect(editor.read.editorGlyphSource(oGlyphId)?.rules).toEqual([rule])
	})

	it("projects the compatible geometric O through target ingestion", () => {
		const compilation = loaded("state/compile").read.compilation()
		expect(compilation.stage).toBe("compiled")
		if (!compilation.ok) return
		expect(compilation.source.glyphs.map((glyph) => glyph.name)).toEqual([
			".notdef",
			"O",
		])
		expect(compilation.source.glyphs[1]?.contours).toHaveLength(2)
		expect(compilation.source.glyphs[1]?.variations).toHaveLength(1)
	})

	it("serializes complete layer-local outlines as editor source v5", () => {
		const source = loaded("state/serialize").read.editorSource()
		expect(source?.editorVersion).toBe(5)
		expect(source?.glyphs[1]).not.toHaveProperty("contours")
		expect(source?.glyphs[1]?.layers).toHaveLength(2)
		expect(source?.glyphs[1]?.layers[0]?.contours[0]?.points[0]).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(/^point:/),
				mode: "soft",
				x: expect.any(Number),
				y: expect.any(Number),
			}),
		)
	})

	it("moves coordinates only in the requested master", () => {
		const editor = loaded("state/move-master")
		const black = firstPoint(editor, blackMasterId)
		const razor = firstPoint(editor, razorMasterId)
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: black.id, x: black.x + 19, y: black.y - 7 }],
		})
		expect(firstPoint(editor, blackMasterId)).toEqual(
			expect.objectContaining({ x: black.x + 19, y: black.y - 7 }),
		)
		expect(firstPoint(editor, razorMasterId)).toEqual(razor)
	})

	it("keeps point and metric subscriptions isolated by coherent state boundary", () => {
		const editor = loaded("state/geometry-boundaries")
		const [movedPoint, unaffectedPoint] = firstContourPoints(
			editor,
			blackMasterId,
		)
		if (movedPoint === undefined || unaffectedPoint === undefined) {
			throw new Error("Fixture points are missing.")
		}
		let movedNotifications = 0
		let unaffectedNotifications = 0
		let metricNotifications = 0
		const movedPosition = editor.silo.findState(editor.atoms.pointPosition, [
			blackMasterId,
			oGlyphId,
			movedPoint.id,
		])
		const unaffectedPosition = editor.silo.findState(
			editor.atoms.pointPosition,
			[blackMasterId, oGlyphId, unaffectedPoint.id],
		)
		const advanceWidth = editor.silo.findState(editor.atoms.advanceWidth, [
			blackMasterId,
			oGlyphId,
		])
		const unsubscribeMoved = editor.silo.subscribe(movedPosition, () => {
			movedNotifications++
		})
		const unsubscribeUnaffected = editor.silo.subscribe(
			unaffectedPosition,
			() => {
				unaffectedNotifications++
			},
		)
		const unsubscribeMetric = editor.silo.subscribe(advanceWidth, () => {
			metricNotifications++
		})

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [
				{ pointId: movedPoint.id, x: movedPoint.x + 7, y: movedPoint.y - 3 },
			],
		})

		expect(movedNotifications).toBe(1)
		expect(unaffectedNotifications).toBe(0)
		expect(metricNotifications).toBe(0)
		unsubscribeMoved()
		unsubscribeUnaffected()
		unsubscribeMetric()
	})

	it("preserves writable selector-family geometry facades", () => {
		const editor = loaded("state/geometry-facades")
		const point = firstPoint(editor, blackMasterId)
		const pointKey = [blackMasterId, oGlyphId, point.id] as const
		const layerKey = [blackMasterId, oGlyphId] as const
		const nextPosition = { x: point.x + 3, y: point.y - 4 }

		expect(editor.atoms.advanceWidth.type).toBe("writable_pure_selector_family")
		expect(editor.atoms.pointPosition.type).toBe(
			"writable_pure_selector_family",
		)
		editor.silo.setState(editor.atoms.pointPosition, pointKey, nextPosition)
		editor.silo.setState(editor.atoms.advanceWidth, layerKey, 777)

		expect(editor.silo.getState(editor.atoms.pointPosition, pointKey)).toBe(
			nextPosition,
		)
		expect(Object.isFrozen(nextPosition)).toBe(true)
		expect(editor.silo.getState(editor.atoms.advanceWidth, layerKey)).toBe(777)
	})

	it("advances revision inside direct core transactions", () => {
		const editor = loaded("state/direct-transaction-revision")
		const point = firstPoint(editor, blackMasterId)
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const sourceBefore = editor.read.editorSource()
		const runMovePoints = editor.silo.runTransaction(
			editor.transactions.movePoints,
		)

		runMovePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 11, y: point.y + 2 }],
		})

		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(
			revision + 1,
		)
		const sourceAfter = editor.read.editorSource()
		expect(sourceAfter).not.toBe(sourceBefore)
		expect(firstPoint(editor, blackMasterId)).toEqual(
			expect.objectContaining({ x: point.x + 11, y: point.y + 2 }),
		)
	})

	it("rolls revision back when a direct core transaction fails", () => {
		const editor = loaded("state/failed-transaction-revision")
		const point = firstPoint(editor, blackMasterId)
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const runMovePoints = editor.silo.runTransaction(
			editor.transactions.movePoints,
		)

		expect(() =>
			runMovePoints({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				points: [{ pointId: point.id, x: Number.NaN, y: point.y }],
			}),
		).toThrow("Point coordinates must be finite numbers.")
		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(revision)
		expect(firstPoint(editor, blackMasterId)).toEqual(point)
	})

	it("undoes a multi-point transaction as one glyph-history entry", () => {
		const editor = loaded("state/multi-point-history")
		const [first, second] = firstContourPoints(editor, blackMasterId)
		if (first === undefined || second === undefined) {
			throw new Error("Fixture points are missing.")
		}

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [
				{ pointId: first.id, x: first.x + 5, y: first.y },
				{ pointId: second.id, x: second.x, y: second.y - 8 },
			],
		})
		editor.undo(oGlyphId)

		const [restoredFirst, restoredSecond] = firstContourPoints(
			editor,
			blackMasterId,
		)
		expect(restoredFirst).toEqual(first)
		expect(restoredSecond).toEqual(second)
	})

	it("clears glyph and kerning histories after whole-document replacement", () => {
		const editor = loaded("state/replacement-history")
		const point = firstPoint(editor, blackMasterId)
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 23, y: point.y }],
		})
		editor.actions.setKerningPair({
			left: oGlyphId,
			right: oGlyphId,
			value: -20,
		})
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toEqual({ at: 1, length: 1 })
		expect(editor.silo.inspectTimeline(editor.kerningTimeline)).toEqual({
			at: 1,
			length: 1,
		})

		editor.actions.load(makeGeometricOEditorFont())
		const replacementPoint = firstPoint(editor, blackMasterId)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toEqual({ at: 0, length: 0 })
		expect(editor.silo.inspectTimeline(editor.kerningTimeline)).toEqual({
			at: 0,
			length: 0,
		})

		editor.undo(oGlyphId)
		editor.actions.undoKerning()
		expect(firstPoint(editor, blackMasterId)).toEqual(replacementPoint)
		expect(editor.silo.getState(editor.atoms.kerning)).toEqual([])
	})

	it("publishes reconciled state coherently at one revision boundary", () => {
		const editor = loaded("state/reconciled-load")
		const externalAtom = editor.silo.atom<string>({
			key: "reconciledSource",
			default: "before",
		})
		const source = makeGeometricOEditorFont()
		const replacement = {
			...source,
			names: { ...source.names, family: "Coherent Replacement" },
		}
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const observations: {
			readonly revision: number
			readonly family: string | undefined
			readonly external: string
		}[] = []
		const unsubscribe = editor.silo.subscribe(
			editor.atoms.documentRevision,
			() => {
				observations.push({
					revision: editor.silo.getState(editor.atoms.documentRevision),
					family: editor.read.editorSource()?.names.family,
					external: editor.silo.getState(externalAtom),
				})
			},
		)

		editor.actions.load(replacement, ({ set }) => {
			set(externalAtom, "co-written")
		})
		unsubscribe()

		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(
			revision + 1,
		)
		expect(observations).toEqual([
			{
				revision: revision + 1,
				family: "Coherent Replacement",
				external: "co-written",
			},
		])
	})

	it("rolls back a failed load reconciliation without clearing histories", () => {
		const editor = loaded("state/failed-reconciled-load")
		const externalAtom = editor.silo.atom<string>({
			key: "reconciledSource",
			default: "before",
		})
		const point = firstPoint(editor, blackMasterId)
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 23, y: point.y }],
		})
		editor.actions.setKerningPair({
			left: oGlyphId,
			right: oGlyphId,
			value: -20,
		})
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const source = editor.read.editorSource()

		expect(() =>
			editor.actions.load(makeGeometricOEditorFont(), ({ set }) => {
				set(externalAtom, "should roll back")
				throw new Error("Reconciliation failed.")
			}),
		).toThrow("Reconciliation failed.")

		expect(editor.silo.getState(externalAtom)).toBe("before")
		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(revision)
		expect(editor.read.editorSource()).toBe(source)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toEqual({ at: 1, length: 1 })
		expect(editor.silo.inspectTimeline(editor.kerningTimeline)).toEqual({
			at: 1,
			length: 1,
		})
	})

	it("does not revise or record explicit no-op transactions", () => {
		const editor = loaded("state/explicit-noops")
		const glyph = editor.read.editorGlyphSource(oGlyphId)
		const layer = glyph?.layers.find(
			(candidate) => candidate.masterId === blackMasterId,
		)
		const contour = layer?.contours[0]
		const first = contour?.points[0]
		if (layer === undefined || contour === undefined || first === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		const singleContourId = "contour:single-noop" as const
		const singlePointId = "point:single-noop" as const
		editor.actions.createContour({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: singleContourId,
			point: { id: singlePointId, mode: "hard" },
			coordinates: [{ masterId: blackMasterId, x: 10, y: 20 }],
		})
		editor.clearHistory(oGlyphId)
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const history = editor.silo.inspectTimeline(
			editor.glyphHistoryTimelines,
			oGlyphId,
		)

		editor.silo.runTransaction(editor.transactions.reverseContour)({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: singleContourId,
		})
		editor.silo.runTransaction(editor.transactions.makeNodeFirst)({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			pointId: first.id,
		})
		editor.silo.runTransaction(editor.transactions.reorderContour)({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			toIndex: layer.contours.indexOf(contour),
		})

		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(revision)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toEqual(history)
	})

	it("does not revise or record unchanged horizontal metrics", () => {
		const editor = loaded("state/unchanged-horizontal-metrics")
		const layer = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((candidate) => candidate.masterId === blackMasterId)
		if (layer === undefined) throw new Error("Fixture layer is missing.")
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		const history = editor.silo.inspectTimeline(
			editor.glyphHistoryTimelines,
			oGlyphId,
		)

		editor.silo.runTransaction(editor.transactions.setHorizontalMetrics)({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			advanceWidth: layer.advanceWidth,
		})

		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(revision)
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId),
		).toEqual(history)
		expect(
			editor.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((candidate) => candidate.masterId === blackMasterId)
				?.advanceWidth,
		).toBe(layer.advanceWidth)
	})

	it("changes node behavior only in the requested master", () => {
		const editor = loaded("state/mode-master")
		const black = firstPoint(editor, blackMasterId)
		const razor = firstPoint(editor, razorMasterId)
		editor.actions.setNodeMode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId: black.id,
			mode: "hard",
		})
		expect(firstPoint(editor, blackMasterId).mode).toBe("hard")
		expect(firstPoint(editor, razorMasterId)).toEqual(razor)
	})

	it("toggles eligible node modes from one snapshot as one master-local edit", () => {
		const editor = loaded("state/toggle-node-modes")
		const [softPoint, hardPoint, handlelessPoint] = firstContourPoints(
			editor,
			blackMasterId,
		)
		if (
			softPoint === undefined ||
			hardPoint === undefined ||
			handlelessPoint === undefined
		) {
			throw new Error("Fixture nodes are missing.")
		}
		editor.actions.setNodeMode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId: hardPoint.id,
			mode: "hard",
		})
		editor.actions.setNodeMode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId: handlelessPoint.id,
			mode: "hard",
		})
		for (const handle of ["incoming", "outgoing"] as const) {
			editor.actions.moveHandle({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId: handlelessPoint.id,
				handle,
				vector: null,
			})
		}
		const revision = editor.silo.getState(editor.atoms.documentRevision)

		const result = editor.actions.toggleNodeModes({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [hardPoint.id, softPoint.id, hardPoint.id, handlelessPoint.id],
		})

		expect(result).toEqual({ toggled: 2, skipped: 1 })
		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(
			revision + 1,
		)
		expect(firstContourPoints(editor, blackMasterId)[0]?.mode).toBe("hard")
		expect(firstContourPoints(editor, blackMasterId)[1]?.mode).toBe("soft")
		expect(firstContourPoints(editor, blackMasterId)[2]?.mode).toBe("hard")
		expect(firstContourPoints(editor, razorMasterId)[0]?.mode).toBe("soft")
		expect(firstContourPoints(editor, razorMasterId)[1]?.mode).toBe("soft")

		editor.undo(oGlyphId)
		expect(firstContourPoints(editor, blackMasterId)[0]?.mode).toBe("soft")
		expect(firstContourPoints(editor, blackMasterId)[1]?.mode).toBe("hard")
		editor.redo(oGlyphId)
		expect(firstContourPoints(editor, blackMasterId)[1]?.mode).toBe("soft")
	})

	it("does not publish or record a no-op node-mode batch", () => {
		const editor = loaded("state/toggle-node-modes-noop")
		const point = firstPoint(editor, blackMasterId)
		editor.actions.setNodeMode({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId: point.id,
			mode: "hard",
		})
		for (const handle of ["incoming", "outgoing"] as const) {
			editor.actions.moveHandle({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointId: point.id,
				handle,
				vector: null,
			})
		}
		const revision = editor.silo.getState(editor.atoms.documentRevision)
		expect(
			editor.actions.toggleNodeModes({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointIds: [point.id],
			}),
		).toEqual({ toggled: 0, skipped: 1 })
		expect(editor.silo.getState(editor.atoms.documentRevision)).toBe(revision)
		editor.undo(oGlyphId)
		expect(firstPoint(editor, blackMasterId).outgoing).toEqual(
			expect.any(Object),
		)
	})

	it("routes master-local topology edits through the glyph timeline", () => {
		const editor = loaded("state/topology-history")
		const contour = editor.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === blackMasterId)?.contours[0]
		if (contour === undefined) throw new Error("Fixture contour is missing.")
		editor.actions.setContourClosed({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			contourId: contour.id,
			closed: false,
		})
		expect(
			editor.read.glyphCompatibility(razorMasterId, blackMasterId, oGlyphId)
				.diagnostics,
		).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "closure" })]),
		)
		expect(editor.read.compilation().stage).toBe("projection-failed")
		editor.undo(oGlyphId)
		expect(
			editor.read.glyphCompatibility(razorMasterId, blackMasterId, oGlyphId)
				.compatible,
		).toBe(true)
	})

	it("keeps glyph histories independent", () => {
		const editor = loaded("state/history-isolation")
		const beforeNotdef = editor.read.editorGlyphSource(notdefGlyphId)
		const point = firstPoint(editor, blackMasterId)
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 1, y: point.y }],
		})
		editor.undo(oGlyphId)
		expect(editor.read.editorGlyphSource(notdefGlyphId)).toBe(beforeNotdef)
	})

	it("returns detached frozen snapshots", () => {
		const input = makeGeometricOEditorFont()
		const editor = createFontEditorState({ key: "state/frozen" })
		editor.actions.load(input)
		const output = editor.read.editorSource()
		expect(Object.isFrozen(output)).toBe(true)
		expect(Object.isFrozen(output?.glyphs[0]?.layers[0]?.contours)).toBe(true)
		expect(output).not.toBe(input)
	})

	it("isolates documents with identical entity IDs", () => {
		const first = loaded("state/isolation/first")
		const second = loaded("state/isolation/second")
		const point = firstPoint(first, blackMasterId)
		first.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: point.id, x: point.x + 50, y: point.y }],
		})
		expect(firstPoint(first, blackMasterId).x).not.toBe(
			firstPoint(second, blackMasterId).x,
		)
	})
})
