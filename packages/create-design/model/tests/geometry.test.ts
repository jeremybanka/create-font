import { describe, expect, it } from "vitest"

import {
	bakeDesignObject,
	ellipseContour,
	normalizedBounds,
	objectBounds,
	objectSvgPath,
	projectDesignObjectContours,
	rectangleContour,
	rotateObject,
	scaleObject,
	translateObject,
} from "../src/geometry.ts"
import type { DesignObject } from "@create-design/source"

describe("design geometry", () => {
	it("uses the same editable contour model for primitive shapes", () => {
		expect(
			rectangleContour({ minX: 10, minY: 20, maxX: 110, maxY: 80 }).points,
		).toHaveLength(4)
		expect(
			ellipseContour({ minX: 10, minY: 20, maxX: 110, maxY: 80 }).points.every(
				(point) => point.incoming !== undefined && point.outgoing !== undefined,
			),
		).toBe(true)
	})

	it("builds cubic SVG paths and scales control vectors", () => {
		const object: DesignObject = {
			id: "object:test",
			name: "Ellipse",
			geometry: {
				kind: "ellipse",
				centerX: 50,
				centerY: 50,
				radiusX: 50,
				radiusY: 50,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:test" } },
		}
		expect(objectSvgPath(object)).toContain("C")
		const scaled = scaleObject(object, { x: 0, y: 0 }, 2, 0.5)
		expect(scaled.geometry).toBe(object.geometry)
		expect(scaled.transform).toMatchObject({ a: 2, d: 0.5 })
		expect(projectDesignObjectContours(scaled)[0]?.points[0]?.x).toBe(100)
	})

	it("supports constrained, centered drawing bounds", () => {
		expect(
			normalizedBounds({ x: 50, y: 50 }, { x: 80, y: 70 }, true, true),
		).toEqual({ minX: 20, minY: 20, maxX: 80, maxY: 80 })
	})

	it("keeps authored live geometry unchanged across object transforms", () => {
		const object: DesignObject = {
			id: "object:live",
			name: "Live rectangle",
			geometry: {
				kind: "rectangle",
				x: 10,
				y: 20,
				width: 80,
				height: 40,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {},
		}
		const moved = translateObject(object, 12, 8)
		const scaled = scaleObject(moved, { x: 0, y: 0 }, 2, 3)
		const rotated = rotateObject(scaled, { x: 0, y: 0 }, 90)
		expect(moved.geometry).toBe(object.geometry)
		expect(scaled.geometry).toBe(object.geometry)
		expect(rotated.geometry).toBe(object.geometry)
		expect(moved.transform).toMatchObject({ e: 12, f: 8 })
		expect(scaled.transform).toMatchObject({ a: 2, d: 3, e: 24, f: 24 })
		expect(rotated.transform.a).toBeCloseTo(0)
		expect(rotated.transform.b).toBeCloseTo(2)
		expect(rotated.transform.c).toBeCloseTo(-3)
		expect(rotated.transform.d).toBeCloseTo(0)
	})

	it("preserves an explicit path fill rule while baking transforms", () => {
		const object: DesignObject = {
			id: "object:nonzero",
			name: "Nonzero path",
			geometry: {
				kind: "path",
				fillRule: "nonzero",
				contours: [
					{
						id: "contour:nonzero",
						closed: true,
						points: [
							{ id: "point:nonzero:0", x: 0, y: 0 },
							{ id: "point:nonzero:1", x: 10, y: 0 },
							{ id: "point:nonzero:2", x: 10, y: 10 },
						],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 8 },
			appearance: { fill: { swatchId: "swatch:test" } },
		}
		const baked = bakeDesignObject(object)
		expect(baked.geometry).toMatchObject({
			kind: "path",
			fillRule: "nonzero",
		})
		expect(baked.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
		expect(projectDesignObjectContours(baked)).toEqual(
			projectDesignObjectContours(object),
		)
	})

	it("includes Pen handle endpoints in transform bounds", () => {
		expect(
			objectBounds({
				id: "pen",
				name: "Pen",
				geometry: {
					kind: "path",
					contours: [
						{
							id: "contour:pen",
							closed: false,
							points: [
								{
									id: "point:pen:start",
									x: 50,
									y: 60,
									incoming: { x: -30, y: -40 },
									outgoing: { x: 80, y: 90 },
								},
								{ id: "point:pen:end", x: 200, y: 180 },
							],
						},
					],
				},
				transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
				appearance: { fill: { swatchId: "swatch:coral" } },
			}),
		).toEqual({ minX: 50, minY: 60, maxX: 200, maxY: 180 })
	})

	it("lowers durable circular and squircle corners for every output projection", () => {
		const object: DesignObject = {
			id: "object:corners",
			name: "Profiled path",
			geometry: {
				kind: "path",
				fillRule: "nonzero",
				contours: [
					{
						id: "contour:corners",
						closed: true,
						points: [
							{ id: "point:0", x: 0, y: 0 },
							{
								id: "point:1",
								x: 100,
								y: 0,
								corner: { profile: "circular", amount: 20 },
							},
							{
								id: "point:2",
								x: 100,
								y: 100,
								corner: { profile: "squircle", amount: 20 },
							},
							{ id: "point:3", x: 0, y: 100 },
						],
					},
				],
			},
			transform: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 },
			appearance: { fill: { swatchId: "swatch:test" } },
		}
		const projected = projectDesignObjectContours(object)[0]!
		expect(projected.points.length).toBeGreaterThan(4)
		expect(projected.points.some(({ id }) => id.includes("corner:entry"))).toBe(
			true,
		)
		expect(
			projected.points.some(
				({ incoming, outgoing }) =>
					incoming !== undefined || outgoing !== undefined,
			),
		).toBe(true)
		expect(objectSvgPath(object)).toContain("C")
		expect(object.geometry.kind === "path" && object.geometry.fillRule).toBe(
			"nonzero",
		)
	})

	it("keeps circular corners isotropic through non-uniform object scaling", () => {
		const object: DesignObject = {
			id: "object:isotropic-corners",
			name: "Wide rounded rectangle",
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:isotropic-corners",
						closed: true,
						points: [
							{ id: "point:0", x: 0, y: 0 },
							{
								id: "point:1",
								x: 100,
								y: 0,
								corner: { profile: "circular", amount: 20 },
							},
							{ id: "point:2", x: 100, y: 100 },
							{ id: "point:3", x: 0, y: 100 },
						],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: "swatch:test" } },
		}
		const scaled = scaleObject(object, { x: 0, y: 0 }, 2, 0.5)
		const points = projectDesignObjectContours(scaled)[0]!.points
		const entry = points.find(({ id }) => id.includes("point:1::corner:entry"))
		const exit = points.find(({ id }) => id.includes("point:1::corner:exit"))
		expect(entry).toMatchObject({ x: 180, y: 0 })
		expect(exit).toMatchObject({ x: 200, y: 20 })
	})
})
