import { describe, expect, it } from "vitest"
import { validatePdf } from "mondrian.pdf"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import { createInitialDocument } from "../src/document.ts"
import {
	createPdfIr,
	createPdfProjectionGraph,
	exportPdf,
	pdfContentStream,
	resolvePdfArtboards,
} from "../src/pdf.ts"
import { parsePdfFixture } from "./pdf-parser-fixture.ts"

describe("PDF export", () => {
	const multiArtboardDocument = () => {
		const document = createInitialDocument()
		return {
			...document,
			artboards: [
				{
					id: "artboard:first",
					name: "First",
					x: 0,
					y: 0,
					width: 100,
					height: 200,
					bleed: { top: 10, right: 20, bottom: 30, left: 40 },
				},
				{
					id: "artboard:second",
					name: "Second",
					x: 100,
					y: 20,
					width: 300,
					height: 150,
				},
				{
					id: "artboard:third",
					name: "Third",
					x: 400,
					y: -10,
					width: 50,
					height: 60,
				},
			],
		}
	}

	it("resolves active, selected, ranged, and all scopes in document order", () => {
		const document = multiArtboardDocument()
		expect(
			resolvePdfArtboards(document, { scope: { kind: "all" } }).map(
				({ id }) => id,
			),
		).toEqual(["artboard:first", "artboard:second", "artboard:third"])
		expect(
			resolvePdfArtboards(document, {
				scope: {
					kind: "selected",
					artboardIds: ["artboard:third", "artboard:first"],
				},
			}).map(({ id }) => id),
		).toEqual(["artboard:first", "artboard:third"])
		expect(
			resolvePdfArtboards(document, {
				scope: {
					kind: "range",
					startArtboardId: "artboard:third",
					endArtboardId: "artboard:second",
				},
			}).map(({ id }) => id),
		).toEqual(["artboard:second", "artboard:third"])
		expect(
			resolvePdfArtboards(document, {
				scope: { kind: "active", artboardId: "artboard:second" },
			}),
		).toEqual([document.artboards[1]])
	})

	it("serializes ordered clipped pages with shared spanning artwork streams", () => {
		expect(
			validatePdf(
				createPdfProjectionGraph().project(multiArtboardDocument(), {
					scope: { kind: "all" },
				}).document,
			),
		).toEqual([])
		const parsed = parsePdfFixture(
			exportPdf(multiArtboardDocument(), { scope: { kind: "all" } }),
		)
		expect(parsed.pages.map(({ mediaBox }) => mediaBox)).toEqual([
			[0, 0, 100, 200],
			[0, 0, 300, 150],
			[0, 0, 50, 60],
		])
		expect(parsed.pages[0]?.trimBox).toBeUndefined()
		expect(parsed.pages[0]?.bleedBox).toBeUndefined()
		expect(parsed.stream(parsed.pages[0]!.contents[0]!)).toBe(
			"q\n0 0 100 200 re W n\n1 0 0 -1 0 200 cm",
		)
		expect(parsed.stream(parsed.pages[1]!.contents[0]!)).toBe(
			"q\n0 0 300 150 re W n\n1 0 0 -1 -100 170 cm",
		)
		const firstObjects = parsed.pages[0]!.contents.slice(1, -1)
		expect(firstObjects.length).toBeGreaterThan(0)
		expect(parsed.pages[1]!.contents.slice(1, -1)).toEqual(firstObjects)
		expect(parsed.pages[2]!.contents.slice(1, -1)).toEqual(firstObjects)
		expect(
			firstObjects.some((reference) => parsed.stream(reference).includes("f*")),
		).toBe(true)
	})

	it("expands media and emits trim and bleed boxes when requested", () => {
		const parsed = parsePdfFixture(
			exportPdf(multiArtboardDocument(), {
				includeBleed: true,
				scope: { kind: "active", artboardId: "artboard:first" },
			}),
		)
		expect(parsed.pages[0]).toMatchObject({
			mediaBox: [0, 0, 160, 240],
			trimBox: [40, 30, 140, 230],
			bleedBox: [0, 0, 160, 240],
		})
		expect(parsed.stream(parsed.pages[0]!.contents[0]!)).toBe(
			"q\n0 0 160 240 re W n\n1 0 0 -1 40 230 cm",
		)
	})

	it("reuses unrelated page and object projections after one artboard edit", () => {
		const graph = createPdfProjectionGraph()
		const document = multiArtboardDocument()
		const before = graph.project(document, { scope: { kind: "all" } })
		const after = graph.project(
			{
				...document,
				artboards: document.artboards.map((artboard) =>
					artboard.id === "artboard:second"
						? { ...artboard, width: artboard.width + 1 }
						: artboard,
				),
			},
			{ scope: { kind: "all" } },
		)
		expect(after.pages[0]).toBe(before.pages[0])
		expect(after.pages[1]).not.toBe(before.pages[1])
		expect(after.pages[2]).toBe(before.pages[2])
		expect(after.pages[1]?.objectProjections).toEqual(
			before.pages[1]?.objectProjections,
		)
	})

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

	it("projects one explicitly selected artboard without changing global artwork", () => {
		const document = createInitialDocument()
		const objectSnapshot = structuredClone(document.objects)
		const social = {
			id: "artboard:social",
			name: "Social",
			x: 800,
			y: -200,
			width: 500,
			height: 500,
		}
		const withArtboards = {
			...document,
			artboards: [...document.artboards, social],
		}
		const projection = createPdfProjectionGraph().project(withArtboards, social)
		expect(projection.page).toMatchObject({
			artboardId: social.id,
			x: social.x,
			y: social.y,
			width: social.width,
			height: social.height,
		})
		expect(pdfContentStream(withArtboards, social)).toContain(
			"1 0 0 -1 -800 300 cm",
		)
		expect(withArtboards.objects).toEqual(objectSnapshot)
	})

	it("exports curved Pen contours with fill-only cubic geometry", () => {
		const document = createInitialDocument()
		const content = pdfContentStream({
			...document,
			objects: [
				{
					id: "object:pen",
					name: "Pen",
					geometry: {
						kind: "path",
						contours: [
							{
								id: "contour:pen",
								closed: false,
								points: [
									{
										id: "point:pen:0",
										x: 40,
										y: 50,
										outgoing: { x: 30, y: 20 },
									},
									{
										id: "point:pen:1",
										x: 160,
										y: 120,
										incoming: { x: -30, y: -20 },
									},
									{ id: "point:pen:2", x: 80, y: 200 },
								],
							},
						],
					},
					transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
					appearance: { fill: { swatchId: "swatch:coral" } },
				},
			],
		})
		expect(content).toContain("1 0 0 -1 0 792 cm")
		expect(content).toContain("70 70 130 100 160 120 c")
		expect(content).toContain("f*")
		expect(content).not.toMatch(/(^|\n)S($|\n)/)
	})

	it("exports optional strokes without requiring a fill", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const content = pdfContentStream({
			...document,
			objects: [
				{
					...object,
					appearance: {
						stroke: {
							...DEFAULT_DESIGN_STROKE_STYLE,
							swatchId: "swatch:ink",
							width: 3,
						},
					},
				},
			],
		})
		expect(content).toContain("0.6 0.4 0.4 1 K")
		expect(content).toContain("3 w")
		expect(content).toMatch(/(^|\n)S($|\n)/)
		expect(content).not.toContain("f*")
	})

	it("exports authored cap, join, miter, and dash operators", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const content = pdfContentStream({
			...document,
			objects: [
				{
					...object,
					appearance: {
						stroke: {
							swatchId: "swatch:ink",
							width: 7.5,
							cap: "round",
							join: "bevel",
							miterLimit: 9,
							dashArray: [8, 3, 2],
							dashOffset: -1.5,
						},
					},
				},
			],
		})
		expect(content).toContain("7.5 w\n1 J\n2 j\n9 M\n[8 3 2] -1.5 d")
		expect(content).toMatch(/(^|\n)S($|\n)/)
	})

	it("does not turn zero-width authored strokes into PDF hairlines", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const content = pdfContentStream({
			...document,
			objects: [
				{
					...object,
					appearance: {
						stroke: {
							...DEFAULT_DESIGN_STROKE_STYLE,
							swatchId: "swatch:ink",
							width: 0,
						},
					},
				},
			],
		})
		expect(content).not.toContain(" w")
		expect(content).not.toMatch(/(^|\n)S($|\n)/)
	})

	it("retains native source spaces for combined fill and stroke paint", () => {
		const document = createInitialDocument()
		const object = document.objects[0]!
		const content = pdfContentStream({
			...document,
			objects: [
				{
					...object,
					appearance: {
						fill: { swatchId: "swatch:ink" },
						stroke: {
							...DEFAULT_DESIGN_STROKE_STYLE,
							swatchId: "swatch:coral",
							width: 2,
						},
					},
				},
			],
		})
		expect(content).toContain("0.6 0.4 0.4 1 k")
		expect(content).toContain("0.8549 0.3686 0.2627 RG")
		expect(content).toContain("B*")
	})

	it("reuses unrelated object projections after a geometry edit", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const object = document.objects[0]!
		const after = graph.project({
			...document,
			objects: [
				{
					...object,
					transform: { ...object.transform, e: object.transform.e + 1 },
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

	it("invalidates only the object projection with edited appearance", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const before = graph.project(document)
		const first = document.objects[0]!
		const after = graph.project({
			...document,
			objects: [
				{
					...first,
					appearance: {
						...first.appearance,
						stroke: {
							...DEFAULT_DESIGN_STROKE_STYLE,
							swatchId: "swatch:ink",
							width: 2,
						},
					},
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

	it("reuses object streams across stacking and artboard-transform changes", () => {
		const graph = createPdfProjectionGraph()
		const document = createInitialDocument()
		const artboard = document.artboards[0]!
		const before = graph.project(document)
		const reordered = graph.project({
			...document,
			objects: document.objects.toReversed(),
		})
		expect(reordered.page).not.toBe(before.page)
		expect(reordered.page.objectProjections).toEqual(
			before.page.objectProjections.toReversed(),
		)
		const resized = graph.project(document, {
			...artboard,
			height: artboard.height + 10,
		})
		expect(resized.page).not.toBe(reordered.page)
		expect(resized.page.objectProjections).toEqual(
			before.page.objectProjections,
		)
		const movedArtboard = { ...artboard, x: 120, y: -40 }
		const moved = graph.project(document, movedArtboard)
		expect(moved.page).not.toBe(resized.page)
		expect(moved.page.objectProjections).toEqual(before.page.objectProjections)
		expect(pdfContentStream(document, movedArtboard)).toContain(
			"1 0 0 -1 -120 752 cm",
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
