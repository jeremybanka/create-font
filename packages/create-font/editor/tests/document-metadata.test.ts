import type { EditorFontSource } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	createFontFaviconPreview,
	createFontFaviconHref,
	editorDocumentTitle,
	FALLBACK_FAVICON_HREF,
	fallbackFaviconHref,
	FAVICON_INK,
	installFavicon,
	normalizeCanvasTitle,
	serializeFaviconSvg,
} from "../src/document-metadata.ts"
import {
	blackMasterId,
	makeDemoFont,
	oGlyphId,
	razorMasterId,
} from "../src/demo-font.ts"
import { readInferredColorPreference } from "../src/inferred-color-preference.ts"

describe(`editor document title`, () => {
	it(`uses exact labels for non-canvas views and a canvas fallback`, () => {
		expect(editorDocumentTitle(`glyphs`, `ignored`)).toBe(`All Glyphs`)
		expect(editorDocumentTitle(`info`, `ignored`)).toBe(`Font Info`)
		expect(editorDocumentTitle(`canvas`, ` \n\t `)).toBe(`Canvas`)
	})

	it(`normalizes multiline text before truncating user-perceived characters`, () => {
		expect(normalizeCanvasTitle(`  Alpha\nBeta\tGamma  `)).toBe(
			`Alpha · Beta Gamma`,
		)
		const family = `👨‍👩‍👧‍👦`
		const prefix = `a`.repeat(19)
		expect(editorDocumentTitle(`canvas`, `${prefix}${family}z`)).toBe(
			`${prefix}${family}`,
		)
	})
})

