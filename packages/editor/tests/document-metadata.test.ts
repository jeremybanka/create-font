import { describe, expect, it } from "vitest"

import {
	createFontFaviconHref,
	editorDocumentTitle,
	FALLBACK_FAVICON_HREF,
	installFavicon,
	normalizeCanvasTitle,
	serializeFaviconSvg,
} from "../src/document-metadata.ts"
import { makeDemoFont, oGlyphId } from "../src/demo-font.ts"

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
		expect(svg).toContain(`M 500 752`)

		const moved = {
			...mapped,
			glyphs: mapped.glyphs.map((glyph) =>
				glyph.id === oGlyphId
					? {
							...glyph,
							layers: glyph.layers.map((layer) => ({
								...layer,
								points: layer.points.map((point, index) =>
									index === 0 ? { ...point, x: point.x + 7 } : point,
								),
							})),
						}
					: glyph,
			),
		}
		expect(createFontFaviconHref(moved)).not.toBe(href)
	})

	it(`falls back safely and escapes serialized SVG attributes`, () => {
		expect(createFontFaviconHref(makeDemoFont())).toBe(FALLBACK_FAVICON_HREF)
		const svg = serializeFaviconSvg({
			path: `M 0 0"><script>alert(1)</script>`,
			viewBox: `0 0 10 "10`,
		})
		expect(svg).toContain(`&quot;`)
		expect(svg).toContain(`&lt;script&gt;`)
		expect(svg).not.toContain(`<script>`)
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
