import { describe, expect, it } from "vitest"

import { resolveVerticalMetricGuides } from "@create-font/states"

import {
	snapDraggedPoint,
	snapDraggedTarget,
	type DragPositionTarget,
} from "../src/canvas-snapping.ts"
import { makeDemoFont } from "../src/demo-font.ts"
import { parseNumericInput } from "../src/numeric-input.ts"

const metricLines = resolveVerticalMetricGuides(makeDemoFont().metrics).filter(
	(guide) => guide.kind === "line",
)

describe("canvas snapping", () => {
	it("snaps axes independently and excludes the dragged node", () => {
		const snapped = snapDraggedPoint({
			pointId: "point:dragged",
			x: 103,
			y: 497,
			nodes: [
				{ pointId: "point:dragged", x: 103, y: 497 },
				{ pointId: "point:other", x: 100, y: 300 },
			],
			metrics: metricLines,
			worldScale: 1,
			thresholdPixels: 7,
		})
		expect(snapped).toMatchObject({ x: 100, y: 500 })
		expect(snapped.snaps.map((snap) => [snap.axis, snap.kind])).toEqual([
			["x", "node"],
			["y", "metric"],
		])
	})

	it("uses a screen-pixel threshold and deterministic tie breaks", () => {
		const input = {
			pointId: "point:dragged" as const,
			x: 100,
			y: 100,
			nodes: [
				{ pointId: "point:z" as const, x: 114, y: 300 },
				{ pointId: "point:a" as const, x: 86, y: 300 },
			],
			metrics: [],
			thresholdPixels: 7,
		}
		expect(snapDraggedPoint({ ...input, worldScale: 0.5 }).x).toBe(86)
		expect(snapDraggedPoint({ ...input, worldScale: 2 }).x).toBe(100)
	})

	it("reasserts the snapped canvas target position on every drag event", () => {
		let position = { x: 103, y: 497 }
		const target: DragPositionTarget = {
			x: () => position.x,
			y: () => position.y,
			position: (next) => {
				position = { ...next }
			},
		}
		const context = {
			pointId: "point:dragged" as const,
			nodes: [
				{ pointId: "point:dragged" as const, x: 103, y: 497 },
				{ pointId: "point:other" as const, x: 100, y: 300 },
			],
			metrics: metricLines,
			worldScale: 1,
			thresholdPixels: 7,
		}

		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 100, y: 500 })
		expect(position).toEqual({ x: 100, y: 500 })

		position = { x: 105, y: 496 }
		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 100, y: 500 })
		expect(position).toEqual({ x: 100, y: 500 })

		position = { x: 120, y: 480 }
		expect(snapDraggedTarget(target, context)).toMatchObject({ x: 120, y: 480 })
		expect(position).toEqual({ x: 120, y: 480 })
	})
})

describe("numeric input parsing", () => {
	it("retains only finite in-range integers for commit", () => {
		expect(parseNumericInput("42", 0, 100)).toBe(42)
		expect(parseNumericInput("", 0, 100)).toBeNull()
		expect(parseNumericInput("2.5", 0, 100)).toBeNull()
		expect(parseNumericInput("Infinity", 0, 100)).toBeNull()
		expect(parseNumericInput("101", 0, 100)).toBeNull()
	})
})
