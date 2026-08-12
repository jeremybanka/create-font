import { describe, expect, it } from "vitest"

import { vectorContourPath, vectorPenSegmentPath } from "../src/vector-scene.ts"
import { vectorCornerHandlePosition } from "../src/VectorScene.tsx"
import type { VectorContour } from "../src/vector-editing.ts"

const square = (profile?: "circular" | "squircle"): VectorContour => ({
	id: "contour:square",
	closed: true,
	nodes: [
		{ id: "point:0", mode: "hard", x: 0, y: 0 },
		{
			id: "point:1",
			mode: "hard",
			x: 100,
			y: 0,
			...(profile === undefined ? {} : { corner: { profile, amount: 20 } }),
		},
		{ id: "point:2", mode: "hard", x: 100, y: 100 },
		{ id: "point:3", mode: "hard", x: 0, y: 100 },
	],
})

describe("shared vector scene paths", () => {
	it.each([
		{
			label: "straight",
			from: { x: 10, y: 20 },
			to: { x: 80, y: 90 },
			expected: "M 10 20 L 80 90",
		},
		{
			label: "source handle only",
			from: { x: 10, y: 20, outgoing: { x: 15, y: -5 } },
			to: { x: 80, y: 90 },
			expected: "M 10 20 C 25 15 80 90 80 90",
		},
		{
			label: "target handle only",
			from: { x: 10, y: 20 },
			to: { x: 80, y: 90, incoming: { x: -12, y: 7 } },
			expected: "M 10 20 C 10 20 68 97 80 90",
		},
		{
			label: "both endpoint handles",
			from: { x: 10, y: 20, outgoing: { x: 15, y: -5 } },
			to: { x: 80, y: 90, incoming: { x: -12, y: 7 } },
			expected: "M 10 20 C 25 15 68 97 80 90",
		},
	] as const)(
		"renders a $label prospective segment",
		({ from, to, expected }) => {
			expect(vectorPenSegmentPath(from, to)).toBe(expected)
		},
	)

	it("renders circular and squircle metadata as lowered canvas geometry", () => {
		const sharp = vectorContourPath(square())
		const circular = vectorContourPath(square("circular"))
		const squircle = vectorContourPath(square("squircle"))
		expect(sharp).not.toContain("C ")
		expect(circular).toContain("C ")
		expect(squircle).toContain("C ")
		expect(circular).not.toBe(sharp)
		expect(squircle).not.toBe(circular)
	})

	it("places curved-corner controls from incident tangents", () => {
		const position = vectorCornerHandlePosition(
			{
				id: "point:corner",
				mode: "hard",
				x: 0,
				y: 0,
				incoming: { x: -20, y: 0 },
				outgoing: { x: 0, y: 20 },
			},
			{ id: "point:before", mode: "hard", x: 0, y: -100 },
			{ id: "point:after", mode: "hard", x: 100, y: 0 },
			1,
		)
		expect(position?.x).toBeCloseTo(-Math.SQRT1_2 * 18)
		expect(position?.y).toBeCloseTo(Math.SQRT1_2 * 18)
	})
})
