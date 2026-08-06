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
	projectDesignOutput,
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
import type { DesignTextService } from "@create-design/text"
import type {
	DesignContour,
	DesignArtboard,
	DesignDocument,
	DesignImageResource,
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
	textService?: DesignTextService,
	imageResourceName?: string,
): string {
	if (object.geometry.kind === "image") {
		if (imageResourceName === undefined) return ""
		const { a, b, c, d, e, f } = object.transform
		return [
			"q",
			`${number(a)} ${number(b)} ${number(c)} ${number(d)} ${number(e)} ${number(f)} cm`,
			`${number(object.geometry.intrinsicWidth)} 0 0 ${number(object.geometry.intrinsicHeight)} 0 0 cm`,
			`/${imageResourceName} Do`,
			"Q",
		].join("\n")
	}
	let projectedObject = object
	if (object.geometry.kind === "text") {
		const layout = textService?.layout(object)
		if (layout === undefined || layout === null)
			throw new Error(
				`Text object ${object.name || object.id} requires a registered canonical text service for PDF export.`,
			)
		const blocking = layout.diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		)
		if (blocking.length > 0)
			throw new Error(
				`Text object ${object.name || object.id} cannot be exported: ${blocking.map(({ message }) => message).join(" ")}`,
			)
		projectedObject = {
			...object,
			geometry: {
				kind: "path",
				fillRule: "nonzero",
				contours: layout.glyphs.flatMap(({ contours }) => contours),
			},
		}
	}
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
	for (const contour of projectDesignObjectContours(projectedObject)) {
		commands.push(...contourCommands(contour))
	}
	commands.push(
		fill !== undefined && paintedStroke !== undefined
			? designObjectFillRule(projectedObject) === "evenodd"
				? "B*"
				: "B"
			: fill !== undefined
				? designObjectFillRule(projectedObject) === "evenodd"
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
	readonly image?: Readonly<{
		colorSpace: "DeviceGray" | "DeviceRGB"
		bytes: Uint8Array
		height: number
		name: string
		sourceId: string
		width: number
	}>
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

export interface PdfProjectionOptions {
	/** Font-backed canonical layout used to lower editable text to outlines. */
	readonly textService?: DesignTextService
	readonly imageResources?: ReadonlyMap<string, DesignImageResource>
}

type ObjectCacheEntry = Readonly<{
	appearance: DesignObject["appearance"]
	geometry: DesignObject["geometry"]
	hidden: boolean
	imageResource: DesignImageResource | null
	maskSignature: string
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

function pdfImageName(sourceId: string): string {
	let hash = 0x811c9dc5
	for (const byte of new TextEncoder().encode(sourceId))
		hash = Math.imul(hash ^ byte, 0x01000193)
	return `Im${(hash >>> 0).toString(16)}`
}

function jpegFrame(bytes: Uint8Array): Readonly<{
	colorSpace: "DeviceGray" | "DeviceRGB"
	height: number
	width: number
}> {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
		throw new Error("Placed PDF images require valid JPEG bytes.")
	for (let offset = 2; offset + 8 < bytes.length;) {
		if (bytes[offset] !== 0xff) {
			offset += 1
			continue
		}
		const marker = bytes[offset + 1]!
		if (marker === 0xd9 || marker === 0xda) break
		if (marker === 0x00 || marker === 0xff) {
			offset += 1
			continue
		}
		const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
		if (length < 2 || offset + 2 + length > bytes.length)
			throw new Error("Placed JPEG has a malformed segment length.")
		if (marker === 0xc0) {
			const precision = bytes[offset + 4]
			const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
			const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
			const components = bytes[offset + 9]
			if (precision !== 8 || (components !== 1 && components !== 3))
				throw new Error(
					"PDF export supports baseline 8-bit grayscale or RGB JPEG images.",
				)
			return {
				colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
				height,
				width,
			}
		}
		if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8)
			throw new Error("PDF export supports baseline JPEG images only.")
		offset += 2 + length
	}
	throw new Error("Placed JPEG is missing a baseline frame.")
}

function clippingContent(
	document: DesignDocument,
	maskGroupIds: readonly string[],
): Readonly<{ prefix: string; suffix: string }> {
	const groups = new Map(document.groups.map((group) => [group.id, group]))
	const objects = new Map(document.objects.map((object) => [object.id, object]))
	const commands: string[] = []
	for (const groupId of maskGroupIds) {
		const clippingPathId = groups.get(groupId)?.clippingPathId
		const clippingObject =
			clippingPathId === undefined ? undefined : objects.get(clippingPathId)
		if (clippingObject === undefined) continue
		commands.push("q")
		for (const contour of projectDesignObjectContours(clippingObject))
			commands.push(...contourCommands(contour))
		commands.push(
			designObjectFillRule(clippingObject) === "evenodd" ? "W* n" : "W n",
		)
	}
	return {
		prefix: commands.join("\n"),
		suffix: maskGroupIds.map(() => "Q").join("\n"),
	}
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
export function createPdfProjectionGraph(
	options: PdfProjectionOptions = {},
): PdfProjectionGraph {
	const objects = new Map<string, ObjectCacheEntry>()
	const pageCaches = new Map<string, PdfPageProjection>()
	let documentCache: Readonly<{
		projection: PdfDocumentProjection
		title: string
	}> | null = null

	const projectObject = (
		object: DesignObject,
		swatches: ReadonlyMap<string, DesignSwatch>,
		document: DesignDocument,
		maskGroupIds: readonly string[],
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
		const imageResource =
			object.geometry.kind === "image"
				? (options.imageResources?.get(object.geometry.source.id) ?? null)
				: null
		if (!hidden && object.geometry.kind === "image" && imageResource === null)
			throw new Error(
				`${object.name || object.id} is missing image resource ${object.geometry.source.id}.`,
			)
		if (
			object.geometry.kind === "image" &&
			imageResource?.mediaType !== undefined &&
			imageResource.mediaType !== object.geometry.mediaType
		)
			throw new Error(
				`${object.name || object.id} resolved with mismatched image type ${imageResource.mediaType}.`,
			)
		if (
			!hidden &&
			object.geometry.kind === "image" &&
			object.geometry.mediaType !== "image/jpeg"
		)
			throw new Error("PDF export currently supports JPEG placed images.")
		const maskSignature = maskGroupIds
			.map((id) => {
				const group = document.groups.find((candidate) => candidate.id === id)
				const clipping = document.objects.find(
					(candidate) => candidate.id === group?.clippingPathId,
				)
				return `${id}:${group?.clippingPathId ?? ""}:${JSON.stringify(clipping?.geometry)}:${JSON.stringify(clipping?.transform)}`
			})
			.join("|")
		const cached = objects.get(object.id)
		if (
			cached !== undefined &&
			cached.geometry === object.geometry &&
			cached.transform === object.transform &&
			cached.appearance === object.appearance &&
			cached.hidden === hidden &&
			cached.imageResource === imageResource &&
			cached.maskSignature === maskSignature &&
			cached.swatchSignature === swatchSignature
		) {
			return cached.projection
		}
		const image = (() => {
			if (object.geometry.kind !== "image" || imageResource === null)
				return undefined
			const frame = jpegFrame(imageResource.bytes)
			if (
				frame.width !== object.geometry.intrinsicWidth ||
				frame.height !== object.geometry.intrinsicHeight
			)
				throw new Error(
					`${object.name || object.id} intrinsic dimensions do not match its JPEG source.`,
				)
			return Object.freeze({
				...frame,
				bytes: imageResource.bytes,
				name: pdfImageName(imageResource.id),
				sourceId: imageResource.id,
			})
		})()
		const clip = clippingContent(document, maskGroupIds)
		const body =
			hidden ||
			(object.geometry.kind !== "image" &&
				fill === undefined &&
				stroke === undefined)
				? ""
				: pdfObjectContentStream(
						object,
						fill,
						stroke,
						options.textService,
						image?.name,
					)
		const projection = Object.freeze({
			id: object.id,
			stream: stream(
				{},
				ascii([clip.prefix, body, clip.suffix].filter(Boolean).join("\n")),
			),
			visible: !hidden,
			...(image === undefined ? {} : { image }),
		}) satisfies PdfObjectProjection
		objects.set(
			object.id,
			Object.freeze({
				appearance: object.appearance,
				geometry: object.geometry,
				hidden,
				imageResource,
				maskSignature,
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
		const imageReferences = new Map<string, PdfReference<PdfStream>>()
		for (const projection of projectedPages.flatMap(
			({ objectProjections }) => objectProjections,
		)) {
			const image = projection.image
			if (image === undefined || imageReferences.has(image.sourceId)) continue
			imageReferences.set(
				image.sourceId,
				builder.add(
					stream(
						{
							Type: name("XObject"),
							Subtype: name("Image"),
							Width: image.width,
							Height: image.height,
							ColorSpace: name(image.colorSpace),
							BitsPerComponent: 8,
							Filter: name("DCTDecode"),
						},
						image.bytes,
					),
				),
			)
		}
		const pageReferences = projectedPages.map((projectedPage) => {
			const mediaBox = projectedPage.mediaBox
			const trimBox = projectedPage.trimBox
			const bleedBox = projectedPage.bleedBox
			const xObjects = Object.fromEntries(
				projectedPage.objectProjections.flatMap((projection) => {
					const image = projection.image
					const reference =
						image === undefined
							? undefined
							: imageReferences.get(image.sourceId)
					return image === undefined || reference === undefined
						? []
						: [[image.name, reference] as const]
				}),
			)
			return builder.add(
				dictionary({
					Type: name("Page"),
					Parent: pages.ref,
					MediaBox: array(...mediaBox),
					...(trimBox === undefined ? {} : { TrimBox: array(...trimBox) }),
					...(bleedBox === undefined ? {} : { BleedBox: array(...bleedBox) }),
					Resources: dictionary(
						Object.keys(xObjects).length === 0
							? {}
							: { XObject: dictionary(xObjects) },
					),
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
			const output = projectDesignOutput(document)
			const errors = output.diagnostics.filter(
				({ severity }) => severity === "error",
			)
			if (errors.length > 0) throw new PdfBlendProjectionError(errors)
			const authoredDocument = document
			document = {
				...document,
				objects: output.objects,
				swatches: output.swatches,
			}
			const swatches = new Map(
				document.swatches.map((swatch) => [swatch.id, swatch]),
			)
			const activeIds = new Set(document.objects.map(({ id }) => id))
			for (const id of objects.keys()) {
				if (!activeIds.has(id)) objects.delete(id)
			}
			const objectProjections = output.entries.map((entry) =>
				projectObject(
					entry.object,
					swatches,
					authoredDocument,
					entry.maskGroupIds,
				),
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
	options: PdfProjectionOptions = {},
): string {
	const authoredDocument = document
	const output = projectDesignOutput(document)
	const errors = output.diagnostics.filter(
		({ severity }) => severity === "error",
	)
	if (errors.length > 0) throw new PdfBlendProjectionError(errors)
	document = { ...document, objects: output.objects, swatches: output.swatches }
	const swatches = new Map(
		document.swatches.map((swatch) => [swatch.id, swatch]),
	)
	const transform = documentToPdfTransform(artboard)
	const commands = [
		`q`,
		`0 0 ${number(artboard.width)} ${number(artboard.height)} re W n`,
		`${number(transform.a)} ${number(transform.b)} ${number(transform.c)} ${number(transform.d)} ${number(transform.e)} ${number(transform.f)} cm`,
	]
	for (const entry of output.entries) {
		const object = entry.object
		if (object.hidden) continue
		const fill =
			object.appearance.fill === undefined
				? undefined
				: swatches.get(object.appearance.fill.swatchId)
		const stroke =
			object.appearance.stroke === undefined
				? undefined
				: swatches.get(object.appearance.stroke.swatchId)
		if (
			object.geometry.kind !== "image" &&
			fill === undefined &&
			stroke === undefined
		)
			continue
		const imageResourceName =
			object.geometry.kind === "image"
				? pdfImageName(object.geometry.source.id)
				: undefined
		if (
			object.geometry.kind === "image" &&
			options.imageResources?.get(object.geometry.source.id) === undefined
		)
			throw new Error(
				`${object.name || object.id} is missing image resource ${object.geometry.source.id}.`,
			)
		const clip = clippingContent(authoredDocument, entry.maskGroupIds)
		commands.push(
			clip.prefix,
			pdfObjectContentStream(
				object,
				fill,
				stroke,
				options.textService,
				imageResourceName,
			),
			clip.suffix,
		)
	}
	commands.push("Q")
	return commands.join("\n")
}

export function createPdfIr(
	document: DesignDocument,
	target: PdfExportTarget = activeDesignArtboard(document),
	options: PdfProjectionOptions = {},
): PdfDocument {
	return createPdfProjectionGraph(options).project(document, target).document
}

export function exportPdf(
	document: DesignDocument,
	target: PdfExportTarget = activeDesignArtboard(document),
	options: PdfProjectionOptions = {},
): Uint8Array {
	return serializePdf(createPdfIr(document, target, options))
}
