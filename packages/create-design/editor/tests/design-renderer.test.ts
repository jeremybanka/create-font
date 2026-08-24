import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_CANVAS_RENDERER,
	DESIGN_CANVAS_RENDERERS,
	DESIGN_CANVAS_RENDERER_STORAGE_KEY,
	normalizeDesignCanvasRenderer,
	readDesignCanvasRenderer,
	writeDesignCanvasRenderer,
} from "../src/design-renderer.ts"

describe("design canvas renderer preference", () => {
	it("registers the existing Konva renderer as the default", () => {
		expect(DESIGN_CANVAS_RENDERERS).toEqual([
			{ id: "konva", label: "Konva (original)" },
			{ id: "vello-hybrid", label: "Vello Hybrid (GPU)" },
		])
		expect(DEFAULT_DESIGN_CANVAS_RENDERER).toBe("konva")
	})

	it("normalizes unavailable renderer settings to Konva", () => {
		expect(normalizeDesignCanvasRenderer("konva")).toBe("konva")
		expect(normalizeDesignCanvasRenderer("vello-hybrid")).toBe("vello-hybrid")
		expect(normalizeDesignCanvasRenderer("canvaskit")).toBe("konva")
		expect(normalizeDesignCanvasRenderer(null)).toBe("konva")
	})

	it("reads a supported renderer and absorbs unavailable or blocked storage", () => {
		expect(
			readDesignCanvasRenderer({
				getItem: (key) =>
					key === DESIGN_CANVAS_RENDERER_STORAGE_KEY ? "konva" : null,
			}),
		).toBe("konva")
		expect(readDesignCanvasRenderer({ getItem: () => "vello-hybrid" })).toBe(
			"vello-hybrid",
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
				{ setItem: (key, value) => values.set(key, value) },
				"vello-hybrid",
			),
		).toBe(true)
		expect(values.get(DESIGN_CANVAS_RENDERER_STORAGE_KEY)).toBe("vello-hybrid")
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
