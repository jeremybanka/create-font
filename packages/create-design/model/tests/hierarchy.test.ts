import { describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import {
	designObjectEffectiveState,
	projectDesignEffectiveHierarchy,
} from "../src/hierarchy.ts"
import { resolveDesignImages } from "../src/images.ts"

describe("effective design hierarchy", () => {
	it("separates a mask path from clipped children without losing hierarchy", () => {
		const initial = createInitialDocument()
		const image = {
			id: "object:image",
			name: "Linked image",
			geometry: {
				kind: "image" as const,
				source: {
					kind: "linked" as const,
					id: "asset:image",
					href: "missing.jpg",
				},
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 80,
				intrinsicHeight: 60,
			},
			transform: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 },
			appearance: {},
		}
		const clip = initial.objects[0]!
		const document = {
			...initial,
			objects: [image, clip],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "group" as const, id: "group:mask" }],
				},
			],
			groups: [
				{
					id: "group:mask",
					name: "Image mask",
					children: [
						{ kind: "object" as const, id: image.id },
						{ kind: "object" as const, id: clip.id },
					],
					clippingPathId: clip.id,
				},
			],
		}
		const hierarchy = projectDesignEffectiveHierarchy(document)
		expect(hierarchy.byObjectId.get(image.id)).toMatchObject({
			maskGroupIds: ["group:mask"],
			clippingForGroupId: null,
		})
		expect(hierarchy.byObjectId.get(clip.id)).toMatchObject({
			maskGroupIds: [],
			clippingForGroupId: "group:mask",
		})
		expect(hierarchy.visibleObjects.map(({ id }) => id)).toEqual([image.id])
		expect(hierarchy.editableObjects.map(({ id }) => id)).toEqual([
			image.id,
			clip.id,
		])
		const [resolution] = resolveDesignImages(document)
		expect(resolution?.diagnostics).toEqual([
			expect.objectContaining({
				code: "image.missing-resource",
				severity: "warning",
				sourceId: "asset:image",
			}),
		])
		expect(resolution?.maskGroupIds).toEqual(["group:mask"])
	})
	it("projects nested groups in layer paint order with independent inherited state", () => {
		const initial = createInitialDocument()
		const coral = initial.objects[0]!
		const cyan = initial.objects[1]!
		const document = {
			...initial,
			objects: [coral, { ...cyan, hidden: true, locked: true }],
			layers: [
				{
					id: "layer:hidden",
					name: "Hidden layer",
					hidden: true,
					children: [{ kind: "group" as const, id: "group:nested" }],
				},
				{
					id: "layer:visible",
					name: "Visible layer",
					children: [{ kind: "object" as const, id: cyan.id }],
				},
			],
			groups: [
				{
					id: "group:nested",
					name: "Nested",
					children: [{ kind: "object" as const, id: coral.id }],
				},
			],
		}
		const projection = projectDesignEffectiveHierarchy(document)
		expect(projection.entries.map((entry) => entry.object.id)).toEqual([
			coral.id,
			cyan.id,
		])
		expect(projection.entries[0]).toMatchObject({
			groupIds: ["group:nested"],
			visible: false,
			locked: false,
			hiddenBy: {
				kind: "layer",
				id: "layer:hidden",
				name: "Hidden layer",
			},
		})
		expect(projection.entries[1]).toMatchObject({
			groupIds: [],
			visible: false,
			locked: true,
			hiddenBy: { kind: "object", id: cyan.id },
			lockedBy: { kind: "object", id: cyan.id },
		})
		expect(projection.visibleObjects).toEqual([])
		expect(projection.editableObjects).toEqual([])
		expect(document.objects[0]).not.toHaveProperty("hidden")
	})

	it("keeps locked-layer objects visible while excluding them from editing", () => {
		const initial = createInitialDocument()
		const document = {
			...initial,
			layers: initial.layers.map((layer) => ({ ...layer, locked: true })),
		}
		const projection = projectDesignEffectiveHierarchy(document)
		expect(projection.visibleObjects).toEqual(initial.objects)
		expect(projection.editableObjects).toEqual([])
		expect(designObjectEffectiveState(document, "object:coral")).toMatchObject({
			visible: true,
			locked: true,
			lockedBy: {
				kind: "layer",
				id: "layer:artwork",
				name: "Artwork",
			},
		})
		expect(initial.objects.every((object) => object.locked === undefined)).toBe(
			true,
		)
	})
})
