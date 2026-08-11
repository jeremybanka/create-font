import { describe, expect, it } from "vitest"

import {
	directSelectionKey,
	designCornerAmountFromInwardDrag,
	designInwardDistances,
	isDirectSelectionNodeSelected,
	marqueeDirectSelection,
	marqueeObjectIds,
	nearestDirectSelectionTarget,
	selectableObjectIds,
	reconcileDesignKeyObject,
	shouldPromoteDesignKeyObject,
	selectionBounds,
	toggleDirectSelection,
	toggleDirectObjectSelection,
	toggleObjectSelection,
	translateDirectSelection,
	type DesignDirectSelectionTarget,
} from "../src/design-selection.ts"
import { createInitialDocument } from "../src/document.ts"
import {
	IDENTITY_DESIGN_TRANSFORM,
	projectDesignObjectContours,
} from "@create-design/model"
import type { DesignDocument, DesignObject } from "../src/types.ts"

const path = (overrides: Partial<DesignObject> = {}): DesignObject => ({
	id: "object:path",
	name: "Path",
	geometry: {
		kind: "path",
		contours: [
			{
				id: "contour:path",
				closed: false,
				points: [
					{
						id: "point:a",
						x: 10,
						y: 10,
						outgoing: { x: 10, y: 0 },
					},
					{
						id: "point:b",
						x: 40,
						y: 10,
						incoming: { x: -10, y: 0 },
					},
				],
			},
		],
	},
	transform: IDENTITY_DESIGN_TRANSFORM,
	appearance: {
		stroke: {
			swatchId: "swatch:ink",
			width: 1,
			cap: "butt",
			join: "miter",
			miterLimit: 4,
			dashArray: [],
			dashOffset: 0,
		},
	},
	...overrides,
})

const documentWith = (...objects: readonly DesignObject[]): DesignDocument => ({
	...createInitialDocument(),
	objects,
	layers: [
		{
			id: "layer:test",
			name: "Test",
			children: objects.map((object) => ({
				kind: "object" as const,
				id: object.id,
			})),
		},
	],
})

