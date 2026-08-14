import { evaluateCubic } from "@create-art/vector-geometry"
import { describe, expect, it } from "vitest"

import {
	addDesignSegmentHandles,
	cutDesignSegment,
} from "../src/design-segment-operations.ts"
import { createInitialDocument } from "../src/document.ts"
import type { DesignDocument, DesignObject } from "../src/types.ts"

const pathObject = (
	points: Extract<
		DesignObject["geometry"],
		{ kind: "path" }
	>["contours"][number]["points"],
	closed = false,
): DesignObject => ({
	id: "object:path",
	name: "Authored path",
	geometry: {
		kind: "path",
		fillRule: "nonzero",
		contours: [{ id: "contour:path", closed, points }],
	},
	transform: { a: 1.5, b: 0.25, c: -0.5, d: 2, e: 30, f: -20 },
	appearance: {
		stroke: {
			swatchId: "swatch:ink",
			width: 3,
			cap: "round",
			join: "round",
			miterLimit: 4,
			dashArray: [],
			dashOffset: 0,
		},
	},
})

const documentWith = (object: DesignObject): DesignDocument => {
	const initial = createInitialDocument()
	return {
		...initial,
		objects: [object],
		layers: [
			{
				id: "layer:paths",
				name: "Paths",
				children: [{ kind: "object", id: object.id }],
			},
		],
	}
}

const sequence = (...values: readonly string[]) => {
	let index = 0
	return () => values[index++] ?? `fallback-${index}`
}

