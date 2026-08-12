import { describe, expect, it } from "vitest"

import {
	createCurvatureComb,
	isCurvatureShortcut,
	sampleCubicCurvature,
} from "../src/curvature-comb.ts"

const arch = {
	p0: { x: 0, y: 0 },
	c1: { x: 0, y: 100 },
	c2: { x: 100, y: 100 },
	p3: { x: 100, y: 0 },
}

describe("curvature comb", () => {
	it("matches Speed Punk's platform shortcut without foreign modifiers", () => {
		const event = {
			altKey: false,
			ctrlKey: false,
			key: "X",
			metaKey: true,
			shiftKey: true,
		}
		expect(isCurvatureShortcut(event, true)).toBe(true)
		expect(isCurvatureShortcut({ ...event, ctrlKey: true }, true)).toBe(false)
		expect(
			isCurvatureShortcut({ ...event, ctrlKey: true, metaKey: false }, false),
		).toBe(true)
		expect(isCurvatureShortcut({ ...event, shiftKey: false }, true)).toBe(false)
	})

	it("evaluates cubic position, tangent, and signed curvature", () => {
		expect(sampleCubicCurvature(arch, 0)).toEqual({
			point: { x: 0, y: 0 },
			tangent: { x: 0, y: 300 },
			curvature: -1 / 150,
		})
		const middle = sampleCubicCurvature(arch, 0.5)
		expect(middle?.point).toEqual({ x: 50, y: 75 })
		expect(middle?.tangent).toEqual({ x: 150, y: 0 })
		expect(middle?.curvature).toBeCloseTo(-8 / 300, 10)
	})

	it("rejects a cusp whose tangent has no usable direction", () => {
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

	it("distributes 400 colored cells across authored cubic segments", () => {
		const cells = createCurvatureComb(
			[
				{
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
				},
			],
			{ gain: 1, side: "outside", referenceUnits: 1_000 },
		)
		expect(cells).toHaveLength(400)
		expect(new Set(cells.map((cell) => cell.color)).size).toBeGreaterThan(1)
		expect(cells.every((cell) => Number.isFinite(cell.curvature))).toBe(true)
	})

	it("uses absolute or signed curvature to choose the normal side", () => {
		const contour = {
			closed: false,
			nodes: [
				{ x: 0, y: 0, outgoing: { x: 0, y: 100 } },
				{ x: 100, y: 0, incoming: { x: 0, y: 100 } },
			],
		}
		const outside = createCurvatureComb([contour], {
			gain: 1,
			side: "outside",
			referenceUnits: 1_000,
		})[0]
		const signed = createCurvatureComb([contour], {
			gain: 1,
			side: "signed",
			referenceUnits: 1_000,
		})[0]
		expect(outside?.path).toMatch(/L6[67]\./)
		expect(signed?.path).toContain("L-66.")
	})

	it("omits straight contours and invalid settings", () => {
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
			createCurvatureComb(straight, {
				gain: Number.NaN,
				side: "outside",
				referenceUnits: 1_000,
			}),
		).toEqual([])
	})
})
