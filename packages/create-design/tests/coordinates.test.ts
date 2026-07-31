import { describe, expect, it } from "vitest"

import {
	canvasToDocumentPoint,
	documentToCanvasPoint,
	documentToInterchangePoint,
	documentToInterchangeVector,
	documentToPdfPoint,
	documentToPdfTransform,
	interchangeToDocumentPoint,
	interchangeToDocumentVector,
	pdfToDocumentPoint,
} from "../src/coordinates.ts"

describe("design coordinate boundaries", () => {
	it("projects the global document plane into canvas world coordinates losslessly", () => {
		const documentPoint = { x: -128.5, y: 2048.25 }
		const canvasPoint = documentToCanvasPoint(documentPoint)
		expect(canvasPoint).toEqual(documentPoint)
		expect(canvasToDocumentPoint(canvasPoint)).toEqual(documentPoint)
	})

	it("round-trips page-independent Y-up clipboard points and vectors", () => {
		const point = { x: 125, y: 740 }
		const vector = { x: -12, y: 35 }
		expect(documentToInterchangePoint(point)).toEqual({ x: 125, y: -740 })
		expect(
			interchangeToDocumentPoint(documentToInterchangePoint(point)),
		).toEqual(point)
		expect(documentToInterchangeVector(vector)).toEqual({ x: -12, y: -35 })
		expect(
			interchangeToDocumentVector(documentToInterchangeVector(vector)),
		).toEqual(vector)
	})

	it("projects global points through an artboard-relative PDF transform", () => {
		const page = { x: 120, y: -40, width: 612, height: 792 }
		expect(documentToPdfTransform(page)).toEqual({
			a: 1,
			b: 0,
			c: 0,
			d: -1,
			e: -120,
			f: 752,
		})
		for (const point of [
			{ x: 120, y: -40 },
			{ x: 732, y: 752 },
			{ x: -50, y: 900 },
		]) {
			expect(pdfToDocumentPoint(documentToPdfPoint(point, page), page)).toEqual(
				point,
			)
		}
	})
})
