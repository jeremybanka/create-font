import { describe, expect, it } from "vitest"

import { signedArea } from "@create-art/vector-geometry"

import {
	createDesignHistory,
	reduceDesignHistory,
} from "../src/design-history.ts"
import { createInitialDocument } from "../src/document.ts"
import {
	ellipseContour,
	rotateObject,
	scaleObject,
	translateObject,
} from "../src/geometry.ts"
import {
	flattenDesignContour,
	objectFillContainsPoint,
} from "../src/painted-geometry.ts"
import {
	expandDesignStroke,
	STROKE_EXPANSION_MAX_ERROR,
	strokeExpansionEligibility,
} from "../src/stroke-expansion.ts"
import type { DesignDocument, DesignObject } from "../src/types.ts"

function strokedPath(
	overrides: Partial<NonNullable<DesignObject["appearance"]["stroke"]>> = {},
): DesignObject {
	return {
		id: "object:stroke",
		name: "Test stroke",
		geometry: {
			kind: "path",
			contours: [
				{
					id: "contour:centerline",
					closed: false,
					points: [
						{ id: "point:start", x: 0, y: 0 },
						{ id: "point:end", x: 20, y: 0 },
					],
				},
			],
		},
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		appearance: {
			stroke: {
				swatchId: "swatch:coral",
				width: 4,
				cap: "butt",
				join: "miter",
				miterLimit: 4,
				dashArray: [],
				dashOffset: 0,
				...overrides,
			},
		},
	}
}

function documentWith(object: DesignObject): DesignDocument {
	return { ...createInitialDocument(), objects: [object] }
}