describe("create-design segment operations", () => {
	it("adds exact one-third local handles and hardens only incompatible soft endpoints", () => {
		const object = pathObject([
			{
				id: "point:a",
				mode: "soft",
				x: 10,
				y: 20,
				incoming: { x: 0, y: -9 },
			},
			{
				id: "point:b",
				mode: "soft",
				x: 40,
				y: 50,
				outgoing: { x: 8, y: 8 },
			},
		])
		const result = addDesignSegmentHandles(documentWith(object), {
			objectId: object.id,
			contourId: "contour:path",
			segmentIndex: 0,
			parameter: 0.5,
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const next = result.document.objects[0]!
		expect(next.transform).toEqual(object.transform)
		expect(next.appearance).toEqual(object.appearance)
		if (next.geometry.kind !== "path") throw new Error("Expected a path.")
		expect(next.geometry.fillRule).toBe("nonzero")
		expect(next.geometry.contours[0]?.points).toEqual([
			{
				id: "point:a",
				mode: "hard",
				x: 10,
				y: 20,
				incoming: { x: 0, y: -9 },
				outgoing: { x: 10, y: 10 },
			},
			{
				id: "point:b",
				mode: "soft",
				x: 40,
				y: 50,
				incoming: { x: -10, y: -10 },
				outgoing: { x: 8, y: 8 },
			},
		])
		expect(result.directSelection.map(({ kind }) => kind)).toEqual([
			"handle",
			"handle",
		])
	})

	it("rejects curved, degenerate, locked, and live-corner segments atomically", () => {
		const base = pathObject([
			{ id: "point:a", x: 0, y: 0 },
			{ id: "point:b", x: 0, y: 0 },
		])
		const original = documentWith(base)
		expect(
			addDesignSegmentHandles(original, {
				objectId: base.id,
				contourId: "contour:path",
				segmentIndex: 0,
				parameter: 0.5,
			}),
		).toMatchObject({ ok: false })
		expect(original.objects[0]).toBe(base)

		const curved = pathObject([
			{ id: "point:a", x: 0, y: 0, outgoing: { x: 5, y: 0 } },
			{ id: "point:b", x: 20, y: 0 },
		])
		expect(
			addDesignSegmentHandles(documentWith(curved), {
				objectId: curved.id,
				contourId: "contour:path",
				segmentIndex: 0,
				parameter: 0.5,
			}),
		).toMatchObject({ ok: false })

		const cornered = pathObject([
			{
				id: "point:a",
				x: 0,
				y: 0,
				corner: { profile: "circular", amount: 4 },
			},
			{ id: "point:b", x: 20, y: 0 },
		])
		expect(
			cutDesignSegment(
				documentWith(cornered),
				{
					objectId: cornered.id,
					contourId: "contour:path",
					segmentIndex: 0,
					parameter: 0.5,
				},
				sequence("left", "right", "contour"),
			),
		).toMatchObject({
			ok: false,
			error: expect.stringContaining("live corners"),
		})

		const locked = { ...curved, locked: true }
		expect(
			cutDesignSegment(
				documentWith(locked),
				{
					objectId: locked.id,
					contourId: "contour:path",
					segmentIndex: 0,
					parameter: 0.5,
				},
				sequence("left", "right", "contour"),
			),
		).toMatchObject({ ok: false, error: expect.stringContaining("Unlock") })
	})

	it("cuts a transformed straight open contour into two ordered pieces", () => {
		const object = pathObject([
			{ id: "point:a", x: 0, y: 0, incoming: { x: -3, y: 1 } },
			{ id: "point:b", x: 30, y: 0 },
			{ id: "point:c", x: 50, y: 20, outgoing: { x: 2, y: 4 } },
		])
		const original = documentWith(object)
		const result = cutDesignSegment(
			original,
			{
				objectId: object.id,
				contourId: "contour:path",
				segmentIndex: 0,
				parameter: 0.25,
			},
			sequence("left", "right", "second"),
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const next = result.document.objects[0]!
		expect(next.id).toBe(object.id)
		expect(next.transform).toEqual(object.transform)
		expect(next.appearance).toEqual(object.appearance)
		if (next.geometry.kind !== "path") throw new Error("Expected a path.")
		expect(
			next.geometry.contours.map(({ id, closed }) => ({ id, closed })),
		).toEqual([
			{ id: "contour:path", closed: false },
			{ id: "contour:second", closed: false },
		])
		expect(next.geometry.contours[0]?.points.map(({ id }) => id)).toEqual([
			"point:a",
			"point:left",
		])
		expect(next.geometry.contours[1]?.points.map(({ id }) => id)).toEqual([
			"point:right",
			"point:b",
			"point:c",
		])
		const left = next.geometry.contours[0]?.points.at(-1)
		const right = next.geometry.contours[1]?.points[0]
		expect(left).toMatchObject({ x: 7.5, y: 0 })
		expect(right).toMatchObject({ x: 7.5, y: 0 })
		expect(left?.id).not.toBe(right?.id)
		expect(result.directSelection.map(({ kind }) => kind)).toEqual([
			"node",
			"node",
		])
	})

	it("opens a closed cubic at an exact de Casteljau split, including its closing edge", () => {
		const object = pathObject(
			[
				{
					id: "point:a",
					x: 0,
					y: 0,
					incoming: { x: -30, y: 0 },
					outgoing: { x: 20, y: 30 },
				},
				{
					id: "point:b",
					x: 80,
					y: 20,
					incoming: { x: -10, y: 40 },
					outgoing: { x: 30, y: -10 },
				},
			],
			true,
		)
		const result = cutDesignSegment(
			documentWith(object),
			{
				objectId: object.id,
				contourId: "contour:path",
				segmentIndex: 1,
				parameter: 0.4,
			},
			sequence("left", "right"),
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const geometry = result.document.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected a path.")
		const contour = geometry.contours[0]!
		expect(contour.closed).toBe(false)
		expect(contour.points.map(({ id }) => id)).toEqual([
			"point:right",
			"point:a",
			"point:b",
			"point:left",
		])
		const originalCubic = {
			p0: { x: 80, y: 20 },
			c1: { x: 110, y: 10 },
			c2: { x: -30, y: 0 },
			p3: { x: 0, y: 0 },
		}
		const cutPoint = evaluateCubic(originalCubic, 0.4)
		expect(contour.points[0]?.x).toBeCloseTo(cutPoint.x, 12)
		expect(contour.points[0]?.y).toBeCloseTo(cutPoint.y, 12)
		expect(contour.points.at(-1)?.x).toBeCloseTo(cutPoint.x, 12)
		expect(contour.points.at(-1)?.y).toBeCloseTo(cutPoint.y, 12)
		expect(contour.points[0]?.incoming).toBeUndefined()
		expect(contour.points.at(-1)?.outgoing).toBeUndefined()
		const right = contour.points[0]!
		const end = contour.points[1]!
		const start = contour.points[2]!
		const left = contour.points[3]!
		const rightPiece = {
			p0: right,
			c1: {
				x: right.x + (right.outgoing?.x ?? 0),
				y: right.y + (right.outgoing?.y ?? 0),
			},
			c2: {
				x: end.x + (end.incoming?.x ?? 0),
				y: end.y + (end.incoming?.y ?? 0),
			},
			p3: end,
		}
		const leftPiece = {
			p0: start,
			c1: {
				x: start.x + (start.outgoing?.x ?? 0),
				y: start.y + (start.outgoing?.y ?? 0),
			},
			c2: {
				x: left.x + (left.incoming?.x ?? 0),
				y: left.y + (left.incoming?.y ?? 0),
			},
			p3: left,
		}
		for (const sample of [0, 0.1, 0.25, 0.4, 0.75, 1]) {
			const reconstructed =
				sample <= 0.4
					? evaluateCubic(leftPiece, sample / 0.4)
					: evaluateCubic(rightPiece, (sample - 0.4) / 0.6)
			expect(reconstructed.x).toBeCloseTo(
				evaluateCubic(originalCubic, sample).x,
				10,
			)
			expect(reconstructed.y).toBeCloseTo(
				evaluateCubic(originalCubic, sample).y,
				10,
			)
		}
	})

	it("rejects endpoint-adjacent cuts without allocating IDs", () => {
		const object = pathObject([
			{ id: "point:a", x: 0, y: 0 },
			{ id: "point:b", x: 20, y: 0 },
		])
		let allocations = 0
		const result = cutDesignSegment(
			documentWith(object),
			{
				objectId: object.id,
				contourId: "contour:path",
				segmentIndex: 0,
				parameter: 0.0005,
			},
			() => String(++allocations),
		)
		expect(result).toMatchObject({ ok: false })
		expect(allocations).toBe(0)
	})
})
