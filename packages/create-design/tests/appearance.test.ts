import { describe, expect, it } from "vitest"

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
		).toEqual({ fill: "swatch:ink", stroke: null })
		expect(summarizeDesignAppearance(document.objects, {})).toEqual({
			fill: "mixed",
			stroke: null,
		})
	})

	it("sets either paint to a swatch or none without changing the other", () => {
		const both = {
			fill: { swatchId: "swatch:coral" },
			stroke: { swatchId: "swatch:ink", width: 3 },
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
			stroke: { swatchId: "swatch:ink", width: 1 },
		})
	})

	it("swaps fill and stroke paints while retaining an authored stroke width", () => {
		expect(
			swapDesignAppearancePaints({
				fill: { swatchId: "swatch:coral" },
				stroke: { swatchId: "swatch:ink", width: 4 },
			}),
		).toEqual({
			fill: { swatchId: "swatch:ink" },
			stroke: { swatchId: "swatch:coral", width: 4 },
		})
		expect(
			swapDesignAppearancePaints({ fill: { swatchId: "swatch:coral" } }),
		).toEqual({ stroke: { swatchId: "swatch:coral", width: 1 } })
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
					stroke: { swatchId: "swatch:ink", width: 2 },
				},
				document.swatches,
			),
		).toEqual({ stroke: { swatchId: "swatch:ink", width: 2 } })
	})
})
