import { stateExistsInStore } from "atom.io/testing"
import { describe, expect, it, vi } from "vitest"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import type { DesignDocument, DesignGeometry } from "../src/types.ts"

const createState = (document = createInitialDocument()) =>
	createDesignEditorState({
		document,
		persistence: createDesignPersistenceState(null),
		name: "normalized-design-document-test",
	})

const withFirstObjectGeometry = (
	document: DesignDocument,
	geometry: DesignGeometry,
): DesignDocument => {
	const first = document.objects[0]
	if (first === undefined) throw new Error("Missing object fixture.")
	return {
		...document,
		objects: document.objects.map((object) =>
			object.id === first.id ? { ...object, geometry } : object,
		),
	}
}

describe("normalized design document state", () => {
	it("round-trips optional artboard appearance through normalized state", () => {
		const initial = createInitialDocument()
		const appearance = {
			...initial,
			artboards: initial.artboards.map((artboard) => ({
				...artboard,
				backgroundColor: "#abcdef",
				borderColor: "#123456",
			})),
		}
		const state = createState(appearance)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			appearance,
		)

		state.actions.commitDocument(initial)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(initial)
	})

	it("reads a fresh document projection through composed selector-family members in a transaction", () => {
		const initial = createInitialDocument()
		const state = createState(initial)
		// Regression: https://github.com/jeremybanka/atom.io/issues/525
		const readDocumentProjection = state.silo.transaction<() => DesignDocument>(
			{
				key: "readFreshDocumentProjection",
				do: ({ get }) => get(state.states.documentSelector),
			},
		)

		expect(state.silo.runTransaction(readDocumentProjection)()).toEqual(initial)
	})

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

	it("materializes new empty layers and groups before publishing their IDs", () => {
		const initial = createInitialDocument()
		const state = createState(initial)
		const expanded: DesignDocument = {
			...initial,
			layers: [
				...initial.layers,
				{ id: "layer:empty", name: "Empty", children: [] },
				{
					id: "layer:container",
					name: "Container",
					children: [{ kind: "group", id: "group:empty" }],
				},
			],
			groups: [
				...initial.groups,
				{ id: "group:empty", name: "Empty group", children: [] },
			],
		}

		state.actions.commitDocument(expanded)

		expect(state.silo.getState(state.states.documentSelector)).toEqual(expanded)
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(initial)
		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(expanded)
	})

	it("keeps composed geometry projections current through history and external loading", () => {
		const initial = createInitialDocument()
		const state = createState(initial)
		const pathDocument = withFirstObjectGeometry(initial, {
			kind: "path",
			contours: [
				{
					id: "contour:history",
					closed: true,
					points: [
						{ id: "point:one", x: 0, y: 0 },
						{ id: "point:two", x: 20, y: 20 },
					],
				},
			],
		})

		// Materialize the rectangle dependency set before changing geometry kinds.
		expect(state.silo.getState(state.states.documentSelector)).toEqual(initial)
		state.actions.commitDocument(pathDocument)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			pathDocument,
		)

		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(initial)
		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			pathDocument,
		)

		const externalDocument = withFirstObjectGeometry(
			{ ...pathDocument, title: "Externally loaded" },
			{
				kind: "ellipse",
				centerX: 40,
				centerY: 50,
				radiusX: 20,
				radiusY: 10,
			},
		)
		state.actions.loadExternalDocument({
			document: externalDocument,
			durableRevision: "revision:external",
		})

		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			externalDocument,
		)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: 0,
		})
		expect(state.silo.getState(state.states.persistenceAtom)).toMatchObject({
			durableRevision: "revision:external",
			status: "saved",
		})
	})
})
