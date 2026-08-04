import { stateExistsInStore } from "atom.io/testing"
import { describe, expect, it, vi } from "vitest"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"

const createState = (document = createInitialDocument()) =>
	createDesignEditorState({
		document,
		persistence: createDesignPersistenceState(null),
		name: "normalized-design-document-test",
	})

describe("normalized design document state", () => {
	it("updates one granular fact without notifying unrelated family members", () => {
		const document = createInitialDocument()
		const [first, second] = document.objects
		if (first === undefined || second === undefined)
			throw new Error("Expected two object fixtures.")
		const state = createState(document)
		const firstNameUpdates = vi.fn()
		const secondNameUpdates = vi.fn()
		const stopFirst = state.silo.subscribe(
			state.silo.findState(state.states.objectNameAtoms, first.id),
			firstNameUpdates,
		)
		const stopSecond = state.silo.subscribe(
			state.silo.findState(state.states.objectNameAtoms, second.id),
			secondNameUpdates,
		)
		const renamed = {
			...document,
			objects: document.objects.map((object) =>
				object.id === first.id ? { ...object, name: "Renamed" } : object,
			),
		}

		state.actions.commitDocument(renamed)

		expect(firstNameUpdates).toHaveBeenCalledTimes(1)
		expect(secondNameUpdates).not.toHaveBeenCalled()
		expect(state.silo.getState(state.states.objectNameAtoms, first.id)).toBe(
			"Renamed",
		)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		stopFirst()
		stopSecond()
	})

	it("keys path points independently, including duplicate authored IDs", () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing object fixture.")
		const firstPoint = { id: "point:duplicate", x: 0, y: 0 }
		const secondPoint = { id: "point:duplicate", x: 20, y: 0 }
		const pathObject = {
			...first,
			geometry: {
				kind: "path" as const,
				contours: [
					{
						id: "contour:test",
						closed: false,
						points: [firstPoint, secondPoint],
					},
				],
			},
		}
		const document = { ...initial, objects: [pathObject] }
		const state = createState(document)
		const firstUpdates = vi.fn()
		const secondUpdates = vi.fn()
		const stopFirst = state.silo.subscribe(
			state.silo.findState(state.states.pointAtoms, [
				first.id,
				"contour:test",
				"point:duplicate",
				0,
			]),
			firstUpdates,
		)
		const stopSecond = state.silo.subscribe(
			state.silo.findState(state.states.pointAtoms, [
				first.id,
				"contour:test",
				"point:duplicate",
				1,
			]),
			secondUpdates,
		)
		const movedFirstPoint = { ...firstPoint, x: 5 }
		const moved = {
			...document,
			objects: [
				{
					...pathObject,
					geometry: {
						...pathObject.geometry,
						contours: [
							{
								...pathObject.geometry.contours[0]!,
								points: [movedFirstPoint, secondPoint],
							},
						],
					},
				},
			],
		}

		state.actions.commitDocument(moved)

		expect(firstUpdates).toHaveBeenCalledTimes(1)
		expect(secondUpdates).not.toHaveBeenCalled()
		expect(state.silo.getState(state.states.documentSelector)).toEqual(moved)
		stopFirst()
		stopSecond()
	})

	it("disposes removed entity facts and restores them with one undo", () => {
		const initial = createInitialDocument()
		const removed = initial.objects[0]
		if (removed === undefined) throw new Error("Missing object fixture.")
		const state = createState(initial)

		state.actions.commitDocument({
			...initial,
			objects: initial.objects.slice(1),
		})

		expect(
			stateExistsInStore(
				state.silo.store,
				state.states.objectNameAtoms,
				removed.id,
			),
		).toBe(false)
		state.silo.undo(state.documentTimeline)
		expect(
			stateExistsInStore(
				state.silo.store,
				state.states.objectNameAtoms,
				removed.id,
			),
		).toBe(true)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(initial)
	})
})
