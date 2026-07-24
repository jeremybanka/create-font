import { describe, expect, it } from "vitest"
import { validatePdf } from "mondrian.pdf"

import { createInitialDocument } from "../src/document.ts"
import { createPdfIr, exportPdf, pdfContentStream } from "../src/pdf.ts"

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
		expect(ir.objects).toHaveLength(5)
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
		expect(content).toContain("70 722 130 692 160 672 c")
		expect(content).toContain("f*")
		expect(content).not.toMatch(/(^|\n)S($|\n)/)
	})
})
