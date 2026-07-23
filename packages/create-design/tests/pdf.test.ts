import { describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { exportPdf, pdfContentStream } from "../src/pdf.ts"

describe("PDF export", () => {
	it("keeps RGB and CMYK fills as native vector operators", () => {
		const content = pdfContentStream(createInitialDocument())
		expect(content).toContain(" rg")
		expect(content).toContain(" k")
		expect(content).toContain(" c")
		expect(content).toContain("f*")
	})

	it("writes a valid single-page PDF structure and xref", () => {
		const bytes = exportPdf(createInitialDocument())
		const pdf = new TextDecoder().decode(bytes)
		expect(pdf.startsWith("%PDF-1.4")).toBe(true)
		expect(pdf).toContain("/MediaBox [0 0 612 792]")
		expect(pdf).toContain("/Creator (create-design)")
		expect(pdf).toContain("xref")
		expect(pdf.endsWith("%%EOF\n")).toBe(true)
	})
})
