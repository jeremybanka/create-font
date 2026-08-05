import { describe, expect, it } from "vitest"
import { createInitialDocument } from "@create-design/source"

import {
	makeDesignClippingMask,
	releaseDesignClippingMask,
} from "../src/design-hierarchy.ts"
import {
	placeDesignImage,
	updateDesignImageSource,
} from "../src/placed-images.ts"

describe("placed images and clipping-mask editing", () => {
	it("places and relinks images while preserving dimensions and transforms", () => {
		const initial = createInitialDocument()
		let sequence = 0
		const placed = placeDesignImage(
			initial,
			{
				name: "Product photo",
				source: { kind: "embedded", id: "asset:product" },
				mediaType: "image/jpeg",
				intrinsicWidth: 1200,
				intrinsicHeight: 800,
				x: 144,
				y: 72,
			},
			{ layerId: initial.layers[0]!.id, groupId: null },
			() => `${++sequence}`,
		)
		expect(placed.object).toMatchObject({
			geometry: {
				kind: "image",
				intrinsicWidth: 1200,
				intrinsicHeight: 800,
				source: { kind: "embedded", id: "asset:product" },
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 144, f: 72 },
		})
		const linked = updateDesignImageSource(placed.document, placed.object.id, {
			kind: "linked",
			id: "asset:product",
			href: "../images/product.jpg",
		})
		const object = linked.objects.find(({ id }) => id === placed.object.id)!
		expect(object.geometry).toMatchObject({
			intrinsicWidth: 1200,
			intrinsicHeight: 800,
			source: { kind: "linked", id: "asset:product" },
		})
		expect(object.transform).toBe(placed.object.transform)
	})

	it("makes and releases the topmost vector clipping path in place", () => {
		const initial = createInitialDocument()
		const ids = initial.objects.map(({ id }) => id)
		const masked = makeDesignClippingMask(initial, ids, () => "mask")
		expect(masked).not.toBeNull()
		const group = masked!.document.groups.find(({ id }) => id === "group:mask")!
		expect(group).toMatchObject({
			name: "Clipping Mask 1",
			clippingPathId: initial.objects.at(-1)!.id,
			children: ids.map((id) => ({ kind: "object", id })),
		})
		const released = releaseDesignClippingMask(masked!.document, group.id)
		expect(released?.document.groups[0]).not.toHaveProperty("clippingPathId")
		expect(released?.document.objects).toEqual(initial.objects)
		expect(released?.selection).toEqual(ids)
	})
})
