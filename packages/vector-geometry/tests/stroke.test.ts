import { describe, expect, it } from "vitest"

import {
	boundsOfPoints,
	expandStroke,
	GeometryError,
	selfIntersections,
	signedArea,
	windingNumber,
	type Contour,
} from "../src/index.ts"

const style = {
	width: 4,
	cap: "butt" as const,
	join: "miter" as const,
	miterLimit: 4,
	tolerances: { flatness: 0.05 },
}

const line: Contour = {
	closed: false,
	points: [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
	],
}

const bounds = (contours: readonly Contour[]) =>
	boundsOfPoints(contours.flatMap((contour) => contour.points))

describe("stroke expansion", () => {
	it("expands butt, square, and round caps within the declared flatness", () => {
		const butt = expandStroke(line, style)
		const square = expandStroke(line, { ...style, cap: "square" })
		const round = expandStroke(line, { ...style, cap: "round" })

		expect(bounds(butt)).toEqual({ minX: 0, minY: -2, maxX: 10, maxY: 2 })
		expect(bounds(square)).toEqual({
			minX: -2,
			minY: -2,
			maxX: 12,
			maxY: 2,
		})
		expect(bounds(round)).toEqual(bounds(square))
		expect(
			Math.abs(signedArea(round[0]?.points ?? [])) - (40 + Math.PI * 4),
		).toBeLessThan(0.35)
	})

	it("constructs bevel, limited miter, and round joins", () => {
		const corner: Contour = {
			closed: false,
			points: [
				{ x: 0, y: 10 },
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
		}
		const bevel = expandStroke(corner, { ...style, join: "bevel" })[0]
		const miter = expandStroke(corner, style)[0]
		const limited = expandStroke(corner, { ...style, miterLimit: 1 })[0]
		const round = expandStroke(corner, { ...style, join: "round" })[0]

		expect(bevel?.points).toContainEqual({ x: -2, y: 0 })
		expect(bevel?.points).toContainEqual({ x: 0, y: -2 })
		expect(miter?.points).toContainEqual({ x: -2, y: -2 })
		expect(limited?.points).not.toContainEqual({ x: -2, y: -2 })
		expect(round?.points.length).toBeGreaterThan(bevel?.points.length ?? 0)
	})

	it("keeps per-vertex authored joins while smoothing generated samples", () => {
		const sampledCorner: Contour = {
			closed: false,
			points: [
				{ x: 0, y: 10 },
				{ x: 0, y: 5 },
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 10, y: 0 },
			],
		}
		const expanded = expandStroke(sampledCorner, {
			...style,
			join: "round",
			vertexJoins: ["miter", "miter", "bevel", "miter", "miter"],
		})[0]
		expect(expanded?.points).toContainEqual({ x: -2, y: 0 })
		expect(expanded?.points).toContainEqual({ x: 0, y: -2 })
		expect(expanded?.points).not.toContainEqual({ x: -2, y: -2 })
		expect(() =>
			expandStroke(sampledCorner, {
				...style,
				vertexJoins: ["miter"],
			}),
		).toThrowError(/align/iu)
	})

	it.each(["miter", "round", "bevel"] as const)(
		"unions a retracing $join stroke into one simple filled contour",
		(join) => {
			const angle = (175 * Math.PI) / 180
			const expanded = expandStroke(
				{
					closed: false,
					points: [
						{ x: -100, y: 0 },
						{ x: 0, y: 0 },
						{ x: Math.cos(angle) * 20, y: Math.sin(angle) * 20 },
					],
				},
				{ ...style, width: 10, join },
			)
			expect(expanded).toHaveLength(1)
			expect(
				selfIntersections(expanded[0]?.points ?? [], { closed: true }),
			).toEqual([])
			expect(
				windingNumber({ x: -10, y: 0 }, expanded[0]?.points ?? []),
			).toMatchObject({ classification: "inside", winding: 1 })
		},
	)

	it("creates one closed contour per open dashed run and honors offsets", () => {
		const dashed = expandStroke(
			{
				closed: false,
				points: [
					{ x: 0, y: 0 },
					{ x: 20, y: 0 },
				],
			},
			{ ...style, dashArray: [5, 3], dashOffset: 2 },
		)
		expect(dashed).toHaveLength(3)
		expect(dashed.every((contour) => contour.closed)).toBe(true)
		expect(dashed.map((contour) => boundsOfPoints(contour.points))).toEqual([
			{ minX: 0, minY: -2, maxX: 3, maxY: 2 },
			{ minX: 6, minY: -2, maxX: 11, maxY: 2 },
			{ minX: 14, minY: -2, maxX: 19, maxY: 2 },
		])
	})

	it("keeps a closed stroke as an outer contour and an independent hole", () => {
		const expanded = expandStroke(
			{
				closed: true,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
					{ x: 10, y: 10 },
					{ x: 0, y: 10 },
				],
			},
			style,
		)
		expect(expanded).toHaveLength(2)
		expect(expanded.map((contour) => boundsOfPoints(contour.points))).toEqual([
			{ minX: 2, minY: 2, maxX: 8, maxY: 8 },
			{ minX: -2, minY: -2, maxX: 12, maxY: 12 },
		])
		expect(
			expanded.map((contour) => Math.sign(signedArea(contour.points))),
		).toEqual([-1, 1])
	})

	it("drops coincident spans and deterministically rejects self-crossing input", () => {
		const coincident = expandStroke(
			{
				closed: false,
				points: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
			},
			style,
		)
		expect(coincident).toEqual(expandStroke(line, style))

		const crossing: Contour = {
			closed: false,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
				{ x: 10, y: 0 },
			],
		}
		expect(() => expandStroke(crossing, style)).toThrowError(
			/self-intersecting/iu,
		)
	})

	it("returns no geometry for zero-length strokes and rejects invalid input", () => {
		expect(
			expandStroke(
				{
					closed: false,
					points: [
						{ x: 4, y: 4 },
						{ x: 4, y: 4 },
					],
				},
				style,
			),
		).toEqual([])
		expect(() => expandStroke(line, { ...style, width: Number.NaN })).toThrow(
			GeometryError,
		)
		expect(() =>
			expandStroke(line, { ...style, dashArray: [0, 0] }),
		).toThrowError(/positive length/u)
		expect(() =>
			expandStroke(
				{
					closed: false,
					points: [
						{ x: 0, y: 0 },
						{ x: Number.POSITIVE_INFINITY, y: 0 },
					],
				},
				style,
			),
		).toThrowError(/finite/u)
		expect(() =>
			expandStroke(
				{
					closed: false,
					points: [
						{ x: -Number.MAX_VALUE, y: 0 },
						{ x: Number.MAX_VALUE, y: 0 },
					],
				},
				{ ...style, dashArray: [2, 2] },
			),
		).toThrowError(/finite geometry range/u)
	})
})
