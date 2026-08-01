import { contourOrientation, flattenCubic } from "@create-art/vector-geometry"
import { describe, expect, it } from "vitest"

import {
	createDesignHistory,
	reduceDesignHistory,
} from "../src/design-history.ts"
import { nearestDesignObject } from "../src/design-canvas.ts"
import {
	applyDesignPathCommand,
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
		const nearest = (point: DesignPoint) =>
			Math.min(
				...flattened.slice(1).map((candidate, index) => {
					const previous = flattened[index]
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
		expect(Math.max(...points.map(nearest))).toBeLessThanOrEqual(
			DEFAULT_PATH_SIMPLIFY_TOLERANCE,
		)
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
})
