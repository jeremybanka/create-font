import { describe, expect, it } from "vitest"
import { IDENTITY_DESIGN_TRANSFORM } from "@create-design/model"

import {
	bakePerspectiveObjects,
	perspectiveQuadFromBounds,
	perspectiveTransformEligibility,
	resolvePerspectiveCornerAcquisition,
	resolvePerspectiveQuad,
	validPerspectiveQuad,
} from "../src/perspective-transform.ts"
import type { DesignDocument, DesignObject } from "../src/types.ts"

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 }

const rectangle = (overrides: Partial<DesignObject> = {}): DesignObject => ({
	id: "object:rect",
	name: "Rectangle",
	geometry: { kind: "rectangle", x: 0, y: 0, width: 100, height: 80 },
	transform: IDENTITY_DESIGN_TRANSFORM,
	appearance: { fill: { swatchId: "swatch:black" } },
	...overrides,
})

const documentFor = (
	objects: readonly DesignObject[],
	overrides: Partial<DesignDocument> = {},
): DesignDocument => ({
	format: "create-design.document",
	version: 7,
	title: "Perspective test",
	artboards: [
		{ id: "artboard:1", name: "Artboard", x: 0, y: 0, width: 400, height: 300 },
	],
	layers: [
		{
			id: "layer:1",
			name: "Layer",
			children: objects.map(({ id }) => ({ kind: "object" as const, id })),
		},
	],
	objects,
	swatches: [
		{
			id: "swatch:black",
			name: "Black",
			source: { space: "rgb", r: 0, g: 0, b: 0 },
		},
	],
	groups: [],
	guides: [],
	...overrides,
})

