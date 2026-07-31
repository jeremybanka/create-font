import { describe, expect, it } from "vitest"

import {
	GeometryError,
	contourOrientation,
	cubicBounds,
	flattenCubic,
	intersectCubicCurves,
	intersectPolylines,
	intersectSegments,
	normalizeContour,
	normalizeContours,
	offsetContour,
	resolveGeometryTolerances,
	selfIntersections,
	signedArea,
	windingNumber,
	type Cubic,
} from "../src/index.ts"
import {
	archCubic,
	bowTie,
	largeCoordinateContour,
	outerSquare,
	overlappingSegments,
	squareHole,
	tangentSegments,
	tinySegmentContour,
} from "./fixtures.ts"

describe("tolerance and errors", () => {
	it("resolves explicit immutable defaults and rejects invalid values", () => {
		const tolerances = resolveGeometryTolerances({ flatness: 0.01 })
		expect(tolerances.flatness).toBe(0.01)
		expect(Object.isFrozen(tolerances)).toBe(true)
		expect(() => resolveGeometryTolerances({ distance: 0 })).toThrow(
			GeometryError,
		)
		expect(() => resolveGeometryTolerances({ maxDepth: 1.5 })).toThrow(
			/maxDepth/,
		)
	})

	it("reports non-finite source coordinates with a stable code", () => {
		try {
			normalizeContour({
				closed: false,
				points: [
					{ x: 0, y: 0 },
					{ x: Number.NaN, y: 2 },
				],
			})
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(GeometryError)
			expect((error as GeometryError).code).toBe("NON_FINITE_COORDINATE")
		}
	})
})

describe("adaptive cubic geometry", () => {
	it("flattens left-to-right with stable source parameters", () => {
		const first = flattenCubic(archCubic, { flatness: 0.1 })
		const second = flattenCubic(archCubic, { flatness: 0.1 })
		expect(first.length).toBeGreaterThan(10)
		expect(first[0]).toEqual({ x: 0, y: 0, parameter: 0 })
		expect(first.at(-1)).toEqual({ x: 100, y: 0, parameter: 1 })
		expect(
			first.every(
				(point, index) =>
					index === 0 || point.parameter > (first[index - 1]?.parameter ?? -1),
			),
		).toBe(true)
		expect(JSON.stringify(first)).toBe(JSON.stringify(second))
	})

	it("reports an exhausted subdivision budget", () => {
		expect(() =>
			flattenCubic(archCubic, { flatness: 1e-12, maxDepth: 1 }),
		).toThrowError(expect.objectContaining({ code: "MAX_DEPTH_EXCEEDED" }))
	})

	it("includes exact cubic extrema in bounds", () => {
		expect(cubicBounds(archCubic)).toEqual({
			minX: 0,
			minY: 0,
			maxX: 100,
			maxY: 75,
		})
	})

	it("finds approximate cubic intersections in parameter order", () => {
		const horizontal: Cubic = {
			p0: { x: 0, y: 50 },
			c1: { x: 100 / 3, y: 50 },
			c2: { x: 200 / 3, y: 50 },
			p3: { x: 100, y: 50 },
		}
		const intersections = intersectCubicCurves(archCubic, horizontal, {
			flatness: 0.01,
		})
		expect(intersections).toHaveLength(2)
		expect(intersections[0]?.kind).toBe("cross")
		expect(intersections[1]?.kind).toBe("cross")
		if (
			intersections[0]?.kind !== "overlap" &&
			intersections[1]?.kind !== "overlap"
		) {
			expect(intersections[0]?.firstParameter).toBeLessThan(
				intersections[1]?.firstParameter ?? 0,
			)
			expect(intersections[0]?.point.y).toBeCloseTo(50, 6)
		}
	})

	it("deduplicates a flattened cubic tangency", () => {
		const tangent: Cubic = {
			p0: { x: 0, y: 75 },
			c1: { x: 100 / 3, y: 75 },
			c2: { x: 200 / 3, y: 75 },
			p3: { x: 100, y: 75 },
		}
		const intersections = intersectCubicCurves(archCubic, tangent, {
			flatness: 0.01,
		})
		expect(intersections).toHaveLength(1)
		expect(intersections[0]).toMatchObject({
			kind: "touch",
			point: { x: 50, y: 75 },
			firstParameter: 0.5,
			secondParameter: 0.5,
		})
	})
})

