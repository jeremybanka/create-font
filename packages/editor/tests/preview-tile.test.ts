import { describe, expect, it } from "vitest"

import {
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

	it("only uses the application preference to choose an initial preset", () => {
		expect(previewColorDefault(true)).toBe("light")
		expect(previewColorDefault(false)).toBe("dark")
	})
})
