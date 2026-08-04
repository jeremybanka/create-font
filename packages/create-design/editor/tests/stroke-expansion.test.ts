import { describe, expect, it } from "vitest"

import {
	distance,
	expandStroke,
	fitCubicContour,
	flattenCubic,
	intersectPolylines,
	selfIntersections,
	signedArea,
	windingNumber,
	type Contour,
	type Cubic,
	type Point,
	type StrokeJoin,
} from "@create-art/vector-geometry"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import {
	ellipseContour,
	rotateObject,
	scaleObject,
	translateObject,
} from "@create-design/model"
import {
	flattenDesignContour,
	flattenDesignContourForStroke,
	objectFillContainsPoint,
} from "@create-design/model"
import {
	expandDesignStroke,
	STROKE_EXPANSION_MAX_ERROR,
	STROKE_EXPANSION_REFIT_ERROR,
	STROKE_EXPANSION_TOLERANCES,
	strokeExpansionEligibility,
} from "../src/stroke-expansion.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
} from "../src/types.ts"

function flattenFit(cubics: readonly Cubic[]): readonly Point[] {
	const points: Point[] = []
	for (const cubic of cubics)
		points.push(
			...flattenCubic(cubic, { flatness: 0.002 }).slice(
				points.length > 0 ? 1 : 0,
			),
		)
	if (
		points.length > 1 &&
		distance(points[0] as Point, points.at(-1) as Point) <= 1e-7
	)
		points.pop()
	return points
}

function pointToContour(point: Point, contour: Contour): number {
	let result = Number.POSITIVE_INFINITY
	for (const [index, start] of contour.points.entries()) {
		const end = contour.points[(index + 1) % contour.points.length]
		if (end === undefined) continue
		const x = end.x - start.x
		const y = end.y - start.y
		const denominator = x * x + y * y
		const parameter =
			denominator === 0
				? 0
				: Math.max(
						0,
						Math.min(
							1,
							((point.x - start.x) * x + (point.y - start.y) * y) / denominator,
						),
					)
		result = Math.min(
			result,
			Math.hypot(
				point.x - start.x - x * parameter,
				point.y - start.y - y * parameter,
			),
		)
	}
	return result
}

function expandedHardContour(
	contour: DesignContour,
	join: StrokeJoin,
	width: number,
): Readonly<{ raw: Contour; fitted: readonly Point[] }> {
	const flattened = flattenDesignContourForStroke(
		contour,
		join,
		STROKE_EXPANSION_TOLERANCES.flatness,
	)
	const raw = expandStroke(
		{ closed: contour.closed, points: flattened.points },
		{
			width,
			cap: "butt",
			join,
			vertexJoins: flattened.vertexJoins,
			miterLimit: 4,
			tolerances: STROKE_EXPANSION_TOLERANCES,
		},
	)[0]
	if (raw === undefined) throw new Error("Missing expanded contour fixture.")
	return {
		raw,
		fitted: flattenFit(
			fitCubicContour(raw, {
				maxError: STROKE_EXPANSION_REFIT_ERROR,
				tolerances: STROKE_EXPANSION_TOLERANCES,
			}),
		),
	}
}

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

function straightHardContour(angleDegrees: number): DesignContour {
	const angle = (angleDegrees * Math.PI) / 180
	const direction = { x: Math.cos(angle), y: Math.sin(angle) }
	return {
		id: `contour:hard:${angleDegrees}`,
		closed: false,
		points: [
			{
				id: "point:hard:start",
				x: -100,
				y: 0,
				outgoing: { x: 30, y: 0 },
			},
			{
				id: "point:hard:corner",
				x: 0,
				y: 0,
				incoming: { x: -30, y: 0 },
				outgoing: { x: direction.x * 30, y: direction.y * 30 },
			},
			{
				id: "point:hard:end",
				x: direction.x * 100,
				y: direction.y * 100,
				incoming: { x: direction.x * -30, y: direction.y * -30 },
			},
		],
	}
}

const hardJoinCases = [
	{ label: "acute", angle: 35, join: "miter", rawPoints: 6 },
	{ label: "acute", angle: 35, join: "round", rawPoints: 10 },
	{ label: "acute", angle: 35, join: "bevel", rawPoints: 7 },
	{ label: "obtuse", angle: 110, join: "miter", rawPoints: 6 },
	{ label: "obtuse", angle: 110, join: "round", rawPoints: 16 },
	{ label: "obtuse", angle: 110, join: "bevel", rawPoints: 7 },
	{ label: "near-reversal", angle: 166, join: "miter", rawPoints: 7 },
	{ label: "near-reversal", angle: 166, join: "round", rawPoints: 21 },
	{ label: "near-reversal", angle: 166, join: "bevel", rawPoints: 7 },
] as const satisfies readonly Readonly<{
	label: string
	angle: number
	join: StrokeJoin
	rawPoints: number
}>[]

