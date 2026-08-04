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
	type PdfReference,
	type PdfStream,
} from "mondrian.pdf"

import {
	projectDesignDocumentBlends,
	resolvedCmyk,
	resolvedRgb,
	type DesignBlendDiagnostic,
} from "@create-design/model"
import { activeDesignArtboard } from "@create-design/model"
import { documentToPdfTransform } from "@create-design/model"
import {
	designObjectFillRule,
	projectDesignObjectContours,
} from "@create-design/model"
import type {
	DesignContour,
	DesignArtboard,
	DesignDocument,
	DesignObject,
	DesignPoint,
	DesignSwatch,
} from "@create-design/source"

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

const PDF_LINE_CAP = { butt: 0, round: 1, square: 2 } as const
const PDF_LINE_JOIN = { miter: 0, round: 1, bevel: 2 } as const

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
	const authoredStroke = object.appearance.stroke
	const paintedStroke =
		stroke !== undefined &&
		authoredStroke !== undefined &&
		authoredStroke.width > 0
			? authoredStroke
			: undefined
	if (fill === undefined && paintedStroke === undefined) return ""
	const commands = [
		...(fill === undefined ? [] : [fillOperator(fill)]),
		...(stroke === undefined || paintedStroke === undefined
			? []
			: [
					strokeOperator(stroke),
					`${number(paintedStroke.width)} w`,
					`${PDF_LINE_CAP[paintedStroke.cap]} J`,
					`${PDF_LINE_JOIN[paintedStroke.join]} j`,
					`${number(paintedStroke.miterLimit)} M`,
					`[${paintedStroke.dashArray.map(number).join(" ")}] ${number(
						paintedStroke.dashOffset,
					)} d`,
				]),
	]
	for (const contour of projectDesignObjectContours(object)) {
		commands.push(...contourCommands(contour))
	}
	commands.push(
		fill !== undefined && paintedStroke !== undefined
			? designObjectFillRule(object) === "evenodd"
				? "B*"
				: "B"
			: fill !== undefined
				? designObjectFillRule(object) === "evenodd"
					? "f*"
					: "f"
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
	readonly artboardId: string
	readonly bleedBox?: readonly [number, number, number, number]
	readonly x: number
	readonly y: number
	readonly height: number
	readonly mediaBox: readonly [number, number, number, number]
	readonly objectProjections: readonly PdfObjectProjection[]
	readonly prefix: PdfStream
	readonly suffix: PdfStream
	readonly trimBox?: readonly [number, number, number, number]
	readonly width: number
}

export interface PdfDocumentProjection {
	readonly document: PdfDocument
	readonly page: PdfPageProjection
	readonly pages: readonly PdfPageProjection[]
}

export type PdfExportScope =
	| Readonly<{ kind: "active"; artboardId: string }>
	| Readonly<{ kind: "all" }>
	| Readonly<{ kind: "selected"; artboardIds: readonly string[] }>
	| Readonly<{ kind: "range"; startArtboardId: string; endArtboardId: string }>

export interface PdfExportRequest {
	readonly includeBleed?: boolean
	readonly scope: PdfExportScope
}

export type PdfExportTarget = DesignArtboard | PdfExportRequest

export interface PdfProjectionGraph {
	project(
		document: DesignDocument,
		target?: PdfExportTarget,
	): PdfDocumentProjection
}

/** Raised when a live blend cannot be lowered into ordinary PDF paths. */
export class PdfBlendProjectionError extends Error {
	readonly diagnostics: readonly DesignBlendDiagnostic[]

	constructor(diagnostics: readonly DesignBlendDiagnostic[]) {
		super(diagnostics.map(({ message }) => message).join("\n"))
		this.name = "PdfBlendProjectionError"
		this.diagnostics = diagnostics
	}
}

