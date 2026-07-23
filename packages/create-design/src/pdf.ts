import {
	array,
	ascii,
	asciiTextString,
	createPdfObjectBuilder,
	dictionary,
	name,
	serializePdf,
	stream,
	textString,
	type PdfCatalogDictionary,
	type PdfDocument,
	type PdfInfoDictionary,
	type PdfPageDictionary,
	type PdfPagesDictionary,
} from "mondrian.pdf"

import { resolvedCmyk, resolvedRgb } from "./color.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignPoint,
	DesignSwatch,
} from "./types.ts"

const number = (value: number): string => Number(value.toFixed(4)).toString()

function pdfPoint(
	point: Readonly<{ x: number; y: number }>,
	pageHeight: number,
): string {
	return `${number(point.x)} ${number(pageHeight - point.y)}`
}

function segment(
	from: DesignPoint,
	to: DesignPoint,
	pageHeight: number,
): string {
	if (from.outgoing === undefined && to.incoming === undefined) {
		return `${pdfPoint(to, pageHeight)} l`
	}
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	return [
		pdfPoint({ x: from.x + first.x, y: from.y + first.y }, pageHeight),
		pdfPoint({ x: to.x + second.x, y: to.y + second.y }, pageHeight),
		pdfPoint(to, pageHeight),
		"c",
	].join(" ")
}

function contourCommands(
	contour: DesignContour,
	pageHeight: number,
): readonly string[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const commands = [`${pdfPoint(first, pageHeight)} m`]
	for (let index = 1; index < contour.points.length; index += 1) {
		const previous = contour.points[index - 1]
		const point = contour.points[index]
		if (previous !== undefined && point !== undefined) {
			commands.push(segment(previous, point, pageHeight))
		}
	}
	if (contour.closed && contour.points.length > 1) {
		const last = contour.points.at(-1)
		if (last !== undefined) commands.push(segment(last, first, pageHeight))
		commands.push("h")
	}
	return commands
}

function fillOperator(swatch: DesignSwatch): string {
	if (swatch.source.space === "cmyk") {
		const { c, m, y, k } = resolvedCmyk(swatch)
		return `${number(c / 100)} ${number(m / 100)} ${number(y / 100)} ${number(k / 100)} k`
	}
	const { r, g, b } = resolvedRgb(swatch)
	return `${number(r / 255)} ${number(g / 255)} ${number(b / 255)} rg`
}

export function pdfContentStream(document: DesignDocument): string {
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const commands = ["q"]
	for (const object of document.objects) {
		if (object.hidden) continue
		const swatch = swatches.get(object.fillId)
		if (swatch === undefined) continue
		commands.push(fillOperator(swatch))
		for (const contour of object.contours) {
			commands.push(...contourCommands(contour, document.page.height))
		}
		commands.push("f*")
	}
	commands.push("Q")
	return commands.join("\n")
}

/**
 * Lowers a design document into mondrian.pdf's validated object IR. The
 * content stream remains low-level so cubic curves, even-odd fills, and native
 * DeviceCMYK colors are retained.
 */
export function createPdfIr(document: DesignDocument): PdfDocument {
	const content = pdfContentStream(document)
	const objects = createPdfObjectBuilder()
	const pages = objects.reserve<PdfPagesDictionary>()
	const contents = objects.add(stream({}, ascii(content)))
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, document.page.width, document.page.height),
			Resources: dictionary({}),
			Contents: contents,
		}) satisfies PdfPageDictionary,
	)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(page),
			Count: 1,
		}) satisfies PdfPagesDictionary,
	)
	const root = objects.add(
		dictionary({
			Type: name("Catalog"),
			Pages: pages.ref,
		}) satisfies PdfCatalogDictionary,
	)
	const info = objects.add(
		dictionary({
			Title: textString(document.title),
			Creator: asciiTextString("create-design"),
			Producer: asciiTextString("mondrian.pdf"),
		}) satisfies PdfInfoDictionary,
	)
	return objects.build({ version: "1.7", root, info })
}

/**
 * Serializes the validated mondrian.pdf IR. Each fill remains in its authored
 * RGB or CMYK space instead of being rasterized.
 */
export function exportPdf(document: DesignDocument): Uint8Array {
	return serializePdf(createPdfIr(document))
}

export function downloadPdf(document: DesignDocument): void {
	const blob = new Blob([exportPdf(document) as BlobPart], {
		type: "application/pdf",
	})
	const url = URL.createObjectURL(blob)
	const anchor = window.document.createElement("a")
	anchor.href = url
	anchor.download = `${document.title.trim() || "untitled"}.pdf`
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