describe("perspective cage gestures", () => {
	it("moves one corner to create a genuine non-affine quadrilateral", () => {
		const quad = resolvePerspectiveQuad(
			bounds,
			"nw",
			{ x: 0, y: 0 },
			{ x: 24, y: 12 },
			{ shiftKey: false, altKey: false },
		)
		expect(quad).toEqual([
			{ x: 24, y: 12 },
			{ x: 100, y: 0 },
			{ x: 100, y: 80 },
			{ x: 0, y: 80 },
		])
		expect(quad[0].x + quad[2].x).not.toBe(quad[1].x + quad[3].x)
		expect(validPerspectiveQuad(quad)).toBe(true)
	})

	it.each([
		["nw", 0, "horizontal", 1, { x: -12, y: 0 }],
		["nw", 0, "vertical", 3, { x: 0, y: -12 }],
		["ne", 1, "horizontal", 0, { x: 12, y: 0 }],
		["ne", 1, "vertical", 2, { x: 0, y: -12 }],
		["se", 2, "horizontal", 3, { x: 12, y: 0 }],
		["se", 2, "vertical", 1, { x: 0, y: 12 }],
		["sw", 3, "horizontal", 2, { x: -12, y: 0 }],
		["sw", 3, "vertical", 0, { x: 0, y: 12 }],
	] as const)(
		"sizes both endpoints of the %s corner's %s side for grow and shrink",
		(handle, movedIndex, acquisition, mateIndex, outward) => {
			const source = perspectiveQuadFromBounds(bounds)
			const start = source[movedIndex]
			const originalLength = Math.hypot(
				start.x - source[mateIndex].x,
				start.y - source[mateIndex].y,
			)
			for (const direction of [1, -1]) {
				const delta = {
					x: outward.x * direction,
					y: outward.y * direction,
				}
				const quad = resolvePerspectiveQuad(
					bounds,
					handle,
					start,
					{ x: start.x + delta.x, y: start.y + delta.y },
					{
						shiftKey: false,
						altKey: true,
						cornerAcquisition: acquisition,
					},
				)
				expect(quad[movedIndex]).toEqual({
					x: start.x + delta.x,
					y: start.y + delta.y,
				})
				expect(quad[mateIndex]).toEqual({
					x: source[mateIndex].x - delta.x,
					y: source[mateIndex].y - delta.y,
				})
				for (const index of [0, 1, 2, 3])
					if (index !== movedIndex && index !== mateIndex)
						expect(quad[index]).toEqual(source[index])
				const length = Math.hypot(
					quad[movedIndex].x - quad[mateIndex].x,
					quad[movedIndex].y - quad[mateIndex].y,
				)
				expect(
					direction === 1 ? length > originalLength : length < originalLength,
				).toBe(true)
			}
		},
	)

	it("keeps the selected side midpoint fixed and restores single-corner behavior when Alt is released", () => {
		const source = perspectiveQuadFromBounds(bounds)
		const start = source[0]
		const current = { x: -20, y: 7 }
		const sized = resolvePerspectiveQuad(bounds, "nw", start, current, {
			shiftKey: false,
			altKey: true,
			cornerAcquisition: "horizontal",
		})
		expect(sized[0]).toEqual(current)
		expect(sized[1]).toEqual({ x: 120, y: -7 })
		expect({
			x: (sized[0].x + sized[1].x) / 2,
			y: (sized[0].y + sized[1].y) / 2,
		}).toEqual({ x: 50, y: 0 })
		const released = resolvePerspectiveQuad(bounds, "nw", start, current, {
			shiftKey: false,
			altKey: false,
		})
		expect(released).toEqual([current, source[1], source[2], source[3]])
	})

	it("uses horizontal side sizing for an exact acquisition tie", () => {
		const quad = resolvePerspectiveQuad(
			bounds,
			"nw",
			{ x: 0, y: 0 },
			{ x: -12, y: -12 },
			{ shiftKey: false, altKey: true },
		)
		expect(quad[1]).toEqual({ x: 112, y: 12 })
		expect(quad[3]).toEqual({ x: 0, y: 80 })
	})

	it("applies free side sizing without Shift and constrains onto the latched side with Shift", () => {
		const start = { x: 0, y: 0 }
		const free = resolvePerspectiveQuad(
			bounds,
			"nw",
			start,
			{ x: -20, y: 9 },
			{
				shiftKey: false,
				altKey: true,
				cornerAcquisition: "horizontal",
			},
		)
		expect(free[0]).toEqual({ x: -20, y: 9 })
		expect(free[1]).toEqual({ x: 120, y: -9 })
		const constrained = resolvePerspectiveQuad(
			bounds,
			"nw",
			start,
			{ x: -20, y: 9 },
			{
				shiftKey: true,
				altKey: true,
				cornerAcquisition: "horizontal",
			},
		)
		expect(constrained[0]).toEqual({ x: -20, y: 0 })
		expect(constrained[1]).toEqual({ x: 120, y: 0 })
	})

	it("acquires sides in the local frame of an already-perspectived cage", () => {
		const source = [
			{ x: 0, y: 10 },
			{ x: 110, y: 0 },
			{ x: 95, y: 100 },
			{ x: -10, y: 80 },
		] as const
		const top = { x: -110, y: 10 }
		const topLength = Math.hypot(top.x, top.y)
		const acquired = resolvePerspectiveCornerAcquisition(
			null,
			source,
			"nw",
			{ x: (top.x / topLength) * 20, y: (top.y / topLength) * 20 },
			false,
		)
		expect(acquired.choice).toBe("horizontal")
		const rawDelta = { x: -18, y: 24 }
		const unit = { x: top.x / topLength, y: top.y / topLength }
		const amount = rawDelta.x * unit.x + rawDelta.y * unit.y
		const constrained = { x: unit.x * amount, y: unit.y * amount }
		const quad = resolvePerspectiveQuad(
			bounds,
			"nw",
			source[0],
			{ x: source[0].x + rawDelta.x, y: source[0].y + rawDelta.y },
			{
				shiftKey: true,
				altKey: true,
				cornerAcquisition: "horizontal",
			},
			source,
		)
		expect(quad[0].x).toBeCloseTo(source[0].x + constrained.x)
		expect(quad[0].y).toBeCloseTo(source[0].y + constrained.y)
		expect(quad[1].x).toBeCloseTo(source[1].x - constrained.x)
		expect(quad[1].y).toBeCloseTo(source[1].y - constrained.y)
	})

	it("latches an acquired side while Shift is held and reacquires on release", () => {
		const source = perspectiveQuadFromBounds(bounds)
		const horizontal = resolvePerspectiveCornerAcquisition(
			null,
			source,
			"nw",
			{ x: -30, y: 8 },
			false,
		)
		expect(horizontal).toEqual({
			choice: "horizontal",
			latched: null,
			shiftKey: false,
		})
		const latched = resolvePerspectiveCornerAcquisition(
			horizontal,
			source,
			"nw",
			{ x: -30, y: 8 },
			true,
		)
		expect(latched).toEqual({
			choice: "horizontal",
			latched: "horizontal",
			shiftKey: true,
		})
		const drifted = resolvePerspectiveCornerAcquisition(
			latched,
			source,
			"nw",
			{ x: 8, y: -30 },
			true,
		)
		expect(drifted.choice).toBe("horizontal")
		expect(drifted.latched).toBe("horizontal")
		const released = resolvePerspectiveCornerAcquisition(
			drifted,
			source,
			"nw",
			{ x: 8, y: -30 },
			false,
		)
		expect(released).toEqual({
			choice: "vertical",
			latched: null,
			shiftKey: false,
		})
	})

	it("waits for meaningful movement before latching Shift", () => {
		const source = perspectiveQuadFromBounds(bounds)
		const pressed = resolvePerspectiveCornerAcquisition(
			null,
			source,
			"nw",
			{ x: 0, y: 0 },
			true,
		)
		expect(pressed).toEqual({ choice: null, latched: null, shiftKey: true })
		const acquired = resolvePerspectiveCornerAcquisition(
			pressed,
			source,
			"nw",
			{ x: 8, y: -30 },
			true,
		)
		expect(acquired).toEqual({
			choice: "vertical",
			latched: "vertical",
			shiftKey: true,
		})
		const drifted = resolvePerspectiveCornerAcquisition(
			acquired,
			source,
			"nw",
			{ x: -30, y: 8 },
			true,
		)
		expect(drifted.choice).toBe("vertical")
	})

	it("shears edges and quantizes a Shift-held skew to 15 degrees", () => {
		const free = resolvePerspectiveQuad(
			bounds,
			"n",
			{ x: 50, y: 0 },
			{ x: 72, y: 15 },
			{ shiftKey: false, altKey: false },
		)
		expect(free[0]).toEqual({ x: 22, y: 0 })
		expect(free[1]).toEqual({ x: 122, y: 0 })
		const constrained = resolvePerspectiveQuad(
			bounds,
			"n",
			{ x: 50, y: 0 },
			{ x: 72, y: 15 },
			{ shiftKey: true, altKey: true },
		)
		const expected = Math.tan(Math.PI / 12) * 80
		expect(constrained[0].x).toBeCloseTo(expected)
		expect(constrained[3].x).toBeCloseTo(-expected)
	})

	it("rejects crossed and degenerate cages", () => {
		expect(
			validPerspectiveQuad([
				{ x: 100, y: 80 },
				{ x: 100, y: 0 },
				{ x: 0, y: 80 },
				{ x: 0, y: 0 },
			]),
		).toBe(false)
		expect(
			bakePerspectiveObjects([rectangle()], bounds, [
				{ x: 0, y: 0 },
				{ x: 0, y: 0 },
				{ x: 100, y: 80 },
				{ x: 0, y: 80 },
			]).ok,
		).toBe(false)
	})
})

