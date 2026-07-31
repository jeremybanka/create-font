import { describe, expect, it } from "vitest"

import {
	captureDesignPointer,
	clampToPage,
	designBaseScale,
	initialDesignCanvasView,
	nearestDesignObject,
	releaseDesignPointer,
	snapDesignObject,
} from "../src/design-canvas.ts"
import { createInitialDocument } from "../src/document.ts"
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
	geometry: {
		kind: "rectangle",
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: { fill: { swatchId: "swatch:coral" } },
})

describe("design canvas adapter", () => {
	it("fits and centers a page in a viewport", () => {
		const viewport = { width: 800, height: 600 }
		const page = { x: 0, y: 0, width: 612, height: 792 }
		const scale = designBaseScale(viewport, page)
		const view = initialDesignCanvasView(viewport, page, scale)
		expect(scale).toBeCloseTo(504 / 792)
		expect(view.x).toBeCloseTo((800 - 612 * scale) / 2)
		expect(view.y).toBe(48)
	})

	it("converts out-of-page gestures to page-edge coordinates", () => {
		expect(
			clampToPage(
				{ x: -20, y: 900 },
				{ x: 0, y: 0, width: 612, height: 792 },
			),
		).toEqual({ x: 0, y: 792 })
	})

	it("centers and clamps an offset page without changing the document plane", () => {
		const viewport = { width: 800, height: 600 }
		const page = { x: -120, y: 240, width: 400, height: 300 }
		const scale = designBaseScale(viewport, page)
		const view = initialDesignCanvasView(viewport, page, scale)
		expect(view.x + page.x * scale).toBeCloseTo(
			(viewport.width - page.width * scale) / 2,
		)
		expect(view.y + page.y * scale).toBeCloseTo(
			(viewport.height - page.height * scale) / 2,
		)
		expect(clampToPage({ x: -500, y: 900 }, page)).toEqual({
			x: page.x,
			y: page.y + page.height,
		})
	})

	it("uses deterministic topmost object hit precedence", () => {
		const bottom = rectangle("bottom", 10, 10, 100, 100)
		const top = rectangle("top", 20, 20, 80, 80)
		expect(
			nearestDesignObject([bottom, top], { x: 50, y: 50 }, 1)?.object.id,
		).toBe("top")
	})

	it("does not select transparent space inside a curved object's bounds", () => {
		const document = createInitialDocument()
		expect(
			nearestDesignObject(document.objects, { x: 500, y: 290 }, 0.634, 12),
		).toBeNull()
		expect(
			nearestDesignObject(document.objects, { x: 389, y: 419 }, 0.634, 12)
				?.object.id,
		).toBe("object:cyan")
	})

	it("keeps outside-stage pointer events captured through release or cancel", () => {
		const captured = new Set<number>()
		const target = {
			hasPointerCapture: (pointerId: number) => captured.has(pointerId),
			releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
			setPointerCapture: (pointerId: number) => captured.add(pointerId),
		}
		expect(captureDesignPointer(target, 7)).toBe(true)
		expect(captured.has(7)).toBe(true)
		expect(releaseDesignPointer(target, 7)).toBe(true)
		expect(captured.has(7)).toBe(false)
		expect(releaseDesignPointer(target, 7)).toBe(false)
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

	it("snaps against an offset page in global coordinates", () => {
		const document = {
			...createInitialDocument(),
			page: { x: -200, y: 300, width: 600, height: 400 },
		}
		const nearlyCentered = rectangle("moving", 49, 449, 151, 551)
		const snapped = snapDesignObject(nearlyCentered, document, 1)
		expect(snapped.x).toBe(100)
		expect(snapped.y).toBe(500)
		expect(snapped.object.geometry).toEqual(nearlyCentered.geometry)
	})
})
