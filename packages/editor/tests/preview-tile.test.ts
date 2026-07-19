import { describe, expect, it } from "vitest"

import {
	estimateNoiseCharacterCount,
	generateGlyphNoise,
	PREVIEW_SAMPLES,
	previewColorDefault,
} from "../src/preview-tile.ts"

describe("preview tile model", () => {
	it("ships the requested proofing samples", () => {
		expect(PREVIEW_SAMPLES.lorem).toContain("Lorem ipsum")
		expect(PREVIEW_SAMPLES.cicero).toContain("denouncing pleasure")
		expect(PREVIEW_SAMPLES.pi.replace(".", "")).toHaveLength(1_000)
		expect(PREVIEW_SAMPLES.nato).toContain(
			"Alfa Bravo Charlie Delta Echo Foxtrot",
		)
		expect(PREVIEW_SAMPLES.nato).toContain("X-ray Yankee Zulu")
	})

	it("generates stable noise exclusively from the supplied glyphs", () => {
		const first = generateGlyphNoise("can", 80)
		expect(first).toHaveLength(80)
		expect(new Set(first)).toEqual(new Set(["c", "a", "n"]))
		expect(generateGlyphNoise("can", 80)).toBe(first)
		expect(generateGlyphNoise(" c a n ", 80)).toBe(first)
		expect(generateGlyphNoise("", 80)).toBe("")
	})

	it("weights repeated glyphs in the noise source", () => {
		const noise = generateGlyphNoise("nne", 10_000)
		const n = Array.from(noise).filter((glyph) => glyph === "n").length
		const e = noise.length - n
		expect(n / e).toBeGreaterThan(1.8)
		expect(n / e).toBeLessThan(2.2)
	})

	it("only uses the application preference to choose an initial preset", () => {
		expect(previewColorDefault(true)).toBe("light")
		expect(previewColorDefault(false)).toBe("dark")
	})

	it("requests more noise for larger panes and smaller, tighter type", () => {
		const base = estimateNoiseCharacterCount({
			width: 800,
			height: 600,
			fontSize: 40,
			lineHeight: 1.2,
		})
		expect(
			estimateNoiseCharacterCount({
				width: 1_600,
				height: 1_200,
				fontSize: 40,
				lineHeight: 1.2,
			}),
		).toBeGreaterThan(base)
		expect(
			estimateNoiseCharacterCount({
				width: 800,
				height: 600,
				fontSize: 20,
				lineHeight: 1,
			}),
		).toBeGreaterThan(base)
	})
})
