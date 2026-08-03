import { describe, expect, it } from "vitest"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import {
	defaultDesignAppearance,
	setDesignAppearancePaint,
	summarizeDesignAppearance,
	swapDesignAppearancePaints,
	validDesignAppearance,
} from "../src/appearance.ts"
import { createInitialDocument } from "../src/document.ts"

describe("design appearance authoring", () => {
	it("summarizes independent paints and exposes mixed selection values", () => {
		const document = createInitialDocument()
		expect(
			summarizeDesignAppearance([], { fill: { swatchId: "swatch:ink" } }),
		).toEqual({
			fill: "swatch:ink",
			stroke: null,
			strokeStyle: {
				width: null,
				cap: null,
				join: null,
				miterLimit: null,
				dashArray: null,
				dashOffset: null,
			},
		})
		expect(summarizeDesignAppearance(document.objects, {})).toEqual({
			fill: "mixed",
			stroke: null,
			strokeStyle: {
				width: null,
				cap: null,
				join: null,
				miterLimit: null,
				dashArray: null,
				dashOffset: null,
			},
		})
	})

	it("sets either paint to a swatch or none without changing the other", () => {
		const both = {
			fill: { swatchId: "swatch:coral" },
			stroke: {
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 3,
			},
		}
		expect(setDesignAppearancePaint(both, "fill", undefined)).toEqual({
			stroke: both.stroke,
		})
		expect(setDesignAppearancePaint(both, "stroke", undefined)).toEqual({
			fill: both.fill,
		})
		expect(
			setDesignAppearancePaint({ fill: both.fill }, "stroke", "swatch:ink"),
		).toEqual({
			fill: both.fill,
			stroke: {
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 1,
			},
		})
	})

	it("swaps fill and stroke paints while retaining an authored stroke width", () => {
		expect(
			swapDesignAppearancePaints({
				fill: { swatchId: "swatch:coral" },
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 4,
				},
			}),
		).toEqual({
			fill: { swatchId: "swatch:ink" },
			stroke: {
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:coral",
				width: 4,
			},
		})
		expect(
			swapDesignAppearancePaints({ fill: { swatchId: "swatch:coral" } }),
		).toEqual({
			stroke: {
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:coral",
				width: 1,
			},
		})
	})

	it("keeps create-design defaults local and drops unavailable current paints", () => {
		const document = createInitialDocument()
		expect(defaultDesignAppearance(document.swatches)).toEqual({
			fill: { swatchId: "swatch:coral" },
		})
		expect(
			validDesignAppearance(
				{
					fill: { swatchId: "swatch:missing" },
					stroke: {
						...DEFAULT_DESIGN_STROKE_STYLE,
						swatchId: "swatch:ink",
						width: 2,
					},
				},
				document.swatches,
			),
		).toEqual({
			stroke: {
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 2,
			},
		})
	})

	it("summarizes authored stroke properties independently", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const first = {
			...object,
			appearance: {
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 6,
					dashArray: [4, 2],
				},
			},
		}
		const second = {
			...first,
			id: "object:second",
			appearance: {
				stroke: { ...first.appearance.stroke, cap: "round" as const },
			},
		}
		expect(summarizeDesignAppearance([first, second], {})).toMatchObject({
			stroke: "swatch:ink",
			strokeStyle: { width: 6, cap: "mixed", dashArray: [4, 2] },
		})
	})
})
