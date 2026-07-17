import type { EditorFontSource } from "@create-font/states"
import { useEffect } from "preact/hooks"

import { createGlyphPreview, type GlyphPreview } from "./glyph-preview.ts"

export type EditorViewName = "canvas" | "glyphs" | "info" | "not-found"

const FALLBACK_FAVICON_SVG = [
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
	`<style>.background{fill:#1c1b17}.bar{fill:#f4f3ef}.accent{fill:#e17352}@media(prefers-color-scheme:dark){.background{fill:#efeee8}.bar{fill:#171815}}</style>`,
	`<rect class="background" x="5" y="5" width="54" height="54" rx="14"/>`,
	`<rect class="bar" x="18" y="17" width="7" height="30" rx="3.5"/>`,
	`<rect class="accent" x="29" y="25" width="7" height="22" rx="3.5"/>`,
	`<rect class="bar" x="40" y="17" width="7" height="30" rx="3.5"/>`,
	`</svg>`,
].join(``)

export const FALLBACK_FAVICON_HREF = faviconDataUrl(FALLBACK_FAVICON_SVG)

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

export function serializeFaviconSvg(preview: GlyphPreview): string {
	const viewBox = escapeSvgAttribute(preview.viewBox)
	const path = escapeSvgAttribute(preview.path)
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
		`<style>path{fill:#1c1b17}@media(prefers-color-scheme:dark){path{fill:#efeee8}}</style>`,
		`<path d="${path}" fill-rule="evenodd" clip-rule="evenodd" transform="scale(1 -1)"/>`,
		`</svg>`,
	].join(``)
}

export function faviconDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function createFontFaviconHref(source: EditorFontSource): string {
	const cmapEntry = source.cmap.find(
		(entry) => entry.codePoint === LOWERCASE_A_CODE_POINT,
	)
	if (cmapEntry === undefined) return FALLBACK_FAVICON_HREF
	const glyph = source.glyphs.find((item) => item.id === cmapEntry.glyphId)
	if (glyph === undefined) return FALLBACK_FAVICON_HREF
	const preview = createGlyphPreview(
		glyph,
		source.defaultMasterId,
		source.metrics,
		source.metadata.unitsPerEm,
	)
	if (preview === null || preview.path.trim().length === 0) {
		return FALLBACK_FAVICON_HREF
	}
	return faviconDataUrl(serializeFaviconSvg(preview))
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
	faviconHref: string,
	view: EditorViewName,
	canvasText: string,
): void {
	useEffect(() => {
		document.title = editorDocumentTitle(view, canvasText)
	}, [canvasText, view])

	useEffect(() => {
		installFavicon(document, faviconHref)
	}, [faviconHref])
}