describe("intersections", () => {
	it("distinguishes crossing, tangent contact, and overlap", () => {
		expect(
			intersectSegments(
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
				{ x: 10, y: 0 },
			),
		).toMatchObject({
			kind: "cross",
			point: { x: 5, y: 5 },
			firstParameter: 0.5,
			secondParameter: 0.5,
		})
		expect(
			intersectSegments(
				tangentSegments.first[0]!,
				tangentSegments.first[1]!,
				tangentSegments.second[0]!,
				tangentSegments.second[1]!,
			),
		).toMatchObject({ kind: "touch", point: { x: 10, y: 0 } })
		expect(
			intersectSegments(
				overlappingSegments.first[0]!,
				overlappingSegments.first[1]!,
				overlappingSegments.second[0]!,
				overlappingSegments.second[1]!,
			),
		).toEqual({
			kind: "overlap",
			start: { x: 4, y: 0 },
			end: { x: 10, y: 0 },
			firstRange: [0.4, 1],
			secondRange: [0, 0.75],
		})
	})

	it("orders polyline intersections by source segment and parameter", () => {
		const result = intersectPolylines(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 20, y: 0 },
			],
			[
				{ x: 2, y: 5 },
				{ x: 18, y: 5 },
			],
		)
		expect(result.map((item) => item.firstSegment)).toEqual([0, 1])
	})

	it("finds a self-intersection without reporting adjacent vertices", () => {
		const result = selfIntersections(bowTie.points, { closed: true })
		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({
			kind: "cross",
			point: { x: 5, y: 5 },
			firstSegment: 0,
			secondSegment: 2,
		})
	})
})

describe("winding and deterministic normalization", () => {
	it("reports winding, outside, and boundary separately", () => {
		expect(windingNumber({ x: 50, y: 50 }, outerSquare.points)).toEqual({
			winding: 1,
			classification: "inside",
		})
		expect(windingNumber({ x: 150, y: 50 }, outerSquare.points)).toEqual({
			winding: 0,
			classification: "outside",
		})
		expect(
			windingNumber({ x: 0, y: 50 }, outerSquare.points).classification,
		).toBe("boundary")
	})

	it("normalizes holes, rotations, direction, and input order byte-stably", () => {
		const first = normalizeContours([squareHole, outerSquare])
		const second = normalizeContours([
			{
				closed: true,
				points: [...outerSquare.points].reverse(),
			},
			{
				closed: true,
				points: [
					squareHole.points[2]!,
					squareHole.points[1]!,
					squareHole.points[0]!,
					squareHole.points[3]!,
				],
			},
		])
		expect(JSON.stringify(first)).toBe(JSON.stringify(second))
		expect(contourOrientation(first[0]?.points ?? [])).toBe("counter-clockwise")
		expect(contourOrientation(first[1]?.points ?? [])).toBe("clockwise")
	})

	it("removes tiny segments and signed zero on the normalization grid", () => {
		const normalized = normalizeContour(tinySegmentContour)
		expect(normalized.points).toHaveLength(4)
		expect(JSON.stringify(normalized)).not.toContain("-0")
	})

	it("retains orientation and area at large translated coordinates", () => {
		expect(signedArea(largeCoordinateContour.points)).toBe(10_000)
		expect(contourOrientation(largeCoordinateContour.points)).toBe(
			"counter-clockwise",
		)
		expect(normalizeContour(largeCoordinateContour).points).toEqual(
			largeCoordinateContour.points,
		)
	})

	it("rejects collapsed closed contours", () => {
		expect(() =>
			normalizeContour({
				closed: true,
				points: [
					{ x: 0, y: 0 },
					{ x: 1e-12, y: 0 },
					{ x: 2e-12, y: 0 },
				],
			}),
		).toThrowError(expect.objectContaining({ code: "DEGENERATE_CONTOUR" }))
	})
})

describe("polyline offsets", () => {
	it("offsets a closed contour to its authored left with miter joins", () => {
		expect(offsetContour(outerSquare, 10).points).toEqual([
			{ x: 10, y: 10 },
			{ x: 90, y: 10 },
			{ x: 90, y: 90 },
			{ x: 10, y: 90 },
		])
		expect(offsetContour(outerSquare, -10).points).toEqual([
			{ x: -10, y: -10 },
			{ x: 110, y: -10 },
			{ x: 110, y: 110 },
			{ x: -10, y: 110 },
		])
	})

	it("supports deterministic bevel joins for open contours", () => {
		const offset = offsetContour(
			{
				closed: false,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
					{ x: 10, y: 10 },
				],
			},
			2,
			{ join: "bevel" },
		)
		expect(offset).toEqual({
			closed: false,
			points: [
				{ x: 0, y: 2 },
				{ x: 10, y: 2 },
				{ x: 8, y: 0 },
				{ x: 8, y: 10 },
			],
		})
	})
})
