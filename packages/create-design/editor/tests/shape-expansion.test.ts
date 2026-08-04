import { describe, expect, it } from "vitest"

import { createDesignEditorState } from "../src/design-editor-state.ts"
import { createInitialDocument, parseDesignDocument } from "../src/document.ts"
import { createDesignPersistenceState } from "../src/persistence.ts"
import {
	objectSvgPath,
	projectDesignObjectContours,
	rotateObject,
	scaleObject,
	translateObject,
} from "@create-design/model"
import { projectDesignVectorObject } from "../src/design-vector-adapter.ts"
import { pdfObjectContentStream } from "@create-design/pdf"
import {
	exactObjectBounds,
	expandDesignShape,
	shapeExpansionEligibility,
} from "../src/shape-expansion.ts"

describe("live shape expansion", () => {
	it.each(["rectangle", "ellipse"] as const)(
		"expands a transformed %s to equivalent local cubic path geometry",
		(kind) => {
			const document = createInitialDocument()
			const source = document.objects.find(
				(object) => object.geometry.kind === kind,
			)
			if (source === undefined) throw new Error(`Missing ${kind} fixture.`)
			const transformed = rotateObject(
				scaleObject(
					translateObject(source, 17, -23),
					{ x: 100, y: 80 },
					1.25,
					0.75,
				),
				{ x: 200, y: 160 },
				30,
			)
			let sequence = 0
			const expanded = expandDesignShape(
				transformed,
				() => `expansion:${sequence++}`,
			)

			expect(expanded.id).toBe(transformed.id)
			expect(expanded.transform).toBe(transformed.transform)
			expect(expanded.appearance).toBe(transformed.appearance)
			expect(expanded.geometry.kind).toBe("path")
			expect(objectSvgPath(expanded)).toBe(objectSvgPath(transformed))
			expect(pdfObjectContentStream(expanded, document.swatches[1])).toBe(
				pdfObjectContentStream(transformed, document.swatches[1]),
			)
			expect(
				projectDesignObjectContours(expanded).map((contour) => ({
					closed: contour.closed,
					points: contour.points.map(({ id: _id, ...point }) => point),
				})),
			).toEqual(
				projectDesignObjectContours(transformed).map((contour) => ({
					closed: contour.closed,
					points: contour.points.map(({ id: _id, ...point }) => point),
				})),
			)

			const vector = projectDesignVectorObject(document, expanded)
			expect(vector.contours.map((contour) => contour.id)).toEqual([
				"contour:expansion:0",
			])
			expect(vector.contours[0]?.nodes.map((node) => node.id)).toEqual([
				"point:expansion:1",
				"point:expansion:2",
				"point:expansion:3",
				"point:expansion:4",
			])
		},
	)

	it("reports selection, lock, and already-expanded eligibility precisely", () => {
		const document = createInitialDocument()
		expect(shapeExpansionEligibility(document, [])).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Select a live"),
		})
		expect(
			shapeExpansionEligibility(document, ["object:coral", "object:cyan"]),
		).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("exactly one"),
		})
		const locked = {
			...document,
			objects: document.objects.map((object) =>
				object.id === "object:coral" ? { ...object, locked: true } : object,
			),
		}
		expect(shapeExpansionEligibility(locked, ["object:coral"])).toMatchObject({
			eligible: false,
			reason: expect.stringContaining("Unlock"),
		})
		const rectangle = document.objects[0]
		if (rectangle === undefined) throw new Error("Missing rectangle fixture.")
		const path = expandDesignShape(rectangle, () => "path")
		const expanded = {
			...document,
			objects: [path, ...document.objects.slice(1)],
		}
		expect(shapeExpansionEligibility(expanded, ["object:coral"])).toMatchObject(
			{
				eligible: false,
				reason: expect.stringContaining("already ordinary path"),
			},
		)
	})

	it("commits one undo entry, retains object selection, and reuses identities on redo", () => {
		const document = createInitialDocument()
		const rectangle = document.objects[0]
		if (rectangle === undefined) throw new Error("Missing rectangle fixture.")
		let sequence = 0
		const expanded = expandDesignShape(rectangle, () => `history:${sequence++}`)
		const committedDocument = {
			...document,
			objects: document.objects.map((object) =>
				object.id === expanded.id ? expanded : object,
			),
		}
		const state = createDesignEditorState({
			document,
			persistence: createDesignPersistenceState(null),
			name: "shape-expansion-history-test",
		})
		state.actions.commitDocument(committedDocument)
		expect(state.silo.inspectTimeline(state.documentTimeline)).toEqual({
			at: 1,
			length: 1,
		})
		expect(["object:coral"]).toContain(expanded.id)

		state.silo.undo(state.documentTimeline)
		expect(
			state.silo.getState(state.states.documentAtom).objects[0]?.geometry.kind,
		).toBe("rectangle")
		state.silo.redo(state.documentTimeline)
		const redone = state.silo.getState(state.states.documentAtom)
		expect(redone.objects[0]).toBe(expanded)
		expect(
			redone.objects[0]?.geometry.kind === "path"
				? redone.objects[0].geometry.contours[0]?.id
				: undefined,
		).toBe("contour:history:0")
	})

	it("round-trips expanded control identities and exposes exact projected bounds", () => {
		const document = createInitialDocument()
		const ellipse = document.objects[1]
		if (ellipse === undefined) throw new Error("Missing ellipse fixture.")
		let sequence = 0
		const expanded = expandDesignShape(ellipse, () => `saved:${sequence++}`)
		const saved = {
			...document,
			objects: document.objects.map((object) =>
				object.id === expanded.id ? expanded : object,
			),
		}
		const restored = parseDesignDocument(JSON.stringify(saved))
		expect(restored).not.toBeNull()
		expect(restored?.objects[1]).toEqual(expanded)
		expect(exactObjectBounds(expanded)).toEqual({
			x: 248,
			y: 278,
			width: 282,
			height: 282,
		})
	})
})
