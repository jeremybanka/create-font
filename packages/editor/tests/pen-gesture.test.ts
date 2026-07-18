import { describe, expect, it } from "vitest"

import { contourStartDirection } from "../src/geometry.ts"
import {
	PEN_DRAG_THRESHOLD_PIXELS,
	penEndpointHandleBeingReplaced,
	penGestureHandles,
	penLayerCoordinates,
	penPointerAction,
	resolvePenEndpoint,
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

	it("constrains Shift handles to all eight rays and resolves ties deterministically", () => {
		const directions = [
			[20, 1, 1, 0],
			[20, -20, 1, 1],
			[1, -20, 0, 1],
			[-20, -20, -1, 1],
			[-20, -1, -1, 0],
			[-20, 20, -1, -1],
			[-1, 20, 0, -1],
			[20, 20, 1, -1],
		] as const
		for (const [dx, dy, expectedX, expectedY] of directions) {
			const result = resolvePenGesture({
				downScreen: { x: 0, y: 0 },
				currentScreen: { x: dx, y: dy },
				worldScale: 1,
				shiftKey: true,
			})
			expect(result.kind).toBe("curve")
			if (result.kind !== "curve") continue
			const length = Math.hypot(dx, dy)
			expect(result.handles.outgoing.x).toBeCloseTo(
				expectedX *
					(expectedX !== 0 && expectedY !== 0 ? length / Math.SQRT2 : length),
			)
			expect(result.handles.outgoing.y).toBeCloseTo(
				expectedY *
					(expectedX !== 0 && expectedY !== 0 ? length / Math.SQRT2 : length),
			)
		}

		const tie = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: {
				x: Math.cos(Math.PI / 8) * 20,
				y: -Math.sin(Math.PI / 8) * 20,
			},
			worldScale: 1,
			shiftKey: true,
		})
		expect(tie.kind).toBe("curve")
		if (tie.kind === "curve") {
			expect(tie.handles.outgoing.x).toBeCloseTo(20 / Math.SQRT2)
			expect(tie.handles.outgoing.y).toBeCloseTo(20 / Math.SQRT2)
		}
	})

	it("authors soft, hard, Alt-converted, and cancelled endpoint handles on either side", () => {
		const drag = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 30, y: -40 },
			worldScale: 1,
		})
		const click = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 1, y: 1 },
			worldScale: 1,
		})
		expect(
			resolvePenEndpoint({
				side: "last",
				mode: "soft",
				incoming: { x: -12, y: 0 },
				outgoing: { x: 8, y: 0 },
				gesture: drag,
			}),
		).toEqual({
			mode: "soft",
			incoming: { x: -7.199999999999999, y: -9.600000000000001 },
			outgoing: { x: 30, y: 40 },
		})
		expect(
			resolvePenEndpoint({
				side: "first",
				mode: "hard",
				incoming: { x: -8, y: 0 },
				outgoing: { x: 12, y: 4 },
				gesture: drag,
			}),
		).toEqual({
			mode: "hard",
			incoming: { x: 30, y: 40 },
			outgoing: { x: 12, y: 4 },
		})
		expect(
			resolvePenEndpoint({
				side: "last",
				mode: "soft",
				incoming: { x: -12, y: 0 },
				outgoing: { x: 8, y: 0 },
				gesture: drag,
				altKey: true,
			}),
		).toEqual({
			mode: "hard",
			incoming: { x: -12, y: 0 },
			outgoing: { x: 30, y: 40 },
		})
		expect(
			resolvePenEndpoint({
				side: "last",
				mode: "soft",
				incoming: { x: -12, y: 0 },
				outgoing: { x: 8, y: 0 },
				gesture: click,
			}),
		).toEqual({ mode: "soft", incoming: { x: -12, y: 0 } })
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

	it.each([
		["unconstrained", false],
		["Shift-constrained", true],
	] as const)(
		"makes a first node's %s drag the eventual curve departure toward the pointer",
		(_label, shiftKey) => {
			const gesture = resolvePenGesture({
				downScreen: { x: 40, y: 40 },
				currentScreen: { x: 70, y: 55 },
				worldScale: 1,
				shiftKey,
			})
			const preview = penGestureHandles(gesture, "outgoing")
			const [committedFirst] = penLayerCoordinates(
				{ x: 100, y: 100 },
				gesture,
				[{ masterId: "master:text", xScale: 1 }],
				"outgoing",
			)
			const secondPoint = { x: 240, y: 100 }
			expect(preview).not.toBeNull()
			expect(committedFirst?.outgoing?.x).toBeCloseTo(
				preview?.outgoing.x ?? Number.NaN,
			)
			expect(committedFirst?.outgoing?.y).toBeCloseTo(
				preview?.outgoing.y ?? Number.NaN,
			)
			const departure = contourStartDirection([
				{
					x: committedFirst?.x ?? 100,
					y: committedFirst?.y ?? 100,
					...(committedFirst?.outgoing === undefined
						? {}
						: { outgoing: committedFirst.outgoing }),
				},
				secondPoint,
			])
			const pointerInFontSpace = { x: 30, y: -15 }
			const departureRadians =
				((departure?.angle ?? Number.NaN) * Math.PI) / 180
			expect(
				Math.cos(departureRadians) * pointerInFontSpace.x +
					Math.sin(departureRadians) * pointerInFontSpace.y,
			).toBeGreaterThan(0)
			expect(
				secondPoint.x - (committedFirst?.x ?? secondPoint.x),
			).toBeGreaterThan(0)
		},
	)

	it("assigns subsequent append and prepend drags to their connected handles", () => {
		const gesture = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 24, y: -12 },
			worldScale: 1,
		})
		const appendedPreview = penGestureHandles(gesture, "incoming")
		const prependedPreview = penGestureHandles(gesture, "outgoing")
		const [appendedCommit] = penLayerCoordinates(
			{ x: 300, y: 400 },
			gesture,
			[{ masterId: "master:text", xScale: 1 }],
			"incoming",
		)
		const [prependedCommit] = penLayerCoordinates(
			{ x: 300, y: 400 },
			gesture,
			[{ masterId: "master:text", xScale: 1 }],
			"outgoing",
		)
		expect(appendedCommit?.incoming).toEqual(appendedPreview?.incoming)
		expect(prependedCommit?.outgoing).toEqual(prependedPreview?.outgoing)
		expect(appendedPreview?.incoming).toEqual({ x: 24, y: 12 })
		expect(prependedPreview?.outgoing).toEqual({ x: 24, y: 12 })
		expect(appendedPreview?.outgoing).toEqual({ x: -24, y: -12 })
		expect(prependedPreview?.incoming).toEqual({ x: -24, y: -12 })
	})

	it("keeps append and prepend endpoint forward handles toward the pointer", () => {
		const gesture = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 30, y: -40 },
			worldScale: 1,
		})
		const first = resolvePenEndpoint({
			side: "first",
			mode: "hard",
			gesture,
		})
		const last = resolvePenEndpoint({
			side: "last",
			mode: "hard",
			gesture,
		})
		expect(first.incoming).toEqual({ x: 30, y: 40 })
		expect(last.outgoing).toEqual({ x: 30, y: 40 })
		const [firstCommit] = penLayerCoordinates(
			{ x: 100, y: 200 },
			gesture,
			[{ masterId: "master:text", xScale: 1 }],
			"incoming",
		)
		const [lastCommit] = penLayerCoordinates(
			{ x: 100, y: 200 },
			gesture,
			[{ masterId: "master:text", xScale: 1 }],
			"outgoing",
		)
		expect(firstCommit?.incoming).toEqual(first.incoming)
		expect(lastCommit?.outgoing).toEqual(last.outgoing)
	})

	it("subdues only the previous forward endpoint handle during a curve drag", () => {
		const curve = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 20, y: 0 },
			worldScale: 1,
		})
		const click = resolvePenGesture({
			downScreen: { x: 0, y: 0 },
			currentScreen: { x: 1, y: 0 },
			worldScale: 1,
		})
		expect(
			penEndpointHandleBeingReplaced(
				{ pointId: "point:first", side: "first" },
				curve,
			),
		).toEqual({ pointId: "point:first", handle: "incoming" })
		expect(
			penEndpointHandleBeingReplaced(
				{ pointId: "point:last", side: "last" },
				curve,
			),
		).toEqual({ pointId: "point:last", handle: "outgoing" })
		expect(
			penEndpointHandleBeingReplaced(
				{ pointId: "point:last", side: "last" },
				click,
			),
		).toBeNull()
		expect(penEndpointHandleBeingReplaced(null, curve)).toBeNull()
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
		expect(penPointerAction("open-endpoint")).toBe("resume")
		expect(penPointerAction("control")).toBe("consume")
		expect(penPointerAction("background")).toBe("place")
		expect(penPointerAction("typed-glyph")).toBe("place")
	})
})
