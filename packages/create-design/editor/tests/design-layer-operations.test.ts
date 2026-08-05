import { describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import {
	createDesignLayer,
	deleteDesignLayer,
	duplicateDesignLayer,
	renameDesignLayer,
	reorderDesignLayer,
	setDesignLayerLocked,
	setDesignLayerUiColor,
	setDesignLayerVisibility,
} from "../src/design-layer-operations.ts"
import type { DesignDocument } from "../src/types.ts"

function layeredFixture(): DesignDocument {
	const initial = createInitialDocument()
	const first = initial.objects[0]!
	const second = initial.objects[1]!
	return {
		...initial,
		objects: [first, second],
		groups: [
			{
				id: "group:nested",
				name: "Nested",
				children: [{ kind: "object", id: first.id }],
			},
		],
		layers: [
			{
				id: "layer:back",
				name: "Back",
				uiColor: "purple",
				children: [{ kind: "group", id: "group:nested" }],
			},
			{
				id: "layer:front",
				name: "Front",
				uiColor: "teal",
				children: [{ kind: "object", id: second.id }],
			},
		],
		blends: [
			{
				id: "blend:cross-layer",
				name: "Cross layer",
				startObjectId: first.id,
				endObjectId: second.id,
				steps: 2,
				contours: [],
			},
		],
	}
}

describe("design layer operations", () => {
	it("creates, trims, toggles, and reorders empty layers without changing descendants", () => {
		const source = layeredFixture()
		const created = createDesignLayer(source, {
			id: "layer:new",
			name: "  New layer  ",
		})
		const renamed = renameDesignLayer(created, "layer:new", "  Foreground  ")
		const hidden = setDesignLayerVisibility(renamed, "layer:new", false)
		const locked = setDesignLayerLocked(hidden, "layer:new", true)
		const recolored = setDesignLayerUiColor(locked, "layer:new", "lime")
		const lowered = reorderDesignLayer(recolored, "layer:new", "down")

		expect(lowered.layers.map(({ id }) => id)).toEqual([
			"layer:back",
			"layer:new",
			"layer:front",
		])
		expect(lowered.layers[1]).toMatchObject({
			name: "Foreground",
			uiColor: "lime",
			hidden: true,
			locked: true,
			children: [],
		})
		expect(lowered.objects).toEqual(source.objects)
		expect(lowered.groups).toEqual(source.groups)
	})

	it("chooses the first unused standard UI color for new layers", () => {
		const created = createDesignLayer(layeredFixture(), {
			id: "layer:new",
			name: "New layer",
		})
		expect(created.layers.at(-1)?.uiColor).toBe("red")
	})

	it("duplicates a complete layer tree with fresh identities and no cross-layer blend", () => {
		const source = layeredFixture()
		let sequence = 0
		const duplicated = duplicateDesignLayer(
			source,
			"layer:back",
			(kind) => `${kind}:copy:${++sequence}`,
		)
		const duplicate = duplicated.document.layers.at(-1)!
		const clonedGroup = duplicated.document.groups.at(-1)!
		const clonedObject = duplicated.document.objects.at(-1)!

		expect(duplicated.layerId).toBe("layer:copy:3")
		expect(duplicate).toMatchObject({
			id: "layer:copy:3",
			name: "Back copy",
			uiColor: "purple",
			children: [{ kind: "group", id: "group:copy:2" }],
		})
		expect(clonedGroup).toMatchObject({
			id: "group:copy:2",
			children: [{ kind: "object", id: "object:copy:1" }],
		})
		expect(clonedObject).toMatchObject({
			id: "object:copy:1",
			name: `${source.objects[0]!.name} copy`,
		})
		expect(clonedObject.geometry).toEqual(source.objects[0]!.geometry)
		expect(duplicated.document.blends).toEqual(source.blends)
	})

	it("duplicates live blends whose complete endpoint set is inside the layer", () => {
		const source = layeredFixture()
		const second = source.objects[1]!
		const combined: DesignDocument = {
			...source,
			layers: [
				{
					...source.layers[0]!,
					children: [
						...source.layers[0]!.children,
						{ kind: "object", id: second.id },
					],
				},
				{ ...source.layers[1]!, children: [] },
			],
		}
		let sequence = 0
		const duplicated = duplicateDesignLayer(
			combined,
			"layer:back",
			(kind) => `${kind}:copy:${++sequence}`,
		)

		expect(duplicated.document.blends).toHaveLength(2)
		expect(duplicated.document.blends?.[1]).toMatchObject({
			name: "Cross layer copy",
			startObjectId: "object:copy:1",
			endObjectId: "object:copy:2",
		})
	})

	it("deletes a layer atomically and chooses the next paint-order neighbor", () => {
		const source = layeredFixture()
		const deleted = deleteDesignLayer(source, "layer:back")

		expect(deleted.fallbackLayerId).toBe("layer:front")
		expect(deleted.removedObjectIds).toEqual([source.objects[0]!.id])
		expect(deleted.document.layers.map(({ id }) => id)).toEqual(["layer:front"])
		expect(deleted.document.groups).toEqual([])
		expect(deleted.document.objects).toEqual([source.objects[1]])
		expect(deleted.document.blends).toEqual([])
		expect(() => deleteDesignLayer(deleted.document, "layer:front")).toThrow(
			"keep at least one layer",
		)
	})
})
