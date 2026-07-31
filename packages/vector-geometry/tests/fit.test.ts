import { describe, expect, it } from "vitest"

import { fitCubicContour, flattenCubic, GeometryError } from "../src/index.ts"
import type { Cubic, Point } from "../src/types.ts"

const KAPPA = (4 / 3) * Math.tan(Math.PI / 8)

function circleCubics(radius: number): readonly Cubic[] {
	const handle = radius * KAPPA
	return [
		{
			p0: { x: 0, y: -radius },
			c1: { x: handle, y: -radius },
			c2: { x: radius, y: -handle },
			p3: { x: radius, y: 0 },
		},
		{
			p0: { x: radius, y: 0 },
			c1: { x: radius, y: handle },
			c2: { x: handle, y: radius },
			p3: { x: 0, y: radius },
		},
		{
			p0: { x: 0, y: radius },
			c1: { x: -handle, y: radius },
			c2: { x: -radius, y: handle },
			p3: { x: -radius, y: 0 },
		},
		{
			p0: { x: -radius, y: 0 },
			c1: { x: -radius, y: -handle },
			c2: { x: -handle, y: -radius },
			p3: { x: 0, y: -radius },
		},
	]
}

describe("cubic contour fitting", () => {
	it("reconstructs a densely sampled cubic circle with four segments", () => {
		const samples: Point[] = []
		for (const cubic of circleCubics(141))
			samples.push(...flattenCubic(cubic, { flatness: 0.025 }).slice(1))
		const fitted = fitCubicContour(
			{ closed: true, points: samples },
			{ maxError: 0.025 },
		)
		expect(fitted).toHaveLength(4)
		expect(
			fitted.every(
				(cubic) =>
					Math.hypot(cubic.c1.x - cubic.p0.x, cubic.c1.y - cubic.p0.y) > 0,
			),
		).toBe(true)
		expect(
			fitted.every(
				(cubic) =>
					Math.hypot(cubic.p3.x - cubic.c2.x, cubic.p3.y - cubic.c2.y) > 0,
			),
		).toBe(true)
	})

	it("retains authored corners as exact anchors", () => {
		const corners = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		]
		const fitted = fitCubicContour(
			{
				closed: true,
				points: [
					corners[0] as Point,
					{ x: 5, y: 0 },
					corners[1] as Point,
					{ x: 10, y: 5 },
					corners[2] as Point,
					{ x: 5, y: 10 },
					corners[3] as Point,
					{ x: 0, y: 5 },
				],
			},
			{ maxError: 0.025 },
		)
		expect(fitted).toHaveLength(4)
		expect(fitted.map((cubic) => cubic.p0)).toEqual(corners)
	})

	it("rejects invalid fit budgets", () => {
		expect(() =>
			fitCubicContour(
				{
					closed: false,
					points: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
				},
				{ maxError: 0 },
			),
		).toThrow(GeometryError)
	})
})
