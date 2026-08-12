import { describe, expect, it } from "vitest"
import { IDENTITY_DESIGN_TRANSFORM } from "@create-design/model"

import {
	bakePerspectiveObjects,
	perspectiveQuadFromBounds,
	perspectiveTransformEligibility,
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

	it("updates Shift and Alt semantics from the same gesture origin", () => {
		const shifted = resolvePerspectiveQuad(
			bounds,
			"nw",
			{ x: 0, y: 0 },
			{ x: 30, y: 8 },
			{ shiftKey: true, altKey: false },
		)
		expect(shifted[0]).toEqual({ x: 30, y: 0 })
		const centered = resolvePerspectiveQuad(
			bounds,
			"nw",
			{ x: 0, y: 0 },
			{ x: 30, y: 8 },
			{ shiftKey: false, altKey: true },
		)
		expect(centered[0]).toEqual({ x: 30, y: 8 })
		expect(centered[2]).toEqual({ x: 70, y: 72 })
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
