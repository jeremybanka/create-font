import { describe, expect, it } from "vitest"

import {
	cubicCurveBounds,
	evaluateCubicCurve,
	interpolateCurvePoint,
	splitCubicCurve,
	straightSegmentHandles,
} from "../src/index.ts"

describe("cubic curve geometry", () => {
	it("finds interior extrema instead of using the control hull", () => {
		const bounds = cubicCurveBounds({
			p0: { x: 0, y: 0 },
			c1: { x: -120, y: 120 },
			c2: { x: 220, y: 120 },
			p3: { x: 100, y: 0 },
		})
		expect(bounds.minX).toBeCloseTo(-26.072, 3)
		expect(bounds.maxX).toBeCloseTo(126.072, 3)
		expect(bounds.minY).toBe(0)
		expect(bounds.maxY).toBe(90)
	})

	it("bounds degenerate linear cubics by their endpoints", () => {
		expect(
			cubicCurveBounds({
				p0: { x: -20, y: 40 },
				c1: { x: -20, y: 40 },
				c2: { x: 60, y: -10 },
				p3: { x: 60, y: -10 },
			}),
		).toEqual({ minX: -20, minY: -10, maxX: 60, maxY: 40 })
	})

	it("splits a cubic without changing its locus", () => {
		const cubic = {
			p0: { x: 0, y: 0 },
			c1: { x: 20, y: 100 },
			c2: { x: 80, y: 100 },
			p3: { x: 100, y: 0 },
		}
		const amount = 0.3
		const split = splitCubicCurve(cubic, amount)
		const expectedSplit = evaluateCubicCurve(cubic, amount)
		expect(split.point.x).toBeCloseTo(expectedSplit.x, 12)
		expect(split.point.y).toBeCloseTo(expectedSplit.y, 12)
		for (const local of [0, 0.2, 0.5, 0.8, 1]) {
			expect(evaluateCubicCurve(split.left, local).x).toBeCloseTo(
				evaluateCubicCurve(cubic, local * amount).x,
				10,
			)
			expect(evaluateCubicCurve(split.left, local).y).toBeCloseTo(
				evaluateCubicCurve(cubic, local * amount).y,
				10,
			)
			expect(evaluateCubicCurve(split.right, local).x).toBeCloseTo(
				evaluateCubicCurve(cubic, amount + local * (1 - amount)).x,
				10,
			)
			expect(evaluateCubicCurve(split.right, local).y).toBeCloseTo(
				evaluateCubicCurve(cubic, amount + local * (1 - amount)).y,
				10,
			)
		}
	})

	it("rejects non-normalized split parameters", () => {
		const cubic = {
			p0: { x: 0, y: 0 },
			c1: { x: 0, y: 0 },
			c2: { x: 1, y: 1 },
			p3: { x: 1, y: 1 },
		}
		expect(() => splitCubicCurve(cubic, -0.1)).toThrow(/\[0, 1\]/)
		expect(() => splitCubicCurve(cubic, 1.1)).toThrow(/\[0, 1\]/)
	})

	it.each([
		[
			{ x: 0, y: 0 },
			{ x: 90, y: 0 },
		],
		[
			{ x: 20, y: -30 },
			{ x: 20, y: 60 },
		],
		[
			{ x: -40, y: 80 },
			{ x: 50, y: -10 },
		],
	] as const)(
		"creates one-third handles that preserve a straight segment",
		(start, end) => {
			const handles = straightSegmentHandles(start, end)
			if (handles === null) throw new Error("Fixture segment is degenerate.")
			expect(handles.startOutgoing).toEqual({
				x: (end.x - start.x) / 3,
				y: (end.y - start.y) / 3,
			})
			expect(handles.endIncoming).toEqual({
				x: (start.x - end.x) / 3,
				y: (start.y - end.y) / 3,
			})
			const cubic = {
				p0: start,
				c1: {
					x: start.x + handles.startOutgoing.x,
					y: start.y + handles.startOutgoing.y,
				},
				c2: {
					x: end.x + handles.endIncoming.x,
					y: end.y + handles.endIncoming.y,
				},
				p3: end,
			}
			for (const amount of [0, 0.2, 0.5, 0.8, 1]) {
				const actual = evaluateCubicCurve(cubic, amount)
				const expected = interpolateCurvePoint(start, end, amount)
				expect(actual.x).toBeCloseTo(expected.x, 12)
				expect(actual.y).toBeCloseTo(expected.y, 12)
			}
		},
	)

	it("rejects invalid segments without producing signed zero", () => {
		expect(straightSegmentHandles({ x: 4, y: -2 }, { x: 4, y: -2 })).toBeNull()
		expect(
			straightSegmentHandles({ x: Number.NaN, y: 0 }, { x: 10, y: 0 }),
		).toBeNull()
		expect(
			straightSegmentHandles(
				{ x: 0, y: 0 },
				{ x: Number.POSITIVE_INFINITY, y: 0 },
			),
		).toBeNull()
		expect(straightSegmentHandles({ x: 0, y: 0 }, { x: 0, y: 30 })).toEqual({
			startOutgoing: { x: 0, y: 10 },
			endIncoming: { x: 0, y: -10 },
		})
	})
})