function projectedBlendDocument(document: DesignDocument): DesignDocument {
	const projection = projectDesignDocumentBlends(document)
	const errors = projection.diagnostics.filter(
		({ severity }) => severity === "error",
	)
	if (errors.length > 0) throw new PdfBlendProjectionError(errors)
	return {
		...document,
		objects: projection.objects,
		swatches: projection.swatches,
	}
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

function isArtboard(target: PdfExportTarget): target is DesignArtboard {
	return "id" in target
}

function exportRequest(
	document: DesignDocument,
	target: PdfExportTarget = activeDesignArtboard(document),
): PdfExportRequest {
	return isArtboard(target)
		? { scope: { kind: "active", artboardId: target.id } }
		: target
}

export function resolvePdfArtboards(
	document: DesignDocument,
	target?: PdfExportTarget,
): readonly DesignArtboard[] {
	if (target !== undefined && isArtboard(target)) return [target]
	const request = exportRequest(document, target)
	const scope = request.scope
	if (scope.kind === "all") return document.artboards
	if (scope.kind === "selected") {
		const selected = new Set(scope.artboardIds)
		const artboards = document.artboards.filter(({ id }) => selected.has(id))
		if (artboards.length === 0)
			throw new Error("PDF export requires at least one selected artboard.")
		return artboards
	}
	if (scope.kind === "range") {
		const start = document.artboards.findIndex(
			({ id }) => id === scope.startArtboardId,
		)
		const end = document.artboards.findIndex(
			({ id }) => id === scope.endArtboardId,
		)
		if (start < 0 || end < 0)
			throw new Error("PDF export range references an unknown artboard.")
		return document.artboards.slice(
			Math.min(start, end),
			Math.max(start, end) + 1,
		)
	}
	const artboard = document.artboards.find(({ id }) => id === scope.artboardId)
	if (artboard === undefined)
		throw new Error(
			`PDF export references unknown artboard ${scope.artboardId}.`,
		)
	return [artboard]
}

/**
 * Owns create-design's semantic PDF invalidation boundaries. Cached streams
 * are ordinary immutable mondrian.pdf values and can be inserted into each
 * freshly composed, fully validated document graph.
 */
export function createPdfProjectionGraph(): PdfProjectionGraph {
	const objects = new Map<string, ObjectCacheEntry>()
	const pageCaches = new Map<string, PdfPageProjection>()
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
		artboard: DesignArtboard,
		objectProjections: readonly PdfObjectProjection[],
		includeBleed: boolean,
	): PdfPageProjection => {
		const cacheKey = `${artboard.id}:${includeBleed ? "bleed" : "trim"}`
		const cached = pageCaches.get(cacheKey)
		const bleed = includeBleed ? artboard.bleed : undefined
		if (
			cached !== undefined &&
			cached.artboardId === artboard.id &&
			cached.x === artboard.x &&
			cached.y === artboard.y &&
			cached.width === artboard.width &&
			cached.height === artboard.height &&
			(cached.trimBox !== undefined) === (bleed !== undefined) &&
			(cached.trimBox?.[0] ?? 0) === (bleed?.left ?? 0) &&
			(cached.trimBox?.[1] ?? 0) === (bleed?.bottom ?? 0) &&
			cached.mediaBox[2] ===
				artboard.width + (bleed?.left ?? 0) + (bleed?.right ?? 0) &&
			cached.mediaBox[3] ===
				artboard.height + (bleed?.top ?? 0) + (bleed?.bottom ?? 0) &&
			sameOrderedProjections(cached.objectProjections, objectProjections)
		) {
			return cached
		}
		const left = bleed?.left ?? 0
		const bottom = bleed?.bottom ?? 0
		const mediaWidth = artboard.width + left + (bleed?.right ?? 0)
		const mediaHeight = artboard.height + bottom + (bleed?.top ?? 0)
		const transform = documentToPdfTransform(artboard)
		const projection = Object.freeze({
			artboardId: artboard.id,
			...(bleed === undefined
				? {}
				: {
						bleedBox: [0, 0, mediaWidth, mediaHeight] as const,
						trimBox: [
							left,
							bottom,
							left + artboard.width,
							bottom + artboard.height,
						] as const,
					}),
			x: artboard.x,
			y: artboard.y,
			height: artboard.height,
			mediaBox: [0, 0, mediaWidth, mediaHeight] as const,
			objectProjections: Object.freeze(objectProjections),
			prefix: stream(
				{},
				ascii(
					[
						"q",
						`0 0 ${number(mediaWidth)} ${number(mediaHeight)} re W n`,
						`${number(transform.a)} ${number(transform.b)} ${number(transform.c)} ${number(transform.d)} ${number(transform.e + left)} ${number(transform.f + bottom)} cm`,
					].join("\n"),
				),
			),
			suffix: stream({}, ascii("Q")),
			width: artboard.width,
		})
		pageCaches.set(cacheKey, projection)
		return projection
	}

	const projectDocument = (
		title: string,
		projectedPages: readonly PdfPageProjection[],
	): PdfDocumentProjection => {
		if (
			documentCache !== null &&
			documentCache.title === title &&
			documentCache.projection.pages.length === projectedPages.length &&
			documentCache.projection.pages.every(
				(page, index) => page === projectedPages[index],
			)
		) {
			return documentCache.projection
		}
		const page = projectedPages[0]
		if (page === undefined)
			throw new Error("PDF export requires at least one artboard.")
		const builder = createPdfObjectBuilder()
		const pages = builder.reserve<PdfPagesDictionary>()
		const objectReferences = new Map<
			PdfObjectProjection,
			PdfReference<PdfStream>
		>()
		for (const projection of projectedPages.flatMap(
			({ objectProjections }) => objectProjections,
		)) {
			if (projection.visible && !objectReferences.has(projection))
				objectReferences.set(projection, builder.add(projection.stream))
		}
		const pageReferences = projectedPages.map((projectedPage) => {
			const mediaBox = projectedPage.mediaBox
			const trimBox = projectedPage.trimBox
			const bleedBox = projectedPage.bleedBox
			return builder.add(
				dictionary({
					Type: name("Page"),
					Parent: pages.ref,
					MediaBox: array(...mediaBox),
					...(trimBox === undefined ? {} : { TrimBox: array(...trimBox) }),
					...(bleedBox === undefined ? {} : { BleedBox: array(...bleedBox) }),
					Resources: dictionary({}),
					Contents: array(
						builder.add(projectedPage.prefix),
						...projectedPage.objectProjections.flatMap((projection) => {
							const reference = objectReferences.get(projection)
							return reference === undefined ? [] : [reference]
						}),
						builder.add(projectedPage.suffix),
					),
				}) satisfies PdfPageDictionary,
			)
		})
		pages.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(...pageReferences),
				Count: pageReferences.length,
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
			pages: Object.freeze(projectedPages),
		}) satisfies PdfDocumentProjection
		documentCache = Object.freeze({ projection, title })
		return projection
	}

	return {
		project(document, target = activeDesignArtboard(document)) {
			document = projectedBlendDocument(document)
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
			const request = exportRequest(document, target)
			const includeBleed = request.includeBleed === true
			const artboards = isArtboard(target)
				? [target]
				: resolvePdfArtboards(document, request)
			return projectDocument(
				document.title,
				artboards.map((artboard) =>
					projectPage(artboard, objectProjections, includeBleed),
				),
			)
		},
	}
}

export function pdfContentStream(
	document: DesignDocument,
	artboard: DesignArtboard = activeDesignArtboard(document),
): string {
	document = projectedBlendDocument(document)
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const transform = documentToPdfTransform(artboard)
	const commands = [
		`q`,
		`0 0 ${number(artboard.width)} ${number(artboard.height)} re W n`,
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

export function createPdfIr(
	document: DesignDocument,
	target: PdfExportTarget = activeDesignArtboard(document),
): PdfDocument {
	return createPdfProjectionGraph().project(document, target).document
}

export function exportPdf(
	document: DesignDocument,
	target: PdfExportTarget = activeDesignArtboard(document),
): Uint8Array {
	return serializePdf(createPdfIr(document, target))
}
