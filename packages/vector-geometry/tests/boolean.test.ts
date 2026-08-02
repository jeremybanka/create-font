import { describe, expect, it } from "vitest"

import {
	booleanContours,
	GeometryError,
	partitionContours,
	resolveFilledContours,
	signedArea,
	type Contour,
} from "../src/index.ts"

const rectangle = (
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): Contour => ({
	closed: true,
	points: [
		{ x: minX, y: minY },
		{ x: maxX, y: minY },
		{ x: maxX, y: maxY },
		{ x: minX, y: maxY },
	],
})

describe("filled-region Boolean operations", () => {
	it("unites overlapping and disjoint regions with canonical output", () => {
		const overlap = booleanContours(
			[[rectangle(0, 0, 10, 10)], [rectangle(5, 0, 15, 10)]],
			{ operation: "union" },
		)
		expect(overlap).toEqual([rectangle(0, 0, 15, 10)])

		const disjoint = booleanContours(
			[[rectangle(20, 0, 30, 10)], [rectangle(0, 0, 10, 10)]],
			{ operation: "union" },
		)
		expect(disjoint).toEqual([
			rectangle(0, 0, 10, 10),
			rectangle(20, 0, 30, 10),
		])

		expect(
			booleanContours([[rectangle(0, 0, 20, 20)], [rectangle(5, 5, 15, 15)]], {
				operation: "union",
			}),
		).toEqual([rectangle(0, 0, 20, 20)])
	})

	it("subtracts nested contours into a compound region with a hole", () => {
		const result = booleanContours([[rectangle(0, 0, 20, 20)]], {
			operation: "difference",
			clips: [[rectangle(5, 5, 15, 15)]],
		})
		expect(result).toHaveLength(2)
		expect(result.map(({ points }) => Math.sign(signedArea(points)))).toEqual([
			1, -1,
		])
	})

	it("intersects every independently filled region", () => {
		expect(
			booleanContours(
				[
					[rectangle(0, 0, 20, 20)],
					[rectangle(5, 0, 15, 20)],
					[rectangle(10, 0, 25, 20)],
				],
				{ operation: "intersection" },
			),
		).toEqual([rectangle(10, 0, 15, 20)])
		expect(
			booleanContours([[rectangle(0, 0, 10, 10)], [rectangle(20, 0, 30, 10)]], {
				operation: "intersection",
			}),
		).toEqual([])

		const outer = rectangle(0, 0, 20, 20)
		const hole = rectangle(5, 5, 15, 15)
		const holed = booleanContours([[outer, hole], [outer]], {
			operation: "intersection",
		})
		expect(holed).toHaveLength(2)
		expect(holed.map(({ points }) => Math.sign(signedArea(points)))).toEqual([
			1, -1,
		])
	})

	it("excludes even object coverage while preserving authored holes", () => {
		expect(
			booleanContours([[rectangle(0, 0, 10, 10)], [rectangle(5, 0, 15, 10)]], {
				operation: "xor",
			}),
		).toEqual([rectangle(0, 0, 5, 10), rectangle(10, 0, 15, 10)])

		const outer = rectangle(0, 0, 20, 20)
		const hole = rectangle(5, 5, 15, 15)
		expect(
			booleanContours([[outer, hole], [hole]], { operation: "xor" }),
		).toEqual([outer])
		expect(
			booleanContours([[outer], [outer], [outer]], { operation: "xor" }),
		).toEqual([outer])
	})

	it("is stable for tangent and self-intersecting inputs", () => {
		const tangent = booleanContours(
			[[rectangle(0, 0, 10, 10)], [rectangle(10, 0, 20, 10)]],
			{ operation: "union" },
		)
		expect(tangent).toEqual([rectangle(0, 0, 20, 10)])
		expect(
			booleanContours([[rectangle(0, 0, 10, 10)], [rectangle(10, 0, 20, 10)]], {
				operation: "intersection",
			}),
		).toEqual([])
		expect(
			booleanContours([[rectangle(0, 0, 10, 10)], [rectangle(10, 0, 20, 10)]], {
				operation: "xor",
			}),
		).toEqual([rectangle(0, 0, 20, 10)])

		const bowTie: Contour = {
			closed: true,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
				{ x: 10, y: 0 },
			],
		}
		const first = booleanContours([[bowTie]], { operation: "union" })
		const second = booleanContours([[bowTie]], { operation: "union" })
		expect(first).toEqual(second)
		expect(first).toHaveLength(2)
	})

	it("rejects open, unsafe, and incomplete operands", () => {
		expect(() =>
			booleanContours([[{ ...rectangle(0, 0, 1, 1), closed: false }]], {
				operation: "union",
			}),
		).toThrowError(GeometryError)
		expect(() =>
			booleanContours([[rectangle(0, 0, 1, 1)]], { operation: "difference" }),
		).toThrowError(/clip/iu)
		expect(() =>
			booleanContours([[rectangle(0, 0, Number.MAX_VALUE, 1)]], {
				operation: "union",
			}),
		).toThrowError(/safe topology/iu)
		expect(() =>
			booleanContours(
				[
					[
						{
							closed: true,
							points: [
								{ x: 0, y: 0 },
								{ x: 1, y: 0 },
								{ x: 2, y: 0 },
							],
						},
					],
				],
				{ operation: "union" },
			),
		).toThrowError(/filled region/iu)
	})

	it("partitions overlapping fills into canonical connected coverage pieces", () => {
		const result = partitionContours([
			[rectangle(0, 0, 10, 10)],
			[rectangle(5, 0, 15, 10)],
		])
		expect(result).toEqual([
			{ contours: [rectangle(0, 0, 5, 10)], contributors: [0] },
			{ contours: [rectangle(5, 0, 10, 10)], contributors: [0, 1] },
			{ contours: [rectangle(10, 0, 15, 10)], contributors: [1] },
		])
	})

	it("resolves authored even-odd and nonzero compound fills explicitly", () => {
		const nested = [rectangle(0, 0, 20, 20), rectangle(5, 5, 15, 15)]
		expect(resolveFilledContours(nested)).toHaveLength(2)
		expect(resolveFilledContours(nested, { fillRule: "nonzero" })).toEqual([
			rectangle(0, 0, 20, 20),
		])
		expect(
			resolveFilledContours(
				[nested[0]!, { ...nested[1]!, points: nested[1]!.points.toReversed() }],
				{ fillRule: "nonzero" },
			),
		).toHaveLength(2)
	})

	it("preserves compound holes while separating disconnected components", () => {
		const outer = rectangle(0, 0, 30, 30)
		const hole = rectangle(5, 5, 15, 15)
		const result = partitionContours([
			[outer, hole],
			[rectangle(5, 5, 15, 15)],
			[rectangle(40, 0, 50, 10)],
		])
		expect(result).toHaveLength(3)
		expect(result.map(({ contributors }) => contributors)).toEqual([
			[0],
			[1],
			[2],
		])
		expect(result[0]?.contours).toHaveLength(2)
		expect(
			result[0]?.contours.map(({ points }) => Math.sign(signedArea(points))),
		).toEqual([1, -1])
	})

	it("deduplicates coincident boundaries and discards tangent zero-area faces", () => {
		expect(
			partitionContours([[rectangle(0, 0, 10, 10)], [rectangle(0, 0, 10, 10)]]),
		).toEqual([
			{
				contours: [rectangle(0, 0, 10, 10)],
				contributors: [0, 1],
			},
		])
		expect(
			partitionContours([
				[rectangle(0, 0, 10, 10)],
				[rectangle(10, 0, 20, 10)],
			]),
		).toEqual([
			{ contours: [rectangle(0, 0, 10, 10)], contributors: [0] },
			{ contours: [rectangle(10, 0, 20, 10)], contributors: [1] },
		])
	})

	it("reports deterministic progress and can be interrupted between region passes", () => {
		const progress: number[] = []
		const completed = partitionContours(
			Array.from({ length: 12 }, (_, index) => [
				rectangle(index * 5, 0, index * 5 + 10, 10),
			]),
			{
				onProgress: ({ completedRegions }) => progress.push(completedRegions),
			},
		)
		expect(progress).toEqual(Array.from({ length: 13 }, (_, index) => index))
		expect(completed.length).toBeGreaterThan(12)

		let processed = 0
		const signal = {
			get aborted() {
				return processed >= 2
			},
		}
		expect(() =>
			partitionContours(
				Array.from({ length: 100 }, (_, index) => [
					rectangle(index, 0, index + 2, 2),
				]),
				{
					signal,
					onProgress: ({ completedRegions }) => {
						processed = completedRegions
					},
				},
			),
		).toThrowError(/aborted/iu)
		expect(processed).toBe(2)
	})
})