describe(`font favicon`, () => {
	function sourceWithLowercaseO(): EditorFontSource {
		const source = makeDemoFont()
		return {
			...source,
			cmap: [
				...source.cmap.filter((entry) => entry.codePoint !== 0x61),
				{ codePoint: 0x61, glyphId: oGlyphId },
			],
		}
	}

	function withDefaultContour(
		coordinates: readonly Readonly<{
			x: number
			y: number
			incoming?: Readonly<{ x: number; y: number }>
			outgoing?: Readonly<{ x: number; y: number }>
		}>[],
	): EditorFontSource {
		return withDefaultContours([coordinates])
	}

	function withDefaultContours(
		contours: readonly (readonly Readonly<{
			x: number
			y: number
			incoming?: Readonly<{ x: number; y: number }>
			outgoing?: Readonly<{ x: number; y: number }>
		}>[])[],
	): EditorFontSource {
		const source = sourceWithLowercaseO()
		return {
			...source,
			glyphs: source.glyphs.map((glyph) =>
				glyph.id !== oGlyphId
					? glyph
					: {
							...glyph,
							layers: glyph.layers.map((layer) => {
								if (layer.masterId !== razorMasterId) return layer
								const template = layer.contours[0]
								if (template === undefined)
									throw new Error("Missing contour fixture.")
								return {
									...layer,
									contours: contours.map((coordinates) => ({
										...template,
										points: coordinates.map((coordinate, index) => {
											const point = template.points[index] ?? template.points[0]
											if (point === undefined)
												throw new Error("Missing point fixture.")
											const {
												incoming: _incoming,
												outgoing: _outgoing,
												corner: _corner,
												...base
											} = point
											return { ...base, ...coordinate }
										}),
									})),
								}
							}),
						},
			),
		}
	}

	function previewViewBox(source: EditorFontSource) {
		const preview = createFontFaviconPreview(source)
		if (preview === null) throw new Error("Expected a favicon preview.")
		return preview.viewBox.split(" ").map(Number)
	}

	function previewPathCount(source: EditorFontSource): number {
		const preview = createFontFaviconPreview(source)
		if (preview === null) throw new Error("Expected a favicon preview.")
		return preview.path.match(/\bM\b/gu)?.length ?? 0
	}

	it(`visually unites intersecting positive contours instead of knocking out their overlap`, () => {
		const source = withDefaultContours([
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			],
			[
				{ x: 50, y: 0 },
				{ x: 150, y: 0 },
				{ x: 150, y: 100 },
				{ x: 50, y: 100 },
			],
		])

		expect(previewPathCount(source)).toBe(1)
		expect(createFontFaviconPreview(source)?.path).toContain("L 150 100")
	})

	it(`keeps a wholly enclosed contour open as a genuine counter`, () => {
		const source = withDefaultContours([
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			],
			[
				{ x: 25, y: 25 },
				{ x: 75, y: 25 },
				{ x: 75, y: 75 },
				{ x: 25, y: 75 },
			],
		])

		expect(previewPathCount(source)).toBe(2)
	})

	it(`unites overlapping strokes while retaining a nested counter`, () => {
		const source = withDefaultContours([
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			],
			[
				{ x: 80, y: 0 },
				{ x: 180, y: 0 },
				{ x: 180, y: 100 },
				{ x: 80, y: 100 },
			],
			[
				{ x: 20, y: 20 },
				{ x: 40, y: 20 },
				{ x: 40, y: 40 },
				{ x: 20, y: 40 },
			],
		])

		expect(previewPathCount(source)).toBe(2)
		expect(createFontFaviconPreview(source)?.path).toContain("L 180 100")
	})

	it(`uses a centered 85%-width square independent of metrics and advance width`, () => {
		const source = withDefaultContour([
			{ x: 100, y: 40 },
			{ x: 300, y: 40 },
			{ x: 300, y: 1_040 },
			{ x: 100, y: 1_040 },
		])
		const modified = {
			...source,
			metadata: { ...source.metadata, unitsPerEm: 16_384 },
			metrics: { ...source.metrics, ascender: 20_000, descender: -10_000 },
			glyphs: source.glyphs.map((glyph) =>
				glyph.id === oGlyphId
					? {
							...glyph,
							layers: glyph.layers.map((layer) => ({
								...layer,
								advanceWidth: 50_000,
								leftSideBearing: 12_000,
							})),
						}
					: glyph,
			),
		}

		expect(previewViewBox(source)).toEqual([115, -625, 170, 170])
		expect(previewViewBox(modified)).toEqual([115, -625, 170, 170])
	})

	it(`converts an asymmetric font-space center through SVG y inversion`, () => {
		const source = withDefaultContour([
			{ x: -40, y: -260 },
			{ x: 360, y: -260 },
			{ x: 360, y: 140 },
			{ x: -40, y: 140 },
		])

		expect(previewViewBox(source)).toEqual([-10, -110, 340, 340])
	})

	it(`uses cubic interior extrema instead of control-handle extents`, () => {
		const source = withDefaultContour([
			{ x: 0, y: 0, outgoing: { x: 100, y: 0 } },
			{ x: 0, y: 100, incoming: { x: 100, y: 0 } },
		])
		const [left, top, width, height] = previewViewBox(source)

		expect(left).toBeCloseTo(5.625)
		expect(top).toBeCloseTo(-81.875)
		expect(width).toBeCloseTo(63.75)
		expect(height).toBeCloseTo(63.75)
	})

	it(`falls back for empty, non-finite, and zero-width drawable outlines`, () => {
		const empty = withDefaultContour([])
		const nonFinite = withDefaultContour([
			{ x: Number.NaN, y: 0 },
			{ x: 100, y: 100 },
		])
		const zeroWidth = withDefaultContour([
			{ x: 20, y: 0 },
			{ x: 20, y: 100 },
		])

		for (const source of [empty, nonFinite, zeroWidth]) {
			expect(createFontFaviconPreview(source)).toBeNull()
			expect(createFontFaviconHref(source)).toBe(FALLBACK_FAVICON_HREF)
		}
	})

	it(`resolves lowercase a through cmap and updates with outline changes`, () => {
		const source = makeDemoFont()
		const mapped = {
			...source,
			cmap: [...source.cmap, { codePoint: 0x61, glyphId: oGlyphId }],
		}
		const href = createFontFaviconHref(mapped)
		expect(href.startsWith(`data:image/svg+xml,`)).toBe(true)
		const svg = decodeURIComponent(href.slice(href.indexOf(`,`) + 1))
		expect(svg).toContain(`fill-rule="evenodd"`)
		expect(svg).toContain(`500 752`)

		const moved = {
			...mapped,
			glyphs: mapped.glyphs.map((glyph) =>
				glyph.id === oGlyphId
					? {
							...glyph,
							layers: glyph.layers.map((layer) => ({
								...layer,
								contours: layer.contours.map((contour, contourIndex) => ({
									...contour,
									points: contour.points.map((point, pointIndex) =>
										contourIndex === 0 && pointIndex === 0
											? { ...point, x: point.x + 7 }
											: point,
									),
								})),
							})),
						}
					: glyph,
			),
		}
		expect(createFontFaviconHref(moved)).not.toBe(href)
	})

	it(`updates path and frame for cmap and default-master changes`, () => {
		const source = sourceWithLowercaseO()
		const oPreview = createFontFaviconPreview(source)
		const remapped = {
			...source,
			cmap: source.cmap.map((entry) =>
				entry.codePoint === 0x61
					? { ...entry, glyphId: source.glyphs[1]?.id ?? entry.glyphId }
					: entry,
			),
		}
		const blackGlyphs = source.glyphs.map((glyph) =>
			glyph.id !== oGlyphId
				? glyph
				: {
						...glyph,
						layers: glyph.layers.map((layer) =>
							layer.masterId !== blackMasterId
								? layer
								: {
										...layer,
										contours: layer.contours.map((contour, contourIndex) => ({
											...contour,
											points: contour.points.map((point, pointIndex) =>
												contourIndex === 0 && pointIndex === 1
													? { ...point, x: point.x + 80 }
													: point,
											),
										})),
									},
						),
					},
		)
		const defaultMasterChanged = createFontFaviconPreview({
			...source,
			glyphs: blackGlyphs,
			defaultMasterId: blackMasterId,
		})
		const remappedPreview = createFontFaviconPreview(remapped)

		expect(remappedPreview?.path).not.toBe(oPreview?.path)
		expect(remappedPreview?.viewBox).not.toBe(oPreview?.viewBox)
		expect(defaultMasterChanged?.path).not.toBe(oPreview?.path)
		expect(defaultMasterChanged?.viewBox).not.toBe(oPreview?.viewBox)
	})

	it(`falls back safely and escapes serialized SVG attributes`, () => {
		expect(createFontFaviconHref(makeDemoFont())).toBe(FALLBACK_FAVICON_HREF)
		const svg = serializeFaviconSvg({
			advanceWidth: 10,
			openPath: "",
			path: `M 0 0"><script>alert(1)</script>`,
			viewBox: `0 0 10 "10`,
		})
		expect(svg).toContain(`&quot;`)
		expect(svg).toContain(`&lt;script&gt;`)
		expect(svg).not.toContain(`<script>`)
	})

	it(`serializes explicit contrasting ink for both inferred preferences`, () => {
		const preview = {
			advanceWidth: 10,
			openPath: "",
			path: "M 0 0 L 1 1",
			viewBox: "0 0 10 10",
		}
		expect(serializeFaviconSvg(preview, "light")).toContain(
			`fill="${FAVICON_INK.light}"`,
		)
		expect(serializeFaviconSvg(preview, "dark")).toContain(
			`fill="${FAVICON_INK.dark}"`,
		)
		expect(fallbackFaviconHref("light")).not.toBe(fallbackFaviconHref("dark"))
		expect(decodeURIComponent(fallbackFaviconHref("light"))).toContain(
			`.background{fill:${FAVICON_INK.light}}`,
		)
	})

	it(`uses a deterministic dark fallback outside the browser`, () => {
		expect(readInferredColorPreference()).toBe("dark")
	})

	it(`reuses the managed icon link across repeated updates`, () => {
		const links: Array<{
			dataset: Record<string, string>
			href: string
			rel: string
			type: string
		}> = []
		const documentStub = {
			createElement: () => ({ dataset: {}, href: ``, rel: ``, type: `` }),
			head: { append: (link: (typeof links)[number]) => links.push(link) },
			querySelector: () => links[0] ?? null,
		} as unknown as Document

		installFavicon(documentStub, `first.svg`)
		installFavicon(documentStub, `second.svg`)

		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({
			href: `second.svg`,
			rel: `icon`,
			type: `image/svg+xml`,
		})
	})
})
