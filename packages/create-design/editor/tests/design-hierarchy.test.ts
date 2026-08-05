import { describe, expect, it } from "vitest"

import {
	appendDesignHierarchyObjects,
	designSelectInteraction,
	designSelectionUnitAtObject,
	groupDesignSelection,
	moveDesignHierarchyNode,
	normalizeDesignSelection,
	removeDesignHierarchyObjects,
	replaceDesignHierarchyObject,
	stackDesignSelection,
	ungroupDesignSelection,
} from "../src/design-hierarchy.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import { translateObject } from "@create-design/model"

const fixture = () => {
	const document = createInitialDocument()
	const first = document.objects[0]!
	return {
		...document,
		objects: [
			first,
			{ ...first, id: "object:middle", name: "Middle" },
			{ ...first, id: "object:front", name: "Front" },
		],
		layers: document.layers.map((layer) => ({
			...layer,
			children: [
				{ kind: "object" as const, id: "object:coral" },
				{ kind: "object" as const, id: "object:middle" },
				{ kind: "object" as const, id: "object:front" },
			],
		})),
	}
}

const multiLayerFixture = () => {
	const document = fixture()
	return {
		...document,
		layers: [
			{
				id: "layer:back",
				name: "Back",
				children: [{ kind: "object" as const, id: "object:coral" }],
			},
			{
				id: "layer:front",
				name: "Front",
				children: [
					{ kind: "object" as const, id: "object:middle" },
					{ kind: "object" as const, id: "object:front" },
				],
			},
		],
	}
}