describe("perspective destructive bake boundary", () => {
	it("composes whole-side sizing through an already-perspectived source cage", () => {
		const source = [
			{ x: 5, y: 12 },
			{ x: 112, y: 2 },
			{ x: 96, y: 92 },
			{ x: -8, y: 76 },
		] as const
		const first = bakePerspectiveObjects([rectangle()], bounds, source)
		expect(first.ok).toBe(true)
		if (!first.ok) return
		const delta = { x: -14, y: 5 }
		const target = resolvePerspectiveQuad(
			bounds,
			"nw",
			source[0],
			{ x: source[0].x + delta.x, y: source[0].y + delta.y },
			{
				shiftKey: false,
				altKey: true,
				cornerAcquisition: "horizontal",
			},
			source,
		)
		expect(target).toEqual([
			{ x: source[0].x + delta.x, y: source[0].y + delta.y },
			{ x: source[1].x - delta.x, y: source[1].y - delta.y },
			source[2],
			source[3],
		])
		const second = bakePerspectiveObjects(first.objects, bounds, target, source)
		expect(second.ok).toBe(true)
		if (!second.ok) return
		const geometry = second.objects[0]!.geometry
		expect(geometry.kind).toBe("path")
		if (geometry.kind !== "path") return
		const points = geometry.contours[0]!.points.slice(0, 4)
		for (const [index, point] of points.entries()) {
			expect(point?.x).toBeCloseTo(target[index]!.x, 6)
			expect(point?.y).toBeCloseTo(target[index]!.y, 6)
		}
	})

	it("expands a live shape to an ordinary identity-transform path", () => {
		const object = rectangle({
			transform: { a: 1, b: 0, c: 0.2, d: 1, e: 10, f: 20 },
		})
		const objectBounds = { minX: 10, minY: 20, maxX: 126, maxY: 100 }
		const quad = resolvePerspectiveQuad(
			objectBounds,
			"ne",
			{ x: 126, y: 20 },
			{ x: 110, y: 36 },
			{ shiftKey: false, altKey: false },
		)
		const result = bakePerspectiveObjects([object], objectBounds, quad)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.objects[0]).toMatchObject({
			id: object.id,
			name: object.name,
			transform: IDENTITY_DESIGN_TRANSFORM,
			geometry: { kind: "path" },
			appearance: object.appearance,
		})
		const geometry = result.objects[0]!.geometry
		expect(
			geometry.kind === "path" && geometry.contours[0]!.points.length,
		).toBeGreaterThanOrEqual(4)
		expect(JSON.stringify(result.objects)).not.toContain('"corner"')
	})

	it("bakes multiple objects coherently without changing object identity", () => {
		const second = rectangle({
			id: "object:second",
			name: "Second",
			geometry: {
				kind: "ellipse",
				centerX: 150,
				centerY: 40,
				radiusX: 30,
				radiusY: 25,
			},
		})
		const selectionBounds = { minX: 0, minY: 0, maxX: 180, maxY: 80 }
		const quad = resolvePerspectiveQuad(
			selectionBounds,
			"se",
			{ x: 180, y: 80 },
			{ x: 155, y: 68 },
			{ shiftKey: false, altKey: false },
		)
		const result = bakePerspectiveObjects(
			[rectangle(), second],
			selectionBounds,
			quad,
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.objects.map(({ id }) => id)).toEqual([
			"object:rect",
			"object:second",
		])
		expect(
			result.objects.every(({ geometry }) => geometry.kind === "path"),
		).toBe(true)
	})

	it("preserves an identity cage exactly at the four bounds corners", () => {
		const result = bakePerspectiveObjects(
			[rectangle()],
			bounds,
			perspectiveQuadFromBounds(bounds),
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const geometry = result.objects[0]!.geometry
		expect(geometry.kind).toBe("path")
		if (geometry.kind !== "path") return
		const points = geometry.contours[0]!.points
		expect(points.map(({ x, y }) => ({ x, y }))).toEqual([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 80 },
			{ x: 0, y: 80 },
		])
	})
})

