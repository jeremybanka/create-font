import type { ContourId, PointId } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	circularHitRegion,
	editorControlHitCandidates,
	editorControlHitRadii,
	nearestEditorControlHit,
	nearestEditorSegmentHit,
	resolveEditorCanvasHit,
} from "../src/canvas-hit-testing.ts"
import type { EditorCanvasContour } from "../src/editor-workspace.ts"

const pointId = (value: string) => `point:${value}` as PointId
const contourId = (value: string) => `contour:${value}` as ContourId

const contours: readonly EditorCanvasContour[] = [
	{
		id: contourId("main"),
		closed: false,
		nodes: [
			{
				pointId: pointId("a"),
				mode: "hard",
				x: 0,
				y: 0,
				outgoing: { x: 20, y: 0 },
			},
			{ pointId: pointId("b"), mode: "hard", x: 100, y: 0 },
		],
	},
]

describe("canvas hit testing", () => {
	it("draws circular hit regions independently of visible geometry", () => {
		const calls: unknown[] = []
		const shape = { id: "shape" }
		circularHitRegion(12, { x: 4, y: 5 })(
			{
				beginPath: () => calls.push("begin"),
				arc: (...values) => calls.push(["arc", ...values]),
				closePath: () => calls.push("close"),
				fillStrokeShape: (value) => calls.push(["fill", value]),
			},
			shape,
		)
		expect(calls).toEqual([
			"begin",
			["arc", 4, 5, 12, 0, Math.PI * 2],
			"close",
			["fill", shape],
		])
	})

	it("projects nodes and handles into one stable control candidate list", () => {
		expect(editorControlHitCandidates(contours)).toEqual([
			{ target: { kind: "node", pointId: pointId("a") }, x: 0, y: 0 },
			{
				target: {
					kind: "handle",
					pointId: pointId("a"),
					handle: "outgoing",
				},
				x: 20,
				y: 0,
			},
			{ target: { kind: "node", pointId: pointId("b") }, x: 100, y: 0 },
		])
	})

	it("uses zoom-stable screen distances", () => {
		const controls = editorControlHitCandidates(contours)
		expect(
			nearestEditorControlHit(controls, { x: 8, y: 0 }, 1)?.target,
		).toEqual({ kind: "node", pointId: pointId("a") })
		expect(nearestEditorControlHit(controls, { x: 8, y: 0 }, 2)).toBeNull()
		expect(
			nearestEditorControlHit(controls, { x: 4, y: 0 }, 2)?.target,
		).toEqual({ kind: "node", pointId: pointId("a") })
	})

	it("gives every distinct crowded control its nearest-side region", () => {
		const left = {
			target: { kind: "node" as const, pointId: pointId("left") },
			x: 0,
			y: 0,
		}
		const right = {
			target: { kind: "node" as const, pointId: pointId("right") },
			x: 4,
			y: 0,
		}
		for (const candidates of [
			[left, right],
			[right, left],
		] as const) {
			expect(
				nearestEditorControlHit(candidates, { x: 1, y: 0 }, 1)?.target,
			).toEqual(left.target)
			expect(
				nearestEditorControlHit(candidates, { x: 3, y: 0 }, 1)?.target,
			).toEqual(right.target)
		}
		const radii = editorControlHitRadii([left, right], 1)
		expect(radii.get("node/point:left")).toBe(2)
		expect(radii.get("node/point:right")).toBe(2)
	})

	it("gives exact-coincident controls one stable draggable owner", () => {
		const controls = [
			{
				target: { kind: "node" as const, pointId: pointId("z") },
				x: 0,
				y: 0,
			},
			{
				target: { kind: "node" as const, pointId: pointId("a") },
				x: 0,
				y: 0,
			},
			{
				target: { kind: "node" as const, pointId: pointId("nearby") },
				x: 8,
				y: 0,
			},
		]
		for (const ordered of [controls, [...controls].reverse()]) {
			expect(
				nearestEditorControlHit(ordered, { x: 0, y: 0 }, 1)?.target,
			).toEqual(controls[1]?.target)
			const radii = editorControlHitRadii(ordered, 1)
			expect(radii.get("node/point:a")).toBe(4)
			expect(radii.get("node/point:z")).toBe(0)
			expect(radii.get("node/point:nearby")).toBe(4)
		}
	})

	it("finds the nearest path within a forgiving screen-space radius", () => {
		const hit = nearestEditorSegmentHit(contours, { x: 50, y: 11 }, 1)
		expect(hit).toMatchObject({
			kind: "segment",
			contourId: contourId("main"),
		})
		expect(hit?.distancePx).toBeCloseTo(11, 10)
		expect(nearestEditorSegmentHit(contours, { x: 50, y: 13 }, 1)).toBeNull()
		expect(
			nearestEditorSegmentHit(contours, { x: 50, y: 5.5 }, 2)?.distancePx,
		).toBeCloseTo(11, 10)
	})

	it("uses contour IDs instead of render order to break path ties", () => {
		const line = (id: string, y: number): EditorCanvasContour => ({
			id: contourId(id),
			closed: false,
			nodes: [
				{ pointId: pointId(`${id}-a`), mode: "hard", x: 0, y },
				{ pointId: pointId(`${id}-b`), mode: "hard", x: 100, y },
			],
		})
		const upper = line("z", -5)
		const lower = line("a", 5)
		for (const ordered of [
			[upper, lower],
			[lower, upper],
		] as const) {
			expect(
				nearestEditorSegmentHit(ordered, { x: 50, y: 0 }, 1)?.contourId,
			).toBe(contourId("a"))
		}
	})

	it("always resolves an eligible control before a path", () => {
		const controls = [
			{
				target: { kind: "node" as const, pointId: pointId("near") },
				x: 50,
				y: 10,
			},
		]
		expect(
			resolveEditorCanvasHit({
				controls,
				contours,
				pointer: { x: 50, y: 1 },
				worldScale: 1,
			}),
		).toMatchObject({ kind: "control", target: controls[0]?.target })
	})
})