describe("design hierarchy commands", () => {
	it("inserts new objects into an explicit layer or group and derives paint order", () => {
		const document = multiLayerFixture()
		const newObject = {
			...document.objects[0]!,
			id: "object:new",
			name: "New",
		}
		const appendedToBack = appendDesignHierarchyObjects(
			{ ...document, objects: [...document.objects, newObject] },
			[newObject.id],
			{ layerId: "layer:back", groupId: null },
		)
		expect(appendedToBack.layers[0]?.children).toEqual([
			{ kind: "object", id: "object:coral" },
			{ kind: "object", id: "object:new" },
		])
		expect(appendedToBack.objects.map(({ id }) => id)).toEqual([
			"object:coral",
			"object:new",
			"object:middle",
			"object:front",
		])

		const grouped = groupDesignSelection(
			appendedToBack,
			["object:coral", "object:new"],
			() => "back",
		)
		if (grouped === null) throw new Error("Expected back-layer group.")
		const nestedObject = {
			...document.objects[0]!,
			id: "object:nested",
			name: "Nested",
		}
		const appendedToGroup = appendDesignHierarchyObjects(
			{
				...grouped.document,
				objects: [...grouped.document.objects, nestedObject],
			},
			[nestedObject.id],
			{ layerId: "layer:back", groupId: "group:back" },
		)
		expect(appendedToGroup.groups[0]?.children.at(-1)).toEqual({
			kind: "object",
			id: "object:nested",
		})
		expect(appendedToGroup.objects.map(({ id }) => id)).toEqual([
			"object:coral",
			"object:new",
			"object:nested",
			"object:middle",
			"object:front",
		])
	})

	it("rejects grouping and stacking selections that cross layer boundaries", () => {
		const document = multiLayerFixture()
		expect(
			groupDesignSelection(
				document,
				["object:coral", "object:middle"],
				() => "cross-layer",
			),
		).toBeNull()
		expect(
			stackDesignSelection(
				document,
				["object:coral", "object:middle"],
				"front",
			),
		).toBeNull()
		expect(document.layers).toEqual(multiLayerFixture().layers)
	})

	it("reparents complete objects and groups across layers without changing authored entities", () => {
		const document = multiLayerFixture()
		const coral = document.objects.find(({ id }) => id === "object:coral")!
		const moved = moveDesignHierarchyNode(
			document,
			{ kind: "object", id: coral.id },
			{ kind: "layer", id: "layer:front" },
			1,
		)
		expect(moved).toMatchObject({
			selection: [coral.id],
			layerId: "layer:front",
			parent: { kind: "layer", id: "layer:front" },
		})
		expect(moved?.document.layers).toEqual([
			{ id: "layer:back", name: "Back", children: [] },
			{
				id: "layer:front",
				name: "Front",
				children: [
					{ kind: "object", id: "object:middle" },
					{ kind: "object", id: "object:coral" },
					{ kind: "object", id: "object:front" },
				],
			},
		])
		expect(moved?.document.objects.map(({ id }) => id)).toEqual([
			"object:middle",
			"object:coral",
			"object:front",
		])
		expect(moved?.document.objects[1]).toBe(coral)

		const grouped = groupDesignSelection(
			moved!.document,
			["object:coral", "object:front"],
			() => "move",
		)!
		const movedGroup = moveDesignHierarchyNode(
			grouped.document,
			{ kind: "group", id: "group:move" },
			{ kind: "layer", id: "layer:back" },
			0,
		)
		expect(movedGroup?.document.layers[0]?.children).toEqual([
			{ kind: "group", id: "group:move" },
		])
		expect(movedGroup?.selection).toEqual(["object:coral", "object:front"])
		expect(movedGroup?.document.groups[0]).toBe(grouped.document.groups[0])
	})

	it("rejects cycles and hidden or locked hierarchy move boundaries before mutation", () => {
		const document = multiLayerFixture()
		const nested = {
			...document,
			layers: document.layers.map((layer) =>
				layer.id === "layer:front"
					? {
							...layer,
							children: [{ kind: "group" as const, id: "group:outer" }],
						}
					: layer,
			),
			groups: [
				{
					id: "group:outer",
					name: "Outer",
					children: [{ kind: "group" as const, id: "group:inner" }],
				},
				{
					id: "group:inner",
					name: "Inner",
					children: [
						{ kind: "object" as const, id: "object:middle" },
						{ kind: "object" as const, id: "object:front" },
					],
				},
			],
		}
		expect(() =>
			moveDesignHierarchyNode(
				nested,
				{ kind: "group", id: "group:outer" },
				{ kind: "group", id: "group:inner" },
				0,
			),
		).toThrow("descendants")
		expect(() =>
			moveDesignHierarchyNode(
				{
					...document,
					layers: document.layers.map((layer) =>
						layer.id === "layer:front" ? { ...layer, locked: true } : layer,
					),
				},
				{ kind: "object", id: "object:coral" },
				{ kind: "layer", id: "layer:front" },
				0,
			),
		).toThrow("Unlock Front")
		expect(() =>
			moveDesignHierarchyNode(
				{
					...document,
					layers: document.layers.map((layer) =>
						layer.id === "layer:back" ? { ...layer, hidden: true } : layer,
					),
				},
				{ kind: "object", id: "object:coral" },
				{ kind: "layer", id: "layer:front" },
				0,
			),
		).toThrow("Show Back")
	})

	it("groups and ungroups children without changing their authored state", () => {
		const document = fixture()
		const before = document.objects.map((object) => ({ ...object }))
		const grouped = groupDesignSelection(
			document,
			["object:coral", "object:middle"],
			() => "selection",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		expect(grouped.document.layers[0]?.children).toEqual([
			{ kind: "group", id: "group:selection" },
			{ kind: "object", id: "object:front" },
		])
		expect(grouped.document.groups).toEqual([
			{
				id: "group:selection",
				name: "Group 1",
				children: [
					{ kind: "object", id: "object:coral" },
					{ kind: "object", id: "object:middle" },
				],
			},
		])
		expect(grouped.document.objects).toEqual(before)

		const ungrouped = ungroupDesignSelection(
			grouped.document,
			grouped.selection,
		)
		expect(ungrouped?.document.layers[0]?.children).toEqual(
			document.objects.map((object) => ({ kind: "object", id: object.id })),
		)
		expect(ungrouped?.document.groups).toEqual([])
		expect(ungrouped?.document.objects).toEqual(before)
	})

	it("moves a group as one stacking unit without rewriting siblings", () => {
		const document = fixture()
		const grouped = groupDesignSelection(
			document,
			["object:coral", "object:middle"],
			() => "selection",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		const sibling = grouped.document.objects[2]
		const front = stackDesignSelection(
			grouped.document,
			grouped.selection,
			"front",
		)
		expect(front?.document.layers[0]?.children).toEqual([
			{ kind: "object", id: "object:front" },
			{ kind: "group", id: "group:selection" },
		])
		expect(front?.document.objects.map((object) => object.id)).toEqual([
			"object:front",
			"object:coral",
			"object:middle",
		])
		expect(front?.document.objects[0]).toBe(sibling)
	})

	it("moves equal multi-object selections deterministically one level", () => {
		const document = fixture()
		const forward = stackDesignSelection(
			document,
			["object:coral", "object:middle"],
			"forward",
		)
		expect(forward?.document.objects.map((object) => object.id)).toEqual([
			"object:front",
			"object:coral",
			"object:middle",
		])
		const backward = stackDesignSelection(
			forward!.document,
			forward!.selection,
			"backward",
		)
		expect(backward?.document.objects.map((object) => object.id)).toEqual([
			"object:coral",
			"object:middle",
			"object:front",
		])
	})

	it("keeps hierarchy references coherent as grouped objects change", () => {
		const document = fixture()
		const grouped = groupDesignSelection(
			document,
			["object:coral", "object:middle"],
			() => "selection",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		const replaced = replaceDesignHierarchyObject(
			grouped.document,
			"object:coral",
			["object:fill", "object:outline"],
		)
		expect(replaced.groups?.[0]?.children).toEqual([
			{ kind: "object", id: "object:fill" },
			{ kind: "object", id: "object:outline" },
			{ kind: "object", id: "object:middle" },
		])
		const removed = removeDesignHierarchyObjects(
			replaced,
			new Set(["object:fill", "object:outline", "object:middle"]),
		)
		expect(removed.groups).toEqual([])
		expect(removed.layers[0]?.children).toEqual([
			{ kind: "object", id: "object:front" },
		])
		const appended = appendDesignHierarchyObjects(
			{
				...removed,
				objects: [
					...removed.objects,
					{ ...removed.objects[0]!, id: "object:new", name: "New" },
				],
			},
			["object:new"],
			{ layerId: removed.layers[0]!.id, groupId: null },
		)
		expect(appended.layers[0]?.children.at(-1)).toEqual({
			kind: "object",
			id: "object:new",
		})
	})

	it("turns a normal member hit into one rigid group interaction and exact undo", () => {
		const grouped = groupDesignSelection(
			fixture(),
			["object:coral", "object:middle"],
			() => "selection",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		const interaction = designSelectInteraction(
			grouped.document,
			[],
			"object:middle",
		)
		expect(interaction?.unit).toMatchObject({
			kind: "group",
			id: "group:selection",
			name: "Group 1",
			objectIds: ["object:coral", "object:middle"],
		})
		expect(interaction?.objects.map(({ id }) => id)).toEqual([
			"object:coral",
			"object:middle",
		])
		const moved = {
			...grouped.document,
			objects: grouped.document.objects.map((object) =>
				interaction?.selection.includes(object.id)
					? translateObject(object, 17, -9)
					: object,
			),
		}
		const before = grouped.document.objects.slice(0, 2).map((object) => ({
			x: object.transform.e,
			y: object.transform.f,
		}))
		const after = moved.objects.slice(0, 2).map((object) => ({
			x: object.transform.e,
			y: object.transform.f,
		}))
		expect(after).toEqual(before.map(({ x, y }) => ({ x: x + 17, y: y - 9 })))
		const state = createDesignEditorState({
			document: grouped.document,
			persistence: createDesignPersistenceState(null),
			name: "hierarchy-history-test",
		})
		state.actions.commitDocument(moved)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			grouped.document,
		)
	})

	it("resolves nested units by explicit group scope and never partially selects", () => {
		const inner = groupDesignSelection(
			fixture(),
			["object:coral", "object:middle"],
			() => "inner",
		)
		if (inner === null) throw new Error("Expected inner group.")
		const outer = groupDesignSelection(
			inner.document,
			[...inner.selection, "object:front"],
			() => "outer",
		)
		if (outer === null) throw new Error("Expected outer group.")
		expect(
			designSelectionUnitAtObject(outer.document, "object:coral"),
		).toMatchObject({ id: "group:outer", objectIds: outer.selection })
		expect(
			designSelectionUnitAtObject(
				outer.document,
				"object:coral",
				"group:outer",
			),
		).toMatchObject({ id: "group:inner", objectIds: inner.selection })
		expect(
			designSelectionUnitAtObject(
				outer.document,
				"object:coral",
				"group:inner",
			),
		).toMatchObject({ id: "object:coral", objectIds: ["object:coral"] })
		expect(normalizeDesignSelection(outer.document, ["object:middle"])).toEqual(
			outer.selection,
		)
	})

	it("keeps hidden descendants in the rigid batch and reports locked descendants", () => {
		const document = fixture()
		const guarded = {
			...document,
			objects: document.objects.map((object, index) =>
				index === 0
					? { ...object, hidden: true }
					: index === 1
						? { ...object, locked: true }
						: object,
			),
		}
		const grouped = groupDesignSelection(
			guarded,
			["object:coral", "object:middle"],
			() => "guarded",
		)
		const interaction = designSelectInteraction(
			grouped!.document,
			[],
			"object:middle",
		)
		expect(interaction?.objects.map(({ id }) => id)).toEqual([
			"object:coral",
			"object:middle",
		])
		expect(interaction?.lockedObject?.id).toBe("object:middle")
	})

	it("rejects partial group selection when an effective descendant is unavailable", () => {
		const grouped = groupDesignSelection(
			fixture(),
			["object:coral", "object:middle"],
			() => "guarded",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		const eligibleObjectIds = new Set(["object:coral", "object:front"])

		expect(
			normalizeDesignSelection(
				grouped.document,
				["object:coral"],
				null,
				eligibleObjectIds,
			),
		).toEqual([])
		expect(
			designSelectInteraction(
				grouped.document,
				[],
				"object:coral",
				null,
				false,
				eligibleObjectIds,
			),
		).toBeNull()
	})
})
