import { describe, expect, it } from "vitest"

import {
	BASE_CANVAS_SCALE,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	zoomCanvasView,
} from "../src/canvas-view.ts"

describe("canvas viewport", () => {
	it("clamps zoom from 25% through 1000%", () => {
		const current = { x: 72, y: 72, zoom: 1 }
		expect(
			zoomCanvasView(current, Number.POSITIVE_INFINITY, { x: 400, y: 300 })
				.zoom,
		).toBe(MAX_CANVAS_ZOOM)
		expect(zoomCanvasView(current, 0, { x: 400, y: 300 }).zoom).toBe(
			MIN_CANVAS_ZOOM,
		)
	})

	it("keeps the focal world coordinate invariant at either clamp", () => {
		const current = { x: -18, y: 37, zoom: 3.2 }
		const focal = { x: 317, y: 241 }
		const world = {
			x: (focal.x - current.x) / (BASE_CANVAS_SCALE * current.zoom),
			y: (focal.y - current.y) / (BASE_CANVAS_SCALE * current.zoom),
		}
		for (const requested of [0.01, 4.8, 100]) {
			const next = zoomCanvasView(current, requested, focal)
			expect((focal.x - next.x) / (BASE_CANVAS_SCALE * next.zoom)).toBeCloseTo(
				world.x,
				10,
			)
			expect((focal.y - next.y) / (BASE_CANVAS_SCALE * next.zoom)).toBeCloseTo(
				world.y,
				10,
			)
		}
	})

	it("does not drift across repeated capped operations", () => {
		const focal = { x: 480, y: 320 }
		let view = { x: 72, y: 72, zoom: 1 }
		for (let index = 0; index < 50; index += 1)
			view = zoomCanvasView(view, view.zoom * 1.2, focal)
		expect(view.zoom).toBe(10)
		const capped = view
		for (let index = 0; index < 20; index += 1)
			view = zoomCanvasView(view, view.zoom * 1.2, focal)
		expect(view).toEqual(capped)
	})
})
