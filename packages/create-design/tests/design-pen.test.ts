import { describe, expect, it } from "vitest"

import {
	cancelDesignPen,
	createDesignPenObject,
	DESIGN_PEN_DRAG_THRESHOLD_PIXELS,
	finishDesignPenContour,
	resolveDesignPenPoint,
	shouldCloseDesignPen,
} from "../src/design-pen.ts"

describe("design Pen lifecycle", () => {
	const gesture = {
		anchor: { x: 100, y: 120 },
		downScreen: { x: 200, y: 240 },
	}

	it("creates hard points for clicks and symmetric soft handles for drags", () => {
		expect(
			resolveDesignPenPoint({
				gesture,
				current: { x: 102, y: 121 },
				currentScreen: { x: 203, y: 242 },
			}),
		).toEqual({ x: 100, y: 120 })

		expect(
			resolveDesignPenPoint({
				gesture,
				current: { x: 130, y: 140 },
				currentScreen: {
					x: 200 + DESIGN_PEN_DRAG_THRESHOLD_PIXELS,
					y: 240,
				},
			}),
		).toEqual({
			x: 100,
			y: 120,
			incoming: { x: -30, y: -20 },
			outgoing: { x: 30, y: 20 },
		})
	})

	it("constrains Shift-dragged handles while keeping them opposite", () => {
		const point = resolveDesignPenPoint({
			gesture,
			current: { x: 132, y: 129 },
			currentScreen: { x: 232, y: 249 },
			shiftKey: true,
		})
		expect(point.outgoing?.y).toBe(0)
		expect(point.incoming?.x).toBeCloseTo(-(point.outgoing?.x ?? 0))
		expect(point.incoming?.y).toBeCloseTo(-(point.outgoing?.y ?? 0))
	})

	it("closes only a three-node contour when the start is clicked", () => {
		const points = [
			{ x: 20, y: 20 },
			{ x: 80, y: 20 },
			{ x: 80, y: 80 },
		]
		expect(shouldCloseDesignPen(points, { x: 24, y: 20 }, 2)).toBe(true)
		expect(shouldCloseDesignPen(points, { x: 26, y: 20 }, 2)).toBe(false)
		expect(shouldCloseDesignPen(points.slice(0, 2), { x: 20, y: 20 }, 2)).toBe(
			false,
		)
	})

	it("finishes open and closed contours without changing their topology", () => {
		const points = [
			{ x: 20, y: 20 },
			{ x: 80, y: 20 },
			{ x: 80, y: 80 },
		]
		expect(finishDesignPenContour(points, false)).toEqual({
			closed: false,
			points,
		})
		expect(finishDesignPenContour(points, true)).toEqual({
			closed: true,
			points,
		})
		expect(finishDesignPenContour(points.slice(0, 1), false)).toBeNull()
		expect(finishDesignPenContour(points.slice(0, 2), true)).toBeNull()
	})

	it("creates one real object on finish and nothing on cancel", () => {
		const points = [
			{ x: 10, y: 10 },
			{ x: 50, y: 10 },
			{ x: 50, y: 50 },
		]
		expect(
			createDesignPenObject({
				id: "object:pen",
				name: "Pen path",
				fillId: "swatch:coral",
				points,
				closed: false,
			}),
		).toMatchObject({
			id: "object:pen",
			contours: [{ closed: false, points }],
		})
		expect(cancelDesignPen()).toEqual([])
	})
})
