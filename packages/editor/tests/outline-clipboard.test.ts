import { describe, expect, it } from "vitest"

import {
	blackMasterId,
	notdefGlyphId,
	oGlyphId,
	razorMasterId,
} from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import {
	copyOutlineSelection,
	OUTLINE_CLIPBOARD_MIME,
	outlinePasteSelectionTargets,
	outlineClipboardPlainText,
	parseOutlineClipboard,
	prepareOutlineClipboardCopy,
	prepareOutlinePaste,
	serializeOutlineClipboard,
	writeOutlineClipboard,
} from "../src/outline-clipboard.ts"

describe("outline clipboard", () => {
	it("plans only represented source nodes and writes both clipboard formats", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const contour = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]
		const first = contour?.points[0]
		if (glyph === null || first === undefined) throw new Error("Missing glyph.")
		const prepared = prepareOutlineClipboardCopy(glyph, razorMasterId, [
			{ kind: "node", pointId: first.id },
			{ kind: "handle", pointId: first.id, handle: "incoming" },
			{ kind: "node", pointId: "point:missing" },
		])
		expect(prepared.ok).toBe(true)
		if (!prepared.ok) return
		expect(prepared.value.selectedPointIds).toEqual([first.id])
		const entries = new Map<string, string>()
		expect(
			writeOutlineClipboard(
				{ setData: (format, data) => entries.set(format, data) },
				prepared.value.payload,
			),
		).toEqual({ ok: true, value: undefined })
		expect(
			parseOutlineClipboard(entries.get(OUTLINE_CLIPBOARD_MIME) ?? ""),
		).toEqual({ ok: true, value: prepared.value.payload })
		expect(parseOutlineClipboard(entries.get("text/plain") ?? "")).toEqual({
			ok: true,
			value: prepared.value.payload,
		})
	})

	it("reports clipboard write failures without throwing", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const point = glyph?.layers[0]?.contours[0]?.points[0]
		if (glyph === null || point === undefined) throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(glyph, razorMasterId, [
			{ kind: "node", pointId: point.id },
		])
		if (!copied.ok) throw new Error(copied.error)
		let calls = 0
		const result = writeOutlineClipboard(
			{
				setData: () => {
					calls += 1
					if (calls === 2) throw new Error("denied")
				},
			},
			copied.value,
		)
		expect(result).toEqual({
			ok: false,
			error: expect.stringContaining("system clipboard"),
		})
		expect(calls).toBe(2)
	})

	it("copies a whole curved contour from the active master", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const contour = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(
			glyph,
			razorMasterId,
			contour.points.map((point) => ({ kind: "node", pointId: point.id })),
		)
		expect(copied.ok).toBe(true)
		if (!copied.ok) return
		expect(copied.value.contours).toHaveLength(1)
		expect(copied.value.contours[0]?.closed).toBe(true)
		expect(copied.value.layers.map((layer) => layer.masterId)).toEqual([
			razorMasterId,
		])
		expect(copied.value.layers[0]?.points[0]).toEqual(
			expect.objectContaining({ incoming: expect.any(Object) }),
		)

		const parsed = parseOutlineClipboard(
			outlineClipboardPlainText(copied.value),
		)
		expect(parsed).toEqual({ ok: true, value: copied.value })
	})

	it("turns discontiguous selected regions into deterministic open fragments", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const contour = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const first = contour.points[0]
		const third = contour.points[2]
		if (first === undefined || third === undefined)
			throw new Error("Missing points.")
		const copied = copyOutlineSelection(glyph, razorMasterId, [
			{ kind: "node", pointId: first.id },
			{ kind: "node", pointId: third.id },
		])
		expect(copied.ok).toBe(true)
		if (!copied.ok) return
		expect(copied.value.contours).toEqual([
			{ closed: false, points: [{ key: "0/0", mode: "hard" }] },
			{ closed: false, points: [{ key: "1/0", mode: "hard" }] },
		])
		expect(copied.value.layers[0]?.points).toEqual([
			expect.not.objectContaining({
				incoming: expect.anything(),
				outgoing: expect.anything(),
			}),
			expect.not.objectContaining({
				incoming: expect.anything(),
				outgoing: expect.anything(),
			}),
		])
	})

	it("validates payloads and prepares fresh IDs for an atomic paste", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const contour = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[1]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(
			glyph,
			razorMasterId,
			contour.points.map((point) => ({ kind: "node", pointId: point.id })),
		)
		if (!copied.ok) throw new Error(copied.error)
		const parsed = parseOutlineClipboard(
			serializeOutlineClipboard(copied.value),
		)
		if (!parsed.ok) throw new Error(parsed.error)
		let sequence = 0
		const prepared = prepareOutlinePaste(
			parsed.value,
			razorMasterId,
			oGlyphId,
			[razorMasterId],
			(kind) => `${kind}:clipboard:${sequence++}`,
		)
		expect(prepared.ok).toBe(true)
		if (!prepared.ok) return
		expect(prepared.value.layers.map((layer) => layer.masterId)).toEqual([
			razorMasterId,
		])
		expect(prepared.value.selectedPointIds).toHaveLength(contour.points.length)
		expect(
			prepared.value.contours[0]?.points.map((point) => point.id),
		).not.toEqual(contour.points.map((point) => point.id))
		expect(
			outlinePasteSelectionTargets(prepared.value.selectedPointIds),
		).toEqual(
			prepared.value.selectedPointIds.map((pointId) => ({
				kind: "node",
				pointId,
			})),
		)

		expect(parseOutlineClipboard("{not-json")).toEqual(
			expect.objectContaining({ ok: false }),
		)
		expect(
			prepareOutlinePaste(
				parsed.value,
				razorMasterId,
				notdefGlyphId,
				[blackMasterId],
				() => "point:unused",
			),
		).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.stringContaining("different set of font masters"),
			}),
		)
	})

	it("remaps one same-glyph source layer to the active master atomically", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const sourceContour = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]
		if (glyph === null || sourceContour === undefined)
			throw new Error("Missing source contour.")
		const sourceBefore = structuredClone(
			glyph.layers.find((layer) => layer.masterId === razorMasterId),
		)
		const destinationBefore = glyph.layers.find(
			(layer) => layer.masterId === blackMasterId,
		)
		const copied = copyOutlineSelection(
			glyph,
			razorMasterId,
			sourceContour.points.map((point) => ({
				kind: "node" as const,
				pointId: point.id,
			})),
		)
		if (!copied.ok) throw new Error(copied.error)
		expect(copied.value.sourceGlyphId).toBe(oGlyphId)

		let sequence = 0
		const prepared = prepareOutlinePaste(
			copied.value,
			blackMasterId,
			oGlyphId,
			[blackMasterId],
			(kind) => `${kind}:cross-master:${sequence++}`,
			[razorMasterId, blackMasterId],
		)
		expect(prepared.ok).toBe(true)
		if (!prepared.ok) return
		expect(prepared.value.layers).toHaveLength(1)
		expect(prepared.value.layers[0]?.masterId).toBe(blackMasterId)
		expect(prepared.value.contours[0]).toMatchObject({
			closed: sourceContour.closed,
			points: sourceContour.points.map((point) => ({ mode: point.mode })),
		})
		expect(prepared.value.layers[0]?.points).toEqual(
			sourceContour.points.map((point, index) => ({
				pointId: prepared.value.selectedPointIds[index],
				x: point.x,
				y: point.y,
				...(point.incoming === undefined
					? {}
					: { incoming: { ...point.incoming } }),
				...(point.outgoing === undefined
					? {}
					: { outgoing: { ...point.outgoing } }),
			})),
		)
		expect(
			prepared.value.selectedPointIds.some((pointId) =>
				sourceContour.points.some((point) => point.id === pointId),
			),
		).toBe(false)

		workspace.font.actions.pasteContours(prepared.value)
		const destinationAfter = workspace.font.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === blackMasterId)
		expect(destinationAfter?.contours).toHaveLength(
			(destinationBefore?.contours.length ?? 0) + 1,
		)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId),
		).toEqual(sourceBefore)

		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)?.contours,
		).toHaveLength(destinationBefore?.contours.length ?? 0)
		workspace.font.redo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)?.contours,
		).toHaveLength((destinationBefore?.contours.length ?? 0) + 1)
	})

	it("does not remap legacy, cross-glyph, or multi-master payloads", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const point = glyph?.layers.find(
			(layer) => layer.masterId === razorMasterId,
		)?.contours[0]?.points[0]
		if (glyph === null || point === undefined) throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(glyph, razorMasterId, [
			{ kind: "node", pointId: point.id },
		])
		if (!copied.ok) throw new Error(copied.error)
		const nextId = () => "point:unused" as const
		const {
			sourceGlyphId: _sourceGlyphId,
			sourceGlyphMasterIds: _sourceGlyphMasterIds,
			...legacy
		} = copied.value
		expect(
			prepareOutlinePaste(
				legacy,
				blackMasterId,
				oGlyphId,
				[blackMasterId],
				nextId,
			),
		).toEqual(expect.objectContaining({ ok: false }))
		expect(
			prepareOutlinePaste(
				copied.value,
				blackMasterId,
				oGlyphId,
				[blackMasterId],
				nextId,
				[blackMasterId],
			),
		).toEqual(expect.objectContaining({ ok: false }))
		expect(
			prepareOutlinePaste(
				copied.value,
				blackMasterId,
				notdefGlyphId,
				[blackMasterId],
				nextId,
			),
		).toEqual(expect.objectContaining({ ok: false }))

		const sourceLayer = copied.value.layers[0]
		if (sourceLayer === undefined) throw new Error("Missing source layer.")
		const multiMaster = {
			...copied.value,
			masterIds: [razorMasterId, blackMasterId],
			layers: [sourceLayer, { ...sourceLayer, masterId: blackMasterId }],
		}
		expect(
			prepareOutlinePaste(
				multiMaster,
				blackMasterId,
				oGlyphId,
				[blackMasterId],
				nextId,
			),
		).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.stringContaining("different set of font masters"),
			}),
		)
	})
})
