import { describe, expect, it } from "vitest"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import {
	captureDesignPointer,
	clampToPage,
	DEFAULT_DESIGN_SNAP_SETTINGS,
	designBaseScale,
	designSnapTargets,
	designSnapThreshold,
	initialDesignCanvasView,
	nearestDesignObject,
	releaseDesignPointer,
	snapDesignObject,
	snapDesignObjects,
} from "../src/design-canvas.ts"
import { createInitialDocument } from "../src/document.ts"
import type { DesignObject, DesignStroke } from "../src/types.ts"

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

const artboard = (
	bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
) => ({
	id: "artboard:test",
	name: "Test artboard",
	...bounds,
})

const strokedPath = (stroke: Partial<DesignStroke> = {}): DesignObject => ({
	id: "stroke",
	name: "Stroke",
	geometry: {
		kind: "path",
		contours: [
			{
				id: "contour:stroke",
				closed: false,
				points: [
					{ id: "point:stroke:start", x: 3, y: 20 },
					{ id: "point:stroke:end", x: 23, y: 20 },
				],
			},
		],
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: {
		stroke: {
			...DEFAULT_DESIGN_STROKE_STYLE,
			swatchId: "swatch:ink",
			width: 4,
			...stroke,
		},
	},
})

const text = (overrides: Partial<DesignObject> = {}): DesignObject => ({
	id: "text",
	name: "Text",
	geometry: {
		kind: "text",
		mode: "point",
		text: "A A",
		x: 20,
		y: 50,
		typography: {
			font: { id: "font:test", family: "Test" },
			size: 20,
			leading: 24,
			tracking: 0,
			kerning: "auto",
			alignment: "start",
			direction: "auto",
		},
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: { fill: { swatchId: "swatch:coral" } },
	...overrides,
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
			clampToPage({ x: -20, y: 900 }, { x: 0, y: 0, width: 612, height: 792 }),
		).toEqual({
			x: 0,
			y: 792,
		})
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

	it("hits only text interaction boxes while retaining topmost and eligibility semantics", () => {
		const bottom = rectangle("bottom", 0, 0, 100, 100)
		const top = text()
		const bounds = () => ({ minX: 20, minY: 30, maxX: 80, maxY: 54 })
		expect(
			nearestDesignObject([bottom, top], { x: 50, y: 40 }, 1, 12, bounds)
				?.object.id,
		).toBe("text")
		expect(
			nearestDesignObject([top], { x: 81, y: 40 }, 1, 12, bounds),
		).toBeNull()
		expect(
			nearestDesignObject(
				[text({ hidden: true })],
				{ x: 50, y: 40 },
				1,
				12,
				bounds,
			),
		).toBeNull()
		expect(
			nearestDesignObject(
				[text({ locked: true })],
				{ x: 50, y: 40 },
				1,
				12,
				bounds,
			),
		).toBeNull()
	})

	it("hits visible stroke bodies while excluding authored dash gaps", () => {
		const solid = strokedPath({ width: 10 })
		expect(
			nearestDesignObject([solid], { x: 12, y: 24.5 }, 1, 0)?.object.id,
		).toBe("stroke")
		const dashed = strokedPath({ dashArray: [4, 4] })
		for (const worldScale of [0.5, 1, 4])
			expect(
				nearestDesignObject([dashed], { x: 5, y: 20 }, worldScale, 0)?.object
					.id,
			).toBe("stroke")
		expect(nearestDesignObject([dashed], { x: 9, y: 20 }, 1, 0)).toBeNull()
	})

	it("keeps the outside selection tolerance constant in screen pixels", () => {
		const object = rectangle("fill", 10, 10, 100, 100)
		expect(
			nearestDesignObject([object], { x: 105, y: 50 }, 1, 12),
		).not.toBeNull()
		expect(nearestDesignObject([object], { x: 105, y: 50 }, 3, 12)).toBeNull()
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
		const activeArtboard = document.artboards[0]!
		const nearlyCentered = rectangle(
			"moving",
			activeArtboard.width / 2 - 50.5,
			activeArtboard.height / 2 - 50,
			activeArtboard.width / 2 + 49.5,
			activeArtboard.height / 2 + 50,
		)
		const atOne = snapDesignObject(nearlyCentered, activeArtboard, 1)
		expect(atOne.x).toBe(activeArtboard.width / 2)
		const zoomed = snapDesignObject(nearlyCentered, activeArtboard, 4)
		expect(zoomed.x).toBe(activeArtboard.width / 2)
	})

	it("snaps against an offset page in global coordinates", () => {
		const activeArtboard = artboard({
			x: -200,
			y: 300,
			width: 600,
			height: 400,
		})
		const nearlyCentered = rectangle("moving", 49, 449, 151, 551)
		const snapped = snapDesignObject(nearlyCentered, activeArtboard, 1)
		expect(snapped.x).toBe(100)
		expect(snapped.y).toBe(500)
		expect(snapped.object.geometry).toEqual(nearlyCentered.geometry)
	})

	it("snaps the painted stroke edge rather than its centerline bounds", () => {
		const square = strokedPath({ cap: "square" })
		const snapped = snapDesignObject(
			square,
			artboard({ x: 0, y: 0, width: 100, height: 100 }),
			1,
		)
		expect(snapped.x).toBe(0)
		expect(snapped.object.transform.e).toBe(-1)
		const transformed = {
			...square,
			transform: { ...square.transform, e: 27 },
		}
		const transformedSnap = snapDesignObject(
			transformed,
			artboard({ x: 0, y: 0, width: 100, height: 100 }),
			1,
		)
		expect(transformedSnap.x).toBe(50)
		expect(transformedSnap.object.transform.e).toBe(25)
		const dashed = strokedPath({ dashArray: [4, 4] })
		const dashedSnap = snapDesignObject(
			{ ...dashed, transform: { ...dashed.transform, e: 26 } },
			artboard({ x: 0, y: 0, width: 100, height: 100 }),
			1,
		)
		expect(dashedSnap.x).toBe(50)
		expect(dashedSnap.object.transform.e).toBe(27)
	})

	it("collects every configurable target category and excludes hidden objects", () => {
		const moving = rectangle("moving", 10, 10, 20, 20)
		const locked = {
			...rectangle("locked", 40, 50, 60, 70),
			locked: true,
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:locked",
						closed: false,
						points: [
							{
								id: "point:locked",
								x: 40,
								y: 50,
								outgoing: { x: 8, y: 3 },
							},
						],
					},
				],
			},
		}
		const hidden = { ...rectangle("hidden", 80, 90, 100, 110), hidden: true }
		const document = {
			...createInitialDocument(),
			objects: [moving, locked, hidden],
			layers: [
				{
					id: "layer:test",
					name: "Test",
					children: [moving, locked, hidden].map((object) => ({
						kind: "object" as const,
						id: object.id,
					})),
				},
			],
			guides: [
				{ id: "guide:locked", axis: "x" as const, value: 32, locked: true },
			],
		}
		const targets = designSnapTargets(
			document,
			"x",
			DEFAULT_DESIGN_SNAP_SETTINGS,
			new Set([moving.id]),
		)
		expect(new Set(targets.map(({ category }) => category))).toEqual(
			new Set([
				"artboards",
				"guides",
				"objectBounds",
				"anchors",
				"controlPoints",
			]),
		)
		expect(targets.some(({ id }) => id.includes("locked"))).toBe(true)
		expect(targets.some(({ id }) => id.includes("hidden"))).toBe(false)
	})

	it("inherits layer visibility for snaps while retaining locked-layer references", () => {
		const moving = rectangle("moving", 0, 0, 10, 10)
		const hidden = rectangle("layer-hidden", 40, 40, 50, 50)
		const locked = rectangle("layer-locked", 80, 80, 90, 90)
		const document = {
			...createInitialDocument(),
			objects: [moving, hidden, locked],
			layers: [
				{
					id: "layer:moving",
					name: "Moving",
					children: [{ kind: "object" as const, id: moving.id }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:locked",
					name: "Locked",
					locked: true,
					children: [{ kind: "object" as const, id: locked.id }],
				},
			],
		}
		const targets = designSnapTargets(
			document,
			"x",
			DEFAULT_DESIGN_SNAP_SETTINGS,
			new Set([moving.id]),
		)
		expect(targets.some(({ id }) => id.includes(hidden.id))).toBe(false)
		expect(targets.some(({ id }) => id.includes(locked.id))).toBe(true)
		expect(hidden.hidden).toBeUndefined()
		expect(locked.locked).toBeUndefined()
	})

	it("honors disabled categories without changing document geometry", () => {
		const moving = rectangle("moving", 100, 100, 110, 110)
		const document = {
			...createInitialDocument(),
			artboards: [artboard({ x: 1_000, y: 1_000, width: 100, height: 100 })],
			objects: [moving],
			layers: [
				{
					id: "layer:test",
					name: "Test",
					children: [{ kind: "object" as const, id: moving.id }],
				},
			],
			guides: [{ id: "guide:near", axis: "x" as const, value: 112 }],
		}
		const enabled = snapDesignObject(moving, document, 1)
		expect(enabled.x).toBe(112)
		const disabled = snapDesignObject(moving, document, 1, {
			thresholdPixels: 7,
			enabled: {
				artboards: false,
				guides: false,
				objectBounds: false,
				anchors: false,
				controlPoints: false,
			},
		})
		expect(disabled.object).toEqual(moving)
		expect(document.guides[0]?.value).toBe(112)
	})

	it("ranks equal-distance candidates deterministically by priority then identity", () => {
		const moving = rectangle("moving", 100, 100, 110, 110)
		const scene = {
			artboards: [] as const,
			objects: [moving],
			guides: [
				{ id: "guide:z", axis: "x" as const, value: 98 },
				{ id: "guide:a", axis: "x" as const, value: 112 },
			],
		}
		const outcomes = Array.from(
			{ length: 20 },
			() => snapDesignObject(moving, scene, 1).x,
		)
		expect(new Set(outcomes)).toEqual(new Set([98]))
		expect(snapDesignObject(moving, scene, 1).matches?.[0]?.category).toBe(
			"guides",
		)
	})

	it("keeps snap distance screen-constant across zoom and invariant under pan or rotation", () => {
		expect(designSnapThreshold(7, 1, 0)).toBe(7)
		expect(designSnapThreshold(7, 2, 90)).toBe(3.5)
		expect(designSnapThreshold(7, 2, -37)).toBe(3.5)
		const moving = rectangle("moving", 100, 100, 110, 110)
		const scene = {
			artboards: [] as const,
			objects: [moving],
			guides: [{ id: "guide:five", axis: "x" as const, value: 115 }],
		}
		expect(snapDesignObject(moving, scene, 1).x).toBe(115)
		expect(snapDesignObject(moving, scene, 2).x).toBeNull()
	})

	it("snaps multi-selected objects rigidly from their combined bounds", () => {
		const first = rectangle("first", 10, 20, 30, 40)
		const second = rectangle("second", 40, 50, 60, 70)
		const scene = {
			artboards: [] as const,
			objects: [first, second],
			guides: [{ id: "guide:right", axis: "x" as const, value: 63 }],
		}
		const result = snapDesignObjects([first, second], scene, 1)
		expect(result.x).toBe(63)
		expect(result.objects[0]?.transform.e).toBe(3)
		expect(result.objects[1]?.transform.e).toBe(3)
	})
})
