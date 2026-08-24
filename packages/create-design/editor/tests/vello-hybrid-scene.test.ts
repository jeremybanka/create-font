import { describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import {
	projectVelloHybridScene,
	velloPreservedStrokeWidth,
} from "../src/vello-hybrid-scene.ts"

describe("Vello Hybrid scene projection", () => {
	it("projects a whole vector scene into one DPR-aware packet", () => {
		const document = createInitialDocument()
		const projection = projectVelloHybridScene({
			viewport: { width: 800, height: 600 },
			devicePixelRatio: 2,
			view: { x: 12, y: 18, scale: 0.5 },
			artboards: document.artboards,
			objects: document.objects,
			swatches: document.swatches,
		})
		expect(projection.packet).toMatchObject({
			abiVersion: 1,
			width: 1600,
			height: 1200,
			view: [1, 0, 0, 1, 24, 36],
		})
		expect(projection.packet?.draws.map(({ id }) => id)).toEqual([
			"object:coral",
			"object:cyan",
		])
		expect(projection.gpuObjectIds).toEqual(
			new Set(["object:coral", "object:cyan"]),
		)
		expect(JSON.parse(projection.packetJson ?? "null")).toMatchObject({
			abiVersion: 1,
		})
	})

	it("preserves authored strokes once they exceed the device-pixel floor", () => {
		expect(velloPreservedStrokeWidth(2, 1, 2)).toBe(2)
		expect(velloPreservedStrokeWidth(0.1, 0.25, 2)).toBe(1.5)
	})

	it("delegates unsupported primitives explicitly instead of dropping them", () => {
		const document = createInitialDocument()
		const path = {
			...document.objects[0]!,
			appearance: {
				stroke: {
					swatchId: "swatch:ink",
					width: 1,
					cap: "butt" as const,
					join: "miter" as const,
					miterLimit: 4,
					dashArray: [3, 2],
					dashOffset: 0,
				},
			},
		}
		const projection = projectVelloHybridScene({
			viewport: { width: 100, height: 100 },
			devicePixelRatio: 1,
			view: { x: 0, y: 0, scale: 1 },
			artboards: [],
			objects: [path],
			swatches: document.swatches,
		})
		expect(projection.gpuObjectIds.size).toBe(0)
		expect(projection.packet).toBeNull()
		expect(projection.diagnostics).toEqual([
			expect.objectContaining({ code: "stroke-dash", objectId: path.id }),
		])
	})

	it("rejects drawing buffers outside Vello's explicit u16 surface limit", () => {
		const projection = projectVelloHybridScene({
			viewport: { width: 40_000, height: 100 },
			devicePixelRatio: 2,
			view: { x: 0, y: 0, scale: 1 },
			artboards: [],
			objects: [],
			swatches: [],
		})
		expect(projection.packet).toBeNull()
		expect(projection.diagnostics[0]?.code).toBe("canvas-size")
	})
})
