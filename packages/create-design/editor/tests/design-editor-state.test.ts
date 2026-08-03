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
			...left.silo.getState(left.states.documentAtom),
			title: "Changed",
		})

		expect(left.silo.getState(left.states.documentAtom).title).toBe("Changed")
		expect(right.silo.getState(right.states.documentAtom).title).toBe("Right")
		expect(
			right.silo.inspectTimeline(right.timelines.documentTimeline),
		).toEqual({
			at: 0,
			length: 0,
		})
	})

	it("commits, undoes, redoes, and clears history on reset", () => {
		const state = stateFor("Initial")
		const initial = state.silo.getState(state.states.documentAtom)
		const edited = { ...initial, title: "Edited" }
		state.actions.commitDocument(edited)

		expect(
			state.silo.inspectTimeline(state.timelines.documentTimeline),
		).toEqual({
			at: 1,
			length: 1,
		})
		state.silo.undo(state.timelines.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(initial)
		state.silo.redo(state.timelines.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(edited)

		const replacement = { ...initial, title: "External" }
		state.actions.resetDocument(replacement)
		expect(state.silo.getState(state.states.documentAtom)).toBe(replacement)
		expect(
			state.silo.inspectTimeline(state.timelines.documentTimeline),
		).toEqual({
			at: 0,
			length: 0,
		})
	})

	it("loads an external document and persistence revision atomically", () => {
		const state = stateFor("Initial")
		const observed = vi.fn()
		const unsubscribe = state.silo.subscribe(
			state.states.snapshotSelector,
			() => {
				observed(
					state.silo.getState(state.states.documentAtom).title,
					state.silo.getState(state.states.persistenceAtom).durableRevision,
				)
			},
		)
		state.actions.loadExternalDocument({
			document: {
				...state.silo.getState(state.states.documentAtom),
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
