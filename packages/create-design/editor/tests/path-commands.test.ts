import {
	contourOrientation,
	flattenCubic,
	pointOnSegment,
	selfIntersections,
} from "@create-art/vector-geometry"
import { validateDesignDocument } from "@create-design/source"
import { describe, expect, it } from "vitest"

import { nearestDesignObject } from "../src/design-canvas.ts"
import { DESIGN_VECTOR_MIME, writeDesignClipboard } from "../src/clipboard.ts"
import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import { ellipseContour, objectBounds } from "@create-design/model"
import {
	applyDesignPathCommand,
	cleanupDesignContour,
	DEFAULT_PATH_SIMPLIFY_TOLERANCE,
	designPathCommandEligibility,
	type DesignPathCommandContext,
} from "../src/path-commands.ts"
import { pdfObjectContentStream } from "@create-design/pdf"
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
	scopeGroupId: string | null = null,
): DesignPathCommandContext => ({
	document,
	objectSelection,
	directSelection,
	scopeGroupId,
})

const expectSingleUndo = (
	before: DesignDocument,
	after: DesignDocument,
): void => {
	const state = createDesignEditorState({
		document: before,
		persistence: createDesignPersistenceState(null),
		name: "path-command-history-test",
	})
	state.actions.commitDocument(after)
	expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
		at: 1,
		length: 1,
	})
	state.silo.undo(state.documentTimeline)
	expect(state.silo.getState(state.states.documentAtom)).toEqual(before)
}

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

		const grouped: DesignDocument = {
			...separate,
			artboards: separate.artboards.map((artboard) => ({
				...artboard,
				id: "artboard:test",
			})),
			swatches: separate.swatches.map((swatch) => ({
				...swatch,
				id: "swatch:ink",
			})),
			objects: separate.objects.map((object) => ({
				...object,
				id: `object:${object.id}`,
				appearance: { fill: { swatchId: "swatch:ink" } },
			})),
			scene: [{ kind: "group", id: "group:joined" }],
			groups: [
				{
					id: "group:joined",
					name: "Joined paths",
					children: [
						{ kind: "object", id: "object:left" },
						{ kind: "object", id: "object:right" },
					],
				},
			],
		}
		// Use the same document-space endpoint pair against grouped siblings.
		const groupedEndpoints = [
			{
				kind: "node" as const,
				objectId: "object:left",
				contourId: "left-line",
				pointId: "left-line:b",
			},
			{
				kind: "node" as const,
				objectId: "object:right",
				contourId: "right-line",
				pointId: "right-line:b",
			},
		]
		const joinedOuter = applyDesignPathCommand(
			"join",
			context(grouped, ["object:left", "object:right"], groupedEndpoints),
		)
		expect(joinedOuter.ok).toBe(true)
		if (!joinedOuter.ok) return
		expect(joinedOuter.document.scene).toEqual([
			{ kind: "object", id: "object:right" },
		])
		expect(joinedOuter.document.groups).toEqual([])
		const joinedGroup = applyDesignPathCommand(
			"join",
			context(
				grouped,
				["object:left", "object:right"],
				groupedEndpoints,
				"group:joined",
			),
		)
		expect(joinedGroup.ok).toBe(true)
		if (!joinedGroup.ok) return
		expect(joinedGroup.document.scene).toEqual([
			{ kind: "group", id: "group:joined" },
		])
		expect(joinedGroup.document.groups?.[0]?.children).toEqual([
			{ kind: "object", id: "object:right" },
		])
		expect(validateDesignDocument(joinedGroup.document)).toEqual({
			ok: true,
			value: joinedGroup.document,
		})
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
		expect(compound.geometry.fillRule).toBe("evenodd")
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
		expect(
			released.document.objects.map((object) =>
				object.geometry.kind === "path" ? object.geometry.fillRule : undefined,
			),
		).toEqual([undefined, "evenodd", "evenodd"])
	})

	it("replaces grouped compounds and released contours without dangling hierarchy", () => {
		const first = path("first", [rectangle("first-box", 0, 0, 20, 20)])
		const second = path("second", [rectangle("second-box", 5, 5, 15, 15)])
		const front = path("front", [rectangle("front-box", 30, 0, 40, 10)])
		const grouped: DesignDocument = {
			...documentWith(first, second, front),
			scene: [
				{ kind: "group", id: "group:compound-source" },
				{ kind: "object", id: front.id },
			],
			groups: [
				{
					id: "group:compound-source",
					name: "Compound source",
					children: [
						{ kind: "object", id: first.id },
						{ kind: "object", id: second.id },
					],
				},
			],
		}
		const made = applyDesignPathCommand(
			"make-compound",
			context(grouped, [first.id, second.id]),
		)
		expect(made.ok).toBe(true)
		if (!made.ok) return
		expect(made.document.scene).toEqual([
			{ kind: "object", id: second.id },
			{ kind: "object", id: front.id },
		])
		expect(made.document.groups).toEqual([])
		expect(made.document.objects.map(({ id }) => id)).toEqual([
			second.id,
			front.id,
		])
		const madeInside = applyDesignPathCommand(
			"make-compound",
			context(grouped, [first.id, second.id], [], "group:compound-source"),
		)
		expect(madeInside.ok).toBe(true)
		if (!madeInside.ok) return
		expect(madeInside.document.scene).toEqual([
			{ kind: "group", id: "group:compound-source" },
			{ kind: "object", id: front.id },
		])
		expect(madeInside.document.groups?.[0]?.children).toEqual([
			{ kind: "object", id: second.id },
		])
		expect(madeInside.document.objects.map(({ id }) => id)).toEqual([
			second.id,
			front.id,
		])

		let sequence = 0
		const released = applyDesignPathCommand(
			"release-compound",
			context(made.document, [second.id]),
			{ nextId: () => `hierarchy:${sequence++}` },
		)
		expect(released.ok).toBe(true)
		if (!released.ok) return
		expect(released.document.scene).toEqual([
			{ kind: "object", id: second.id },
			{ kind: "object", id: "object:hierarchy:0" },
			{ kind: "object", id: front.id },
		])
		expect(released.document.objects.map(({ id }) => id)).toEqual([
			second.id,
			"object:hierarchy:0",
			front.id,
		])
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

		expectSingleUndo(source, normalized.document)
	})

	it("preserves nonzero fill semantics through contour editing commands", () => {
		const nonzeroPath = (id: string, contours: readonly DesignContour[]) =>
			path(id, contours, {
				geometry: { kind: "path", fillRule: "nonzero", contours },
			})
		const reverseContour = rectangle("reverse-box", 0, 0, 20, 20)
		const closeContour = contour("close-shape", [
			{ id: "close:a", x: 0, y: 0 },
			{ id: "close:b", x: 20, y: 0 },
			{ id: "close:c", x: 0, y: 20 },
		])
		const simplifyContour = contour("simplify-shape", [
			{ id: "simplify:a", x: 0, y: 0 },
			{ id: "simplify:duplicate", x: 0, y: 0 },
			{ id: "simplify:b", x: 20, y: 0 },
			{ id: "simplify:c", x: 0, y: 20 },
		])
		const outer = rectangle("normalize-outer", 0, 0, 20, 20)
		const inner = rectangle("normalize-inner", 5, 5, 15, 15)
		const fixtures = [
			{
				command: "reverse" as const,
				object: nonzeroPath("reverse-rule", [reverseContour]),
				directSelection: [
					{
						kind: "contour" as const,
						objectId: "reverse-rule",
						contourId: reverseContour.id,
					},
				],
			},
			{
				command: "close" as const,
				object: nonzeroPath("close-rule", [closeContour]),
				directSelection: [
					{
						kind: "contour" as const,
						objectId: "close-rule",
						contourId: closeContour.id,
					},
				],
			},
			{
				command: "simplify" as const,
				object: nonzeroPath("simplify-rule", [simplifyContour]),
				directSelection: [
					{
						kind: "contour" as const,
						objectId: "simplify-rule",
						contourId: simplifyContour.id,
					},
				],
			},
			{
				command: "normalize-winding" as const,
				object: nonzeroPath("normalize-rule", [outer, inner]),
				directSelection: [
					{
						kind: "contour" as const,
						objectId: "normalize-rule",
						contourId: inner.id,
					},
				],
			},
		]
		for (const fixture of fixtures) {
			const unrelated = nonzeroPath("unrelated-rule", [
				rectangle("unrelated-box", 30, 0, 40, 10),
			])
			const source = documentWith(fixture.object, unrelated)
			const result = applyDesignPathCommand(
				fixture.command,
				context(source, [fixture.object.id], fixture.directSelection),
			)
			expect(result.ok).toBe(true)
			if (!result.ok) continue
			const edited = result.document.objects[0]
			expect(
				edited?.geometry.kind === "path" ? edited.geometry.fillRule : undefined,
			).toBe("nonzero")
			expect(result.document.objects[1]).toBe(unrelated)
			expect(pdfObjectContentStream(edited!, source.swatches[0])).toMatch(
				/\nf$/u,
			)
		}
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

		expectSingleUndo(source, result.document)
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

	it("intersects transformed live curves into deterministic ordinary clipboard and PDF geometry", () => {
		const first: DesignObject = {
			...path("first", []),
			geometry: {
				kind: "ellipse",
				centerX: 20,
				centerY: 20,
				radiusX: 20,
				radiusY: 15,
			},
			transform: { ...identity, e: 5 },
		}
		const topAppearance: DesignObject["appearance"] = {
			fill: { swatchId: "ink" },
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
			appearance: topAppearance,
		}
		const source = documentWith(first, second)
		const run = () => {
			let id = 0
			return applyDesignPathCommand(
				"pathfinder-intersect",
				context(source, [second.id, first.id]),
				{ nextId: () => `intersect:${id++}` },
			)
		}
		const result = run()
		expect(result).toEqual(run())
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.objectSelection).toEqual(["second"])
		expect(result.directSelection).toEqual([])
		const intersected = result.document.objects[0]
		if (intersected?.geometry.kind !== "path")
			throw new Error("Expected ordinary path")
		expect(intersected.transform).toEqual(identity)
		expect(intersected.appearance).toEqual(topAppearance)
		expect(intersected.geometry.contours).toHaveLength(1)
		expect(
			intersected.geometry.contours[0]?.points.some(
				(point) => point.incoming !== undefined || point.outgoing !== undefined,
			),
		).toBe(true)
		expect(objectBounds(intersected)).toMatchObject({ minX: 15, maxX: 45 })
		expect(
			nearestDesignObject([intersected], { x: 30, y: 20 }, 1)?.object.id,
		).toBe("second")
		expect(pdfObjectContentStream(intersected, source.swatches[0])).toContain(
			"f*",
		)
		const clipboard = new Map<string, string>()
		expect(
			writeDesignClipboard(
				{ setData: (format, value) => clipboard.set(format, value) },
				result.document,
				result.objectSelection,
			),
		).toBe(1)
		expect(
			JSON.parse(clipboard.get(DESIGN_VECTOR_MIME) ?? "null").objects[0]
				.geometry.kind,
		).toBe("path")
	})

	it("excludes even coverage across nested, holed, disjoint, and transformed fills", () => {
		const outer = rectangle("outer", 0, 0, 20, 20)
		const hole = rectangle("hole", 5, 5, 15, 15)
		const donut = path("donut", [outer, hole])
		const fillHole = path("fill-hole", [rectangle("fill", 5, 5, 15, 15)])
		const topAppearance: DesignObject["appearance"] = {
			fill: { swatchId: "ink" },
			stroke: {
				swatchId: "ink",
				width: 1,
				cap: "butt",
				join: "miter",
				miterLimit: 4,
				dashArray: [],
				dashOffset: 0,
			},
		}
		const island = path("island", [rectangle("island-box", 0, 0, 5, 5)], {
			transform: { ...identity, e: 30 },
			appearance: topAppearance,
		})
		const source = documentWith(donut, fillHole, island)
		let id = 0
		const result = applyDesignPathCommand(
			"pathfinder-exclude",
			context(source, [island.id, donut.id, fillHole.id]),
			{ nextId: () => `exclude:${id++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects.map(({ id }) => id)).toEqual(["island"])
		const excluded = result.document.objects[0]
		if (excluded?.geometry.kind !== "path") throw new Error("Expected path")
		expect(excluded.geometry.contours).toHaveLength(2)
		expect(excluded.appearance).toEqual(topAppearance)
		expect(excluded.transform).toEqual(identity)
		expect(objectBounds(excluded)).toMatchObject({ minX: 0, maxX: 35 })
		expect(
			nearestDesignObject([excluded], { x: 10, y: 10 }, 1)?.object.id,
		).toBe("island")
		expect(nearestDesignObject([excluded], { x: 32, y: 2 }, 1)?.object.id).toBe(
			"island",
		)
		expect(pdfObjectContentStream(excluded, source.swatches[0])).toContain("f*")

		expectSingleUndo(source, result.document)
	})

	it("divides coverage into fresh deterministic pieces under the topmost complete appearance", () => {
		const bottomAppearance: DesignObject["appearance"] = {
			fill: { swatchId: "ink" },
			stroke: {
				swatchId: "ink",
				width: 2,
				cap: "round",
				join: "round",
				miterLimit: 4,
				dashArray: [],
				dashOffset: 0,
			},
		}
		const topAppearance: DesignObject["appearance"] = {
			fill: { swatchId: "ink" },
			stroke: {
				swatchId: "ink",
				width: 4,
				cap: "square",
				join: "bevel",
				miterLimit: 5,
				dashArray: [2, 1],
				dashOffset: 0.5,
			},
		}
		const bottom = path("bottom", [rectangle("bottom-box", 0, 0, 10, 10)], {
			appearance: bottomAppearance,
		})
		const top = path("top", [rectangle("top-box", 5, 0, 15, 10)], {
			appearance: topAppearance,
		})
		const source = documentWith(bottom, top)
		const run = () => {
			let sequence = 0
			return applyDesignPathCommand(
				"pathfinder-divide",
				context(source, [top.id, bottom.id]),
				{ nextId: () => `divide:${sequence++}` },
			)
		}
		const result = run()
		expect(result).toEqual(run())
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects).toHaveLength(3)
		expect(result.document.objects.map(({ appearance }) => appearance)).toEqual(
			[bottomAppearance, topAppearance, topAppearance],
		)
		expect(
			result.document.objects.map((object) => {
				const bounds = objectBounds(object)
				return [bounds?.minX, bounds?.maxX]
			}),
		).toEqual([
			[0, 5],
			[5, 10],
			[10, 15],
		])
		expect(
			result.document.objects.every(
				({ id }) => id !== "bottom" && id !== "top",
			),
		).toBe(true)
		expect(new Set(result.objectSelection).size).toBe(3)
		expect(
			result.document.objects.every(
				(object) =>
					object.geometry.kind === "path" &&
					object.geometry.contours.every((output) =>
						output.points.every(
							(point) =>
								!point.id.includes("bottom") && !point.id.includes("top"),
						),
					),
			),
		).toBe(true)
	})

	it("divides coincident and tangent boundaries without zero-area duplicates", () => {
		const run = (second: DesignContour) => {
			let sequence = 0
			return applyDesignPathCommand(
				"pathfinder-divide",
				context(
					documentWith(
						path("first", [rectangle("first-box", 0, 0, 10, 10)]),
						path("second", [second]),
					),
					["first", "second"],
				),
				{ nextId: () => `boundary:${sequence++}` },
			)
		}
		const coincident = run(rectangle("same", 0, 0, 10, 10))
		expect(coincident.ok && coincident.document.objects).toHaveLength(1)
		const tangent = run(rectangle("tangent", 10, 0, 20, 10))
		expect(tangent.ok && tangent.document.objects).toHaveLength(2)
	})

	it("trims hidden coverage into fill-only pieces and merges same-fill components", () => {
		const stroke = {
			swatchId: "ink",
			width: 3,
			cap: "round" as const,
			join: "round" as const,
			miterLimit: 4,
			dashArray: [],
			dashOffset: 0,
		}
		const bottom = path("bottom", [rectangle("bottom-box", 0, 0, 10, 10)], {
			appearance: { fill: { swatchId: "ink" }, stroke },
		})
		const top = path("top", [rectangle("top-box", 5, 0, 15, 10)], {
			appearance: { fill: { swatchId: "ink" }, stroke },
		})
		const red = path("red", [rectangle("red-box", 20, 0, 30, 10)], {
			appearance: { fill: { swatchId: "red" }, stroke },
		})
		const source: DesignDocument = {
			...documentWith(bottom, top, red),
			swatches: [
				...documentWith().swatches,
				{ id: "red", name: "Red", source: { space: "rgb", r: 1, g: 0, b: 0 } },
			],
		}
		let trimId = 0
		const trimmed = applyDesignPathCommand(
			"pathfinder-trim",
			context(source, [bottom.id, top.id, red.id]),
			{ nextId: () => `trim:${trimId++}` },
		)
		expect(trimmed.ok).toBe(true)
		if (!trimmed.ok) return
		expect(trimmed.document.objects).toHaveLength(4)
		expect(
			trimmed.document.objects.every(
				({ appearance }) => appearance.stroke === undefined,
			),
		).toBe(true)

		let mergeId = 0
		const merged = applyDesignPathCommand(
			"pathfinder-merge",
			context(source, [bottom.id, top.id, red.id]),
			{ nextId: () => `merge:${mergeId++}` },
		)
		expect(merged.ok).toBe(true)
		if (!merged.ok) return
		expect(merged.document.objects).toHaveLength(2)
		expect(
			merged.document.objects.map((object) => ({
				fill: object.appearance.fill?.swatchId,
				stroke: object.appearance.stroke,
				bounds: objectBounds(object),
			})),
		).toMatchObject([
			{ fill: "ink", stroke: undefined, bounds: { minX: 0, maxX: 15 } },
			{ fill: "red", stroke: undefined, bounds: { minX: 20, maxX: 30 } },
		])
	})

	it("crops underlying visible fills with the topmost mask and deletes mask-only area", () => {
		const bottom = path("bottom", [rectangle("bottom-box", 0, 0, 20, 10)])
		const middle = path("middle", [rectangle("middle-box", 5, 0, 15, 10)])
		const mask = path("mask", [rectangle("mask-box", 10, 0, 25, 10)])
		let sequence = 0
		const result = applyDesignPathCommand(
			"pathfinder-crop",
			context(documentWith(bottom, middle, mask), [
				mask.id,
				bottom.id,
				middle.id,
			]),
			{ nextId: () => `crop:${sequence++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects).toHaveLength(2)
		expect(
			result.document.objects.map((object) => {
				const bounds = objectBounds(object)
				return [bounds?.minX, bounds?.maxX]
			}),
		).toEqual([
			[15, 20],
			[10, 15],
		])
		expect(
			result.document.objects.every(
				({ appearance }) => appearance.stroke === undefined,
			),
		).toBe(true)
		expect(result.document.objects.some(({ id }) => id === mask.id)).toBe(false)
	})

	it("outlines every unique noded boundary once as a fresh editable open path", () => {
		const bottom = path("bottom", [rectangle("bottom-box", 0, 0, 10, 10)])
		const topStroke = {
			swatchId: "ink",
			width: 3,
			cap: "round" as const,
			join: "bevel" as const,
			miterLimit: 4,
			dashArray: [1, 2],
			dashOffset: 0,
		}
		const top = path("top", [rectangle("top-box", 5, 0, 15, 10)], {
			appearance: { fill: { swatchId: "ink" }, stroke: topStroke },
		})
		let sequence = 0
		const result = applyDesignPathCommand(
			"pathfinder-outline",
			context(documentWith(bottom, top), [bottom.id, top.id]),
			{ nextId: () => `outline:${sequence++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.document.objects).toHaveLength(10)
		expect(
			result.document.objects.every(
				(object) =>
					object.appearance.fill === undefined &&
					object.geometry.kind === "path" &&
					object.geometry.contours.length === 1 &&
					object.geometry.contours[0]?.closed === false &&
					object.geometry.contours[0].points.length === 2,
			),
		).toBe(true)
		expect(
			result.document.objects.some(
				({ appearance }) => appearance.stroke?.width === 1,
			),
		).toBe(true)
		expect(
			result.document.objects.some(
				({ appearance }) => appearance.stroke?.width === topStroke.width,
			),
		).toBe(true)
	})

	it("nodes T-junctions before deduplicating Outline segments", () => {
		const base = path("base", [rectangle("base-box", 0, 0, 20, 20)])
		const crossing = path("crossing", [
			rectangle("crossing-box", 5, -5, 15, 10),
		])
		let sequence = 0
		const result = applyDesignPathCommand(
			"pathfinder-outline",
			context(documentWith(base, crossing), [base.id, crossing.id]),
			{ nextId: () => `junction:${sequence++}` },
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const segments = result.document.objects.flatMap((object) =>
			object.geometry.kind === "path"
				? object.geometry.contours.flatMap((output) => {
						const [start, end] = output.points
						return start === undefined || end === undefined
							? []
							: [{ start, end }]
					})
				: [],
		)
		const keys = segments.map(
			({ start, end }) => `${start.x},${start.y}:${end.x},${end.y}`,
		)
		expect(new Set(keys).size).toBe(keys.length)
		for (const segment of segments)
			for (const candidate of segments.flatMap(({ start, end }) => [
				start,
				end,
			])) {
				const isEndpoint =
					(candidate.x === segment.start.x &&
						candidate.y === segment.start.y) ||
					(candidate.x === segment.end.x && candidate.y === segment.end.y)
				if (!isEndpoint)
					expect(pointOnSegment(candidate, segment.start, segment.end)).toBe(
						false,
					)
			}
	})

	it("preserves authored fill rules and passes progress and cancellation through partition commands", () => {
		const outer = rectangle("outer", 0, 0, 20, 20)
		const nested = rectangle("nested", 5, 5, 15, 15)
		const nonzero = path("nonzero", [outer, nested], {
			geometry: {
				kind: "path",
				fillRule: "nonzero",
				contours: [outer, nested],
			},
		})
		const evenodd = path("evenodd", [outer, nested], {
			geometry: {
				kind: "path",
				fillRule: "evenodd",
				contours: [outer, nested],
			},
		})
		const outlineCount = (object: DesignObject) => {
			let sequence = 0
			const result = applyDesignPathCommand(
				"pathfinder-outline",
				context(documentWith(object), [object.id]),
				{ nextId: () => `fill-rule:${sequence++}` },
			)
			return result.ok ? result.document.objects.length : -1
		}
		expect(outlineCount(nonzero)).toBe(4)
		expect(outlineCount(evenodd)).toBe(8)

		const progress: number[] = []
		let sequence = 0
		const completed = applyDesignPathCommand(
			"pathfinder-divide",
			context(
				documentWith(
					nonzero,
					path("other", [rectangle("other-box", 10, 0, 30, 20)]),
				),
				["nonzero", "other"],
			),
			{
				nextId: () => `progress:${sequence++}`,
				onPathfinderProgress: ({ completedRegions }) =>
					progress.push(completedRegions),
			},
		)
		expect(completed.ok).toBe(true)
		expect(progress).toEqual([0, 1, 2])

		const cancelled = applyDesignPathCommand(
			"pathfinder-divide",
			context(documentWith(nonzero, evenodd), [nonzero.id, evenodd.id]),
			{ pathfinderSignal: { aborted: true } },
		)
		expect(cancelled).toEqual({
			ok: false,
			error: "Boolean partition was aborted.",
		})
	})

	it("replaces complete hierarchy units atomically and undo restores every Pathfinder source", () => {
		const first = path("first", [rectangle("first-box", 0, 0, 10, 10)])
		const second = path("second", [rectangle("second-box", 5, 0, 15, 10)])
		const front = path("front", [rectangle("front-box", 30, 0, 40, 10)])
		const source: DesignDocument = {
			...documentWith(first, second, front),
			scene: [
				{ kind: "group", id: "group:pathfinder" },
				{ kind: "object", id: front.id },
			],
			groups: [
				{
					id: "group:pathfinder",
					name: "Pathfinder",
					children: [
						{ kind: "object", id: first.id },
						{ kind: "object", id: second.id },
					],
				},
			],
		}
		let sequence = 0
		const divided = applyDesignPathCommand(
			"pathfinder-divide",
			context(source, [first.id, second.id]),
			{ nextId: () => `hierarchy-divide:${sequence++}` },
		)
		expect(divided.ok).toBe(true)
		if (!divided.ok) return
		expect(divided.document.groups).toEqual([])
		expect(divided.document.scene?.at(-1)).toEqual({
			kind: "object",
			id: front.id,
		})
		expect(divided.document.scene?.slice(0, -1)).toEqual(
			divided.objectSelection.map((id) => ({ kind: "object", id })),
		)
		sequence = 0
		const dividedInside = applyDesignPathCommand(
			"pathfinder-divide",
			context(source, [first.id, second.id], [], "group:pathfinder"),
			{ nextId: () => `hierarchy-divide-inner:${sequence++}` },
		)
		expect(dividedInside.ok).toBe(true)
		if (!dividedInside.ok) return
		expect(dividedInside.document.scene).toEqual(source.scene)
		expect(dividedInside.document.groups?.[0]?.children).toEqual(
			dividedInside.objectSelection.map((id) => ({ kind: "object", id })),
		)
		expect(dividedInside.document.objects.at(-1)?.id).toBe(front.id)
		expectSingleUndo(source, divided.document)
	})

	it.each([
		[
			"pathfinder-intersect" as const,
			rectangle("left", 0, 0, 5, 5),
			rectangle("right", 10, 0, 15, 5),
		],
		[
			"pathfinder-exclude" as const,
			rectangle("same-a", 0, 0, 5, 5),
			rectangle("same-b", 0, 0, 5, 5),
		],
	])(
		"commits an explicit empty %s result atomically",
		(command, first, second) => {
			const source = documentWith(
				path("first", [first]),
				path("second", [second]),
			)
			const result = applyDesignPathCommand(
				command,
				context(source, ["first", "second"]),
				{ nextId: () => "unused" },
			)
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.document.objects).toEqual([])
			expect(result.objectSelection).toEqual([])
			expect(result.directSelection).toEqual([])
			expect(result.message).toMatch(/empty/iu)
		},
	)
})
