import { describe, expect, it } from "vitest"

import { evaluateCubicCurve, splitCubicCurve } from "../src/index.ts"

describe("cubic curve geometry", () => {
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
})