describe("perspective eligibility", () => {
	it.each([
		[
			"stroke",
			rectangle({
				appearance: {
					stroke: {
						swatchId: "swatch:black",
						width: 2,
						cap: "butt",
						join: "miter",
						miterLimit: 4,
						dashArray: [],
						dashOffset: 0,
					},
				},
			}),
			"Expand or remove strokes",
		],
		[
			"text",
			rectangle({
				geometry: {
					kind: "text",
					mode: "point",
					text: "Hi",
					x: 0,
					y: 0,
					typography: {
						font: { id: "font:1", family: "Test" },
						size: 12,
						leading: 14,
						tracking: 0,
						kerning: "auto",
						alignment: "start",
						direction: "ltr",
					},
				},
			}),
			"convert it to paths",
		],
		[
			"image",
			rectangle({
				geometry: {
					kind: "image",
					source: { kind: "embedded", id: "image:1" },
					mediaType: "image/png",
					intrinsicWidth: 100,
					intrinsicHeight: 80,
				},
			}),
			"raster images",
		],
	] as const)(
		"rejects unsupported %s selections non-destructively",
		(_name, object, message) => {
			const result = perspectiveTransformEligibility(documentFor([object]), [
				object,
			])
			expect(result.eligible).toBe(false)
			if (!result.eligible) expect(result.reason).toContain(message)
		},
	)

	it("rejects clipping paths and live blend endpoints", () => {
		const object = rectangle()
		const clipped = documentFor([object], {
			groups: [
				{
					id: "group:1",
					name: "Clip",
					children: [{ kind: "object", id: object.id }],
					clippingPathId: object.id,
				},
			],
		})
		expect(perspectiveTransformEligibility(clipped, [object])).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("clipping mask"),
		})
		const other = rectangle({ id: "object:other" })
		const blended = documentFor([object, other], {
			blends: [
				{
					id: "blend:1",
					name: "Blend",
					startObjectId: object.id,
					endObjectId: other.id,
					steps: 2,
					contours: [],
				},
			],
		})
		expect(perspectiveTransformEligibility(blended, [object])).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("live blend"),
		})
	})
})
