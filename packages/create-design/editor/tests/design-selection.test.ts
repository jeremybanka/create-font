import { describe, expect, it } from "vitest"

import {
	directSelectionKey,
	marqueeDirectSelection,
	marqueeObjectIds,
	nearestDirectSelectionTarget,
	selectableObjectIds,
	selectionBounds,
	toggleDirectSelection,
	toggleObjectSelection,
	translateDirectSelection,
	type DesignDirectSelectionTarget,
} from "../src/design-selection.ts"
import { createInitialDocument } from "../src/document.ts"
import { IDENTITY_DESIGN_TRANSFORM } from "@create-design/model"
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
})
