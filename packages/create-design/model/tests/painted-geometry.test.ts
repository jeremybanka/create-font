import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"
import { describe, expect, it } from "vitest"

import {
	objectFillContainsPoint,
	objectStrokeDistance,
	visibleObjectBounds,
} from "../src/painted-geometry.ts"
import type { DesignObject, DesignStroke } from "@create-design/source"

const path = (
	points: readonly { readonly x: number; readonly y: number }[],
	stroke: Partial<DesignStroke> = {},
	closed = false,
): DesignObject => ({
	id: "object:stroke",
	name: "Stroke",
	geometry: {
		kind: "path",
		contours: [
			{
				id: "contour:stroke",
				closed,
				points: points.map((point, index) => ({
					id: `point:stroke:${index}`,
					...point,
				})),
			},
		],
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: {
		stroke: {
			...DEFAULT_DESIGN_STROKE_STYLE,
			swatchId: "swatch:ink",
			width: 10,
			...stroke,
		},
	},
})

describe("painted design geometry", () => {
	it("treats an open subpath as implicitly closed for fill paint", () => {
		const triangle = path([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 0, y: 10 },
		])
		const filled = {
			...triangle,
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		expect(objectFillContainsPoint(filled, { x: 2, y: 2 })).toBe(true)
		expect(objectFillContainsPoint(filled, { x: 9, y: 9 })).toBe(false)
	})

	it("honors authored nonzero and even-odd fill rules", () => {
		const rectangle = (id: string, min: number, max: number) => ({
			id,
			closed: true,
			points: [
				{ id: `${id}:0`, x: min, y: min },
				{ id: `${id}:1`, x: max, y: min },
				{ id: `${id}:2`, x: max, y: max },
				{ id: `${id}:3`, x: min, y: max },
			],
		})
		const base: DesignObject = {
			...path([]),
			geometry: {
				kind: "path",
				fillRule: "evenodd",
				contours: [rectangle("outer", 0, 20), rectangle("inner", 5, 15)],
			},
			appearance: { fill: { swatchId: "swatch:ink" } },
		}
		expect(objectFillContainsPoint(base, { x: 10, y: 10 })).toBe(false)
		const geometry = base.geometry
		if (geometry.kind !== "path") throw new Error("Expected path fixture.")
		expect(
			objectFillContainsPoint(
				{ ...base, geometry: { ...geometry, fillRule: "nonzero" } },
				{ x: 10, y: 10 },
			),
		).toBe(true)
	})

	it("includes authored open-path caps in bounds and hit testing", () => {
		const butt = path([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		])
		const round = path(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
			{ cap: "round" },
		)
		const square = path(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
			{ cap: "square" },
		)
		expect(visibleObjectBounds(butt)).toEqual({
			minX: 0,
			minY: -5,
			maxX: 10,
			maxY: 5,
		})
		expect(visibleObjectBounds(round)).toEqual({
			minX: -5,
			minY: -5,
			maxX: 15,
			maxY: 5,
		})
		expect(visibleObjectBounds(square)).toEqual(visibleObjectBounds(round))
		expect(objectStrokeDistance(square, { x: -4.5, y: 4.5 })).toBe(0)
		expect(objectStrokeDistance(round, { x: -4.5, y: 4.5 })).toBeGreaterThan(0)
	})

	it("distinguishes miter joins from bevels and honors the miter limit", () => {
		const points = [
			{ x: 0, y: 10 },
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
		]
		const miter = path(points, { width: 4, join: "miter", miterLimit: 4 })
		const bevel = path(points, { width: 4, join: "bevel" })
		const round = path(points, { width: 4, join: "round" })
		const limited = path(points, {
			width: 4,
			join: "miter",
			miterLimit: 1,
		})
		expect(objectStrokeDistance(miter, { x: -1.75, y: -1.75 })).toBe(0)
		expect(objectStrokeDistance(bevel, { x: -1.75, y: -1.75 })).toBeGreaterThan(
			0,
		)
		expect(objectStrokeDistance(round, { x: -1.4, y: -1.4 })).toBe(0)
		expect(objectStrokeDistance(bevel, { x: -1.4, y: -1.4 })).toBeGreaterThan(0)
		expect(objectStrokeDistance(limited, { x: -1.75, y: -1.75 })).toBe(
			objectStrokeDistance(bevel, { x: -1.75, y: -1.75 }),
		)
	})

	it("excludes dash gaps and zero-width or degenerate strokes", () => {
		const dashed = path(
			[
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
			],
			{ width: 2, dashArray: [4, 4] },
		)
		expect(objectStrokeDistance(dashed, { x: 2, y: 0 })).toBe(0)
		expect(objectStrokeDistance(dashed, { x: 6, y: 0 })).toBeGreaterThan(0)
		const translated = {
			...dashed,
			transform: { ...dashed.transform, e: 100, f: 30 },
		}
		expect(objectStrokeDistance(translated, { x: 102, y: 30 })).toBe(0)
		expect(objectStrokeDistance(translated, { x: 106, y: 30 })).toBeGreaterThan(
			0,
		)
		expect(visibleObjectBounds(path([{ x: 0, y: 0 }]))).toBeNull()
		expect(
			visibleObjectBounds(
				path(
					[
						{ x: 0, y: 0 },
						{ x: 20, y: 0 },
					],
					{ width: 0 },
				),
			),
		).toBeNull()
	})
})
