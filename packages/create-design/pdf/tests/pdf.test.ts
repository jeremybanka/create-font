import { describe, expect, it } from "vitest"
import { validatePdf } from "mondrian.pdf"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"
import type { DesignObject, DesignSwatch } from "@create-design/source"
import type { DesignTextLayout, DesignTextService } from "@create-design/text"

import { createInitialDocument } from "@create-design/source"
import {
	createPdfIr,
	createPdfProjectionGraph,
	exportPdf,
	pdfObjectContentStream,
	pdfContentStream,
	resolvePdfArtboards,
} from "../src/pdf.ts"
import { parsePdfFixture } from "./pdf-parser-fixture.ts"
import { preflightPdfExport } from "../src/pdf-preflight.ts"

describe("PDF export", () => {
	it("embeds baseline JPEG pixels under explicit vector clipping", () => {
		const jpegBase64 =
			"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z"
		const jpeg = Uint8Array.from(atob(jpegBase64), (character) =>
			character.charCodeAt(0),
		)
		const initial = createInitialDocument()
		const clip = initial.objects[0]!
		const image = {
			id: "object:jpeg",
			name: "JPEG",
			geometry: {
				kind: "image" as const,
				source: { kind: "embedded" as const, id: "asset:jpeg" },
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 1,
				intrinsicHeight: 1,
			},
			transform: { a: 100, b: 0, c: 0, d: 80, e: 40, f: 50 },
			appearance: {},
		}
		const document = {
			...initial,
			objects: [image, clip],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "group" as const, id: "group:mask" }],
				},
			],
			groups: [
				{
					id: "group:mask",
					name: "JPEG mask",
					children: [
						{ kind: "object" as const, id: image.id },
						{ kind: "object" as const, id: clip.id },
					],
					clippingPathId: clip.id,
				},
			],
		}
		const imageResources = new Map([
			[
				"asset:jpeg",
				{
					id: "asset:jpeg",
					mediaType: "image/jpeg" as const,
					bytes: jpeg,
				},
			],
		])
		const target = document.artboards[0]!
		expect(
			preflightPdfExport(document, target, {}, undefined, imageResources)
				.decision,
		).toBe("ready")
		const bytes = exportPdf(document, target, { imageResources })
		expect(
			validatePdf(createPdfIr(document, target, { imageResources })),
		).toEqual([])
		const source = new TextDecoder("latin1").decode(bytes)
		expect(source).toContain("/Subtype /Image")
		expect(source).toContain("/Filter /DCTDecode")
		expect(source).toMatch(/W\*? n/)
		expect(source).toMatch(/\/Im[0-9a-f]+ Do/)
	})

	it("reports a recoverable missing linked image before PDF export", () => {
		const initial = createInitialDocument()
		const image = {
			id: "object:missing",
			name: "Missing link",
			geometry: {
				kind: "image" as const,
				source: {
					kind: "linked" as const,
					id: "asset:missing",
					href: "../missing.jpg",
				},
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 20,
				intrinsicHeight: 10,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {},
		}
		const document = {
			...initial,
			objects: [image],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "object" as const, id: image.id }],
				},
			],
			groups: [],
		}
		const preflight = preflightPdfExport(document, document.artboards[0]!)
		expect(preflight.decision).toBe("blocked")
		expect(preflight.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "pdf.image.missing-resource",
				entityId: image.id,
				message: expect.stringContaining("relink"),
			}),
		)
		expect(document.objects[0]).toBe(image)
	})
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

	it("uses hierarchy paint order while omitting hidden and retaining locked layers", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const back = { ...source, id: "object:layer-back", name: "Back" }
		const hidden = { ...source, id: "object:layer-hidden", name: "Hidden" }
		const front = { ...source, id: "object:layer-front", name: "Front" }
		const document = {
			...initial,
			objects: [front, hidden, back],
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "group" as const, id: "group:back" }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					locked: true,
					children: [{ kind: "object" as const, id: front.id }],
				},
			],
			groups: [
				{
					id: "group:back",
					name: "Back group",
					children: [{ kind: "object" as const, id: back.id }],
				},
			],
		}
		const projection = createPdfProjectionGraph().project(document)
		const unlocked = {
			...document,
			layers: document.layers.map((layer) => ({
				...layer,
				...(layer.id === "layer:front" ? { locked: false } : {}),
			})),
		}

		expect(projection.page.objectProjections.map(({ id }) => id)).toEqual([
			back.id,
			front.id,
		])
		expect(pdfContentStream(document)).toBe(pdfContentStream(unlocked))
	})

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

	it("uses the authored path fill rule for PDF paint operators", () => {
		const document = createInitialDocument()
		const source = document.objects[0]!
		const object = {
			...source,
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: [
					{
						id: "contour:rule",
						closed: true,
						points: [
							{ id: "point:rule:0", x: 0, y: 0 },
							{ id: "point:rule:1", x: 10, y: 0 },
							{ id: "point:rule:2", x: 10, y: 10 },
						],
					},
				],
			},
		}
		const swatch = document.swatches[0]
		if (swatch === undefined) throw new Error("Expected swatch fixture.")
		expect(pdfObjectContentStream(object, swatch)).toMatch(/\nf$/u)
		expect(
			pdfObjectContentStream(
				{
					...object,
					geometry: { ...object.geometry, fillRule: "evenodd" },
				},
				swatch,
			),
		).toMatch(/\nf\*$/u)
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
		const pen = {
			id: "object:pen",
			name: "Pen",
			geometry: {
				kind: "path" as const,
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
		}
		const content = pdfContentStream({
			...document,
			objects: [pen],
			layers: document.layers.map((layer) => ({
				...layer,
				children: [{ kind: "object" as const, id: pen.id }],
			})),
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
			layers: document.layers.map((layer) => ({
				...layer,
				children: layer.children.toReversed(),
			})),
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

	it("lowers live text from the exact canonical glyph contours used by canvas and expansion", () => {
		const contour = {
			id: "glyph:0:contour:0",
			closed: true,
			points: [
				{ id: "p:0", x: 10, y: 20 },
				{ id: "p:1", x: 30, y: 20 },
				{ id: "p:2", x: 30, y: 40 },
				{ id: "p:3", x: 10, y: 40 },
			],
		} as const
		const text: DesignObject = {
			id: "object:text",
			name: "Text",
			geometry: {
				kind: "text",
				mode: "point",
				text: "A",
				x: 10,
				y: 40,
				typography: {
					font: { id: "font:test", family: "Test" },
					size: 20,
					leading: 24,
					tracking: 0,
					kerning: "auto",
					alignment: "start",
					direction: "ltr",
				},
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 },
			appearance: { fill: { swatchId: "swatch:black" } },
		}
		const expanded: DesignObject = {
			...text,
			geometry: { kind: "path", fillRule: "nonzero", contours: [contour] },
		}
		const layout = {
			objectId: text.id,
			font: {
				source: "font:test",
				family: "Test",
				faceIndex: 0,
				revision: 1,
				binaryHash: "test",
				key: "font:test",
			},
			glyphs: [
				{
					glyphId: 1,
					cluster: 0,
					clusterEnd: 1,
					lineIndex: 0,
					x: 10,
					y: 40,
					advanceX: 20,
					advanceY: 0,
					contours: [contour],
				},
			],
			lines: [],
			diagnostics: [],
			visibleTextEnd: 1,
			overset: false,
			bounds: { x: 10, y: 20, width: 20, height: 20 },
		} satisfies DesignTextLayout
		const service = { layout: () => layout } as unknown as DesignTextService
		const swatch: DesignSwatch = {
			id: "swatch:black",
			name: "Black",
			source: { space: "rgb", r: 0, g: 0, b: 0 },
		}
		expect(pdfObjectContentStream(text, swatch, undefined, service)).toBe(
			pdfObjectContentStream(expanded, swatch),
		)
	})
})
