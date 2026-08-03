import { describe, expect, it } from "vitest"

import {
	distance,
	expandStroke,
	fitCubicContour,
	flattenCubic,
	GeometryError,
	intersectPolylines,
	selfIntersections,
	signedArea,
} from "../src/index.ts"
import type { Contour, Cubic, Point } from "../src/types.ts"

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

function flattenFit(cubics: readonly Cubic[]): readonly Point[] {
	const points: Point[] = []
	for (const cubic of cubics)
		points.push(
			...flattenCubic(cubic, { flatness: 0.002 }).slice(
				points.length > 0 ? 1 : 0,
			),
		)
	if (
		points.length > 1 &&
		distance(points[0] as Point, points.at(-1) as Point) <= 1e-7
	)
		points.pop()
	return points
}

function pointToContour(point: Point, contour: Contour): number {
	let result = Number.POSITIVE_INFINITY
	const segmentCount = contour.points.length - (contour.closed ? 0 : 1)
	for (let index = 0; index < segmentCount; index += 1) {
		const start = contour.points[index]
		const end = contour.points[(index + 1) % contour.points.length]
		if (start === undefined || end === undefined) continue
		const x = end.x - start.x
		const y = end.y - start.y
		const denominator = x * x + y * y
		const parameter =
			denominator === 0
				? 0
				: Math.max(
						0,
						Math.min(
							1,
							((point.x - start.x) * x + (point.y - start.y) * y) / denominator,
						),
					)
		result = Math.min(
			result,
			Math.hypot(
				point.x - start.x - x * parameter,
				point.y - start.y - y * parameter,
			),
		)
	}
	return result
}

function tightCurvedCenterline(): readonly Point[] {
	const coefficients = [
		{ a: 8.574342430802062, b: -14.40299014793709 },
		{ a: -3.9136159338522702, b: 1.7000835994258523 },
		{ a: -15.084286633646116, b: -3.9464907511137426 },
		{ a: -14.255118552828208, b: 12.053232677280903 },
	]
	return Array.from({ length: 160 }, (_, index) => {
		const angle = (index / 160) * Math.PI * 2
		let radius = 100
		for (const [coefficientIndex, coefficient] of coefficients.entries()) {
			radius +=
				coefficient.a * Math.cos((coefficientIndex + 1) * angle) +
				coefficient.b * Math.sin((coefficientIndex + 1) * angle)
		}
		return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
	})
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

	it("locally refines a tight curved seam without new overlaps", () => {
		const centerline = tightCurvedCenterline()
		const expanded = expandStroke(
			{ closed: true, points: centerline },
			{
				width: 23.615311466623098,
				cap: "butt",
				join: "round",
				vertexJoins: centerline.map(() => "miter"),
				miterLimit: 4,
				tolerances: { flatness: 0.025, distance: 1e-7 },
			},
		)
		expect(expanded.map((contour) => contour.points.length)).toEqual([160, 160])
		expect(
			expanded.map((contour) =>
				selfIntersections(contour.points, { closed: true }),
			),
		).toEqual([[], []])
		expect(
			intersectPolylines(expanded[0]?.points ?? [], expanded[1]?.points ?? [], {
				firstClosed: true,
				secondClosed: true,
			}),
		).toEqual([])

		const fitted = expanded.map((contour) =>
			fitCubicContour(contour, { maxError: 0.025 }),
		)
		expect(fitted.map((cubics) => cubics.length)).toEqual([137, 132])
		const flattened = fitted.map(flattenFit)
		expect(
			flattened.map((points) => selfIntersections(points, { closed: true })),
		).toEqual([[], []])
		expect(
			intersectPolylines(flattened[0] ?? [], flattened[1] ?? [], {
				firstClosed: true,
				secondClosed: true,
			}),
		).toEqual([])
		expect(flattened.map((points) => Math.sign(signedArea(points)))).toEqual([
			-1, 1,
		])
		for (const [index, contour] of expanded.entries()) {
			const fittedContour: Contour = {
				closed: true,
				points: flattened[index] ?? [],
			}
			const sourceToFit = Math.max(
				...contour.points.map((point) => pointToContour(point, fittedContour)),
			)
			const fitToSource = Math.max(
				...fittedContour.points.map((point) => pointToContour(point, contour)),
			)
			expect(sourceToFit).toBeLessThanOrEqual(0.025)
			expect(fitToSource).toBeLessThanOrEqual(0.025)
		}
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
