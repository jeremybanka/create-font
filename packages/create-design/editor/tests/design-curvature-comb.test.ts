import { describe, expect, it } from "vitest"

import {
	createDesignObjectGeometryHitTest,
	ellipseContour,
	IDENTITY_DESIGN_TRANSFORM,
} from "@create-design/model"

import { createDesignCurvatureComb } from "../src/design-curvature-comb.ts"
import type {
	DesignContour,
	DesignObject,
	DesignTransform,
} from "../src/types.ts"

const reverseContour = (contour: DesignContour): DesignContour => ({
	...contour,
	points: [...contour.points].reverse().map((point) => {
		const { incoming, outgoing, ...anchor } = point
		return {
			...anchor,
			...(outgoing === undefined ? {} : { incoming: outgoing }),
			...(incoming === undefined ? {} : { outgoing: incoming }),
		}
	}),
})

const pathObject = (
	id: string,
	contours: readonly DesignContour[],
	fillRule: "evenodd" | "nonzero" = "evenodd",
	transform: DesignTransform = IDENTITY_DESIGN_TRANSFORM,
): DesignObject => ({
	id,
	name: id,
	appearance: { fill: { swatchId: "swatch:ink" } },
	geometry: { kind: "path", contours, fillRule },
	transform,
})

const tips = (path: string): readonly { x: number; y: number }[] => {
	const values = [
		...path.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g),
	].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
	return values.slice(2)
}

const outerCells = (objects: readonly DesignObject[]) =>
	createDesignCurvatureComb(objects, {
		gain: 1,
		referenceUnits: 100,
		side: "outside",
	})

describe("create-design curvature-comb topology", () => {
	it("points outside equivalent closed shapes regardless of authored winding", () => {
		const clockwise = ellipseContour(
			{ minX: 0, minY: 0, maxX: 100, maxY: 100 },
			"clockwise",
		)
		const counterclockwise = reverseContour(clockwise)
		for (const [id, contour] of [
			["clockwise", clockwise],
			["counterclockwise", counterclockwise],
		] as const) {
			const object = pathObject(id, [contour])
			const hitTest = createDesignObjectGeometryHitTest(object)
			const cells = outerCells([object])
			expect(cells).toHaveLength(400)
			expect(
				cells
					.flatMap(({ path }) => tips(path))
					.every((tip) => !hitTest.containsPoint(tip)),
			).toBe(true)
		}
	})

	it("uses compound fill topology for outer boundaries and counters", () => {
		const outer = ellipseContour(
			{ minX: 0, minY: 0, maxX: 100, maxY: 100 },
			"outer",
		)
		const counter = ellipseContour(
			{ minX: 30, minY: 30, maxX: 70, maxY: 70 },
			"counter",
		)
		for (const [rule, inner] of [
			["evenodd", counter],
			["nonzero", reverseContour(counter)],
		] as const) {
			const object = pathObject(rule, [outer, inner], rule)
			const hitTest = createDesignObjectGeometryHitTest(object)
			const cells = outerCells([object])
			expect(cells).toHaveLength(400)
			expect(
				cells
					.flatMap(({ path }) => tips(path))
					.every((tip) => !hitTest.containsPoint(tip)),
			).toBe(true)
		}

		const filledNested = pathObject(
			"filled-nested",
			[outer, counter],
			"nonzero",
		)
		// The same-winding nested contour is not a boundary under nonzero fill.
		expect(outerCells([filledNested])).toHaveLength(200)
	})

	it("budgets cells across multiple objects while resolving each topology", () => {
		const first = pathObject("first", [
			ellipseContour({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, "first"),
		])
		const second = pathObject(
			"second",
			[
				reverseContour(
					ellipseContour({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, "second"),
				),
			],
			"evenodd",
			{ ...IDENTITY_DESIGN_TRANSFORM, e: 200 },
		)
		const cells = outerCells([first, second])
		expect(cells).toHaveLength(400)
		for (const cell of cells) {
			const baseX = Number(cell.path.match(/^M(-?\d+(?:\.\d+)?)/)?.[1])
			const object = baseX > 150 ? second : first
			const hitTest = createDesignObjectGeometryHitTest(object)
			expect(tips(cell.path).every((tip) => !hitTest.containsPoint(tip))).toBe(
				true,
			)
		}
	})

	it("uses signed curvature for open paths because they have no exterior", () => {
		const open = pathObject("open", [
			{
				id: "open-contour",
				closed: false,
				points: [
					{
						id: "start",
						x: 0,
						y: 0,
						outgoing: { x: 0, y: 100 },
					},
					{
						id: "end",
						x: 100,
						y: 0,
						incoming: { x: 0, y: 100 },
					},
				],
			},
		])
		const outside = outerCells([open])
		const signed = createDesignCurvatureComb([open], {
			gain: 1,
			referenceUnits: 100,
			side: "signed",
		})
		expect(outside).toEqual(signed)
	})
})
