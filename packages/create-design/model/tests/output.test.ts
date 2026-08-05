import { describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import { createDesignBlend } from "../src/blends.ts"
import {
	designOutputLayerForEntity,
	projectDesignOutput,
} from "../src/output.ts"

describe("design output projection", () => {
	it("flattens nested layer paint order, effective state, and live blends", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const back = { ...source, id: "object:back", name: "Back" }
		const nested = { ...source, id: "object:nested", name: "Nested" }
		const hidden = { ...source, id: "object:hidden", name: "Hidden" }
		const front = { ...source, id: "object:front", name: "Front" }
		const blend = createDesignBlend(
			"blend:across-layers",
			"Across layers",
			back,
			front,
			1,
		)
		const document = {
			...initial,
			objects: [front, hidden, nested, back],
			blends: [blend],
			layers: [
				{
					id: "layer:back",
					name: "Back layer",
					children: [
						{ kind: "object" as const, id: back.id },
						{ kind: "group" as const, id: "group:nested" },
					],
				},
				{
					id: "layer:hidden",
					name: "Hidden layer",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:front",
					name: "Front layer",
					locked: true,
					children: [{ kind: "group" as const, id: "group:front" }],
				},
			],
			groups: [
				{
					id: "group:nested",
					name: "Nested group",
					children: [{ kind: "object" as const, id: nested.id }],
				},
				{
					id: "group:front",
					name: "Front group",
					children: [{ kind: "object" as const, id: front.id }],
				},
			],
		}

		const projection = projectDesignOutput(document)

		expect(projection.objects.map(({ id }) => id)).toEqual([
			"object:back",
			"object:nested",
			"object:blend:across-layers:step:1",
			"object:front",
		])
		expect(projection.byObjectId.get(nested.id)?.groupIds).toEqual([
			"group:nested",
		])
		expect(
			projection.byObjectId.get("object:blend:across-layers:step:1"),
		).toMatchObject({
			layer: { id: "layer:front" },
			groupIds: ["group:front"],
			object: { locked: true },
			source: { kind: "blend", blendId: blend.id },
		})
		expect(designOutputLayerForEntity(projection, blend.id)?.id).toBe(
			"layer:front",
		)
		expect(
			document.objects.every((object) => object.locked === undefined),
		).toBe(true)
	})
})
