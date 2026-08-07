import { describe, expect, it } from "vitest"

import {
	canvasDimmerHex,
	canvasDimmerPercent,
	canvasDimmerTokens,
	DEFAULT_DESIGN_CANVAS_DIMMER,
	DESIGN_CANVAS_DIMMER_STORAGE_KEY,
	normalizeCanvasDimmer,
	readCanvasDimmer,
} from "../src/canvas-dimmer.ts"

describe("canvas dimmer preference", () => {
	it("maps endpoints and midpoint to deterministic neutral colors", () => {
		expect(canvasDimmerHex(0)).toBe("#000000")
		expect(canvasDimmerHex(128)).toBe("#808080")
		expect(canvasDimmerHex(255)).toBe("#ffffff")
		expect(canvasDimmerPercent(128)).toBe(50)
	})

	it("normalizes invalid and out-of-range values defensively", () => {
		for (const value of [
			Number.NaN,
			Infinity,
			-1,
			256,
			"",
			"  ",
			"not-a-number",
		])
			expect(normalizeCanvasDimmer(value)).toBe(DEFAULT_DESIGN_CANVAS_DIMMER)
		expect(normalizeCanvasDimmer("127.6")).toBe(128)
	})

	it("reads storage without letting missing, malformed, or blocked storage fail", () => {
		expect(
			readCanvasDimmer({
				getItem: (key) =>
					key === DESIGN_CANVAS_DIMMER_STORAGE_KEY ? "200" : null,
			}),
		).toBe(200)
		expect(readCanvasDimmer({ getItem: () => "-20" })).toBe(
			DEFAULT_DESIGN_CANVAS_DIMMER,
		)
		expect(
			readCanvasDimmer({
				getItem: () => {
					throw new Error("blocked")
				},
			}),
		).toBe(DEFAULT_DESIGN_CANVAS_DIMMER)
	})

	it("switches every supporting chrome token for full-range contrast", () => {
		const black = canvasDimmerTokens(0)
		const white = canvasDimmerTokens(255)
		expect(black.surface).toBe("#000000")
		expect(black.artboardLabel).toBe("#f2f2f2")
		expect(white.surface).toBe("#ffffff")
		expect(white.artboardLabel).toBe("#171717")
		expect(black.selection).not.toBe(white.selection)
	})
})
