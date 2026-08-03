import { describe, expect, it } from "vitest"

import {
	cmykToRgb,
	resolvedCmyk,
	resolvedRgb,
	rgbToCmyk,
} from "../src/color.ts"

describe("design colors", () => {
	it("converts process colors in both directions", () => {
		expect(cmykToRgb({ space: "cmyk", c: 100, m: 0, y: 0, k: 0 })).toEqual({
			space: "rgb",
			r: 0,
			g: 255,
			b: 255,
		})
		expect(rgbToCmyk({ space: "rgb", r: 0, g: 0, b: 0 })).toEqual({
			space: "cmyk",
			c: 0,
			m: 0,
			y: 0,
			k: 100,
		})
	})

	it("uses a manual alternate without replacing the source definition", () => {
		const swatch = {
			id: "swatch:test",
			name: "Test",
			source: { space: "rgb", r: 218, g: 94, b: 67 },
			alternate: { space: "cmyk", c: 0, m: 72, y: 68, k: 4 },
		} as const
		expect(resolvedRgb(swatch)).toEqual(swatch.source)
		expect(resolvedCmyk(swatch)).toEqual(swatch.alternate)
	})
})
