import { describe, expect, it } from "vitest"

import {
	assembleDesignDocument,
	parseDesignDocumentText,
	splitDesignDocument,
	validateDesignDocument,
	type DesignDocument,
} from "../src/index.ts"

const document: DesignDocument = {
	format: "create-design.document",
	version: 6,
	title: "Persisted blend",
	artboards: [
		{ id: "artboard:one", name: "One", x: 0, y: 0, width: 100, height: 100 },
	],
	swatches: [],
	objects: [
		{
			id: "object:a",
			name: "A",
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:a",
						closed: false,
						points: [{ id: "point:a", x: 0, y: 0 }],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {},
		},
		{
			id: "object:b",
			name: "B",
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:b",
						closed: false,
						points: [{ id: "point:b", x: 10, y: 10 }],
					},
				],
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {},
		},
	],
	layers: [
		{
			id: "layer:artwork",
			name: "Artwork",
			children: [
				{ kind: "object", id: "object:a" },
				{ kind: "object", id: "object:b" },
			],
		},
	],
	groups: [],
	blends: [
		{
			id: "blend:one",
			name: "One",
			startObjectId: "object:a",
			endObjectId: "object:b",
			steps: 7,
			contours: [
				{
					startContourId: "contour:a",
					endContourId: "contour:b",
					points: [{ startPointId: "point:a", endPointId: "point:b" }],
				},
			],
			locked: true,
		},
	],
	guides: [],
}

describe("persisted live blends", () => {
	it("round-trips stable endpoint references, correspondence, flags, and step count through JSON", () => {
		expect(parseDesignDocumentText(JSON.stringify(document))).toEqual({
			ok: true,
			value: document,
		})
	})

	it("round-trips blends through canonical source directories", () => {
		const split = splitDesignDocument(document)
		if (!split.ok) throw new Error("Expected split to succeed.")
		const assembled = assembleDesignDocument(split.value)
		expect(assembled).toEqual({ ok: true, value: document })
	})

	it("keeps missing endpoints recoverable for the model resolver", () => {
		const missing = {
			...document,
			objects: document.objects.slice(0, 1),
			layers: document.layers.map((layer) => ({
				...layer,
				children: layer.children.slice(0, 1),
			})),
		}
		expect(validateDesignDocument(missing)).toEqual({
			ok: true,
			value: missing,
		})
	})

	it("rejects duplicate blend identities and invalid step counts", () => {
		expect(
			validateDesignDocument({
				...document,
				blends: [...document.blends!, document.blends![0]!],
			}),
		).toMatchObject({
			ok: false,
			errors: [{ code: "directory.duplicate_id", path: "$.blends[1].id" }],
		})
		expect(
			validateDesignDocument({
				...document,
				blends: [{ ...document.blends![0]!, steps: 0 }],
			}),
		).toMatchObject({
			ok: false,
			errors: [{ code: "document.schema", path: "$.blends[0].steps" }],
		})
	})
})
