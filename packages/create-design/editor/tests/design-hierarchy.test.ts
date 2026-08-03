import { describe, expect, it } from "vitest"

import {
	appendDesignHierarchyObjects,
	designSelectInteraction,
	designSelectionUnitAtObject,
	groupDesignSelection,
	normalizeDesignSelection,
	removeDesignHierarchyObjects,
	replaceDesignHierarchyObject,
	stackDesignSelection,
	ungroupDesignSelection,
} from "../src/design-hierarchy.ts"
import { createInitialDocument } from "../src/document.ts"
import {
	createDesignHistory,
	reduceDesignHistory,
} from "../src/design-history.ts"
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
	}
}

describe("design hierarchy commands", () => {
	it("groups and ungroups children without changing their authored state", () => {
		const document = fixture()
		const before = document.objects.map((object) => ({ ...object }))
		const grouped = groupDesignSelection(
			document,
			["object:coral", "object:middle"],
			() => "selection",
		)
		if (grouped === null) throw new Error("Expected grouping to succeed.")
		expect(grouped.document.scene).toEqual([
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
		expect(ungrouped?.document.scene).toEqual(
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
		expect(front?.document.scene).toEqual([
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
		expect(removed.scene).toEqual([{ kind: "object", id: "object:front" }])
		const appended = appendDesignHierarchyObjects(removed, ["object:new"])
		expect(appended.scene?.at(-1)).toEqual({
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
		const committed = reduceDesignHistory(
			createDesignHistory(grouped.document),
			{
				type: "commit",
				document: moved,
			},
		)
		expect(reduceDesignHistory(committed, { type: "undo" }).present).toEqual(
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
})
