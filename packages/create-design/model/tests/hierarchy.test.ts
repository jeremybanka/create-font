import { describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import {
	designObjectEffectiveState,
	projectDesignEffectiveHierarchy,
} from "../src/hierarchy.ts"

describe("effective design hierarchy", () => {
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
