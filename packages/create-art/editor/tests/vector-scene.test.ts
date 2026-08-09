import { describe, expect, it } from "vitest"

import { vectorContourPath } from "../src/vector-scene.ts"
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
