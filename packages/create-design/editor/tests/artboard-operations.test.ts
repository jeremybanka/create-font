import { describe, expect, it } from "vitest"

import {
	allDesignArtboardsBounds,
	createDesignArtboard,
	deleteDesignArtboard,
	designArtboardsAtPoint,
	duplicateDesignArtboard,
	reorderDesignArtboard,
	updateDesignArtboard,
} from "../src/artboard-operations.ts"
import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"

describe("design artboard operations", () => {
	it("creates, duplicates, renames, reorders, and deletes without changing artwork", () => {
		const initial = createInitialDocument()
		const objects = initial.objects
		const created = createDesignArtboard(initial, "artboard:two", {
			x: 700,
			y: 20,
			width: 300,
			height: 200,
		})
		expect(created.document.objects).toBe(objects)
		expect(created.activeArtboardId).toBe("artboard:two")

		const duplicated = duplicateDesignArtboard(
			created.document,
			"artboard:two",
			"artboard:three",
		)
		expect(duplicated.document.artboards[2]).toMatchObject({
			id: "artboard:three",
			name: "Artboard 2 copy",
			x: 748,
			y: 68,
		})
		const renamed = updateDesignArtboard(
			duplicated.document,
			"artboard:three",
			{ name: "Packaging" },
		)
		const reordered = reorderDesignArtboard(renamed, "artboard:three", 0)
		expect(reordered.artboards.map(({ id }) => id)).toEqual([
			"artboard:three",
			"artboard:page",
			"artboard:two",
		])
		const deleted = deleteDesignArtboard(reordered, "artboard:three")!
		expect(deleted.document.artboards.map(({ id }) => id)).toEqual([
			"artboard:page",
			"artboard:two",
		])
		expect(deleted.document.objects).toBe(objects)
	})

	it("moves only artwork intersecting the artboard when explicitly enabled", () => {
		const initial = createInitialDocument()
		const outside = {
			...initial.objects[0]!,
			id: "object:outside",
			geometry: {
				kind: "rectangle" as const,
				x: 900,
				y: 900,
				width: 20,
				height: 20,
			},
		}
		const document = { ...initial, objects: [...initial.objects, outside] }
		const stationary = updateDesignArtboard(document, "artboard:page", {
			x: 100,
			y: -50,
		})
		expect(stationary.objects).toBe(document.objects)

		const moved = updateDesignArtboard(
			document,
			"artboard:page",
			{ x: 100, y: -50 },
			{ moveIntersectingArtwork: true },
		)
		expect(moved.objects.slice(0, 2).map(({ transform }) => transform)).toEqual(
			initial.objects.map(({ transform }) => ({
				...transform,
				e: transform.e + 100,
				f: transform.f - 50,
			})),
		)
		expect(moved.objects[2]).toBe(outside)
	})

	it("keeps every canonical action in one undo step", () => {
		const initial = createInitialDocument()
		const created = createDesignArtboard(initial, "artboard:two").document
		const state = createDesignEditorState({
			document: initial,
			persistence: createDesignPersistenceState(null),
			name: "artboard-history-test",
		})
		state.actions.commitDocument(created)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(initial)
		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(created)
	})

	it("navigates overlapping artboards and computes fit-all bounds", () => {
		const initial = createInitialDocument()
		const document = createDesignArtboard(initial, "artboard:overlap", {
			x: 500,
			y: -100,
			width: 300,
			height: 300,
		}).document
		expect(
			designArtboardsAtPoint(document.artboards, { x: 550, y: 100 }).map(
				({ id }) => id,
			),
		).toEqual(["artboard:page", "artboard:overlap"])
		expect(allDesignArtboardsBounds(document.artboards)).toEqual({
			x: 0,
			y: -100,
			width: 800,
			height: 892,
		})
	})

	it("refuses to remove the document's final artboard", () => {
		expect(
			deleteDesignArtboard(createInitialDocument(), "artboard:page"),
		).toBeNull()
	})
})
