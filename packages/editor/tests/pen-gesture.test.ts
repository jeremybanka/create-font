import { describe, expect, it } from "vitest"

import {
	PEN_DRAG_THRESHOLD_PIXELS,
	penLayerCoordinates,
	penPointerAction,
	resolvePenGesture,
} from "../src/pen-gesture.ts"

describe("Pen gestures", () => {
	it("keeps pointer jitter as a hard click at every zoom", () => {
		for (const worldScale of [0.045, 0.18, 0.72]) {
			expect(
				resolvePenGesture({
					downScreen: { x: 100, y: 100 },
					currentScreen: { x: 103, y: 102 },
					worldScale,
				}),
			).toMatchObject({ kind: "click", mode: "hard", handles: null })
		}
	})

	it("creates a soft opposite-ray pair at the screen-space threshold", () => {
		const result = resolvePenGesture({
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 100 + PEN_DRAG_THRESHOLD_PIXELS, y: 100 },
			worldScale: 0.5,
		})
		expect(result).toEqual({
			kind: "curve",
			mode: "soft",
			distancePixels: PEN_DRAG_THRESHOLD_PIXELS,
			handles: {
				incoming: { x: -8, y: 0 },
				outgoing: { x: 8, y: 0 },
			},
		})
	})

	it("inverts screen y while preserving preview and commit parity", () => {
		const input = {
			downScreen: { x: 100, y: 100 },
			currentScreen: { x: 120, y: 80 },
			worldScale: 0.25,
		}
		const preview = resolvePenGesture(input)
		const commit = resolvePenGesture(input)
		expect(commit).toEqual(preview)
		expect(preview.handles).toEqual({
			incoming: { x: -80, y: -80 },
			outgoing: { x: 80, y: 80 },
		})
	})

	it("maps nodes and dragged endpoints into every master", () => {
		const gesture = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 18, y: -9 },
			worldScale: 0.18,
		})
		const layers = penLayerCoordinates({ x: 300, y: 400 }, gesture, [
			{ masterId: "master:text", xScale: 1 },
			{ masterId: "master:heavy", xScale: 0.94 },
		])
		expect(layers).toEqual([
			{
				masterId: "master:text",
				x: 300,
				y: 400,
				incoming: { x: -100, y: -50 },
				outgoing: { x: 100, y: 50 },
			},
			{
				masterId: "master:heavy",
				x: 312,
				y: 400,
				incoming: { x: -94, y: -50 },
				outgoing: { x: 94, y: 50 },
			},
		])
		for (const layer of layers) {
			expect(layer.incoming?.x).toBe(-(layer.outgoing?.x ?? Number.NaN))
			expect(layer.incoming?.y).toBe(-(layer.outgoing?.y ?? Number.NaN))
		}
	})

	it("keeps layer handles exactly opposite when the mapped node rounds", () => {
		const gesture = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 13, y: 7 },
			worldScale: 0.18,
		})
		const [layer] = penLayerCoordinates({ x: 301, y: 407 }, gesture, [
			{ masterId: "master:rounded", xScale: 0.94 },
		])
		expect(layer?.incoming?.x).toBe(-(layer?.outgoing?.x ?? Number.NaN))
		expect(layer?.incoming?.y).toBe(-(layer?.outgoing?.y ?? Number.NaN))
	})

	it("preserves segment, closure, control, then background semantics", () => {
		expect(penPointerAction("segment")).toBe("split")
		expect(penPointerAction("first-node")).toBe("close")
		expect(penPointerAction("control")).toBe("consume")
		expect(penPointerAction("background")).toBe("place")
		expect(penPointerAction("typed-glyph")).toBe("place")
	})
})
