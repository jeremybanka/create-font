import {
	contourOrientation,
	flattenCubic,
	selfIntersections,
} from "@create-art/vector-geometry"
import { describe, expect, it } from "vitest"

import {
	createDesignHistory,
	reduceDesignHistory,
} from "../src/design-history.ts"
import { nearestDesignObject } from "../src/design-canvas.ts"
import { ellipseContour } from "../src/geometry.ts"
import {
	applyDesignPathCommand,
	cleanupDesignContour,
	DEFAULT_PATH_SIMPLIFY_TOLERANCE,
	designPathCommandEligibility,
	type DesignPathCommandContext,
} from "../src/path-commands.ts"
import { pdfObjectContentStream } from "../src/pdf.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
} from "../src/types.ts"

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const appearance = { fill: { swatchId: "ink" } }

const contour = (
	id: string,
	points: readonly DesignPoint[],
	closed = false,
): DesignContour => ({ id, closed, points })

const path = (
	id: string,
	contours: readonly DesignContour[],
	overrides: Partial<DesignObject> = {},
): DesignObject => ({
	id,
	name: id,
	geometry: { kind: "path", contours },
	transform: identity,
	appearance,
	...overrides,
})

const documentWith = (...objects: readonly DesignObject[]): DesignDocument => ({
	format: "create-design.document",
	version: 5,
	title: "Topology",
	artboards: [
		{ id: "artboard", name: "Artboard", x: 0, y: 0, width: 500, height: 500 },
	],
	swatches: [
		{ id: "ink", name: "Ink", source: { space: "rgb", r: 0, g: 0, b: 0 } },
	],
	objects,
	guides: [],
})

const context = (
	document: DesignDocument,
	objectSelection: readonly string[],
	directSelection: DesignPathCommandContext["directSelection"] = [],
): DesignPathCommandContext => ({ document, objectSelection, directSelection })

const line = (id: string, startX: number, endX: number): DesignContour =>
	contour(id, [
		{ id: `${id}:a`, x: startX, y: 0 },
		{ id: `${id}:b`, x: endX, y: 0 },
	])

const rectangle = (
	id: string,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): DesignContour =>
	contour(
		id,
		[
			{ id: `${id}:0`, x: minX, y: minY },
			{ id: `${id}:1`, x: maxX, y: minY },
			{ id: `${id}:2`, x: maxX, y: maxY },
			{ id: `${id}:3`, x: minX, y: maxY },
		],
		true,
	)

