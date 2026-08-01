import { describe, expect, it } from "vitest"

import {
	appendDesignHierarchyObjects,
	groupDesignSelection,
	removeDesignHierarchyObjects,
	replaceDesignHierarchyObject,
	stackDesignSelection,
	ungroupDesignSelection,
} from "../src/design-hierarchy.ts"
import { createInitialDocument } from "../src/document.ts"

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
})