describe("design stroke expansion", () => {
	it("retains the object transform while replacing stroke with editable fill", () => {
		const transformed = rotateObject(
			scaleObject(
				translateObject(strokedPath({ cap: "round" }), 30, 12),
				{ x: 10, y: 0 },
				1.5,
				0.75,
			),
			{ x: 10, y: 0 },
			25,
		)
		let sequence = 0
		const result = expandDesignStroke(
			transformed,
			() => `expanded:${sequence++}`,
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const expanded = result.objects[0]
		expect(expanded?.id).toBe(transformed.id)
		expect(expanded?.transform).toBe(transformed.transform)
		expect(expanded?.appearance).toEqual({
			fill: { swatchId: "swatch:coral" },
		})
		expect(expanded?.geometry.kind).toBe("path")
		if (expanded?.geometry.kind !== "path") return
		expect(expanded.geometry.contours).toHaveLength(1)
		expect(expanded.geometry.contours[0]?.id).toBe("contour:expanded:0")
		expect(
			expanded.geometry.contours[0]?.points.every((point) =>
				point.id.startsWith("point:expanded:"),
			),
		).toBe(true)
	})

	it("expands dashes into independent filled regions", () => {
		let sequence = 0
		const result = expandDesignStroke(
			strokedPath({ dashArray: [5, 3], dashOffset: 0 }),
			() => `dash:${sequence++}`,
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const expanded = result.objects[0]
		expect(expanded?.geometry.kind).toBe("path")
		if (expanded?.geometry.kind !== "path") return
		expect(expanded.geometry.contours).toHaveLength(3)
		expect(objectFillContainsPoint(expanded, { x: 2, y: 0 })).toBe(true)
		expect(objectFillContainsPoint(expanded, { x: 6, y: 0 })).toBe(false)
		expect(objectFillContainsPoint(expanded, { x: 10, y: 0 })).toBe(true)
	})

	it("keeps a cubic circular stroke as two editable four-anchor circles", () => {
		const centerX = 389
		const centerY = 419
		const radius = 141
		const width = 12
		const source: DesignObject = {
			...strokedPath({ width, join: "round" }),
			geometry: {
				kind: "path",
				contours: [
					ellipseContour({
						minX: centerX - radius,
						minY: centerY - radius,
						maxX: centerX + radius,
						maxY: centerY + radius,
					}),
				],
			},
		}
		let sequence = 0
		const result = expandDesignStroke(source, () => `circle:${sequence++}`)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const expanded = result.objects[0]
		expect(expanded?.geometry.kind).toBe("path")
		if (expanded?.geometry.kind !== "path") return
		expect(
			expanded.geometry.contours.map((contour) => contour.points.length),
		).toEqual([4, 4])
		for (const contour of expanded.geometry.contours) {
			for (const point of contour.points) {
				expect(point.incoming).toBeDefined()
				expect(point.outgoing).toBeDefined()
				if (point.incoming === undefined || point.outgoing === undefined)
					continue
				const denominator =
					Math.hypot(point.incoming.x, point.incoming.y) *
					Math.hypot(point.outgoing.x, point.outgoing.y)
				expect(
					Math.abs(
						(point.incoming.x * point.outgoing.y -
							point.incoming.y * point.outgoing.x) /
							denominator,
					),
				).toBeLessThan(1e-6)
				expect(
					(point.incoming.x * point.outgoing.x +
						point.incoming.y * point.outgoing.y) /
						denominator,
				).toBeLessThan(0)
			}
		}

		const samples = expanded.geometry.contours.map((contour) =>
			flattenDesignContour(contour, 0.0001),
		)
		expect(samples.map((points) => Math.sign(signedArea(points)))).toEqual([
			-1, 1,
		])
		for (const [index, points] of samples.entries()) {
			const expectedRadius = radius + (index === 0 ? -width / 2 : width / 2)
			const maximumError = Math.max(
				...points.map((point) =>
					Math.abs(
						Math.hypot(point.x - centerX, point.y - centerY) - expectedRadius,
					),
				),
			)
			expect(maximumError).toBeLessThanOrEqual(STROKE_EXPANSION_MAX_ERROR)
		}
	})

	it("preserves a differently painted source fill immediately below the outline", () => {
		const sourceStroke = strokedPath().appearance.stroke
		if (sourceStroke === undefined) throw new Error("Missing stroke fixture.")
		const source: DesignObject = {
			...strokedPath(),
			appearance: {
				fill: { swatchId: "swatch:cyan" },
				stroke: sourceStroke,
			},
		}
		let sequence = 0
		const result = expandDesignStroke(source, () => `fill:${sequence++}`)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.objects).toHaveLength(2)
		expect(result.objects[0]).toMatchObject({
			id: expect.stringMatching(/^object:fill:/u),
			name: "Test stroke fill",
			geometry: source.geometry,
			appearance: { fill: { swatchId: "swatch:cyan" } },
		})
		expect(result.objects[1]).toMatchObject({
			id: source.id,
			appearance: { fill: { swatchId: "swatch:coral" } },
		})
		expect(result.selectedObjectId).toBe(source.id)
	})

	it("commits one history entry without disturbing unrelated objects", () => {
		const document = createInitialDocument()
		const source = strokedPath()
		const unrelated = document.objects[0]
		if (unrelated === undefined) throw new Error("Missing document fixture.")
		const before = { ...document, objects: [unrelated, source] }
		const result = expandDesignStroke(source, () => "history")
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const after = { ...before, objects: [unrelated, ...result.objects] }
		const committed = reduceDesignHistory(createDesignHistory(before), {
			type: "commit",
			document: after,
		})
		expect(committed.past).toEqual([before])
		expect(committed.present.objects[0]).toBe(unrelated)
		const undone = reduceDesignHistory(committed, { type: "undo" })
		expect(undone.present).toBe(before)
		expect(reduceDesignHistory(undone, { type: "redo" }).present).toBe(after)
	})

	it("fails degenerate, self-crossing, and invalid inputs without allocating IDs", () => {
		const zero: DesignObject = {
			...strokedPath(),
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:zero",
						closed: false,
						points: [
							{ id: "point:zero:0", x: 4, y: 4 },
							{ id: "point:zero:1", x: 4, y: 4 },
						],
					},
				],
			},
		}
		let allocations = 0
		const zeroResult = expandDesignStroke(zero, () => {
			allocations += 1
			return "unused"
		})
		expect(zeroResult).toMatchObject({
			ok: false,
			error: expect.stringContaining("no visible length"),
		})
		expect(allocations).toBe(0)
		const selfCrossing: DesignObject = {
			...strokedPath(),
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:crossing",
						closed: false,
						points: [
							{ id: "point:crossing:0", x: 0, y: 0 },
							{ id: "point:crossing:1", x: 10, y: 10 },
							{ id: "point:crossing:2", x: 0, y: 10 },
							{ id: "point:crossing:3", x: 10, y: 0 },
						],
					},
				],
			},
		}
		expect(expandDesignStroke(selfCrossing, () => "unused")).toMatchObject({
			ok: false,
			error: expect.stringContaining("Self-intersecting"),
		})

		const invalid = {
			...strokedPath(),
			transform: { ...strokedPath().transform, a: Number.NaN },
		}
		expect(expandDesignStroke(invalid, () => "unused")).toMatchObject({
			ok: false,
			error: expect.stringContaining("finite"),
		})
	})

	it("reports selection, visibility, lock, paint, and width eligibility", () => {
		const object = strokedPath()
		const document = documentWith(object)
		expect(strokeExpansionEligibility(document, [])).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Select one"),
		})
		expect(
			strokeExpansionEligibility(document, [object.id, "object:other"]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("exactly"),
		})
		expect(
			strokeExpansionEligibility(documentWith({ ...object, hidden: true }), [
				object.id,
			]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Show"),
		})
		expect(
			strokeExpansionEligibility(documentWith({ ...object, locked: true }), [
				object.id,
			]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Unlock"),
		})
		expect(
			strokeExpansionEligibility(documentWith({ ...object, appearance: {} }), [
				object.id,
			]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Assign"),
		})
		expect(
			strokeExpansionEligibility(documentWith(strokedPath({ width: 0 })), [
				object.id,
			]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("positive"),
		})
		expect(strokeExpansionEligibility(document, [object.id])).toMatchObject({
			eligible: true,
			object,
		})
	})
})
