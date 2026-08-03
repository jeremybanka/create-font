import { describe, expect, it, vi } from "vitest"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"

const stateFor = (title: string) => {
	const document = { ...createInitialDocument(), title }
	return createDesignEditorState({
		document,
		persistence: createDesignPersistenceState(null),
		name: `test-${title}`,
	})
}

describe("create-design atom.io state", () => {
	it("isolates independently instantiated document graphs", () => {
		const left = stateFor("Left")
		const right = stateFor("Right")
		left.actions.commitDocument({
			...left.silo.getState(left.states.documentSelector),
			title: "Changed",
		})

		expect(left.silo.getState(left.states.documentSelector).title).toBe(
			"Changed",
		)
		expect(right.silo.getState(right.states.documentSelector).title).toBe(
			"Right",
		)
		expect(right.silo.getState(right.states.historyMetaSelector)).toEqual({
			canUndo: false,
			canRedo: false,
			pastLength: 0,
			futureLength: 0,
		})
	})

	it("commits, undoes, redoes, and clears history on reset", () => {
		const state = stateFor("Initial")
		const initial = state.silo.getState(state.states.documentSelector)
		const edited = { ...initial, title: "Edited" }
		state.actions.commitDocument(edited)

		expect(state.silo.getState(state.states.historyMetaSelector)).toEqual({
			canUndo: true,
			canRedo: false,
			pastLength: 1,
			futureLength: 0,
		})
		expect(state.actions.navigateDocumentHistory("undo")).toBe(initial)
		expect(state.silo.getState(state.states.documentSelector)).toBe(initial)
		expect(state.actions.navigateDocumentHistory("redo")).toBe(edited)
		expect(state.silo.getState(state.states.documentSelector)).toBe(edited)

		const replacement = { ...initial, title: "External" }
		state.actions.resetDocument(replacement)
		expect(state.silo.getState(state.states.documentSelector)).toBe(replacement)
		expect(state.silo.getState(state.states.historyMetaSelector)).toEqual({
			canUndo: false,
			canRedo: false,
			pastLength: 0,
			futureLength: 0,
		})
	})

	it("retains at most 100 past documents and invalidates redo on commit", () => {
		const state = stateFor("0")
		for (let index = 1; index <= 101; index += 1) {
			state.actions.commitDocument({
				...state.silo.getState(state.states.documentSelector),
				title: String(index),
			})
		}
		expect(state.silo.getState(state.states.historyAtom).past).toHaveLength(100)

		for (let index = 0; index < 100; index += 1)
			expect(state.actions.navigateDocumentHistory("undo")).not.toBeNull()
		expect(state.silo.getState(state.states.documentSelector).title).toBe("1")
		expect(state.actions.navigateDocumentHistory("undo")).toBeNull()

		state.actions.navigateDocumentHistory("redo")
		state.actions.commitDocument({
			...state.silo.getState(state.states.documentSelector),
			title: "Replacement",
		})
		expect(state.silo.getState(state.states.historyMetaSelector).canRedo).toBe(
			false,
		)
	})

	it("loads an external document and persistence revision atomically", () => {
		const state = stateFor("Initial")
		const observed = vi.fn()
		const unsubscribe = state.silo.subscribe(
			state.states.snapshotSelector,
			() => {
				observed(
					state.silo.getState(state.states.documentSelector).title,
					state.silo.getState(state.states.persistenceAtom).durableRevision,
				)
			},
		)
		state.actions.loadExternalDocument({
			document: {
				...state.silo.getState(state.states.documentSelector),
				title: "External",
			},
			durableRevision: "revision-2",
		})

		expect(observed).toHaveBeenLastCalledWith("External", "revision-2")
		expect(state.silo.getState(state.states.persistenceAtom).status).toBe(
			"saved",
		)
		unsubscribe()
	})
})
