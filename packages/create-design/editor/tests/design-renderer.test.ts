import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_CANVAS_RENDERER,
	DESIGN_CANVAS_RENDERERS,
	DESIGN_CANVAS_RENDERER_STORAGE_KEY,
	designCanvasDisplayStrokeWidth,
	normalizeDesignCanvasRenderer,
	PRESERVED_KONVA_MINIMUM_STROKE_DEVICE_PIXELS,
	readDesignCanvasRenderer,
	writeDesignCanvasRenderer,
} from "../src/design-renderer.ts"

describe("design canvas renderer preference", () => {
	it("registers the existing Konva renderer as the default", () => {
		expect(DESIGN_CANVAS_RENDERERS).toEqual([
			{ id: "konva", label: "Konva (original)" },
			{ id: "konva-preserved", label: "Konva (preserved detail)" },
		])
		expect(DEFAULT_DESIGN_CANVAS_RENDERER).toBe("konva")
	})

	it("normalizes unavailable renderer settings to Konva", () => {
		expect(normalizeDesignCanvasRenderer("konva")).toBe("konva")
		expect(normalizeDesignCanvasRenderer("konva-preserved")).toBe(
			"konva-preserved",
		)
		expect(normalizeDesignCanvasRenderer("canvaskit")).toBe("konva")
		expect(normalizeDesignCanvasRenderer(null)).toBe("konva")
	})

	it("leaves authored stroke widths exact in the original renderer", () => {
		expect(
			designCanvasDisplayStrokeWidth({
				authoredWidth: 0.125,
				devicePixelRatio: 2,
				renderer: "konva",
				worldScale: 0.1,
			}),
		).toBe(0.125)
	})

	it("promotes low-zoom hairlines to one physical output pixel", () => {
		const authoredWidth = 0.25
		const worldScale = 0.1
		const devicePixelRatio = 2
		const displayWidth = designCanvasDisplayStrokeWidth({
			authoredWidth,
			devicePixelRatio,
			renderer: "konva-preserved",
			worldScale,
		})
		expect(displayWidth).toBe(5)
		expect(displayWidth * worldScale * devicePixelRatio).toBe(
			PRESERVED_KONVA_MINIMUM_STROKE_DEVICE_PIXELS,
		)
	})

	it("does not change strokes that already cover the preservation floor", () => {
		expect(
			designCanvasDisplayStrokeWidth({
				authoredWidth: 2,
				devicePixelRatio: 2,
				renderer: "konva-preserved",
				worldScale: 0.5,
			}),
		).toBe(2)
	})

	it("falls back to authored geometry for invalid projection inputs", () => {
		for (const projection of [
			{ worldScale: 0, devicePixelRatio: 2 },
			{ worldScale: Number.NaN, devicePixelRatio: 2 },
			{ worldScale: 0.5, devicePixelRatio: 0 },
			{ worldScale: 0.5, devicePixelRatio: Number.POSITIVE_INFINITY },
		])
			expect(
				designCanvasDisplayStrokeWidth({
					authoredWidth: 0.25,
					renderer: "konva-preserved",
					...projection,
				}),
			).toBe(0.25)
	})

	it("reads a supported renderer and absorbs unavailable or blocked storage", () => {
		expect(
			readDesignCanvasRenderer({
				getItem: (key) =>
					key === DESIGN_CANVAS_RENDERER_STORAGE_KEY ? "konva" : null,
			}),
		).toBe("konva")
		expect(readDesignCanvasRenderer({ getItem: () => "konva-preserved" })).toBe(
			"konva-preserved",
		)
		expect(readDesignCanvasRenderer({ getItem: () => "future-renderer" })).toBe(
			"konva",
		)
		expect(
			readDesignCanvasRenderer({
				getItem: () => {
					throw new Error("blocked")
				},
			}),
		).toBe("konva")
	})

	it("persists selections without letting storage failures block the session", () => {
		const values = new Map<string, string>()
		expect(
			writeDesignCanvasRenderer(
				{
					setItem: (key, value) => values.set(key, value),
				},
				"konva",
			),
		).toBe(true)
		expect(values.get(DESIGN_CANVAS_RENDERER_STORAGE_KEY)).toBe("konva")
		expect(
			writeDesignCanvasRenderer(
				{
					setItem: (key, value) => values.set(key, value),
				},
				"konva-preserved",
			),
		).toBe(true)
		expect(values.get(DESIGN_CANVAS_RENDERER_STORAGE_KEY)).toBe(
			"konva-preserved",
		)
		expect(
			writeDesignCanvasRenderer(
				{
					setItem: () => {
						throw new Error("blocked")
					},
				},
				"konva",
			),
		).toBe(false)
	})
})
