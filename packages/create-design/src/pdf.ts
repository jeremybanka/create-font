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
	type PdfStream,
} from "mondrian.pdf"

import { resolvedCmyk, resolvedRgb } from "./color.ts"
import { documentToPdfTransform } from "./coordinates.ts"
import { projectDesignObjectContours } from "./geometry.ts"
import type {
	DesignContour,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSwatch,
} from "./types.ts"

const number = (value: number): string => Number(value.toFixed(4)).toString()

function pdfPoint(point: Readonly<{ x: number; y: number }>): string {
	return `${number(point.x)} ${number(point.y)}`
}

function segment(from: DesignPoint, to: DesignPoint): string {
	if (from.outgoing === undefined && to.incoming === undefined) {
		return `${pdfPoint(to)} l`
	}
	const first = from.outgoing ?? { x: 0, y: 0 }
	const second = to.incoming ?? { x: 0, y: 0 }
	return [
		pdfPoint({ x: from.x + first.x, y: from.y + first.y }),
		pdfPoint({ x: to.x + second.x, y: to.y + second.y }),
		pdfPoint(to),
		"c",
	].join(" ")
}

function contourCommands(contour: DesignContour): readonly string[] {
	const first = contour.points[0]
	if (first === undefined) return []
	const commands = [`${pdfPoint(first)} m`]
	for (let index = 1; index < contour.points.length; index += 1) {
		const previous = contour.points[index - 1]
		const point = contour.points[index]
		if (previous !== undefined && point !== undefined) {
			commands.push(segment(previous, point))
		}
	}
	if (contour.closed && contour.points.length > 1) {
		const last = contour.points.at(-1)
		if (last !== undefined) commands.push(segment(last, first))
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

function strokeOperator(swatch: DesignSwatch): string {
	return fillOperator(swatch).replace(/ k$/u, " K").replace(/ rg$/u, " RG")
}

function colorSignature(swatch: DesignSwatch): string {
	const source = swatch.source
	return source.space === "rgb"
		? `rgb:${source.r}:${source.g}:${source.b}`
		: `cmyk:${source.c}:${source.m}:${source.y}:${source.k}`
}

export function pdfObjectContentStream(
	object: DesignObject,
	fill?: DesignSwatch,
	stroke?: DesignSwatch,
): string {
	const commands = [
		...(fill === undefined ? [] : [fillOperator(fill)]),
		...(stroke === undefined
			? []
			: [
					strokeOperator(stroke),
					`${number(object.appearance.stroke?.width ?? 0)} w`,
				]),
	]
	for (const contour of projectDesignObjectContours(object)) {
		commands.push(...contourCommands(contour))
	}
	commands.push(
		fill !== undefined && stroke !== undefined
			? "B*"
			: fill !== undefined
				? "f*"
				: "S",
	)
	return commands.join("\n")
}

export interface PdfObjectProjection {
	readonly id: string
	readonly stream: PdfStream
	readonly visible: boolean
}

export interface PdfPageProjection {
	readonly x: number
	readonly y: number
	readonly height: number
	readonly objectProjections: readonly PdfObjectProjection[]
	readonly prefix: PdfStream
	readonly suffix: PdfStream
	readonly width: number
}

export interface PdfDocumentProjection {
	readonly document: PdfDocument
	readonly page: PdfPageProjection
}

export interface PdfProjectionGraph {
	project(document: DesignDocument): PdfDocumentProjection
}

type ObjectCacheEntry = Readonly<{
	appearance: DesignObject["appearance"]
	geometry: DesignObject["geometry"]
	hidden: boolean
	projection: PdfObjectProjection
	swatchSignature: string
	transform: DesignObject["transform"]
}>

function sameOrderedProjections(
	left: readonly PdfObjectProjection[],
	right: readonly PdfObjectProjection[],
): boolean {
	return (
		left.length === right.length &&
		left.every((projection, index) => projection === right[index])
	)
}

/**
 * Owns create-design's semantic PDF invalidation boundaries. Cached streams
 * are ordinary immutable mondrian.pdf values and can be inserted into each
 * freshly composed, fully validated document graph.
 */
export function createPdfProjectionGraph(): PdfProjectionGraph {
	const objects = new Map<string, ObjectCacheEntry>()
	let pageCache: PdfPageProjection | null = null
	let documentCache: Readonly<{
		projection: PdfDocumentProjection
		title: string
	}> | null = null

	const projectObject = (
		object: DesignObject,
		swatches: ReadonlyMap<string, DesignSwatch>,
	): PdfObjectProjection => {
		const hidden = object.hidden === true
		const fillId = object.appearance.fill?.swatchId
		const strokeId = object.appearance.stroke?.swatchId
		const fill = fillId === undefined ? undefined : swatches.get(fillId)
		const stroke = strokeId === undefined ? undefined : swatches.get(strokeId)
		const missingId =
			fillId !== undefined && fill === undefined
				? fillId
				: strokeId !== undefined && stroke === undefined
					? strokeId
					: undefined
		if (!hidden && missingId !== undefined) {
			throw new Error(
				`Object ${object.name || object.id} references missing swatch ${missingId}.`,
			)
		}
		const swatchSignature = [
			fill === undefined ? "none" : `fill:${colorSignature(fill)}`,
			stroke === undefined ? "none" : `stroke:${colorSignature(stroke)}`,
		].join("|")
		const cached = objects.get(object.id)
		if (
			cached !== undefined &&
			cached.geometry === object.geometry &&
			cached.transform === object.transform &&
			cached.appearance === object.appearance &&
			cached.hidden === hidden &&
			cached.swatchSignature === swatchSignature
		) {
			return cached.projection
		}
		const projection = Object.freeze({
			id: object.id,
			stream: stream(
				{},
				ascii(
					hidden || (fill === undefined && stroke === undefined)
						? ""
						: pdfObjectContentStream(object, fill, stroke),
				),
			),
			visible: !hidden,
		}) satisfies PdfObjectProjection
		objects.set(
			object.id,
			Object.freeze({
				appearance: object.appearance,
				geometry: object.geometry,
				hidden,
				projection,
				swatchSignature,
				transform: object.transform,
			}),
		)
		return projection
	}

	const projectPage = (
		document: DesignDocument,
		objectProjections: readonly PdfObjectProjection[],
	): PdfPageProjection => {
		const cached = pageCache
		if (
			cached !== null &&
			cached.x === document.page.x &&
			cached.y === document.page.y &&
			cached.width === document.page.width &&
			cached.height === document.page.height &&
			sameOrderedProjections(cached.objectProjections, objectProjections)
		) {
			return cached
		}
		const transform = documentToPdfTransform(document.page)
		pageCache = Object.freeze({
			x: document.page.x,
			y: document.page.y,
			height: document.page.height,
			objectProjections: Object.freeze(objectProjections),
			prefix: stream(
				{},
				ascii(
					`q\n${number(transform.a)} ${number(transform.b)} ${number(transform.c)} ${number(transform.d)} ${number(transform.e)} ${number(transform.f)} cm`,
				),
			),
			suffix: stream({}, ascii("Q")),
			width: document.page.width,
		})
		return pageCache
	}

	const projectDocument = (
		title: string,
		page: PdfPageProjection,
	): PdfDocumentProjection => {
		if (
			documentCache !== null &&
			documentCache.title === title &&
			documentCache.projection.page === page
		) {
			return documentCache.projection
		}
		const builder = createPdfObjectBuilder()
		const pages = builder.reserve<PdfPagesDictionary>()
		const contents = [
			builder.add(page.prefix),
			...page.objectProjections
				.filter(({ visible }) => visible)
				.map(({ stream: objectStream }) => builder.add(objectStream)),
			builder.add(page.suffix),
		]
		const pageReference = builder.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, page.width, page.height),
				Resources: dictionary({}),
				Contents: array(...contents),
			}) satisfies PdfPageDictionary,
		)
		pages.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(pageReference),
				Count: 1,
			}) satisfies PdfPagesDictionary,
		)
		const root = builder.add(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
			}) satisfies PdfCatalogDictionary,
		)
		const info = builder.add(
			dictionary({
				Title: textString(title),
				Creator: asciiTextString("create-design"),
				Producer: asciiTextString("mondrian.pdf"),
			}) satisfies PdfInfoDictionary,
		)
		const projection = Object.freeze({
			document: builder.build({ version: "1.7", root, info }),
			page,
		}) satisfies PdfDocumentProjection
		documentCache = Object.freeze({ projection, title })
		return projection
	}

	return {
		project(document) {
			const swatches = new Map(
				document.swatches.map((swatch) => [swatch.id, swatch]),
			)
			const activeIds = new Set(document.objects.map(({ id }) => id))
			for (const id of objects.keys()) {
				if (!activeIds.has(id)) objects.delete(id)
			}
			const objectProjections = document.objects.map((object) =>
				projectObject(object, swatches),
			)
			return projectDocument(
				document.title,
				projectPage(document, objectProjections),
			)
		},
	}
}

export function pdfContentStream(document: DesignDocument): string {
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const transform = documentToPdfTransform(document.page)
	const commands = [
		`q`,
		`${number(transform.a)} ${number(transform.b)} ${number(transform.c)} ${number(transform.d)} ${number(transform.e)} ${number(transform.f)} cm`,
	]
	for (const object of document.objects) {
		if (object.hidden) continue
		const fill =
			object.appearance.fill === undefined
				? undefined
				: swatches.get(object.appearance.fill.swatchId)
		const stroke =
			object.appearance.stroke === undefined
				? undefined
				: swatches.get(object.appearance.stroke.swatchId)
		if (fill === undefined && stroke === undefined) continue
		commands.push(pdfObjectContentStream(object, fill, stroke))
	}
	commands.push("Q")
	return commands.join("\n")
}

export function createPdfIr(document: DesignDocument): PdfDocument {
	return createPdfProjectionGraph().project(document).document
}

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
