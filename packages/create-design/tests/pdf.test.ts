import { describe, expect, it } from "vitest"
import { validatePdf } from "mondrian.pdf"

import { createInitialDocument } from "../src/document.ts"
import {
	createPdfIr,
	createPdfProjectionGraph,
	exportPdf,
	pdfContentStream,
} from "../src/pdf.ts"

describe("PDF export", () => {
	it("keeps RGB and CMYK fills as native vector operators", () => {
		const content = pdfContentStream(createInitialDocument())
		expect(content).toContain(" rg")
		expect(content).toContain(" k")
		expect(content).toContain(" c")
		expect(content).toContain("f*")
	})

	it("builds a valid mondrian.pdf object graph", () => {
		const ir = createPdfIr(createInitialDocument())
		expect(ir.version).toBe("1.7")
		expect(ir.objects).toHaveLength(8)
		expect(validatePdf(ir)).toEqual([])
	})

	it("serializes the mondrian.pdf IR as a single-page PDF", () => {
		const bytes = exportPdf(createInitialDocument())
		const pdf = new TextDecoder().decode(bytes)
		expect(pdf.startsWith("%PDF-1.7")).toBe(true)
		expect(pdf).toContain("/MediaBox [0 0 612 792]")
		expect(pdf).toContain("/Creator (create-design)")
		expect(pdf).toContain("/Producer (mondrian.pdf)")
		expect(pdf).toContain("xref")
		expect(pdf.endsWith("%%EOF\n")).toBe(true)
	})

	it("exports curved Pen contours with fill-only cubic geometry", () => {
		const document = createInitialDocument()
		const content = pdfContentStream({
			...document,
			objects: [
				{
					id: "object:pen",
					name: "Pen",
					fillId: "swatch:coral",
					contours: [
						{
							closed: false,
							points: [
								{ x: 40, y: 50, outgoing: { x: 30, y: 20 } },
								{ x: 160, y: 120, incoming: { x: -30, y: -20 } },
								{ x: 80, y: 200 },
							],
						},
					],
				},
			],
		})
		expect(content).toContain("1 0 0 -1 0 792 cm")
		expect(content).toContain("70 70 130 100 160 120 c")
		expect(content).toContain("f*")
		expect(content).not.toMatch(/(^|\n)S($|\n)/)
	})

	it("reuses unrelated object projections after a geometry edit", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const object = document.objects[0]!
		const contour = object.contours[0]!
		const point = contour.points[0]!
		const after = graph.project({
			...document,
			objects: [
				{
					...object,
					contours: [
						{
							...contour,
							points: [
								{ ...point, x: point.x + 1 },
								...contour.points.slice(1),
							],
						},
					],
				},
				...document.objects.slice(1),
			],
		})
		expect(after.page.objectProjections[0]).not.toBe(
			before.page.objectProjections[0],
		)
		expect(after.page.objectProjections[1]).toBe(
			before.page.objectProjections[1],
		)
	})

	it("invalidates only consumers of an edited swatch", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const after = graph.project({
			...document,
			swatches: document.swatches.map((swatch) =>
				swatch.id === "swatch:coral"
					? {
							...swatch,
							source: { space: "rgb" as const, r: 10, g: 20, b: 30 },
						}
					: swatch,
			),
		})
		expect(after.page.objectProjections[0]).not.toBe(
			before.page.objectProjections[0],
		)
		expect(after.page.objectProjections[1]).toBe(
			before.page.objectProjections[1],
		)
	})

	it("reuses object streams across stacking and page-size changes", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const reordered = graph.project({
			...document,
			objects: document.objects.toReversed(),
		})
		expect(reordered.page).not.toBe(before.page)
		expect(reordered.page.objectProjections).toEqual(
			before.page.objectProjections.toReversed(),
		)
		const resized = graph.project({
			...document,
			page: { ...document.page, height: document.page.height + 10 },
		})
		expect(resized.page).not.toBe(reordered.page)
		expect(resized.page.objectProjections).toEqual(
			before.page.objectProjections,
		)
	})

	it("keeps page and document projections for non-export state", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const metadata = graph.project({ ...document, title: "Proof title" })
		expect(metadata).not.toBe(before)
		expect(metadata.page).toBe(before.page)
		const uiOnly = graph.project({
			...document,
			title: "Proof title",
			guides: [{ id: "guide:1", axis: "x", value: 20 }],
		})
		expect(uiOnly).toBe(metadata)
	})

	it("serializes deterministically with per-object content streams", () => {
		const document = createInitialDocument()
		expect(exportPdf(document)).toEqual(exportPdf(document))
		const pdf = new TextDecoder().decode(exportPdf(document))
		expect(pdf).toContain("/Contents [")
	})
})
