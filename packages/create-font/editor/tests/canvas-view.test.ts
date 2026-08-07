import { describe, expect, it } from "vitest"

import {
	BASE_CANVAS_SCALE,
	initialCanvasView,
	initializeCanvasView,
	MAX_CANVAS_ZOOM,
	MIN_CANVAS_ZOOM,
	zoomCanvasView,
} from "../src/canvas-view.ts"

describe("canvas viewport", () => {
	it.each([
		[
			{ width: 1_200, height: 600 },
			{ x: 400, y: 200, zoom: 1 },
		],
		[
			{ width: 480, height: 1_440 },
			{ x: 160, y: 480, zoom: 1 },
		],
		[
			{ width: 1_000.5, height: 749.25 },
			{ x: 333.5, y: 249.75, zoom: 1 },
		],
	] as const)(
		"initializes one-third into a %# viewport",
		(viewport, expected) => {
			expect(initialCanvasView(viewport)).toEqual(expected)
		},
	)

	it.each([
		{ width: 0, height: 600 },
		{ width: 800, height: 0 },
		{ width: Number.NaN, height: 600 },
		{ width: 800, height: Number.POSITIVE_INFINITY },
	])("waits for a finite positive viewport: %#", (viewport) => {
		expect(initialCanvasView(viewport)).toBeNull()
	})

	it("initializes after a zero-size mount and preserves a manipulated view on resize", () => {
		const placeholder = { x: 72, y: 72, zoom: 1 }
		const measured = { width: 900, height: 600 }
		const initialized = initializeCanvasView(
			placeholder,
			{ width: 0, height: 0 },
			measured,
		)
		expect(initialized).toEqual({ x: 300, y: 200, zoom: 1 })

		const manipulated = { x: -45, y: 123, zoom: 2.5 }
		expect(
			initializeCanvasView(manipulated, measured, {
				width: 1_440,
				height: 900,
			}),
		).toBe(manipulated)
	})

	it("clamps zoom from 5% through 1000%", () => {
		const current = { x: 72, y: 72, zoom: 1 }
		expect(MIN_CANVAS_ZOOM).toBe(0.05)
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