describe("design stroke expansion", () => {
	it.each(hardJoinCases)(
		"keeps $label hard Bézier nodes simple with a $join join",
		({ angle, join, rawPoints }) => {
			const { raw, fitted } = expandedHardContour(
				straightHardContour(angle),
				join,
				10,
			)
			expect(raw.points).toHaveLength(rawPoints)
			expect(selfIntersections(raw.points, { closed: true })).toEqual([])
			expect(selfIntersections(fitted, { closed: true })).toEqual([])
			expect(Math.sign(signedArea(raw.points))).toBe(1)
			expect(Math.sign(signedArea(fitted))).toBe(1)

			const fittedContour = { closed: true, points: fitted }
			expect(
				Math.max(
					...raw.points.map((point) => pointToContour(point, fittedContour)),
				),
			).toBeLessThanOrEqual(STROKE_EXPANSION_REFIT_ERROR)
			expect(
				Math.max(...fitted.map((point) => pointToContour(point, raw))),
			).toBeLessThanOrEqual(STROKE_EXPANSION_REFIT_ERROR)
		},
	)

	it.each(["miter", "round", "bevel"] as const)(
		"replaces an invalid inner $join intersection with a bounded cusp",
		(join) => {
			const angle = (177.5 * Math.PI) / 180
			const contour: DesignContour = {
				id: "contour:hard:cusp",
				closed: false,
				points: [
					{
						id: "point:cusp:start",
						x: -100,
						y: 27,
						outgoing: { x: 20, y: 38 },
					},
					{
						id: "point:cusp:corner",
						x: 0,
						y: 0,
						incoming: { x: -7, y: 0 },
						outgoing: {
							x: Math.cos(angle) * 0.5,
							y: Math.sin(angle) * 0.5,
						},
					},
					{
						id: "point:cusp:end",
						x: 5,
						y: 31,
						incoming: { x: 60, y: 4 },
					},
				],
			}
			const { raw, fitted } = expandedHardContour(contour, join, 2.2)
			expect(raw.points).toHaveLength(
				{ miter: 178, round: 180, bevel: 179 }[join],
			)
			expect(selfIntersections(raw.points, { closed: true })).toEqual([])
			expect(selfIntersections(fitted, { closed: true })).toEqual([])
			expect(Math.sign(signedArea(raw.points))).toBe(1)
			expect(Math.sign(signedArea(fitted))).toBe(1)
		},
	)

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

	it("unions a heavy acute cubic stroke while preserving its main counterform", () => {
		const ellipse = ellipseContour({ minX: 0, minY: 0, maxX: 200, maxY: 200 })
		const contour: DesignContour = {
			...ellipse,
			points: ellipse.points.map((point, index) =>
				index === 0 ? { ...point, outgoing: { x: -150, y: 25 } } : point,
			),
		}
		const flattened = flattenDesignContourForStroke(
			contour,
			"miter",
			STROKE_EXPANSION_TOLERANCES.flatness,
		)
		const raw = expandStroke(
			{ closed: true, points: flattened.points },
			{
				width: 40,
				cap: "butt",
				join: "miter",
				miterLimit: 4,
				vertexJoins: flattened.vertexJoins,
				tolerances: STROKE_EXPANSION_TOLERANCES,
			},
		)
		expect(raw.map((candidate) => candidate.points.length)).toEqual([232, 206])
		expect(
			raw.map((candidate) =>
				selfIntersections(candidate.points, { closed: true }),
			),
		).toEqual([[], []])
		expect(
			intersectPolylines(raw[0]?.points ?? [], raw[1]?.points ?? [], {
				firstClosed: true,
				secondClosed: true,
			}),
		).toEqual([])

		const fitted = raw.map((candidate) =>
			flattenFit(
				fitCubicContour(candidate, {
					maxError: STROKE_EXPANSION_REFIT_ERROR,
					tolerances: STROKE_EXPANSION_TOLERANCES,
				}),
			),
		)
		expect(
			fitted.map((points) => selfIntersections(points, { closed: true })),
		).toEqual([[], []])
		expect(
			intersectPolylines(fitted[0] ?? [], fitted[1] ?? [], {
				firstClosed: true,
				secondClosed: true,
			}),
		).toEqual([])
		expect(fitted.map((points) => Math.sign(signedArea(points)))).toEqual([
			1, -1,
		])
		for (const [index, candidate] of raw.entries()) {
			const fittedContour = {
				closed: true,
				points: fitted[index] ?? [],
			}
			expect(
				Math.max(
					...candidate.points.map((point) =>
						pointToContour(point, fittedContour),
					),
				),
			).toBeLessThanOrEqual(STROKE_EXPANSION_REFIT_ERROR)
			expect(
				Math.max(
					...fittedContour.points.map((point) =>
						pointToContour(point, candidate),
					),
				),
			).toBeLessThanOrEqual(STROKE_EXPANSION_REFIT_ERROR)
		}

		const occupancy = (point: Point) =>
			fitted.reduce(
				(sum, candidate) => sum + windingNumber(point, candidate).winding,
				0,
			)
		expect(occupancy({ x: 105, y: -15 })).toBe(1)
		expect(occupancy({ x: 100, y: 100 })).toBe(0)

		const source: DesignObject = {
			...strokedPath({ width: 40, join: "miter" }),
			geometry: { kind: "path", contours: [contour] },
		}
		let sequence = 0
		const result = expandDesignStroke(source, () => `union:${sequence++}`)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const expanded = result.objects[0]
		if (expanded === undefined)
			throw new Error("Missing expanded union fixture.")
		expect(objectFillContainsPoint(expanded, { x: 105, y: -15 })).toBe(true)
		expect(objectFillContainsPoint(expanded, { x: 100, y: 100 })).toBe(false)
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
		const state = createDesignEditorState({
			document: before,
			persistence: createDesignPersistenceState(null),
			name: "stroke-expansion-history-test",
		})
		state.actions.commitDocument(after)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(state.silo.getState(state.states.documentAtom).objects[0]).toBe(
			unrelated,
		)
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(before)
		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(after)
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
