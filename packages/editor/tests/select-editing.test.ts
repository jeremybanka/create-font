import type { EditorLayerNode, GlyphId, MasterId } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	constrainVectorToEightRays,
	previewHandleDrag,
	resolveHandleEdit,
} from "../src/curve-editing.ts"
import {
	directDragOwnsPointer,
	planSelectionNudge,
	rememberedTangentDirection,
	resolveTangentSlide,
	selectedTangentSlideConstraint,
	tangentSlideConstraint,
} from "../src/select-editing.ts"

const pointId = "point:select" as const

describe("Select handle editing", () => {
	it("scopes cancellation to the pointer that began the drag", () => {
		expect(directDragOwnsPointer(7, 7)).toBe(true)
		expect(directDragOwnsPointer(7, 8)).toBe(false)
		expect(directDragOwnsPointer(null, 7)).toBe(false)
	})

	it("quantizes every octant with deterministic clockwise ties", () => {
		for (const [raw, expected] of [
			[
				{ x: 10, y: 1 },
				{ x: Math.sqrt(101), y: 0 },
			],
			[
				{ x: 9, y: 8 },
				{ x: Math.sqrt(72.5), y: Math.sqrt(72.5) },
			],
			[
				{ x: 1, y: 10 },
				{ x: 0, y: Math.sqrt(101) },
			],
			[
				{ x: -8, y: 9 },
				{ x: -Math.sqrt(72.5), y: Math.sqrt(72.5) },
			],
			[
				{ x: -10, y: 1 },
				{ x: -Math.sqrt(101), y: 0 },
			],
			[
				{ x: -9, y: -8 },
				{ x: -Math.sqrt(72.5), y: -Math.sqrt(72.5) },
			],
			[
				{ x: -1, y: -10 },
				{ x: 0, y: -Math.sqrt(101) },
			],
			[
				{ x: 8, y: -9 },
				{ x: Math.sqrt(72.5), y: -Math.sqrt(72.5) },
			],
		] as const) {
			const constrained = constrainVectorToEightRays(raw)
			expect(constrained.x).toBeCloseTo(expected.x)
			expect(constrained.y).toBeCloseTo(expected.y)
			expect(Math.hypot(constrained.x, constrained.y)).toBeCloseTo(
				Math.hypot(raw.x, raw.y),
			)
		}
		expect(constrainVectorToEightRays({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
		const tie = Math.tan(Math.PI / 8)
		const constrainedTie = constrainVectorToEightRays({ x: 1, y: tie })
		expect(constrainedTie.x).toBeCloseTo(constrainedTie.y)
	})

	it("shares hard, symmetric, and one-sided soft handle resolution", () => {
		const hard: EditorLayerNode = {
			pointId,
			mode: "hard",
			x: 0,
			y: 0,
			incoming: { x: -20, y: 0 },
			outgoing: { x: 30, y: 0 },
		}
		const hardEdit = resolveHandleEdit(hard, "outgoing", { x: 3, y: 9 }, true)
		expect(hardEdit?.constrainedToEightRays).toBe(true)
		expect(hardEdit?.storageVector).toEqual({ x: 0, y: 9 })
		expect(hardEdit?.previewVector).toEqual({ x: 0, y: 9 })

		const symmetric = previewHandleDrag(
			{ ...hard, mode: "soft" },
			"outgoing",
			hardEdit?.previewVector ?? { x: 0, y: 0 },
		)
		expect(symmetric.incoming?.x).toBeCloseTo(0)
		expect(symmetric.incoming?.y).toBeCloseTo(-20)

		const { outgoing: _outgoing, ...withoutOutgoing } = hard
		const asymmetric = { ...withoutOutgoing, mode: "soft" as const }
		const asymmetricEdit = resolveHandleEdit(
			asymmetric,
			"incoming",
			{ x: 0, y: 40 },
			true,
		)
		expect(asymmetricEdit).toEqual({
			storageVector: { x: 0, y: 40 },
			previewVector: { x: -40, y: 0 },
			constrainedToEightRays: false,
		})
	})

	it("preserves off-tangent pointer radius for either one-sided handle", () => {
		for (const handle of ["incoming", "outgoing"] as const) {
			const direction = handle === "incoming" ? -1 : 1
			const node: EditorLayerNode = {
				pointId,
				mode: "soft",
				x: 0,
				y: 0,
				[handle]: { x: direction, y: direction },
			}
			const resolved = resolveHandleEdit(node, handle, { x: 2, y: 0 }, true)
			expect(resolved?.storageVector).toEqual({ x: 2, y: 0 })
			expect(
				Math.hypot(
					resolved?.previewVector.x ?? 0,
					resolved?.previewVector.y ?? 0,
				),
			).toBeCloseTo(2)
			expect((resolved?.previewVector.x ?? 0) * direction).toBeGreaterThan(0)
			expect(resolved?.previewVector.x).toBeCloseTo(
				resolved?.previewVector.y ?? Number.NaN,
			)
		}
	})

	it("quantizes the raw vector before ray-preserving integer rounding", () => {
		const node: EditorLayerNode = {
			pointId,
			mode: "hard",
			x: 0,
			y: 0,
			outgoing: { x: 10, y: 0 },
		}
		// Rounding first produces (1, 1), which would incorrectly choose diagonal.
		expect(
			resolveHandleEdit(node, "outgoing", { x: 1.4, y: 0.57 }, true)
				?.storageVector,
		).toEqual({ x: 2, y: 0 })
		expect(
			resolveHandleEdit(node, "outgoing", { x: 9, y: 8 }, true)?.storageVector,
		).toEqual({ x: 9, y: 9 })
	})

	it("rounds one-sided storage while previewing its derived tangent length", () => {
		for (const handle of ["incoming", "outgoing"] as const) {
			const direction = handle === "incoming" ? -1 : 1
			const node: EditorLayerNode = {
				pointId,
				mode: "soft",
				x: 0,
				y: 0,
				[handle]: { x: direction * 3, y: direction * 4 },
			}
			const resolved = resolveHandleEdit(
				node,
				handle,
				{ x: direction * 3.72, y: direction * 4.96 },
				true,
			)
			expect(resolved?.storageVector).toEqual({
				x: direction * 4,
				y: direction * 5,
			})
			expect(resolved?.constrainedToEightRays).toBe(false)
			const preview = resolved?.previewVector
			expect(preview).toBeDefined()
			if (preview === undefined) continue
			expect(preview.x * 4 - preview.y * 3).toBeCloseTo(0)
			expect(Math.hypot(preview.x, preview.y)).toBeCloseTo(Math.sqrt(41))
		}
	})
})

describe("soft-node tangent slides", () => {
	it("projects and clamps a two-sided node between fixed endpoints", () => {
		const nodes: readonly EditorLayerNode[] = [
			{
				pointId,
				mode: "soft",
				x: 50,
				y: 50,
				incoming: { x: -50, y: -50 },
				outgoing: { x: 50, y: 50 },
			},
		]
		const constraint = tangentSlideConstraint(nodes, 0, false)
		expect(constraint).not.toBeNull()
		if (constraint === null) return
		const perpendicular = resolveTangentSlide(constraint, { x: 30, y: 70 })
		expect(perpendicular?.points[0]).toMatchObject({ x: 50, y: 50 })
		expect(
			resolveTangentSlide(constraint, { x: -50, y: -50 })?.points[0],
		).toMatchObject({ x: 0, y: 0 })
		expect(
			resolveTangentSlide(constraint, { x: 150, y: 150 })?.points[0],
		).toMatchObject({ x: 100, y: 100 })
		expect(perpendicular?.handles).toEqual([
			{ pointId, handle: "incoming", x: 0, y: 0 },
			{ pointId, handle: "outgoing", x: 100, y: 100 },
		])
	})

	it("uses neighbor controls for asymmetric bounds and an open half-line", () => {
		const bounded: readonly EditorLayerNode[] = [
			{
				pointId,
				mode: "soft",
				x: 100,
				y: 0,
				incoming: { x: -50, y: 0 },
			},
			{
				pointId: "point:next" as const,
				mode: "hard",
				x: 250,
				y: 0,
				incoming: { x: -50, y: 0 },
			},
		]
		const boundedConstraint = tangentSlideConstraint(bounded, 0, false)
		expect(boundedConstraint).toMatchObject({
			start: { x: 50, y: 0 },
			end: { x: 200, y: 0 },
		})
		if (boundedConstraint === null) return
		expect(
			resolveTangentSlide(boundedConstraint, { x: 500, y: 20 })?.points[0],
		).toMatchObject({ x: 200, y: 0 })

		const unbounded: readonly EditorLayerNode[] = [
			{
				pointId,
				mode: "soft",
				x: 100,
				y: 0,
				outgoing: { x: 50, y: 0 },
			},
		]
		const ray = tangentSlideConstraint(unbounded, 0, false)
		expect(ray).toMatchObject({
			start: { x: 150, y: 0 },
			end: null,
			direction: { x: -50, y: 0 },
		})
		if (ray === null) return
		expect(resolveTangentSlide(ray, { x: 300, y: 0 })?.points[0]).toMatchObject(
			{ x: 150, y: 0 },
		)
		expect(
			resolveTangentSlide(ray, { x: -100, y: 20 })?.points[0],
		).toMatchObject({ x: -100, y: 0 })
	})

	it("keeps one-sided zero endpoints bounded or on a cached open ray", () => {
		const bounded: readonly EditorLayerNode[] = [
			{
				pointId,
				mode: "soft",
				x: 100,
				y: 0,
				incoming: { x: 0, y: 0 },
			},
			{
				pointId: "point:next" as const,
				mode: "hard",
				x: 200,
				y: 0,
				incoming: { x: -20, y: 0 },
			},
		]
		const boundedConstraint = tangentSlideConstraint(bounded, 0, false)
		expect(boundedConstraint).toMatchObject({
			origin: { x: 100, y: 0 },
			start: { x: 100, y: 0 },
			end: { x: 180, y: 0 },
		})
		if (boundedConstraint === null) return
		expect(
			resolveTangentSlide(boundedConstraint, { x: 110, y: 40 })?.points[0],
		).toMatchObject({ x: 110, y: 0 })

		const unbounded: readonly EditorLayerNode[] = [
			{
				pointId,
				mode: "soft",
				x: 100,
				y: 0,
				outgoing: { x: 0, y: 0 },
			},
		]
		expect(tangentSlideConstraint(unbounded, 0, false)).toBeNull()
		expect(
			selectedTangentSlideConstraint(
				[{ closed: false, nodes: unbounded }],
				[{ kind: "node", pointId }],
			),
		).toEqual({ pointId, constraint: null })
		const cached = tangentSlideConstraint(unbounded, 0, false, {
			x: -1,
			y: 0,
		})
		expect(cached).toMatchObject({
			start: { x: 100, y: 0 },
			direction: { x: -1, y: 0 },
		})
		if (cached === null) return
		expect(
			resolveTangentSlide(cached, { x: 90, y: 20 })?.points[0],
		).toMatchObject({ x: 90, y: 0 })
	})

	it("keeps a zero-endpoint ray across modifier release and later gestures", () => {
		const glyphId = "glyph:memory" as GlyphId
		const masterId = "master:memory" as MasterId
		const memory = {
			glyphId,
			masterId,
			pointId,
			handle: "outgoing" as const,
			anchor: { x: 100, y: 20 },
			direction: { x: -8, y: 3 },
		}
		const zeroNode: EditorLayerNode = {
			pointId,
			mode: "soft",
			x: 100,
			y: 20,
			outgoing: { x: 0, y: 0 },
		}
		// Memory has no modifier lifecycle: releasing and repressing Alt reuses it.
		expect(
			rememberedTangentDirection(memory, { glyphId, masterId }, zeroNode),
		).toEqual(memory.direction)
		expect(
			rememberedTangentDirection(memory, { glyphId, masterId }, zeroNode),
		).toEqual(memory.direction)
		expect(
			rememberedTangentDirection(
				memory,
				{ glyphId: "glyph:other" as GlyphId, masterId },
				zeroNode,
			),
		).toBeUndefined()
		expect(
			rememberedTangentDirection(
				memory,
				{ glyphId, masterId },
				{
					...zeroNode,
					x: 101,
				},
			),
		).toBeUndefined()
	})

	it("requires a single node selection for Alt-arrow precedence", () => {
		const node: EditorLayerNode = {
			pointId,
			mode: "soft",
			x: 0,
			y: 0,
			incoming: { x: -10, y: 0 },
			outgoing: { x: 10, y: 0 },
		}
		const contours = [{ closed: false, nodes: [node] }]
		expect(
			selectedTangentSlideConstraint(contours, [{ kind: "node", pointId }])
				?.constraint,
		).not.toBeNull()
		expect(
			selectedTangentSlideConstraint(contours, [
				{ kind: "handle", pointId, handle: "incoming" },
			]),
		).toBeNull()
	})
})

describe("selected control nudging", () => {
	it("moves a hard handle independently and mixed owner controls rigidly", () => {
		const node: EditorLayerNode = {
			pointId,
			mode: "hard",
			x: 10,
			y: 20,
			incoming: { x: -5, y: 0 },
			outgoing: { x: 8, y: 0 },
		}
		expect(
			planSelectionNudge(
				[node],
				[{ kind: "handle", pointId, handle: "incoming" }],
				1,
				10,
			)?.result,
		).toEqual({
			points: [],
			handles: [{ pointId, handle: "incoming", x: 6, y: 30 }],
		})
		expect(
			planSelectionNudge(
				[node],
				[
					{ kind: "node", pointId },
					{ kind: "handle", pointId, handle: "outgoing" },
				],
				1,
				0,
			)?.result,
		).toEqual({
			points: [{ pointId, x: 11, y: 20 }],
			handles: [{ pointId, handle: "outgoing", x: 19, y: 20 }],
		})
	})

	it("expands both symmetric handles to their owner and resolves asymmetry", () => {
		const symmetric: EditorLayerNode = {
			pointId,
			mode: "soft",
			x: 0,
			y: 0,
			incoming: { x: -10, y: 0 },
			outgoing: { x: 20, y: 0 },
		}
		const rigid = planSelectionNudge(
			[symmetric],
			[
				{ kind: "handle", pointId, handle: "outgoing" },
				{ kind: "handle", pointId, handle: "incoming" },
			],
			0,
			10,
		)
		expect(rigid?.selection).toContainEqual({ kind: "node", pointId })
		expect(rigid?.result).toEqual({
			points: [{ pointId, x: 0, y: 10 }],
			handles: [
				{ pointId, handle: "incoming", x: -10, y: 10 },
				{ pointId, handle: "outgoing", x: 20, y: 10 },
			],
		})
		const reorderedWithDuplicate = planSelectionNudge(
			[symmetric],
			[
				{ kind: "handle", pointId, handle: "incoming" },
				{ kind: "handle", pointId, handle: "outgoing" },
				{ kind: "handle", pointId, handle: "incoming" },
			],
			0,
			10,
		)
		expect(reorderedWithDuplicate).toEqual(rigid)
		expect(reorderedWithDuplicate?.selection).toHaveLength(3)

		const { outgoing: _outgoing, ...asymmetric } = symmetric
		expect(
			planSelectionNudge(
				[asymmetric],
				[{ kind: "handle", pointId, handle: "incoming" }],
				0,
				10,
			)?.result.handles[0],
		).toMatchObject({
			x: -10,
			y: 10,
		})
	})

	it("rejects stale mixed selections atomically", () => {
		const node: EditorLayerNode = {
			pointId,
			mode: "hard",
			x: 0,
			y: 0,
		}
		expect(
			planSelectionNudge(
				[node],
				[
					{ kind: "node", pointId },
					{
						kind: "handle",
						pointId,
						handle: "incoming",
					},
				],
				1,
				0,
			),
		).toBeNull()
	})
})
