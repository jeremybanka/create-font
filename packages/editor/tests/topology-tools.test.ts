import { describe, expect, it } from "vitest"

import type { EditorCanvasContour } from "../src/editor-workspace.ts"
import {
	ENDPOINT_JOIN_RADIUS_PX,
	finalizePointDragPreview,
	resolveOpenEndpointTarget,
	type OpenEndpointTarget,
} from "../src/topology-tools.ts"

const contours: readonly EditorCanvasContour[] = [
	{
		id: "contour:source",
		closed: false,
		nodes: [
			{ pointId: "point:source:first", mode: "hard", x: 0, y: 0 },
			{ pointId: "point:source:last", mode: "hard", x: 100, y: 0 },
		],
	},
	{
		id: "contour:target:b",
		closed: false,
		nodes: [
			{ pointId: "point:target:b:first", mode: "hard", x: 120, y: 0 },
			{ pointId: "point:target:b:last", mode: "hard", x: 200, y: 0 },
		],
	},
	{
		id: "contour:target:a",
		closed: false,
		nodes: [
			{ pointId: "point:target:a:first", mode: "hard", x: 120, y: 0 },
			{ pointId: "point:target:a:last", mode: "hard", x: 220, y: 0 },
		],
	},
	{
		id: "contour:closed",
		closed: true,
		nodes: [
			{ pointId: "point:closed:first", mode: "hard", x: 110, y: 0 },
			{ pointId: "point:closed:last", mode: "hard", x: 130, y: 0 },
		],
	},
]

describe("open endpoint join targeting", () => {
	it("uses a zoom-stable radius and deterministic contour/point tie ordering", () => {
		expect(
			resolveOpenEndpointTarget(
				contours,
				"contour:source",
				"point:source:last",
				{ x: 120, y: 0 },
				1,
			),
		).toEqual({
			contourId: "contour:target:a",
			pointId: "point:target:a:first",
			x: 120,
			y: 0,
		})
		expect(
			resolveOpenEndpointTarget(
				contours,
				"contour:source",
				"point:source:last",
				{ x: 120 + ENDPOINT_JOIN_RADIUS_PX / 2, y: 0 },
				2,
			),
		).not.toBeNull()
		expect(
			resolveOpenEndpointTarget(
				contours,
				"contour:source",
				"point:source:last",
				{ x: 120 + ENDPOINT_JOIN_RADIUS_PX / 2 + 0.01, y: 0 },
				2,
			),
		).toBeNull()
	})

	it("rejects the source contour, closed contours, and interior nodes", () => {
		expect(
			resolveOpenEndpointTarget(
				contours,
				"contour:source",
				"point:source:last",
				{ x: 100, y: 0 },
				1,
				5,
			),
		).toBeNull()
	})
})

describe("point drag finalization", () => {
	it("restores failed previews and clears every transient join field", () => {
		const positions: { x: number; y: number }[] = []
		let drawCount = 0
		const drag = {
			origin: { x: 10, y: 20 },
			target: {
				position(point: Readonly<{ x: number; y: number }>) {
					positions.push({ ...point })
				},
				getLayer: () => ({
					batchDraw: () => {
						drawCount += 1
					},
				}),
			},
			lastRawPoint: { x: 30, y: 40 } as Readonly<{
				x: number
				y: number
			}> | null,
			joinTarget: {
				contourId: "contour:target:a",
				pointId: "point:target:a:first",
				x: 120,
				y: 0,
			} as const satisfies OpenEndpointTarget,
		}

		finalizePointDragPreview(drag, true)

		expect(positions).toEqual([{ x: 10, y: 20 }])
		expect(drawCount).toBe(1)
		expect(drag.lastRawPoint).toBeNull()
		expect(drag.joinTarget).toBeNull()
	})
})