describe("create-design path commands", () => {
	it("reports precise eligibility without changing the document", () => {
		const open = path("open", [line("line", 0, 10)])
		const locked = path("locked", [line("locked-line", 0, 10)], {
			locked: true,
		})
		const document = documentWith(open, locked)
		expect(
			designPathCommandEligibility("reverse", context(document, [])),
		).toEqual({ eligible: false, reason: "Select one or more path contours." })
		expect(
			designPathCommandEligibility("close", context(document, [locked.id])),
		).toEqual({
			eligible: false,
			reason: "Unlock locked before editing its paths.",
		})
		expect(document.objects).toEqual([open, locked])
	})

	it("reverses only directly selected contours and swaps their handles", () => {
		const first = contour("first", [
			{ id: "a", x: 0, y: 0, outgoing: { x: 2, y: 1 } },
			{ id: "b", x: 10, y: 0, incoming: { x: -3, y: 2 } },
		])
		const second = line("second", 20, 30)
		const document = documentWith(path("shape", [first, second]))
		const selected = [
			{ kind: "contour" as const, objectId: "shape", contourId: "first" },
		]
		const result = applyDesignPathCommand(
			"reverse",
			context(document, ["shape"], selected),
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const contours = result.document.objects[0]?.geometry
		expect(contours?.kind).toBe("path")
		if (contours?.kind !== "path") return
		expect(contours.contours[0]?.points).toEqual([
			{ id: "b", x: 10, y: 0, outgoing: { x: -3, y: 2 } },
			{ id: "a", x: 0, y: 0, incoming: { x: 2, y: 1 } },
		])
		expect(contours.contours[1]).toBe(second)
		expect(result.directSelection).toEqual(selected)
	})

	it("joins selected open endpoints, retains contour/point identities, and closes one contour", () => {
		const first = line("first", 0, 10)
		const second = line("second", 20, 10)
		const document = documentWith(path("shape", [first, second]))
		const endpoints = [
			{
				kind: "node" as const,
				objectId: "shape",
				contourId: "first",
				pointId: "first:b",
			},
			{
				kind: "node" as const,
				objectId: "shape",
				contourId: "second",
				pointId: "second:b",
			},
		]
		const result = applyDesignPathCommand(
			"join",
			context(document, ["shape"], endpoints),
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const geometry = result.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected a path")
		expect(geometry.contours).toHaveLength(1)
		expect(geometry.contours[0]?.id).toBe("first")
		expect(geometry.contours[0]?.points.map(({ id }) => id)).toEqual([
			"first:a",
			"first:b",
			"second:a",
		])

		const close = applyDesignPathCommand(
			"join",
			context(
				result.document,
				["shape"],
				[
					{
						kind: "node",
						objectId: "shape",
						contourId: "first",
						pointId: "first:a",
					},
					{
						kind: "node",
						objectId: "shape",
						contourId: "first",
						pointId: "second:a",
					},
				],
			),
		)
		expect(
			close.ok && close.document.objects[0]?.geometry.kind === "path"
				? close.document.objects[0].geometry.contours[0]?.closed
				: false,
		).toBe(true)

		const separate = documentWith(
			path("left", [line("left-line", 0, 10)], {
				transform: { ...identity, e: 100 },
			}),
			path("right", [line("right-line", 130, 110)]),
		)
		const across = applyDesignPathCommand(
			"join",
			context(
				separate,
				["left", "right"],
				[
					{
						kind: "node",
						objectId: "left",
						contourId: "left-line",
						pointId: "left-line:b",
					},
					{
						kind: "node",
						objectId: "right",
						contourId: "right-line",
						pointId: "right-line:b",
					},
				],
			),
		)
		expect(across.ok).toBe(true)
		if (!across.ok) return
		expect(across.document.objects.map(({ id }) => id)).toEqual(["right"])
		const acrossGeometry = across.document.objects[0]?.geometry
		if (acrossGeometry?.kind !== "path") throw new Error("Expected joined path")
		expect(acrossGeometry.contours[0]?.points.map(({ x }) => x)).toEqual([
			100, 110, 130,
		])
	})

	it("simplifies duplicate and redundant samples within its documented tolerance", () => {
		const points = Array.from({ length: 21 }, (_, index) => ({
			id: `p${index}`,
			x: index * 5,
			y: Math.sin((index / 20) * Math.PI) * 20,
		}))
		points.splice(10, 0, { ...points[10]!, id: "duplicate" })
		const original = contour("sampled", points)
		const cleanedPoints = cleanupDesignContour(original).points
		let sequence = 0
		const result = applyDesignPathCommand(
			"simplify",
			context(documentWith(path("shape", [original])), ["shape"]),
			{ nextId: () => `new:${sequence++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const geometry = result.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected a path")
		const simplified = geometry.contours[0]
		expect(simplified?.points.length).toBeLessThan(points.length)
		if (simplified === undefined) return
		const flattened: { x: number; y: number }[] = []
		for (const [index, point] of simplified.points.entries()) {
			const next = simplified.points[index + 1]
			if (next === undefined) continue
			flattened.push(
				...flattenCubic(
					{
						p0: point,
						c1: {
							x: point.x + (point.outgoing?.x ?? 0),
							y: point.y + (point.outgoing?.y ?? 0),
						},
						c2: {
							x: next.x + (next.incoming?.x ?? 0),
							y: next.y + (next.incoming?.y ?? 0),
						},
						p3: next,
					},
					{ flatness: DEFAULT_PATH_SIMPLIFY_TOLERANCE / 4 },
				).slice(index === 0 ? 0 : 1),
			)
		}
		const nearest = (
			point: Readonly<{ x: number; y: number }>,
			polyline: readonly Readonly<{ x: number; y: number }>[],
		) =>
			Math.min(
				...polyline.slice(1).map((candidate, index) => {
					const previous = polyline[index]
					if (previous === undefined) return Number.POSITIVE_INFINITY
					const x = candidate.x - previous.x
					const y = candidate.y - previous.y
					const denominator = x * x + y * y
					const amount =
						denominator === 0
							? 0
							: Math.max(
									0,
									Math.min(
										1,
										((point.x - previous.x) * x + (point.y - previous.y) * y) /
											denominator,
									),
								)
					return Math.hypot(
						previous.x + amount * x - point.x,
						previous.y + amount * y - point.y,
					)
				}),
			)
		expect(
			Math.max(...points.map((point) => nearest(point, flattened))),
		).toBeLessThanOrEqual(DEFAULT_PATH_SIMPLIFY_TOLERANCE)
		expect(
			Math.max(...flattened.map((point) => nearest(point, cleanedPoints))),
		).toBeLessThanOrEqual(DEFAULT_PATH_SIMPLIFY_TOLERANCE)
		expect(selfIntersections(cleanedPoints, { closed: false })).toEqual([])
		expect(selfIntersections(flattened, { closed: false })).toEqual([])
		expect(new Set(simplified.points.map(({ id }) => id)).size).toBe(
			simplified.points.length,
		)
		expect(simplified.points[0]?.id).toBe("p0")
		expect(simplified.points.at(-1)?.id).toBe("p20")
	})

	it("never expands compact authored curves merely to improve fit error", () => {
		const acute = contour(
			"acute",
			[
				{
					id: "acute:a",
					x: 40,
					y: 10,
					incoming: { x: -24, y: 8 },
					outgoing: { x: 18, y: 24 },
				},
				{
					id: "acute:b",
					x: 85,
					y: 80,
					incoming: { x: -4, y: -36 },
					outgoing: { x: -48, y: -8 },
				},
				{
					id: "acute:c",
					x: 10,
					y: 70,
					incoming: { x: 28, y: 12 },
					outgoing: { x: -2, y: -38 },
				},
			],
			true,
		)
		const circle = ellipseContour(
			{ minX: 0, minY: 0, maxX: 100, maxY: 100 },
			"circle",
		)
		const singleCubic = contour("single", [
			{ id: "single:a", x: 0, y: 0, outgoing: { x: 40, y: 80 } },
			{ id: "single:b", x: 100, y: 0, incoming: { x: -40, y: 80 } },
		])
		const hardCorners = contour(
			"corners",
			[
				{ id: "corner:a", x: 0, y: 0 },
				{ id: "corner:b", x: 100, y: 0 },
				{ id: "corner:c", x: 100, y: 100 },
				{ id: "corner:d", x: 0, y: 100 },
			],
			true,
		)
		for (const authored of [acute, circle, singleCubic, hardCorners]) {
			const source = documentWith(path(`shape:${authored.id}`, [authored]))
			let generated = 0
			const result = applyDesignPathCommand(
				"simplify",
				context(source, [`shape:${authored.id}`]),
				{ nextId: () => `unexpected:${generated++}` },
			)
			expect(result.ok).toBe(true)
			if (!result.ok) continue
			expect(result.document).toBe(source)
			expect(result.document.objects[0]?.geometry).toEqual({
				kind: "path",
				contours: [authored],
			})
			expect(generated).toBe(0)
		}
		expect(acute.points).toHaveLength(3)
	})

	it("refuses reduction when an inflection or crossing makes topology risky", () => {
		const loopRisk = contour("loop-risk", [
			{ id: "l0", x: 0, y: 0 },
			{ id: "l1", x: 100, y: 100 },
			{ id: "l2", x: 0, y: 100 },
			{ id: "l3", x: 100, y: 0 },
			{ id: "l4", x: 140, y: 50 },
		])
		const inflection = contour("inflection", [
			{ id: "i0", x: 0, y: 0 },
			{ id: "i1", x: 20, y: 35 },
			{ id: "i2", x: 40, y: 50 },
			{ id: "i3", x: 60, y: -50 },
			{ id: "i4", x: 80, y: -35 },
			{ id: "i5", x: 100, y: 0 },
		])
		const crossingSource = documentWith(path("crossing", [loopRisk]))
		const crossingResult = applyDesignPathCommand(
			"simplify",
			context(crossingSource, ["crossing"]),
		)
		expect(crossingResult.ok && crossingResult.document).toBe(crossingSource)

		const inflectionSource = documentWith(
			path("inflection-shape", [inflection]),
		)
		const inflectionResult = applyDesignPathCommand(
			"simplify",
			context(inflectionSource, ["inflection-shape"]),
		)
		expect(inflectionResult.ok).toBe(true)
		if (!inflectionResult.ok) return
		const geometry = inflectionResult.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected path")
		expect(geometry.contours[0]?.points.length).toBeLessThanOrEqual(
			inflection.points.length,
		)
	})

	it("cleans coincident zero-length spans and removes dangling direct targets", () => {
		const original = contour("cleanup", [
			{ id: "a", x: 0, y: 0 },
			{ id: "duplicate", x: 0, y: 0, outgoing: { x: 10, y: 12 } },
			{ id: "c", x: 30, y: 0, incoming: { x: -8, y: 5 } },
			{ id: "d", x: 30, y: 30 },
		])
		const source = documentWith(path("shape", [original]))
		const selected = [
			{ kind: "contour" as const, objectId: "shape", contourId: "cleanup" },
			{
				kind: "node" as const,
				objectId: "shape",
				contourId: "cleanup",
				pointId: "duplicate",
			},
			{
				kind: "handle" as const,
				objectId: "shape",
				contourId: "cleanup",
				pointId: "duplicate",
				handle: "outgoing" as const,
			},
			{
				kind: "node" as const,
				objectId: "shape",
				contourId: "cleanup",
				pointId: "c",
			},
			{
				kind: "handle" as const,
				objectId: "shape",
				contourId: "cleanup",
				pointId: "c",
				handle: "incoming" as const,
			},
			{
				kind: "segment" as const,
				objectId: "shape",
				contourId: "cleanup",
				segmentIndex: 0,
			},
			{
				kind: "segment" as const,
				objectId: "shape",
				contourId: "cleanup",
				segmentIndex: 1,
			},
			{
				kind: "segment" as const,
				objectId: "shape",
				contourId: "cleanup",
				segmentIndex: 2,
			},
		]
		let generated = 0
		const result = applyDesignPathCommand(
			"simplify",
			context(source, ["shape"], selected),
			{ nextId: () => `unexpected:${generated++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const geometry = result.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected path")
		expect(geometry.contours[0]?.points).toEqual([
			{ id: "a", x: 0, y: 0, outgoing: { x: 10, y: 12 } },
			{ id: "c", x: 30, y: 0, incoming: { x: -8, y: 5 } },
			{ id: "d", x: 30, y: 30 },
		])
		expect(generated).toBe(0)
		expect(result.objectSelection).toEqual(["shape"])
		expect(result.directSelection).toEqual([
			{ kind: "contour", objectId: "shape", contourId: "cleanup" },
			{ kind: "node", objectId: "shape", contourId: "cleanup", pointId: "c" },
			{
				kind: "handle",
				objectId: "shape",
				contourId: "cleanup",
				pointId: "c",
				handle: "incoming",
			},
			{
				kind: "segment",
				objectId: "shape",
				contourId: "cleanup",
				segmentIndex: 1,
			},
		])
	})

	it("makes and releases compounds without silently changing authored winding or stacking", () => {
		const outer = contour(
			"outer",
			[
				{ id: "o0", x: 0, y: 0 },
				{ id: "o1", x: 100, y: 0 },
				{ id: "o2", x: 100, y: 100 },
				{ id: "o3", x: 0, y: 100 },
			],
			true,
		)
		const hole = contour(
			"hole",
			[
				{ id: "h0", x: 25, y: 25 },
				{ id: "h1", x: 75, y: 25 },
				{ id: "h2", x: 75, y: 75 },
				{ id: "h3", x: 25, y: 75 },
			],
			true,
		)
		const background = path("background", [outer])
		const top = path("top", [hole])
		const source = documentWith(background, path("middle", [outer]), top)
		const made = applyDesignPathCommand(
			"make-compound",
			context(source, [background.id, top.id]),
		)
		expect(made.ok).toBe(true)
		if (!made.ok) return
		expect(made.document.objects.map(({ id }) => id)).toEqual(["middle", "top"])
		const compound = made.document.objects[1]
		if (compound?.geometry.kind !== "path") throw new Error("Expected compound")
		expect(compound.geometry.contours.map(({ id }) => id)).toEqual([
			"outer",
			"hole",
		])
		expect(contourOrientation(compound.geometry.contours[0]!.points)).toBe(
			"counter-clockwise",
		)
		expect(contourOrientation(compound.geometry.contours[1]!.points)).toBe(
			"counter-clockwise",
		)
		expect(pdfObjectContentStream(compound, source.swatches[0])).toContain("f*")
		expect(
			nearestDesignObject([compound], { x: 10, y: 10 }, 1)?.object.id,
		).toBe("top")
		expect(nearestDesignObject([compound], { x: 50, y: 50 }, 1)).toBeNull()

		let sequence = 0
		const released = applyDesignPathCommand(
			"release-compound",
			context(made.document, ["top"]),
			{ nextId: () => `release:${sequence++}` },
		)
		expect(released.ok).toBe(true)
		if (!released.ok) return
		expect(released.document.objects.map(({ id }) => id)).toEqual([
			"middle",
			"top",
			"object:release:0",
		])
		expect(released.objectSelection).toEqual(["top", "object:release:0"])
	})

	it("normalizes holes only when explicitly requested and undo restores exact topology", () => {
		const outer = contour(
			"outer",
			[
				{ id: "a", x: 0, y: 0 },
				{ id: "b", x: 100, y: 0 },
				{ id: "c", x: 100, y: 100 },
				{ id: "d", x: 0, y: 100 },
			],
			true,
		)
		const hole = contour(
			"hole",
			[
				{ id: "e", x: 25, y: 25 },
				{ id: "f", x: 75, y: 25 },
				{ id: "g", x: 75, y: 75 },
				{ id: "h", x: 25, y: 75 },
			],
			true,
		)
		const source = documentWith(path("compound", [outer, hole]))
		const normalized = applyDesignPathCommand(
			"normalize-winding",
			context(
				source,
				["compound"],
				[{ kind: "contour", objectId: "compound", contourId: "hole" }],
			),
		)
		expect(normalized.ok).toBe(true)
		if (!normalized.ok) return
		const geometry = normalized.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected path")
		expect(contourOrientation(geometry.contours[0]!.points)).toBe(
			"counter-clockwise",
		)
		expect(contourOrientation(geometry.contours[1]!.points)).toBe("clockwise")
		expect(geometry.contours[1]?.points.map(({ id }) => id)).toEqual([
			"h",
			"g",
			"f",
			"e",
		])

		const committed = reduceDesignHistory(createDesignHistory(source), {
			type: "commit",
			document: normalized.document,
		})
		const undone = reduceDesignHistory(committed, { type: "undo" })
		expect(undone.present).toEqual(source)
	})

	it("reports useful Pathfinder ineligibility without mutating mixed selections", () => {
		const valid = path("valid", [rectangle("valid-box", 0, 0, 10, 10)])
		const cases = [
			path("locked", [rectangle("locked-box", 0, 0, 10, 10)], {
				locked: true,
			}),
			path("hidden", [rectangle("hidden-box", 0, 0, 10, 10)], {
				hidden: true,
			}),
			path("stroke-only", [rectangle("stroke-box", 0, 0, 10, 10)], {
				appearance: {},
			}),
			path("open", [line("open-line", 0, 10)]),
		]
		for (const invalid of cases) {
			const source = documentWith(valid, invalid)
			const eligibility = designPathCommandEligibility(
				"pathfinder-unite",
				context(source, [valid.id, invalid.id]),
			)
			expect(eligibility.eligible).toBe(false)
			expect(source.objects).toEqual([valid, invalid])
		}
	})

	it("unites transformed, overlapping, and disjoint fills under the topmost appearance", () => {
		const bottom = path("bottom", [rectangle("bottom-box", 0, 0, 10, 10)], {
			transform: { ...identity, e: 10 },
		})
		const untouched = path("untouched", [
			rectangle("untouched-box", 60, 0, 70, 10),
		])
		const topAppearance: DesignObject["appearance"] = {
			fill: { swatchId: "ink" },
			stroke: {
				swatchId: "ink",
				width: 2,
				cap: "round",
				join: "bevel",
				miterLimit: 4,
				dashArray: [],
				dashOffset: 0,
			},
		}
		const top = path(
			"top",
			[rectangle("overlap", 15, 0, 25, 10), rectangle("island", 40, 0, 50, 10)],
			{ appearance: topAppearance },
		)
		const source = documentWith(bottom, untouched, top)
		let id = 0
		const result = applyDesignPathCommand(
			"pathfinder-unite",
			context(source, [top.id, bottom.id]),
			{ nextId: () => `pathfinder:${id++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects.map(({ id }) => id)).toEqual([
			"untouched",
			"top",
		])
		const united = result.document.objects[1]
		expect(united?.appearance).toEqual(topAppearance)
		expect(united?.transform).toEqual(identity)
		expect(result.objectSelection).toEqual(["top"])
		expect(result.directSelection).toEqual([])
		if (united?.geometry.kind !== "path") throw new Error("Expected path")
		expect(united.geometry.contours).toHaveLength(2)
		expect(nearestDesignObject([united], { x: 12, y: 5 }, 1)?.object.id).toBe(
			"top",
		)
		expect(nearestDesignObject([united], { x: 45, y: 5 }, 1)?.object.id).toBe(
			"top",
		)
	})

	it("subtracts every front fill from the backmost object and preserves holes in canvas and PDF", () => {
		const back = path("back", [rectangle("back-box", 0, 0, 20, 20)])
		const front = path("front", [rectangle("front-box", 2, 2, 18, 18)])
		const frontTwo = path("front-two", [
			rectangle("front-two-box", 0.5, 0.5, 1.5, 1.5),
		])
		const source = documentWith(back, front, frontTwo)
		let id = 0
		const result = applyDesignPathCommand(
			"pathfinder-subtract-front",
			context(source, [frontTwo.id, back.id, front.id]),
			{ nextId: () => `subtract:${id++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects.map(({ id }) => id)).toEqual(["back"])
		const subtracted = result.document.objects[0]
		if (subtracted?.geometry.kind !== "path") throw new Error("Expected path")
		expect(subtracted.geometry.contours).toHaveLength(3)
		expect(subtracted.appearance).toEqual(back.appearance)
		expect(
			nearestDesignObject([subtracted], { x: 0.25, y: 0.25 }, 1)?.object.id,
		).toBe("back")
		expect(nearestDesignObject([subtracted], { x: 10, y: 10 }, 1, 1)).toBeNull()
		expect(nearestDesignObject([subtracted], { x: 1, y: 1 }, 1, 0.1)).toBeNull()
		expect(pdfObjectContentStream(subtracted, source.swatches[0])).toContain(
			"f*",
		)
		expect(result.message).toMatch(/2 front objects/iu)

		const committed = reduceDesignHistory(createDesignHistory(source), {
			type: "commit",
			document: result.document,
		})
		expect(reduceDesignHistory(committed, { type: "undo" }).present).toEqual(
			source,
		)
	})

	it("commits a deterministic empty subtraction when front fills cover the target", () => {
		const back = path("back", [rectangle("small", 2, 2, 4, 4)])
		const front = path("front", [rectangle("cover", 0, 0, 10, 10)])
		const first = applyDesignPathCommand(
			"pathfinder-subtract-front",
			context(documentWith(back, front), [back.id, front.id]),
			{ nextId: () => "unused" },
		)
		expect(first.ok).toBe(true)
		if (!first.ok) return
		expect(first.document.objects).toEqual([])
		expect(first.objectSelection).toEqual([])
		expect(first.message).toMatch(/empty/iu)
	})

	it("returns deterministic ordinary cubic geometry for overlapping live curves", () => {
		const first: DesignObject = {
			...path("first", []),
			geometry: {
				kind: "ellipse",
				centerX: 20,
				centerY: 20,
				radiusX: 20,
				radiusY: 15,
			},
		}
		const second: DesignObject = {
			...path("second", []),
			geometry: {
				kind: "ellipse",
				centerX: 35,
				centerY: 20,
				radiusX: 20,
				radiusY: 15,
			},
		}
		const source = documentWith(first, second)
		const run = () => {
			let id = 0
			return applyDesignPathCommand(
				"pathfinder-unite",
				context(source, [first.id, second.id]),
				{ nextId: () => `curve:${id++}` },
			)
		}
		const left = run()
		const right = run()
		expect(left).toEqual(right)
		expect(left.ok).toBe(true)
		if (!left.ok) return
		const geometry = left.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected ordinary path")
		expect(
			geometry.contours.some((output) =>
				output.points.some(
					(point) =>
						point.incoming !== undefined || point.outgoing !== undefined,
				),
			),
		).toBe(true)
	})
})
