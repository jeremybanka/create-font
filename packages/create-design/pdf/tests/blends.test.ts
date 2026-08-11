import { describe, expect, it } from "vitest"

import { createDesignBlend } from "@create-design/model"
import type { DesignDocument, DesignObject } from "@create-design/source"
import {
	createPdfProjectionGraph,
	PdfBlendProjectionError,
	preflightPdfExport,
} from "../src/index.ts"

const endpoint = (id: string, x: number): DesignObject => ({
	id,
	name: id,
	geometry: {
		kind: "path",
		contours: [
			{
				id: `${id}:contour`,
				closed: true,
				points: [
					{ id: `${id}:a`, x, y: 0 },
					{ id: `${id}:b`, x: x + 10, y: 0 },
					{ id: `${id}:c`, x: x + 10, y: 10 },
				],
			},
		],
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: { fill: { swatchId: "swatch:black" } },
})

const fixture = (): DesignDocument => {
	const start = endpoint("object:start", 0)
	const end = endpoint("object:end", 30)
	return {
		format: "create-design.document",
		version: 8,
		title: "PDF blend",
		artboards: [
			{ id: "artboard:one", name: "One", x: 0, y: 0, width: 100, height: 100 },
		],
		swatches: [
			{
				id: "swatch:black",
				name: "Black",
				source: { space: "rgb", r: 0, g: 0, b: 0 },
			},
		],
		objects: [start, end],
		blends: [createDesignBlend("blend:pdf", "PDF", start, end, 2)],
		layers: [
			{
				id: "layer:artwork",
				name: "Artwork",
				children: [
					{ kind: "object", id: start.id },
					{ kind: "object", id: end.id },
				],
			},
		],
		groups: [],
		guides: [],
	}
}

describe("PDF live blend lowering", () => {
	it("lowers intermediate steps to ordinary deterministic path streams", () => {
		const projection = createPdfProjectionGraph().project(fixture())
		expect(
			preflightPdfExport(fixture(), fixture().artboards[0]!).capabilities,
		).toContain("vector.live-blend")
		expect(projection.page.objectProjections.map(({ id }) => id)).toEqual([
			"object:start",
			"object:blend:pdf:step:1",
			"object:blend:pdf:step:2",
			"object:end",
		])
	})

	it("blocks preflight and throws a typed error for a missing endpoint", () => {
		const document = fixture()
		const missing = { ...document, objects: document.objects.slice(0, 1) }
		const preflight = preflightPdfExport(missing, document.artboards[0]!)
		expect(preflight).toMatchObject({
			decision: "blocked",
			diagnostics: [
				{ code: "pdf.blend.endpoint.missing", entityKind: "blend" },
			],
		})
		expect(() => createPdfProjectionGraph().project(missing)).toThrow(
			PdfBlendProjectionError,
		)
	})

	it("suppresses intermediates when an endpoint is hidden", () => {
		const document = fixture()
		const hidden = {
			...document,
			objects: [
				document.objects[0]!,
				{ ...document.objects[1]!, hidden: true },
			],
		}
		expect(
			createPdfProjectionGraph()
				.project(hidden)
				.page.objectProjections.map(({ id }) => id),
		).toEqual(["object:start"])
	})
})
