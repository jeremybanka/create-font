import { describe, expect, it } from "vitest"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createDesignPenObject } from "../src/design-pen.ts"
import { createInitialDocument, parseDesignDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import type { DesignDocument } from "../src/types.ts"

describe("design Pen timeline", () => {
	const stateFor = (document: DesignDocument) =>
		createDesignEditorState({
			document,
			persistence: createDesignPersistenceState(null),
			name: "pen-history-test",
		})

	const completedPenDocument = () => {
		const document = createInitialDocument()
		const object = createDesignPenObject({
			id: "object:pen",
			name: "Pen path 3",
			appearance: { fill: { swatchId: "swatch:coral" } },
			points: [
				{ x: 40, y: 50 },
				{
					x: 160,
					y: 90,
					incoming: { x: -30, y: -20 },
					outgoing: { x: 30, y: 20 },
				},
				{ x: 210, y: 180 },
			],
			closed: false,
		})
		if (object === null) throw new TypeError("Expected a Pen object.")
		return { ...document, objects: [...document.objects, object] }
	}

	it("commits a completed contour as one atomic undo/redo operation", () => {
		const initial = createInitialDocument()
		const state = stateFor(initial)
		state.actions.commitDocument(completedPenDocument())
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(state.silo.getState(state.states.documentAtom).objects).toHaveLength(
			initial.objects.length + 1,
		)

		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentAtom).objects).toHaveLength(
			initial.objects.length,
		)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: 1,
		})

		state.silo.redo(state.documentTimeline)
		expect(
			state.silo.getState(state.states.documentAtom).objects.at(-1)?.id,
		).toBe("object:pen")
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
	})

	it("invalidates redo after a different commit", () => {
		const initial = createInitialDocument()
		const state = stateFor(initial)
		state.actions.commitDocument(completedPenDocument())
		state.silo.undo(state.documentTimeline)
		const replacement = { ...initial, title: "Replacement" }
		state.actions.commitDocument(replacement)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(state.silo.getState(state.states.documentAtom)).toBe(replacement)
	})

	it("round-trips completed Pen nodes and handles through persistence", () => {
		const document = completedPenDocument()
		const restored = parseDesignDocument(JSON.stringify(document))
		expect(restored?.objects.at(-1)).toEqual(document.objects.at(-1))
		const geometry = restored?.objects.at(-1)?.geometry
		expect(
			geometry?.kind === "path"
				? geometry.contours[0]?.points[1]?.outgoing
				: undefined,
		).toEqual({ x: 30, y: 20 })
	})
})
