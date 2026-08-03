import { describe, expect, it } from "vitest"

import type { TransformHandle } from "../src/canvas-cursor.ts"
import {
	normalizeSignedAngle,
	resolveTransformResize,
	resolveTransformRotation,
	snapTransformAngle,
} from "../src/transform-gesture.ts"

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
			handle: "east" as Exclude<TransformHandle, "inside" | "rotation">,
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

const radians = (degrees: number): number => (degrees * Math.PI) / 180
const degrees = (angle: number): number => (angle * 180) / Math.PI
const pointAt = (angleDegrees: number) => ({
	x: Math.cos(radians(angleDegrees)) * 100,
	y: Math.sin(radians(angleDegrees)) * 100,
})

describe("transform rotation gestures", () => {
	const centeredBounds = { minX: -50, minY: -25, maxX: 50, maxY: 25 }

	it("resolves signed angles around the stable selection center", () => {
		const counterClockwise = resolveTransformRotation({
			bounds: centeredBounds,
			startX: 100,
			startY: 0,
			targetX: 0,
			targetY: 100,
		})
		const clockwise = resolveTransformRotation({
			bounds: centeredBounds,
			startX: 100,
			startY: 0,
			targetX: 0,
			targetY: -100,
		})
		expect(counterClockwise).toMatchObject({ pivotX: 0, pivotY: 0 })
		expect(degrees(counterClockwise.angleRadians)).toBeCloseTo(90)
		expect(degrees(clockwise.angleRadians)).toBeCloseTo(-90)
	})

	it("normalizes deterministically across the signed wrap boundary", () => {
		const start = pointAt(179)
		const target = pointAt(-179)
		const result = resolveTransformRotation({
			bounds: centeredBounds,
			startX: start.x,
			startY: start.y,
			targetX: target.x,
			targetY: target.y,
		})
		expect(degrees(result.angleRadians)).toBeCloseTo(2)
		expect(degrees(normalizeSignedAngle(radians(181)))).toBeCloseTo(-179)
	})

	it("snaps Shift rotation to 15 degree increments in both directions", () => {
		expect(degrees(snapTransformAngle(radians(7.49)))).toBeCloseTo(0)
		expect(degrees(snapTransformAngle(radians(7.5)))).toBeCloseTo(15)
		expect(degrees(snapTransformAngle(radians(-44)))).toBeCloseTo(-45)
		expect(degrees(snapTransformAngle(radians(181)))).toBeCloseTo(-180)
	})

	it("engages and releases snapping from the original vector without jumps", () => {
		const target = pointAt(22)
		const common = {
			bounds: centeredBounds,
			startX: 100,
			startY: 0,
			targetX: target.x,
			targetY: target.y,
		}
		expect(degrees(resolveTransformRotation(common).angleRadians)).toBeCloseTo(
			22,
		)
		expect(
			degrees(
				resolveTransformRotation({ ...common, shiftKey: true }).angleRadians,
			),
		).toBeCloseTo(15)
		expect(degrees(resolveTransformRotation(common).angleRadians)).toBeCloseTo(
			22,
		)
	})

	it("returns a finite no-op for degenerate pointer vectors", () => {
		const result = resolveTransformRotation({
			bounds: { minX: 10, minY: 20, maxX: 10, maxY: 20 },
			startX: 10,
			startY: 20,
			targetX: Number.POSITIVE_INFINITY,
			targetY: 20,
			shiftKey: true,
		})
		expect(result).toEqual({ pivotX: 10, pivotY: 20, angleRadians: 0 })
		expect(Object.values(result).every(Number.isFinite)).toBe(true)
	})
})
