import { describe, expect, it } from "vitest"

import { oGlyphId, razorMasterId, blackMasterId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import {
	copyOutlineSelection,
	outlinePasteSelectionTargets,
	outlineClipboardPlainText,
	parseOutlineClipboard,
	prepareOutlinePaste,
	serializeOutlineClipboard,
} from "../src/outline-clipboard.ts"

describe("outline clipboard", () => {
	it("copies a whole curved contour across every master", () => {
		const workspace = createEditorWorkspace()
		const glyph = workspace.font.read.editorGlyphSource(oGlyphId)
		const contour = glyph?.contours[0]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(
			glyph,
			contour.points.map((point) => ({ kind: "node", pointId: point.id })),
		)
		expect(copied.ok).toBe(true)
		if (!copied.ok) return
		expect(copied.value.contours).toHaveLength(1)
		expect(copied.value.contours[0]?.closed).toBe(true)
		expect(copied.value.layers.map((layer) => layer.masterId)).toEqual([
			razorMasterId,
			blackMasterId,
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
		const contour = glyph?.contours[0]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const first = contour.points[0]
		const third = contour.points[2]
		if (first === undefined || third === undefined)
			throw new Error("Missing points.")
		const copied = copyOutlineSelection(glyph, [
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
		const contour = glyph?.contours[1]
		if (glyph === null || contour === undefined)
			throw new Error("Missing glyph.")
		const copied = copyOutlineSelection(
			glyph,
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
			oGlyphId,
			[razorMasterId, blackMasterId],
			(kind) => `${kind}:clipboard:${sequence++}`,
		)
		expect(prepared.ok).toBe(true)
		if (!prepared.ok) return
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
				oGlyphId,
				[razorMasterId],
				() => "point:unused",
			),
		).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.stringContaining("different set of font masters"),
			}),
		)
	})
})
