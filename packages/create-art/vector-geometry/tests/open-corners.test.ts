import { describe, expect, it } from "vitest"

import {
	lowerInferredCorners,
	type InferredCornerContour,
} from "../src/index.ts"

const exterior: InferredCornerContour = {
	closed: true,
	id: "exterior",
	points: [
		{ id: "a", point: { x: 0, y: 0 } },
		{ id: "overflow-in", point: { x: 120, y: 0 } },
		{ id: "overflow-out", point: { x: 100, y: -20 } },
		{ id: "d", point: { x: 100, y: 100 } },
		{ id: "e", point: { x: 0, y: 100 } },
	],
}

describe("open corners", () => {
	it("infers a Glyphs-style exterior overflow pair from geometry alone", () => {
		const lowered = lowerInferredCorners([exterior])
		expect(lowered.corners).toEqual([
			expect.objectContaining({
				firstContourId: "exterior",
				firstPointId: "overflow-in",
				secondPointId: "overflow-out",
				intersection: { x: 100, y: 0 },
			}),
		])
		expect(
			lowered.contours[0]?.points.map(({ id, point }) => ({ id, point })),
		).toEqual([
			{ id: "a", point: { x: 0, y: 0 } },
			{ id: "overflow-in", point: { x: 100, y: 0 } },
			{ id: "d", point: { x: 100, y: 100 } },
			{ id: "e", point: { x: 0, y: 100 } },
		])
	})

	it("classifies both inferred overextensions and their bridge", () => {
		expect(lowerInferredCorners([exterior]).overflowSegments).toEqual([
			{
				start: { x: 100, y: 0 },
				end: { x: 120, y: 0 },
				pointId: "overflow-in",
			},
			{
				start: { x: 120, y: 0 },
				end: { x: 100, y: -20 },
				pointId: "overflow-in",
			},
			{
				start: { x: 100, y: -20 },
				end: { x: 100, y: 0 },
				pointId: "overflow-out",
			},
		])
	})

	it("infers an interior open corner", () => {
		const interior: InferredCornerContour = {
			closed: true,
			id: "interior",
			points: [
				{ id: "previous", point: { x: 0, y: 0 } },
				{ id: "overflow-in", point: { x: 120, y: 0 } },
				{ id: "overflow-out", point: { x: 100, y: 20 } },
				{ id: "after", point: { x: 100, y: -100 } },
				{ id: "end", point: { x: 0, y: -100 } },
			],
		}
		const lowered = lowerInferredCorners([interior])
		expect(lowered.contours[0]?.points[1]?.point).toEqual({
			x: 100,
			y: 0,
		})
		expect(lowered.overflowSegments).toHaveLength(3)
	})

	it("leaves parallel overflow-like geometry untouched", () => {
		const parallel: InferredCornerContour = {
			...exterior,
			id: "parallel",
			points: exterior.points.map((point, index) =>
				index === 2
					? { ...point, point: { x: 0, y: 10 } }
					: index === 3
						? { ...point, point: { x: 100, y: 10 } }
						: point,
			),
		}
		expect(lowerInferredCorners([parallel]).contours[0]?.points).toEqual(
			parallel.points,
		)
	})

	it("never guesses intent between separate overlapping contours", () => {
		const top = {
			id: "top",
			closed: true,
			points: [
				{ id: "top-left", point: { x: 100, y: 732 } },
				{ id: "top-overflow", point: { x: 600, y: 732 } },
				{ id: "top-bottom-right", point: { x: 600, y: 668 } },
				{ id: "top-bottom-left", point: { x: 100, y: 668 } },
			],
		}
		const diagonal = {
			id: "diagonal",
			closed: true,
			points: [
				{ id: "diagonal-outer-overflow", point: { x: 632, y: 700 } },
				{ id: "diagonal-bottom-right", point: { x: 382, y: 350 } },
				{ id: "diagonal-bottom-left", point: { x: 318, y: 350 } },
				{ id: "diagonal-inner-overflow", point: { x: 568, y: 700 } },
			],
		}
		const lowered = lowerInferredCorners([top, diagonal])
		expect(lowered.corners).toEqual([])
		expect(lowered.contours).toEqual([top, diagonal])
	})

	it("does not infer corners for ordinary non-segment contour overlaps", () => {
		const lowered = lowerInferredCorners([
			{
				id: "triangle",
				closed: true,
				points: [
					{ id: "a", point: { x: 0, y: 0 } },
					{ id: "b", point: { x: 100, y: 0 } },
					{ id: "c", point: { x: 50, y: 100 } },
				],
			},
			{
				id: "box",
				closed: true,
				points: [
					{ id: "d", point: { x: 40, y: -20 } },
					{ id: "e", point: { x: 80, y: -20 } },
					{ id: "f", point: { x: 80, y: 80 } },
					{ id: "g", point: { x: 40, y: 80 } },
				],
			},
		])
		expect(lowered.corners).toEqual([])
	})

	it("does not create long acute miters beyond the segment widths", () => {
		const lowered = lowerInferredCorners([
			{
				id: "vertical",
				closed: true,
				points: [
					{ id: "vertical-outer-top", point: { x: 25, y: 700 } },
					{ id: "vertical-inner-top", point: { x: 175, y: 700 } },
					{ id: "vertical-inner-bottom", point: { x: 175, y: 350 } },
					{ id: "vertical-outer-bottom", point: { x: 25, y: 350 } },
				],
			},
			{
				id: "diagonal",
				closed: true,
				points: [
					{ id: "diagonal-outer-top", point: { x: 161, y: 744 } },
					{ id: "diagonal-outer-bottom", point: { x: 411, y: 394 } },
					{ id: "diagonal-inner-bottom", point: { x: 289, y: 306 } },
					{ id: "diagonal-inner-top", point: { x: 39, y: 656 } },
				],
			},
		])

		expect(lowered.corners).toEqual([])
	})

	it("is invariant to cyclic starts, winding, and contour order", () => {
		const rotated = {
			...exterior,
			points: [...exterior.points.slice(2), ...exterior.points.slice(0, 2)],
		}
		const reversed = { ...exterior, points: [...exterior.points].reverse() }
		for (const contour of [rotated, reversed]) {
			const lowered = lowerInferredCorners([
				{ id: "unrelated", closed: true, points: [] },
				contour,
			])
			const result = lowered.contours.find(({ id }) => id === "exterior")
			expect(result?.points).toHaveLength(4)
			expect(
				result?.points.some(({ point }) => point.x === 100 && point.y === 0),
			).toBe(true)
			expect(
				result?.points.some(
					({ point }) =>
						(point.x === 120 && point.y === 0) ||
						(point.x === 100 && point.y === -20),
				),
			).toBe(false)
		}
	})

	it("rejects overlapping candidate neighborhoods as ambiguous", () => {
		const ambiguous: InferredCornerContour = {
			id: "ambiguous",
			closed: true,
			points: [
				{ id: "a", point: { x: 0, y: 0 } },
				{ id: "b", point: { x: 120, y: 0 } },
				{ id: "c", point: { x: 100, y: -20 } },
				{ id: "d", point: { x: 100, y: 120 } },
				{ id: "e", point: { x: 80, y: 100 } },
				{ id: "f", point: { x: 200, y: 100 } },
			],
		}
		const lowered = lowerInferredCorners([ambiguous])
		expect(lowered.corners).toEqual([])
		expect(lowered.contours[0]?.points).toEqual(ambiguous.points)
	})

	it.each([
		[
			"T",
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			],
		],
		[
			"plus",
			[
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			],
		],
		[
			"X",
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
				{ x: 100, y: 0 },
			],
		],
	])(
		"does not treat %s intersections as an open-corner pair",
		(_name, points) => {
			const contours = points.map((point, index) => ({
				id: `stroke-${index}`,
				closed: true,
				points: [
					{ id: `a-${index}`, point },
					{ id: `b-${index}`, point: { x: point.x + 10, y: point.y } },
					{ id: `c-${index}`, point: { x: point.x + 10, y: point.y + 10 } },
					{ id: `d-${index}`, point: { x: point.x, y: point.y + 10 } },
				],
			}))
			expect(lowerInferredCorners(contours).corners).toEqual([])
		},
	)
})
