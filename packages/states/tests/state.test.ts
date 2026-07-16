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
	it("projects the Razor/Black geometric O through target ingestion", () => {
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
		const first = createLoadedEditor("test/isolation")
		const second = createLoadedEditor("test/isolation")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[1]?.points[1]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		expect(first.atoms.pointX.key).toBe("pointX")
		expect(second.atoms.pointX.key).toBe("pointX")

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

		editor.undo(oGlyphId)
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
		).toBe(400)

		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				pointId,
			]),
		).toBe(700)
	})

	it("keeps one independent timeline per glyph", () => {
		const editor = createLoadedEditor("test/glyph-histories")
		const source = makeGeometricOEditorFont()
		const oPointId = source.glyphs.find((glyph) => glyph.id === oGlyphId)
			?.contours[0]?.points[0]?.id
		const notdefPointId = source.glyphs.find(
			(glyph) => glyph.id === notdefGlyphId,
		)?.contours[0]?.points[0]?.id
		if (oPointId === undefined || notdefPointId === undefined) {
			throw new Error("Fixture points are missing.")
		}
		let oLength = 0
		let notdefLength = 0
		editor.silo.subscribe(editor.glyphHistoryTimelines, oGlyphId, (update) => {
			oLength = update.length
		})
		editor.silo.subscribe(
			editor.glyphHistoryTimelines,
			notdefGlyphId,
			(update) => {
				notdefLength = update.length
			},
		)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: oPointId, x: 510, y: 810 }],
		})
		expect(oLength).toBe(1)
		expect(notdefLength).toBe(0)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: notdefGlyphId,
			points: [{ pointId: notdefPointId, x: 520, y: 800 }],
		})
		expect(oLength).toBe(1)
		expect(notdefLength).toBe(1)

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				notdefGlyphId,
				notdefPointId,
			]),
		).toBe(520)
	})

	it("keeps relative handles anchored when their owning node moves", () => {
		const editor = createLoadedEditor("test/anchored-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!before.ok) throw new Error("Fixture layer node did not project.")

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: before.value.x + 125, y: before.value.y - 75 }],
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok) throw new Error("Moved layer node did not project.")
		expect(after.value.incoming).toEqual(before.value.incoming)
		expect(after.value.outgoing).toEqual(before.value.outgoing)
		expect(after.value.x).toBe(before.value.x + 125)
		expect(after.value.y).toBe(before.value.y - 75)
	})

	it("moves soft handles as one line while preserving the opposite length", () => {
		const editor = createLoadedEditor("test/soft-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const before = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!before.ok || before.value.incoming === undefined) {
			throw new Error("Fixture incoming handle is missing.")
		}
		const oppositeLength = Math.hypot(
			before.value.incoming.x,
			before.value.incoming.y,
		)

		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 0, y: 200 },
		})

		const after = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!after.ok) throw new Error("Edited layer node did not project.")
		expect(after.value.outgoing).toEqual({ x: 0, y: 200 })
		expect(after.value.incoming?.x).toBeCloseTo(0)
		expect(after.value.incoming?.y).toBeCloseTo(-oppositeLength)
		expect(
			Math.hypot(after.value.incoming?.x ?? 0, after.value.incoming?.y ?? 0),
		).toBeCloseTo(oppositeLength)
	})

	it("keeps hard handles independent and softens every master atomically", () => {
		const editor = createLoadedEditor("test/hard-handles")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
			const hard = editor.read.layerNode(masterId, oGlyphId, pointId)
			if (!hard.ok) throw new Error("Hard layer node did not project.")
			expect(hard.value.mode).toBe("hard")
			expect(hard.value.incoming).toBeDefined()
			expect(hard.value.outgoing).toBeUndefined()
		}

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			const soft = editor.read.layerNode(masterId, oGlyphId, pointId)
			if (!soft.ok || soft.value.incoming === undefined) {
				throw new Error("Soft layer node did not project.")
			}
			expect(soft.value.mode).toBe("soft")
			expect(soft.value.outgoing).toBeUndefined()
		}
	})

	it("deletes one handle independently and hardens its node", () => {
		const editor = createLoadedEditor("test/delete-handle")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [],
			handles: [{ pointId, handle: "incoming" }],
		})

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!node.ok) throw new Error("Edited layer node did not project.")
		expect(node.value.mode).toBe("hard")
		expect(node.value.incoming).toBeUndefined()
		expect(node.value.outgoing).toBeDefined()
	})

	it("keeps a one-sided smooth node one-sided and projects its handle onto the tangent", () => {
		const editor = createLoadedEditor("test/soften-one-sided")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		const nextPointId = contour?.points[1]?.id
		if (pointId === undefined || nextPointId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
		}
		const hard = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!hard.ok || hard.value.incoming === undefined) {
			throw new Error("One-sided hard node did not project.")
		}
		const originalLength = Math.hypot(
			hard.value.incoming.x,
			hard.value.incoming.y,
		)

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const next = editor.read.layerNode(blackMasterId, oGlyphId, nextPointId)
		if (!node.ok || !next.ok || node.value.incoming === undefined) {
			throw new Error("Softened layer nodes did not project.")
		}
		expect(node.value.mode).toBe("soft")
		expect(node.value.outgoing).toBeUndefined()
		const tangent = {
			x: next.value.x + (next.value.incoming?.x ?? 0) - node.value.x,
			y: next.value.y + (next.value.incoming?.y ?? 0) - node.value.y,
		}
		expect(
			node.value.incoming.x * tangent.y - node.value.incoming.y * tangent.x,
		).toBeCloseTo(0)
		expect(
			node.value.incoming.x * tangent.x + node.value.incoming.y * tangent.y,
		).toBeLessThanOrEqual(0)
		expect(
			Math.hypot(node.value.incoming.x, node.value.incoming.y),
		).toBeCloseTo(originalLength)

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: node.value.x + 60, y: node.value.y - 40 }],
		})
		const moved = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const nextAfterMove = editor.read.layerNode(
			blackMasterId,
			oGlyphId,
			nextPointId,
		)
		if (!moved.ok || !nextAfterMove.ok || moved.value.incoming === undefined) {
			throw new Error("Moved one-sided soft node did not project.")
		}
		const movedTangent = {
			x:
				nextAfterMove.value.x +
				(nextAfterMove.value.incoming?.x ?? 0) -
				moved.value.x,
			y:
				nextAfterMove.value.y +
				(nextAfterMove.value.incoming?.y ?? 0) -
				moved.value.y,
		}
		expect(
			moved.value.incoming.x * movedTangent.y -
				moved.value.incoming.y * movedTangent.x,
		).toBeCloseTo(0)
		expect(
			Math.hypot(moved.value.incoming.x, moved.value.incoming.y),
		).toBeCloseTo(originalLength)
		expect(moved.value.incoming).not.toEqual(node.value.incoming)
	})

	it("projects a sole outgoing handle without adding an incoming handle", () => {
		const editor = createLoadedEditor("test/soften-outgoing-only")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		const previousPointId = contour?.points.at(-1)?.id
		if (pointId === undefined || previousPointId === undefined) {
			throw new Error("Fixture nodes are missing.")
		}
		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: null,
			})
		}
		const hard = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!hard.ok || hard.value.outgoing === undefined) {
			throw new Error("One-sided hard node did not project.")
		}
		const originalLength = Math.hypot(
			hard.value.outgoing.x,
			hard.value.outgoing.y,
		)

		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		const previous = editor.read.layerNode(
			blackMasterId,
			oGlyphId,
			previousPointId,
		)
		if (!node.ok || !previous.ok || node.value.outgoing === undefined) {
			throw new Error("Softened layer nodes did not project.")
		}
		expect(node.value.mode).toBe("soft")
		expect(node.value.incoming).toBeUndefined()
		const awayFromPreviousControl = {
			x: node.value.x - (previous.value.x + (previous.value.outgoing?.x ?? 0)),
			y: node.value.y - (previous.value.y + (previous.value.outgoing?.y ?? 0)),
		}
		expect(
			node.value.outgoing.x * awayFromPreviousControl.y -
				node.value.outgoing.y * awayFromPreviousControl.x,
		).toBeCloseTo(0)
		expect(
			node.value.outgoing.x * awayFromPreviousControl.x +
				node.value.outgoing.y * awayFromPreviousControl.y,
		).toBeGreaterThanOrEqual(0)
		expect(
			Math.hypot(node.value.outgoing.x, node.value.outgoing.y),
		).toBeCloseTo(originalLength)
	})

	it("keeps a handleless node hard when asked to soften it", () => {
		const editor = createLoadedEditor("test/soften-handleless")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")

		for (const masterId of [razorMasterId, blackMasterId] as const) {
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "incoming",
				vector: null,
			})
			editor.actions.moveHandle({
				masterId,
				glyphId: oGlyphId,
				pointId,
				handle: "outgoing",
				vector: null,
			})
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "soft" })
		const handleless = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		if (!handleless.ok) throw new Error("Handleless node did not project.")
		expect(handleless.value.mode).toBe("hard")
	})

	it("deletes nodes while keeping a contour closed by default", () => {
		const editor = createLoadedEditor("test/delete-node-closed")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[1]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [pointId],
			handles: [],
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(3)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(true)
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("breaks deleted node regions into open loose-ended paths and undoes atomically", () => {
		const editor = createLoadedEditor("test/delete-node-open")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const pointId = contour?.points[1]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [pointId],
			handles: [],
			breakPaths: true,
		})

		const remaining = editor.silo.getState(editor.atoms.contourPointIds, [
			oGlyphId,
			contour.id,
		])
		expect(remaining).toHaveLength(3)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(false)
		const firstPointId = remaining?.[0]
		const lastPointId = remaining?.at(-1)
		if (firstPointId === undefined || lastPointId === undefined) {
			throw new Error("Broken path endpoints are missing.")
		}
		const first = editor.read.layerNode(blackMasterId, oGlyphId, firstPointId)
		const last = editor.read.layerNode(blackMasterId, oGlyphId, lastPointId)
		if (!first.ok || !last.ok)
			throw new Error("Broken endpoints did not project.")
		expect(first.value.incoming).toBeUndefined()
		expect(last.value.outgoing).toBeUndefined()
		expect(first.value.mode).toBe("hard")
		expect(last.value.mode).toBe("hard")
		const compilation = editor.read.compilation()
		expect(compilation.stage).toBe("projection-failed")
		if (compilation.stage === "projection-failed") {
			expect(compilation.projectionErrors).toContainEqual(
				expect.objectContaining({ code: "topology.open_contour" }),
			)
		}

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(4)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contour.id]),
		).toBe(true)
	})

	it.each([
		["outgoing", 0, [1, 2, 3, 0]],
		["incoming", 0, [0, 1, 2, 3]],
	] as const)(
		"breaks a deleted %s handle's segment and clears both loose ends",
		(handle, selectedIndex, expectedIndexes) => {
			const editor = createLoadedEditor(`test/delete-${handle}-handle-open`)
			const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
			const pointId = contour?.points[selectedIndex]?.id
			if (contour === undefined || pointId === undefined) {
				throw new Error("Fixture contour is missing.")
			}

			editor.actions.deleteSelection({
				masterId: blackMasterId,
				glyphId: oGlyphId,
				pointIds: [],
				handles: [{ pointId, handle }],
				breakPaths: true,
			})

			const remaining = editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			])
			expect(remaining).toEqual(
				expectedIndexes.map((index) => contour.points[index]?.id),
			)
			expect(
				editor.silo.getState(editor.atoms.contourClosed, [
					oGlyphId,
					contour.id,
				]),
			).toBe(false)
			const firstPointId = remaining?.[0]
			const lastPointId = remaining?.at(-1)
			if (firstPointId === undefined || lastPointId === undefined) {
				throw new Error("Broken path endpoints are missing.")
			}
			for (const masterId of [razorMasterId, blackMasterId] as const) {
				const first = editor.read.layerNode(masterId, oGlyphId, firstPointId)
				const last = editor.read.layerNode(masterId, oGlyphId, lastPointId)
				if (!first.ok || !last.ok) {
					throw new Error("Broken endpoints did not project.")
				}
				expect(first.value.incoming).toBeUndefined()
				expect(last.value.outgoing).toBeUndefined()
			}

			editor.undo(oGlyphId)
			expect(
				editor.silo.getState(editor.atoms.contourPointIds, [
					oGlyphId,
					contour.id,
				]),
			).toEqual(contour.points.map((point) => point.id))
			expect(
				editor.silo.getState(editor.atoms.contourClosed, [
					oGlyphId,
					contour.id,
				]),
			).toBe(true)
		},
	)

	it("splits disjoint deleted regions into separate open contours", () => {
		const editor = createLoadedEditor("test/delete-disjoint-regions")
		const contour = makeGeometricOEditorFont().glyphs[1]?.contours[0]
		const firstPointId = contour?.points[0]?.id
		const thirdPointId = contour?.points[2]?.id
		if (
			contour === undefined ||
			firstPointId === undefined ||
			thirdPointId === undefined
		) {
			throw new Error("Fixture contour is missing.")
		}

		editor.actions.deleteSelection({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointIds: [firstPointId, thirdPointId],
			handles: [],
			breakPaths: true,
		})

		const contourIds = editor.silo.getState(
			editor.atoms.glyphContourIds,
			oGlyphId,
		)
		expect(contourIds).toHaveLength(3)
		const splitContours = contourIds?.slice(0, 2) ?? []
		expect(
			splitContours.map((contourId) =>
				editor.silo.getState(editor.atoms.contourPointIds, [
					oGlyphId,
					contourId,
				]),
			),
		).toEqual([[contour.points[1]?.id], [contour.points[3]?.id]])
		expect(
			splitContours.map((contourId) =>
				editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contourId]),
			),
		).toEqual([false, false])

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
		).toHaveLength(2)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [
				oGlyphId,
				contour.id,
			]),
		).toHaveLength(4)
		editor.redo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.glyphContourIds, oGlyphId),
		).toHaveLength(3)
	})

	it("projects and serializes a raw one-sided soft handle", () => {
		const editor = createLoadedEditor("test/raw-soft-invariant")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const atomKey = [blackMasterId, oGlyphId, pointId] as const
		editor.silo.setState(editor.atoms.outgoingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleY, atomKey, null)

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(node.ok).toBe(true)
		if (!node.ok) return
		expect(node.value.mode).toBe("soft")
		expect(node.value.incoming).toBeDefined()
		expect(node.value.outgoing).toBeUndefined()
		expect(editor.read.editorSource()).not.toBeNull()
		expect(editor.read.compilation().stage).not.toBe("projection-failed")
	})

	it("diagnoses a raw handleless soft node instead of serializing it", () => {
		const editor = createLoadedEditor("test/raw-handleless-soft-invariant")
		const pointId =
			makeGeometricOEditorFont().glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture node is missing.")
		const atomKey = [blackMasterId, oGlyphId, pointId] as const
		editor.silo.setState(editor.atoms.incomingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.incomingHandleY, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleX, atomKey, null)
		editor.silo.setState(editor.atoms.outgoingHandleY, atomKey, null)

		const node = editor.read.layerNode(blackMasterId, oGlyphId, pointId)
		expect(node.ok).toBe(false)
		if (!node.ok) {
			expect(node.errors).toContainEqual(
				expect.objectContaining({ code: "curve.soft_handle_pair" }),
			)
		}
		expect(editor.read.editorSource()).toBeNull()
		expect(editor.read.compilation().stage).toBe("projection-failed")
	})

	it("coordinates cubic-to-quadratic subdivision topology across masters", () => {
		const editor = createLoadedEditor("test/cubic-plan")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 700, y: -900 },
		})

		const plan = editor.silo.getState(editor.selectors.curveSegmentPlan, [
			oGlyphId,
			contour.id,
			0,
		])
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.value.subdivisionDepth).toBeGreaterThan(0)
		expect(plan.value.maximumError).toBeLessThanOrEqual(0.5)
		const razor = editor.read.glyphLayer(razorMasterId, oGlyphId)
		const black = editor.read.glyphLayer(blackMasterId, oGlyphId)
		expect(razor.ok).toBe(true)
		expect(black.ok).toBe(true)
		if (!razor.ok || !black.ok) return
		expect(razor.value.flattenedPoints).toHaveLength(
			black.value.flattenedPoints.length,
		)
		expect(editor.read.compilation().stage).toBe("compiled")
	})

	it("reports a typed projection error when the fixed curve bound cannot fit", () => {
		const editor = createLoadedEditor("test/cubic-limit")
		const source = makeGeometricOEditorFont()
		const contour = source.glyphs[1]?.contours[0]
		const pointId = contour?.points[0]?.id
		if (contour === undefined || pointId === undefined) {
			throw new Error("Fixture contour is missing.")
		}
		editor.actions.setNodeMode({ glyphId: oGlyphId, pointId, mode: "hard" })
		editor.actions.moveHandle({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			pointId,
			handle: "outgoing",
			vector: { x: 1_000_000_000_000, y: 0 },
		})

		const plan = editor.silo.getState(editor.selectors.curveSegmentPlan, [
			oGlyphId,
			contour.id,
			0,
		])
		expect(plan.ok).toBe(false)
		if (plan.ok) return
		expect(plan.errors).toContainEqual(
			expect.objectContaining({ code: "curve.approximation_limit" }),
		)
	})

	it("inserts one shared point with coordinates in every layer", () => {
		const editor = createLoadedEditor("test/insert")
		const contourId = makeGeometricOEditorFont().glyphs[1]?.contours[0]?.id
		if (contourId === undefined) throw new Error("Fixture contour is missing.")

		editor.actions.insertPoint({
			glyphId: oGlyphId,
			contourId,
			at: 1,
			point: { id: "point:glyph:O:inserted", mode: "hard" },
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

		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId: "point:glyph:O:inserted", x: 733, y: 811 }],
		})
		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.pointX, [
				blackMasterId,
				oGlyphId,
				"point:glyph:O:inserted",
			]),
		).toBe(700)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).toContain("point:glyph:O:inserted")

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).not.toContain("point:glyph:O:inserted")
	})

	it("creates and closes a pen contour with shared master coordinates", () => {
		const editor = createLoadedEditor("test/create-contour")
		const contourId = "contour:glyph:O:pen"
		const pointIds = [
			"point:glyph:O:pen:0",
			"point:glyph:O:pen:1",
			"point:glyph:O:pen:2",
		] as const

		editor.actions.createContour({
			glyphId: oGlyphId,
			contourId,
			point: { id: pointIds[0], mode: "hard" },
			coordinates: [
				{ masterId: razorMasterId, x: 200, y: 100 },
				{ masterId: blackMasterId, x: 200, y: 100 },
			],
		})
		for (const [index, pointId] of pointIds.slice(1).entries()) {
			editor.actions.insertPoint({
				glyphId: oGlyphId,
				contourId,
				point: { id: pointId, mode: "hard" },
				coordinates: [
					{ masterId: razorMasterId, x: 400 + index * 100, y: 300 },
					{ masterId: blackMasterId, x: 400 + index * 100, y: 300 },
				],
			})
		}
		editor.actions.setContourClosed({
			glyphId: oGlyphId,
			contourId,
			closed: true,
		})

		expect(
			editor.silo.getState(editor.atoms.contourPointIds, [oGlyphId, contourId]),
		).toEqual(pointIds)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contourId]),
		).toBe(true)
		expect(editor.read.compilation().stage).toBe("compiled")

		editor.undo(oGlyphId)
		expect(
			editor.silo.getState(editor.atoms.contourClosed, [oGlyphId, contourId]),
		).toBe(false)
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
		const pointId = replacement.glyphs[1]?.contours[0]?.points[0]?.id
		if (pointId === undefined) throw new Error("Fixture point is missing.")
		editor.actions.movePoints({
			masterId: blackMasterId,
			glyphId: oGlyphId,
			points: [{ pointId, x: 625, y: 800 }],
		})
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(1)

		editor.actions.load(replacement)

		expect(editor.read.editorSource()?.names.family).toBe("Replacement O")
		expect(editor.read.compilation().stage).toBe("compiled")
		expect(
			editor.silo.inspectTimeline(editor.glyphHistoryTimelines, oGlyphId)
				.length,
		).toBe(0)
		editor.undo(oGlyphId)
		expect(editor.read.editorSource()?.names.family).toBe("Replacement O")
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
		const point = layer?.points[4]
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
		editor.silo.setState(editor.atoms.glyphEditor, oGlyphId, {
			note: "Selected for review",
			color: "#ff00ff",
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
