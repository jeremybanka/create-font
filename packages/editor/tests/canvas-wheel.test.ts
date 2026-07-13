import { describe, expect, it } from "vitest"

import { hasWheelZoomModifier } from "../src/canvas-wheel.ts"

describe("canvas wheel shortcuts", () => {
	it.each([
		["Alt/Option", { altKey: true, ctrlKey: false, metaKey: false }],
		["Control", { altKey: false, ctrlKey: true, metaKey: false }],
		["Command", { altKey: false, ctrlKey: false, metaKey: true }],
	])("zooms when %s is held", (_modifier, event) => {
		expect(hasWheelZoomModifier(event)).toBe(true)
	})

	it("pans without a zoom modifier", () => {
		expect(
			hasWheelZoomModifier({ altKey: false, ctrlKey: false, metaKey: false }),
		).toBe(false)
	})
})
