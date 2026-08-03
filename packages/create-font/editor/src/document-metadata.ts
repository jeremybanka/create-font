import type { EditorFontSource } from "@create-font/states"
import { useEffect } from "preact/hooks"

import { createGlyphPreview, type GlyphPreview } from "./glyph-preview.ts"
import {
	type InferredColorPreference,
	useInferredColorPreference,
} from "./inferred-color-preference.ts"

export type EditorViewName = "canvas" | "glyphs" | "info" | "not-found"

export const FAVICON_INK = Object.freeze({
	dark: "#efeee8",
	light: "#1c1b17",
}) satisfies Readonly<Record<InferredColorPreference, string>>

function serializeFallbackFaviconSvg(
	preference: InferredColorPreference,
): string {
	const ink = FAVICON_INK[preference]
	const inverseInk = FAVICON_INK[preference === "light" ? "dark" : "light"]
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
		`<style>.background{fill:${ink}}.bar{fill:${inverseInk}}.accent{fill:#e17352}</style>`,
		`<rect class="background" x="5" y="5" width="54" height="54" rx="14"/>`,
		`<rect class="bar" x="18" y="17" width="7" height="30" rx="3.5"/>`,
		`<rect class="accent" x="29" y="25" width="7" height="22" rx="3.5"/>`,
		`<rect class="bar" x="40" y="17" width="7" height="30" rx="3.5"/>`,
		`</svg>`,
	].join(``)
}

export function fallbackFaviconHref(
	preference: InferredColorPreference,
): string {
	return faviconDataUrl(serializeFallbackFaviconSvg(preference))
}

export const FALLBACK_FAVICON_HREF = fallbackFaviconHref("dark")

const LOWERCASE_A_CODE_POINT = 0x61
const CANVAS_TITLE_LENGTH = 20

function graphemes(value: string): readonly string[] {
	if (typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })
		return Array.from(segmenter.segment(value), ({ segment }) => segment)
	}
	return Array.from(value)
}

export function normalizeCanvasTitle(value: string): string {
	return value
		.replace(/[\r\n\u2028\u2029]+/gu, ` · `)
		.replace(/[\t\v\f\u0085]+/gu, ` `)
		.replace(/\p{Cc}+/gu, ``)
		.replace(/\s+/gu, ` `)
		.trim()
		.replace(/^(?:·\s*)+|(?:\s*·)+$/gu, ``)
}

export function editorDocumentTitle(
	view: EditorViewName,
	canvasText: string,
): string {
	if (view === `glyphs`) return `All Glyphs`
	if (view === `info`) return `Font Info`
	if (view === `not-found`) return `create-font`
	const normalized = normalizeCanvasTitle(canvasText)
	if (normalized.length === 0) return `Canvas`
	return graphemes(normalized).slice(0, CANVAS_TITLE_LENGTH).join(``)
}

function escapeSvgAttribute(value: string): string {
	return value
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`)
		.replaceAll(`'`, `&apos;`)
}

export function serializeFaviconSvg(
	preview: GlyphPreview,
	preference: InferredColorPreference = "dark",
): string {
	const viewBox = escapeSvgAttribute(preview.viewBox)
	const path = escapeSvgAttribute(preview.path)
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
		`<path d="${path}" fill="${FAVICON_INK[preference]}" fill-rule="evenodd" clip-rule="evenodd" transform="scale(1 -1)"/>`,
		`</svg>`,
	].join(``)
}

export function faviconDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function createFontFaviconPreview(
	source: EditorFontSource,
): GlyphPreview | null {
	const cmapEntry = source.cmap.find(
		(entry) => entry.codePoint === LOWERCASE_A_CODE_POINT,
	)
	if (cmapEntry === undefined) return null
	const glyph = source.glyphs.find((item) => item.id === cmapEntry.glyphId)
	if (glyph === undefined) return null
	const preview = createGlyphPreview(
		glyph,
		source.defaultMasterId,
		source.metrics,
		source.metadata.unitsPerEm,
	)
	return preview === null || preview.path.trim().length === 0 ? null : preview
}

export function faviconHrefForPreview(
	preview: GlyphPreview | null,
	preference: InferredColorPreference,
): string {
	return preview === null
		? fallbackFaviconHref(preference)
		: faviconDataUrl(serializeFaviconSvg(preview, preference))
}

export function createFontFaviconHref(
	source: EditorFontSource,
	preference: InferredColorPreference = "dark",
): string {
	return faviconHrefForPreview(createFontFaviconPreview(source), preference)
}

export function installFavicon(documentValue: Document, href: string): void {
	let link = documentValue.querySelector<HTMLLinkElement>(
		`link[data-create-font-favicon]`,
	)
	if (link === null) {
		link = documentValue.createElement(`link`)
		link.dataset.createFontFavicon = ``
		documentValue.head.append(link)
	}
	link.rel = `icon`
	link.type = `image/svg+xml`
	if (link.href !== href) link.href = href
}

export function useEditorDocumentMetadata(
	faviconPreview: GlyphPreview | null,
	view: EditorViewName,
	canvasText: string,
): void {
	const preference = useInferredColorPreference()
	const faviconHref = faviconHrefForPreview(faviconPreview, preference)
	useEffect(() => {
		document.title = editorDocumentTitle(view, canvasText)
	}, [canvasText, view])

	useEffect(() => {
		installFavicon(document, faviconHref)
	}, [faviconHref])
}
