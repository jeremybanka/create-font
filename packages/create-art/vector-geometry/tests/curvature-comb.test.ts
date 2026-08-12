import { describe, expect, it } from "vitest"

import {
	createCurvatureComb,
	sampleCubicCurvature,
} from "../src/curvature-comb.ts"

const arch = {
	p0: { x: 0, y: 0 },
	c1: { x: 0, y: 100 },
	c2: { x: 100, y: 100 },
	p3: { x: 100, y: 0 },
}

describe("curvature comb", () => {
	it("evaluates signed curvature and rejects a zero-speed cusp", () => {
		expect(sampleCubicCurvature(arch, 0)).toEqual({
			point: { x: 0, y: 0 },
			tangent: { x: 0, y: 300 },
			curvature: -1 / 150,
		})
		expect(
			sampleCubicCurvature(
				{
					p0: { x: 0, y: 0 },
					c1: { x: 0, y: 0 },
					c2: { x: 100, y: 0 },
					p3: { x: 100, y: 0 },
				},
				0,
			),
		).toBeNull()
	})

	it("distributes cells, color maps magnitudes, and supports both normal modes", () => {
		const contour = {
			closed: false,
			nodes: [
				{ x: 0, y: 0, outgoing: { x: 0, y: 100 } },
				{
					x: 100,
					y: 0,
					incoming: { x: 0, y: 100 },
					outgoing: { x: 0, y: -100 },
				},
				{ x: 200, y: 0, incoming: { x: 0, y: -100 } },
			],
		}
		const outside = createCurvatureComb([contour], {
			gain: 1,
			side: "outside",
			referenceUnits: 1_000,
		})
		const signed = createCurvatureComb([contour], {
			gain: 1,
			side: "signed",
			referenceUnits: 1_000,
		})
		expect(outside).toHaveLength(400)
		expect(new Set(outside.map(({ color }) => color)).size).toBeGreaterThan(1)
		expect(outside[0]?.path).not.toBe(signed[0]?.path)
		expect(outside.every(({ curvature }) => Number.isFinite(curvature))).toBe(
			true,
		)
	})

	it("omits straight contours and rejects invalid gain or reference scale", () => {
		const straight = [
			{
				closed: false,
				nodes: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 },
				],
			},
		]
		expect(
			createCurvatureComb(straight, {
				gain: 1,
				side: "outside",
				referenceUnits: 1_000,
			}),
		).toEqual([])
		expect(
			createCurvatureComb(
				[
					{
						closed: false,
						nodes: [
							{ x: 0, y: 0, outgoing: { x: 10, y: 10 } },
							{ x: 20, y: 0 },
						],
					},
				],
				{
					gain: Number.NaN,
					side: "outside",
					referenceUnits: 0,
				},
			),
		).toEqual([])
	})
})