describe("design selection", () => {
	it("replaces, adds, and subtracts object selection deterministically", () => {
		expect(toggleObjectSelection(["a"], "b", false)).toEqual(["b"])
		expect(toggleObjectSelection(["a"], "b", true)).toEqual(["a", "b"])
		expect(toggleObjectSelection(["a", "b"], "a", true)).toEqual(["b"])
	})

	it("selects every object contour as one additive direct-selection unit", () => {
		const first = toggleDirectObjectSelection(
			[],
			"object:first",
			["a", "b"],
			false,
		)
		expect(first).toEqual([
			{ kind: "contour", objectId: "object:first", contourId: "a" },
			{ kind: "contour", objectId: "object:first", contourId: "b" },
		])
		const second = toggleDirectObjectSelection(
			first,
			"object:second",
			["c"],
			true,
		)
		expect(second).toHaveLength(3)
		expect(
			toggleDirectObjectSelection(second, "object:first", ["a", "b"], true),
		).toEqual([{ kind: "contour", objectId: "object:second", contourId: "c" }])
	})

	it("promotes and reconciles an explicit key object", () => {
		expect(
			shouldPromoteDesignKeyObject(["a", "b"], ["a", "b"], "a", false),
		).toBe(true)
		expect(shouldPromoteDesignKeyObject(["a", "b"], ["b"], "b", false)).toBe(
			false,
		)
		expect(shouldPromoteDesignKeyObject(["a", "b"], ["b"], "b", true)).toBe(
			false,
		)
		expect(reconcileDesignKeyObject("b", ["a", "b"], new Set(["b"]))).toBe("b")
		expect(reconcileDesignKeyObject("b", ["a"], new Set(["b"]))).toBeNull()
		expect(reconcileDesignKeyObject("b", ["a", "b"], new Set(["a"]))).toBeNull()
	})

	it("excludes locked and hidden objects from Select All and marquee", () => {
		const visible = path()
		const locked = path({ id: "object:locked", locked: true })
		const hidden = path({ id: "object:hidden", hidden: true })
		expect(selectableObjectIds([visible, locked, hidden])).toEqual([visible.id])
		expect(
			marqueeObjectIds([visible, locked, hidden], {
				minX: 0,
				minY: 0,
				maxX: 100,
				maxY: 100,
			}),
		).toEqual([visible.id])
	})

	it("combines multi-object bounds for one group transform", () => {
		const first = path()
		const second = {
			...path({ id: "object:second" }),
			transform: { ...IDENTITY_DESIGN_TRANSFORM, e: 50 },
		}
		expect(selectionBounds([first, second])).toMatchObject({
			minX: 10,
			maxX: 90,
		})
	})

	it("uses authoritative per-object bounds for selection and marquee", () => {
		const object = path()
		const authoritative = () => ({ minX: -20, minY: -10, maxX: 120, maxY: 80 })
		expect(selectionBounds([object], authoritative)).toEqual(authoritative())
		expect(
			marqueeObjectIds(
				[object],
				{ minX: 110, minY: 70, maxX: 130, maxY: 90 },
				authoritative,
			),
		).toEqual([object.id])
	})

	it("hits nodes, handles, segments, and contours with screen-stable precedence", () => {
		const document = documentWith(path())
		expect(
			nearestDirectSelectionTarget(
				document,
				document.objects,
				{ x: 10, y: 10 },
				1,
			)?.kind,
		).toBe("node")
		expect(
			nearestDirectSelectionTarget(
				document,
				document.objects,
				{ x: 20, y: 10 },
				1,
			)?.kind,
		).toBe("handle")
		expect(
			nearestDirectSelectionTarget(
				document,
				document.objects,
				{ x: 25, y: 10 },
				2,
				{ maxDistancePixels: 4 },
			)?.kind,
		).toBe("segment")
		expect(
			nearestDirectSelectionTarget(
				document,
				document.objects,
				{ x: 25, y: 10 },
				2,
				{ contour: true, maxDistancePixels: 4 },
			)?.kind,
		).toBe("contour")
	})

	it("toggles direct targets and marquee-selects only eligible nodes", () => {
		const node: DesignDirectSelectionTarget = {
			kind: "node",
			objectId: "object:path",
			contourId: "contour:path",
			pointId: "point:a",
		}
		expect(toggleDirectSelection([], node, false)).toEqual([node])
		expect(toggleDirectSelection([node], node, true)).toEqual([])
		const document = documentWith(
			path(),
			path({ id: "object:locked", locked: true }),
		)
		const marquee = marqueeDirectSelection(document, {
			minX: 5,
			minY: 5,
			maxX: 15,
			maxY: 15,
		})
		expect(marquee.map(directSelectionKey)).toEqual([directSelectionKey(node)])
	})

	it("derives selected node paint from node, segment, and contour targets", () => {
		const base = { objectId: "object:path", contourId: "contour:path" }
		expect(
			isDirectSelectionNodeSelected(
				[{ ...base, kind: "node", pointId: "point:a" }],
				base.objectId,
				base.contourId,
				"point:a",
				0,
				3,
			),
		).toBe(true)
		expect(
			isDirectSelectionNodeSelected(
				[{ ...base, kind: "segment", segmentIndex: 0 }],
				base.objectId,
				base.contourId,
				"point:b",
				1,
				3,
			),
		).toBe(true)
		expect(
			isDirectSelectionNodeSelected(
				[{ ...base, kind: "segment", segmentIndex: 0 }],
				base.objectId,
				base.contourId,
				"point:c",
				2,
				3,
			),
		).toBe(false)
		expect(
			isDirectSelectionNodeSelected(
				[{ ...base, kind: "contour" }],
				base.objectId,
				base.contourId,
				"point:c",
				2,
				3,
			),
		).toBe(true)
	})

	it("excludes direct targets inherited from hidden or locked layers", () => {
		const object = path()
		const hidden = documentWith(object)
		const hiddenLayer = {
			...hidden,
			layers: hidden.layers.map((layer) => ({ ...layer, hidden: true })),
		}
		const lockedLayer = {
			...hidden,
			layers: hidden.layers.map((layer) => ({ ...layer, locked: true })),
		}
		const bounds = { minX: 5, minY: 5, maxX: 15, maxY: 15 }
		expect(marqueeDirectSelection(hiddenLayer, bounds)).toEqual([])
		expect(marqueeDirectSelection(lockedLayer, bounds)).toEqual([])
		expect(object.hidden).toBeUndefined()
		expect(object.locked).toBeUndefined()
	})

	it("moves exactly the selected node and handle without touching unrelated geometry", () => {
		const document = documentWith(path())
		const movedNode = translateDirectSelection(
			document,
			[
				{
					kind: "node",
					objectId: "object:path",
					contourId: "contour:path",
					pointId: "point:a",
				},
			],
			{ x: 3, y: 4 },
		)
		if (movedNode.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected a path.")
		expect(movedNode.objects[0].geometry.contours[0]?.points).toEqual([
			{ id: "point:a", x: 13, y: 14, outgoing: { x: 10, y: 0 } },
			{ id: "point:b", x: 40, y: 10, incoming: { x: -10, y: 0 } },
		])
		const movedHandle = translateDirectSelection(
			document,
			[
				{
					kind: "handle",
					objectId: "object:path",
					contourId: "contour:path",
					pointId: "point:a",
					handle: "outgoing",
				},
			],
			{ x: 2, y: 5 },
		)
		if (movedHandle.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected a path.")
		expect(movedHandle.objects[0].geometry.contours[0]?.points[0]).toEqual({
			id: "point:a",
			x: 10,
			y: 10,
			outgoing: { x: 12, y: 5 },
		})
	})

	it("preserves document-space live-corner scale during transformed direct edits", () => {
		const transform = { a: 2, b: 0, c: 0, d: 2, e: 7, f: -4 }
		const object = path({
			transform,
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:path",
						closed: true,
						points: [
							{ id: "point:a", x: 0, y: 0 },
							{
								id: "point:b",
								x: 100,
								y: 0,
								corner: { profile: "circular", amount: 20 },
							},
							{ id: "point:c", x: 100, y: 100 },
						],
					},
				],
			},
		})
		const moved = translateDirectSelection(
			documentWith(object),
			[
				{
					kind: "node",
					objectId: object.id,
					contourId: "contour:path",
					pointId: "point:a",
				},
			],
			{ x: 2, y: 0 },
		).objects[0]!
		expect(moved.transform).toEqual(transform)
		if (moved.geometry.kind !== "path") throw new Error("Expected a path.")
		expect(moved.geometry.contours[0]?.points[0]?.x).toBe(1)
		expect(moved.geometry.contours[0]?.points[1]?.corner).toEqual({
			profile: "circular",
			amount: 20,
		})
		const lowered = projectDesignObjectContours(moved)[0]!
		const entry = lowered.points.find((point) =>
			point.id.includes("point:b::corner:entry"),
		)
		expect(entry?.x).toBeCloseTo(187)
	})

	it("computes directional corner drag distance in document space", () => {
		expect(
			designInwardDistances({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }),
		).toEqual({ start: 5, current: 10 })
		expect(
			designInwardDistances({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: -4, y: 3 }),
		).toEqual({ start: 5, current: 0 })
		expect(
			designInwardDistances({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: -3, y: -4 }),
		).toEqual({ start: 5, current: -5 })
	})

	it("maps the full existing corner amount onto inward handle travel", () => {
		expect(designCornerAmountFromInwardDrag(120, 18, 18)).toBe(120)
		expect(designCornerAmountFromInwardDrag(120, 18, 9)).toBe(60)
		expect(designCornerAmountFromInwardDrag(120, 18, 0)).toBe(0)
		expect(designCornerAmountFromInwardDrag(120, 18, -18)).toBe(0)
		expect(designCornerAmountFromInwardDrag(120, 18, 1e-12)).toBe(0)
		expect(designCornerAmountFromInwardDrag(120, 18, 30)).toBe(132)
	})
})
