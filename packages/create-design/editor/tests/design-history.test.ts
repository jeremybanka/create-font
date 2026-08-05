import { describe, expect, it } from "vitest"
import { createDesignBlend } from "@create-design/model"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createDesignPenObject } from "../src/design-pen.ts"
import {
	expandDesignBlend,
	makeDesignBlend,
	updateDesignBlend,
} from "../src/blend-operations.ts"
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
		return {
			...document,
			objects: [...document.objects, object],
			layers: document.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: "object" as const, id: object.id },
				],
			})),
		}
	}

	it("commits a completed contour as one atomic undo/redo operation", () => {
		const initial = createInitialDocument()
		const state = stateFor(initial)
		state.actions.commitDocument(completedPenDocument())
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(
			state.silo.getState(state.states.documentSelector).objects,
		).toHaveLength(initial.objects.length + 1)

		state.silo.undo(state.documentTimeline)
		expect(
			state.silo.getState(state.states.documentSelector).objects,
		).toHaveLength(initial.objects.length)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 0,
			length: 1,
		})

		state.silo.redo(state.documentTimeline)
		expect(
			state.silo.getState(state.states.documentSelector).objects.at(-1)?.id,
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
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			replacement,
		)
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

describe("live blend timeline", () => {
	it("restores exact live options and endpoints after expansion", () => {
		const initial = createInitialDocument()
		let id = 0
		const nextId = () => `history-${++id}`
		const made = makeDesignBlend(
			initial,
			initial.objects.slice(0, 2).map(({ id }) => id),
			nextId,
			6,
		)!
		const configured = updateDesignBlend(made.document, made.blendId, {
			name: "Configured blend",
			steps: 9,
		})!
		const expanded = expandDesignBlend(configured, made.blendId, nextId)!
		const state = createDesignEditorState({
			document: configured,
			persistence: createDesignPersistenceState(null),
			name: "blend-expand-history-test",
		})
		state.actions.commitDocument(expanded.document)
		expect(state.silo.getState(state.states.documentSelector).blends).toEqual(
			[],
		)
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			configured,
		)
	})

	it("persists a blend and restores endpoint-driven updates with undo", () => {
		const initial = createInitialDocument()
		const [start, end] = initial.objects
		if (start === undefined || end === undefined)
			throw new Error("Expected endpoint fixtures.")
		const blend = createDesignBlend("blend:history", "History", start, end, 4)
		const withBlend = { ...initial, blends: [blend] }
		const state = createDesignEditorState({
			document: withBlend,
			persistence: createDesignPersistenceState(null),
			name: "blend-history-test",
		})
		const moved = {
			...withBlend,
			objects: withBlend.objects.map((object) =>
				object.id === end.id
					? { ...object, transform: { ...object.transform, e: 80 } }
					: object,
			),
		}
		state.actions.commitDocument(moved)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(moved)
		state.silo.undo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(
			withBlend,
		)
		state.silo.redo(state.documentTimeline)
		expect(state.silo.getState(state.states.documentSelector)).toEqual(moved)
	})
})
