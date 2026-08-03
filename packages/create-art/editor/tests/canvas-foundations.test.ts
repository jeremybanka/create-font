import { describe, expect, it } from "vitest"

import {
	canvasScale,
	canvasToolCursor,
	documentToScreen,
	inverseCanvasScale,
	rankAxisCandidate,
	rankPointCandidate,
	reduceCanvasWheel,
	screenToDocument,
} from "../src/canvas-foundations.ts"

const options = { baseScale: 0.5, minZoom: 0.25, maxZoom: 8 }

describe("shared canvas foundations", () => {
	it("round trips document and screen coordinates", () => {
		const view = { x: 120, y: -45, zoom: 2 }
		const document = { x: 37.5, y: -18.25 }
		const screen = documentToScreen(document, view, options)
		expect(screenToDocument(screen, view, options)).toEqual(document)
		expect(canvasScale(view, options)).toBe(1)
		expect(inverseCanvasScale(view, options)).toBe(1)
	})

	it("zooms around the pointer and pans through the same wheel reducer", () => {
		const view = { x: 100, y: 80, zoom: 1 }
		const focal = { x: 300, y: 240 }
		const before = screenToDocument(focal, view, options)
		const zoomed = reduceCanvasWheel(
			view,
			{
				deltaX: 0,
				deltaY: -100,
				shiftKey: false,
				altKey: false,
				ctrlKey: true,
				metaKey: false,
			},
			focal,
			options,
		)
		expect(screenToDocument(focal, zoomed, options)).toEqual(before)
		expect(zoomed.zoom).toBeGreaterThan(1)
		expect(
			reduceCanvasWheel(
				view,
				{
					deltaX: 20,
					deltaY: 30,
					shiftKey: false,
					altKey: false,
					ctrlKey: false,
					metaKey: false,
				},
				focal,
				options,
			),
		).toEqual({ x: 80, y: 50, zoom: 1 })
	})

	it("ranks snap and hit ties deterministically", () => {
		expect(
			rankAxisCandidate(
				10,
				[
					{ id: "z", priority: 0, value: 12 },
					{ id: "a", priority: 0, value: 8 },
					{ id: "priority", priority: -1, value: 12 },
				],
				3,
			)?.id,
		).toBe("priority")
		expect(
			rankPointCandidate(
				{ x: 0, y: 0 },
				[
					{ id: "z", priority: 0, x: 3, y: 4 },
					{ id: "a", priority: 0, x: -3, y: -4 },
				],
				2,
				10,
			)?.id,
		).toBe("a")
	})

	it("keeps screen tolerances scale-independent and rejects invalid input", () => {
		const candidate = [{ id: "point", priority: 0, x: 10, y: 0 }]
		expect(rankPointCandidate({ x: 0, y: 0 }, candidate, 1, 10)).not.toBeNull()
		expect(rankPointCandidate({ x: 0, y: 0 }, candidate, 2, 10)).toBeNull()
		expect(rankAxisCandidate(Number.NaN, [], 3)).toBeNull()
		expect(rankPointCandidate({ x: 0, y: 0 }, candidate, 0, 10)).toBeNull()
	})

	it("resolves tool and gesture cursors", () => {
		expect(canvasToolCursor("pen")).toBe("crosshair")
		expect(canvasToolCursor("select", { overObject: true })).toBe("move")
		expect(canvasToolCursor("select", { dragging: true })).toBe("grabbing")
		expect(canvasToolCursor("transform", { resize: "nesw-resize" })).toBe(
			"nesw-resize",
		)
	})
})
