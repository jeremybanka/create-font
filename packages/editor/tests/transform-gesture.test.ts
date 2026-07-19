import { describe, expect, it } from "vitest"

import type { TransformHandle } from "../src/canvas-cursor.ts"
import { resolveTransformResize } from "../src/transform-gesture.ts"

const bounds = { minX: 0, minY: 10, maxX: 100, maxY: 210 }

describe("transform resize gestures", () => {
	it.each([
		["west", -50, 110],
		["east", 150, 110],
		["north", 50, 310],
		["south", 50, -90],
		["north-west", -50, 310],
		["north-east", 150, 310],
		["south-east", 150, -90],
		["south-west", -50, -90],
	] as const)("keeps the center fixed for %s", (handle, targetX, targetY) => {
		const result = resolveTransformResize({
			bounds,
			handle,
			targetX,
			targetY,
			altKey: true,
		})
		expect(result.anchorX).toBe(50)
		expect(result.anchorY).toBe(110)
		if (handle.includes("west") || handle.includes("east"))
			expect(result.scaleX).toBe(2)
		else expect(result.scaleX).toBe(1)
		if (handle.includes("north") || handle.includes("south"))
			expect(result.scaleY).toBe(2)
		else expect(result.scaleY).toBe(1)
	})

	it("switches between opposite-edge and center math from original bounds", () => {
		const common = {
			bounds,
			handle: "east" as Exclude<TransformHandle, "inside">,
			targetX: 150,
			targetY: 110,
		}
		expect(resolveTransformResize(common)).toMatchObject({
			anchorX: 0,
			scaleX: 1.5,
		})
		expect(resolveTransformResize({ ...common, altKey: true })).toMatchObject({
			anchorX: 50,
			scaleX: 2,
		})
	})

	it("uses the existing dominant change for uniform center scaling", () => {
		expect(
			resolveTransformResize({
				bounds,
				handle: "north-east",
				targetX: 125,
				targetY: 310,
				altKey: true,
				shiftKey: true,
			}),
		).toEqual({ anchorX: 50, anchorY: 110, scaleX: 2, scaleY: 2 })
	})

	it("mirrors cleanly through the center and protects degenerate axes", () => {
		expect(
			resolveTransformResize({
				bounds,
				handle: "east",
				targetX: 25,
				targetY: 0,
				altKey: true,
			}).scaleX,
		).toBe(-0.5)
		const degenerate = resolveTransformResize({
			bounds: { minX: 5, maxX: 5, minY: 10, maxY: 20 },
			handle: "east",
			targetX: 100,
			targetY: 0,
			altKey: true,
		})
		expect(degenerate.scaleX).toBe(1)
		expect(Object.values(degenerate).every(Number.isFinite)).toBe(true)
	})
})
