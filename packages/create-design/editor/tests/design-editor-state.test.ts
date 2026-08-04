import { describe, expect, it, vi } from "vitest"

import {
	createDesignEditorState,
	DESIGN_HISTORY_UNDO_LIMIT,
} from "../src/design-editor-state.ts"
import { createInitialDocument } from "../src/document.ts"
import {
	createDesignPersistenceState,
	type DesignRecoveryDraft,
} from "../src/persistence.ts"

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
		expect(right.silo.inspectTimeline(right.documentTimeline)).toEqual({
			at: 0,
			length: 0,
		})
	})

	it("records logical commits, ignores no-ops, and supports undo and redo", () => {
		const state = stateFor("Initial")
		const initial = state.silo.getState(state.states.documentAtom)
		state.actions.commitDocument(initial)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: 0,
		})

		const edited = { ...initial, title: "Edited" }
		state.actions.commitDocument(edited)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})

		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(initial)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: 1,
		})

		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom)).toBe(edited)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
	})

	it("retains exactly the latest 100 logical undo steps", () => {
		const state = stateFor("0")
		const updates = vi.fn()
		const unsubscribe = state.silo.subscribe(state.documentTimeline, updates)

		for (let index = 1; index <= DESIGN_HISTORY_UNDO_LIMIT + 1; index += 1) {
			state.actions.commitDocument({
				...state.silo.getState(state.states.documentAtom),
				title: String(index),
			})
		}

		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: DESIGN_HISTORY_UNDO_LIMIT,
			length: DESIGN_HISTORY_UNDO_LIMIT,
		})
		expect(updates).toHaveBeenCalledTimes(DESIGN_HISTORY_UNDO_LIMIT + 1)
		expect(updates).toHaveBeenLastCalledWith(
			expect.objectContaining({
				at: DESIGN_HISTORY_UNDO_LIMIT,
				length: DESIGN_HISTORY_UNDO_LIMIT,
				event: expect.objectContaining({
					type: "transaction_outcome",
					token: expect.objectContaining({ key: "commitDocument" }),
				}),
			}),
		)

		for (let index = 0; index < DESIGN_HISTORY_UNDO_LIMIT; index += 1)
			state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom).title).toBe("1")
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: DESIGN_HISTORY_UNDO_LIMIT,
		})

		unsubscribe()
	})

	it("invalidates the redo branch before settling a replacement commit", () => {
		const state = stateFor("Initial")
		const initial = state.silo.getState(state.states.documentAtom)
		state.actions.commitDocument({ ...initial, title: "One" })
		state.actions.commitDocument({ ...initial, title: "Two" })
		state.silo.undo(state.documentTimeline)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 2,
		})

		state.actions.commitDocument({ ...initial, title: "Replacement" })
		expect(state.silo.getState(state.states.documentAtom).title).toBe(
			"Replacement",
		)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 2,
			length: 2,
		})
	})

	it("rebases history for reset, external load, and recovery", () => {
		const state = stateFor("Initial")
		const initial = state.silo.getState(state.states.documentAtom)
		const commit = (title: string) =>
			state.actions.commitDocument({
				...state.silo.getState(state.states.documentAtom),
				title,
			})
		const expectRebased = (title: string) => {
			expect(state.silo.getState(state.states.documentAtom).title).toBe(title)
			expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
				at: 0,
				length: 0,
			})
		}

		commit("Before reset")
		state.actions.resetDocument({ ...initial, title: "Reset" })
		expectRebased("Reset")

		commit("Before external")
		state.actions.loadExternalDocument({
			document: { ...initial, title: "External" },
			durableRevision: "revision-2",
		})
		expectRebased("External")

		commit("Before recovery")
		const recovered = { ...initial, title: "Recovered" }
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "revision-2",
			document: recovered,
			updatedAt: 1,
		}
		state.actions.updatePersistence({ type: "recovery-found", draft })
		state.actions.recoverDocument(recovered)
		expectRebased("Recovered")
		expect(state.silo.getState(state.states.persistenceAtom).status).toBe(
			"dirty",
		)
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
