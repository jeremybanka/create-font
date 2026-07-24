import { describe, expect, it } from "vitest"

import {
	clampToPage,
	designBaseScale,
	initialDesignCanvasView,
	nearestDesignObject,
	snapDesignObject,
} from "../src/design-canvas.ts"
import { createInitialDocument } from "../src/document.ts"
import { rectangleContour } from "../src/geometry.ts"
import type { DesignObject } from "../src/types.ts"

const rectangle = (
	id: string,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): DesignObject => ({
	id,
	name: id,
	fillId: "swatch:coral",
	contours: [{ ...rectangleContour({ minX, minY, maxX, maxY }) }],
})

describe("design canvas adapter", () => {
	it("fits and centers a page in a viewport", () => {
		const viewport = { width: 800, height: 600 }
		const page = { width: 612, height: 792 }
		const scale = designBaseScale(viewport, page)
		const view = initialDesignCanvasView(viewport, page, scale)
		expect(scale).toBeCloseTo(504 / 792)
		expect(view.x).toBeCloseTo((800 - 612 * scale) / 2)
		expect(view.y).toBe(48)
	})

	it("converts out-of-page gestures to page-edge coordinates", () => {
		expect(
			clampToPage({ x: -20, y: 900 }, { width: 612, height: 792 }),
		).toEqual({ x: 0, y: 792 })
	})

	it("uses deterministic topmost object hit precedence", () => {
		const bottom = rectangle("bottom", 10, 10, 100, 100)
		const top = rectangle("top", 20, 20, 80, 80)
		expect(
			nearestDesignObject([bottom, top], { x: 50, y: 50 }, 1)?.object.id,
		).toBe("top")
	})

	it("snaps an object center to the page center at every zoom", () => {
		const document = createInitialDocument()
		const nearlyCentered = rectangle(
			"moving",
			document.page.width / 2 - 50.5,
			document.page.height / 2 - 50,
			document.page.width / 2 + 49.5,
			document.page.height / 2 + 50,
		)
		const atOne = snapDesignObject(nearlyCentered, document, 1)
		expect(atOne.x).toBe(document.page.width / 2)
		const zoomed = snapDesignObject(nearlyCentered, document, 4)
		expect(zoomed.x).toBe(document.page.width / 2)
	})
})
