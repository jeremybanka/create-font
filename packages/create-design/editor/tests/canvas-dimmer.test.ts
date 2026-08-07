import { describe, expect, it } from "vitest"

import {
	browserPrefersLightColorScheme,
	canvasDimmerHex,
	canvasDimmerPercent,
	canvasDimmerTokens,
	DARK_DESIGN_CANVAS_DIMMER,
	DESIGN_CANVAS_DIMMER_STORAGE_KEY,
	LIGHT_DESIGN_CANVAS_DIMMER,
	normalizeCanvasDimmer,
	readCanvasDimmerPreference,
	resolveCanvasDimmer,
	writeCanvasDimmerPreference,
} from "../src/canvas-dimmer.ts"

describe("canvas dimmer preference", () => {
	it("uses the light contextual default when system appearance is unavailable", () => {
		expect(browserPrefersLightColorScheme()).toBe(true)
	})

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
			expect(normalizeCanvasDimmer(value)).toBe(DARK_DESIGN_CANVAS_DIMMER)
		expect(normalizeCanvasDimmer("127.6")).toBe(128)
	})

	it("derives unsaved light and dark defaults from the system scheme", () => {
		const inherited = readCanvasDimmerPreference({ getItem: () => null })
		expect(inherited).toEqual({ kind: "system" })
		expect(resolveCanvasDimmer(inherited, false)).toBe(
			DARK_DESIGN_CANVAS_DIMMER,
		)
		expect(resolveCanvasDimmer(inherited, true)).toBe(
			LIGHT_DESIGN_CANVAS_DIMMER,
		)
	})

	it("lets an explicit stored value override either system scheme", () => {
		const explicit = readCanvasDimmerPreference({
			getItem: (key) =>
				key === DESIGN_CANVAS_DIMMER_STORAGE_KEY ? "200" : null,
		})
		expect(explicit).toEqual({ kind: "explicit", value: 200 })
		expect(resolveCanvasDimmer(explicit, false)).toBe(200)
		expect(resolveCanvasDimmer(explicit, true)).toBe(200)
	})

	it("treats malformed and blocked storage as an inherited preference", () => {
		expect(readCanvasDimmerPreference({ getItem: () => "-20" })).toEqual({
			kind: "system",
		})
		expect(
			readCanvasDimmerPreference({
				getItem: () => {
					throw new Error("blocked")
				},
			}),
		).toEqual({ kind: "system" })
	})

	it("writes only explicit preferences and absorbs storage failures", () => {
		const values = new Map<string, string>()
		const storage = {
			setItem: (key: string, value: string) => values.set(key, value),
		}
		expect(writeCanvasDimmerPreference(storage, { kind: "system" })).toBe(false)
		expect(values.size).toBe(0)
		expect(
			writeCanvasDimmerPreference(storage, { kind: "explicit", value: 144 }),
		).toBe(true)
		expect(values.get(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe("144")
		expect(
			writeCanvasDimmerPreference(
				{
					setItem: () => {
						throw new Error("blocked")
					},
				},
				{ kind: "explicit", value: 144 },
			),
		).toBe(false)
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
