import { describe, expect, it } from "vitest"

import {
	dragVectorControlsWithFixedHandles,
	translateVectorControls,
	vectorHandleSelectionKey,
	type VectorControlSelection,
} from "../src/vector-control-editing.ts"
import type { VectorContour, VectorNode } from "../src/vector-editing.ts"

const contour = (...nodes: readonly VectorNode[]): readonly VectorContour[] => [
	{ id: "contour", closed: false, nodes },
]

const selection = (
	nodes: readonly string[] = [],
	handles: readonly (readonly [string, "incoming" | "outgoing"])[] = [],
): VectorControlSelection => ({
	nodes: new Set(nodes),
	handles: new Set(
		handles.map(([pointId, handle]) =>
			vectorHandleSelectionKey(pointId, handle),
		),
	),
})

describe("shared vector control editing", () => {
	it("moves one hard handle independently", () => {
		const result = translateVectorControls(
			contour({
				id: "a",
				mode: "hard",
				x: 10,
				y: 20,
				incoming: { x: -5, y: 0 },
				outgoing: { x: 8, y: 0 },
			}),
			selection([], [["a", "outgoing"]]),
			{ x: 2, y: 3 },
		)
		expect(result?.contours[0]?.nodes[0]).toEqual({
			id: "a",
			mode: "hard",
			x: 10,
			y: 20,
			incoming: { x: -5, y: 0 },
			outgoing: { x: 10, y: 3 },
		})
	})

	it("keeps a two-sided soft handle opposite and preserves its length", () => {
		const result = translateVectorControls(
			contour({
				id: "a",
				mode: "soft",
				x: 0,
				y: 0,
				incoming: { x: -5, y: 0 },
				outgoing: { x: 10, y: 0 },
			}),
			selection([], [["a", "outgoing"]]),
			{ x: 0, y: 10 },
		)
		const node = result?.contours[0]?.nodes[0]
		expect(node?.outgoing).toEqual({ x: 10, y: 10 })
		expect(
			Math.hypot(node?.incoming?.x ?? 0, node?.incoming?.y ?? 0),
		).toBeCloseTo(5)
		expect(
			(node?.incoming?.x ?? 0) * (node?.outgoing?.y ?? 0) -
				(node?.incoming?.y ?? 0) * (node?.outgoing?.x ?? 0),
		).toBeCloseTo(0)
		expect(
			(node?.incoming?.x ?? 0) * (node?.outgoing?.x ?? 0) +
				(node?.incoming?.y ?? 0) * (node?.outgoing?.y ?? 0),
		).toBeLessThan(0)
	})

	it("implicitly moves a soft owner when both handles are selected", () => {
		const result = translateVectorControls(
			contour({
				id: "a",
				mode: "soft",
				x: 10,
				y: 20,
				incoming: { x: -5, y: 0 },
				outgoing: { x: 8, y: 0 },
			}),
			selection(
				[],
				[
					["a", "incoming"],
					["a", "outgoing"],
				],
			),
			{ x: 4, y: -3 },
		)
		expect(result?.contours[0]?.nodes[0]).toMatchObject({
			x: 14,
			y: 17,
			incoming: { x: -5, y: 0 },
			outgoing: { x: 8, y: 0 },
		})
	})

	it("Alt-drags a hard node while its absolute endpoints remain fixed", () => {
		const original: VectorNode = {
			id: "a",
			mode: "hard",
			x: 10,
			y: 20,
			incoming: { x: -5, y: 2 },
			outgoing: { x: 8, y: -3 },
		}
		const result = dragVectorControlsWithFixedHandles(
			contour(original),
			selection(["a"]),
			"a",
			{ x: 7, y: 11 },
		)
		const moved = result?.contours[0]?.nodes[0]
		expect(moved).toMatchObject({ x: 17, y: 31 })
		expect({
			x: (moved?.x ?? 0) + (moved?.incoming?.x ?? 0),
			y: (moved?.y ?? 0) + (moved?.incoming?.y ?? 0),
		}).toEqual({ x: 5, y: 22 })
		expect({
			x: (moved?.x ?? 0) + (moved?.outgoing?.x ?? 0),
			y: (moved?.y ?? 0) + (moved?.outgoing?.y ?? 0),
		}).toEqual({ x: 18, y: 17 })
	})

	it("projects an Alt-dragged soft node onto its fixed handle tangent", () => {
		const result = dragVectorControlsWithFixedHandles(
			contour({
				id: "a",
				mode: "soft",
				x: 10,
				y: 0,
				incoming: { x: -10, y: 0 },
				outgoing: { x: 20, y: 0 },
			}),
			selection(["a"]),
			"a",
			{ x: 7, y: 50 },
		)
		const moved = result?.contours[0]?.nodes[0]
		expect(moved).toMatchObject({ x: 17, y: 0 })
		expect({
			x: (moved?.x ?? 0) + (moved?.incoming?.x ?? 0),
			y: (moved?.y ?? 0) + (moved?.incoming?.y ?? 0),
		}).toEqual({ x: 0, y: 0 })
		expect({
			x: (moved?.x ?? 0) + (moved?.outgoing?.x ?? 0),
			y: (moved?.y ?? 0) + (moved?.outgoing?.y ?? 0),
		}).toEqual({ x: 30, y: 0 })
	})

	it("moves an explicitly selected hard handle with its Alt-dragged owner", () => {
		const result = dragVectorControlsWithFixedHandles(
			contour({
				id: "a",
				mode: "hard",
				x: 10,
				y: 10,
				incoming: { x: -5, y: 0 },
				outgoing: { x: 8, y: 0 },
			}),
			selection(["a"], [["a", "outgoing"]]),
			"a",
			{ x: 4, y: 6 },
		)
		const moved = result?.contours[0]?.nodes[0]
		expect(moved).toMatchObject({
			x: 14,
			y: 16,
			incoming: { x: -9, y: -6 },
			outgoing: { x: 8, y: 0 },
		})
	})
})
