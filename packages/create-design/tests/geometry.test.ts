import { describe, expect, it } from "vitest"

import {
	ellipseContour,
	normalizedBounds,
	objectSvgPath,
	rectangleContour,
	scaleObject,
} from "../src/geometry.ts"

describe("design geometry", () => {
	it("uses the same editable contour model for primitive shapes", () => {
		expect(
			rectangleContour({ minX: 10, minY: 20, maxX: 110, maxY: 80 }).points,
		).toHaveLength(4)
		expect(
			ellipseContour({ minX: 10, minY: 20, maxX: 110, maxY: 80 }).points.every(
				(point) => point.incoming !== undefined && point.outgoing !== undefined,
			),
		).toBe(true)
	})

	it("builds cubic SVG paths and scales control vectors", () => {
		const object = {
			id: "object:test",
			name: "Ellipse",
			fillId: "swatch:test",
			contours: [ellipseContour({ minX: 0, minY: 0, maxX: 100, maxY: 100 })],
		}
		expect(objectSvgPath(object)).toContain("C")
		const scaled = scaleObject(object, { x: 0, y: 0 }, 2, 0.5)
		expect(scaled.contours[0]?.points[0]?.x).toBe(100)
		expect(scaled.contours[0]?.points[0]?.outgoing?.x).toBeGreaterThan(50)
	})

	it("supports constrained, centered drawing bounds", () => {
		expect(
			normalizedBounds({ x: 50, y: 50 }, { x: 80, y: 70 }, true, true),
		).toEqual({ minX: 20, minY: 20, maxX: 80, maxY: 80 })
	})
})
