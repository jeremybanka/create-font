import { inflateSync } from "node:zlib"

import { validateDesignDocument } from "@create-design/source"
import type {
	ColorDefinition,
	DesignAppearance,
	DesignContour,
	DesignDocument,
	DesignGroup,
	DesignLayer,
	DesignObject,
	DesignPoint,
	DesignSceneChild,
	DesignSwatch,
	DesignTransform,
} from "@create-design/source"

import type {
	IllustratorImportDiagnostic,
	IllustratorImportOptions,
	IllustratorImportResult,
} from "./types.ts"

type PdfObject = Readonly<{
	body: string
	dictionary: string
	id: number
	stream?: Uint8Array
}>

type PdfToken = number | string | readonly PdfToken[]

type TokenizedStream = Readonly<{
	count: number
	hadInlineImage: boolean
	tokens: readonly PdfToken[]
}>

type Paint = Readonly<{ color: ColorDefinition; key: string }> | null

type ClipPath = Readonly<{
	contours: readonly DesignContour[]
	fillRule: "evenodd" | "nonzero"
	transform: DesignTransform
}>

type GraphicsState = {
	ctm: DesignTransform
	dashArray: readonly number[]
	dashOffset: number
	fill: Paint
	lineCap: "butt" | "round" | "square"
	lineJoin: "miter" | "round" | "bevel"
	miterLimit: number
	stroke: Paint
	strokeWidth: number
	clips: readonly ClipPath[]
}

const decoder = new TextDecoder("latin1")
const numberPattern = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`
const IDENTITY_DESIGN_TRANSFORM: DesignTransform = Object.freeze({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: 0,
	f: 0,
})
const DEFAULT_MITER_LIMIT = 4
const LAYER_UI_COLORS = [
	"red",
	"blue",
	"yellow",
	"purple",
	"green",
	"pink",
	"cyan",
	"orange",
	"indigo",
	"lime",
	"magenta",
	"teal",
] as const
export const MAX_ILLUSTRATOR_FILE_BYTES = 256 * 1024 * 1024
const MAX_OBJECTS = 100_000
const MAX_PAGES = 1_000
const MAX_COMPRESSED_STREAM_BYTES = 64 * 1024 * 1024
const MAX_DECODED_STREAM_BYTES = 128 * 1024 * 1024
const MAX_CONTENT_TOKENS = 2_000_000
const MAX_TOTAL_DECODED_BYTES = 256 * 1024 * 1024
const MAX_EXECUTED_TOKENS = 10_000_000
const MAX_PATH_POINTS = 2_000_000
const MAX_FORM_EXPANSIONS = 1_000
const MAX_NATIVE_OBJECTS = 100_000
const MAX_NATIVE_GROUPS = 100_000
const MAX_NATIVE_LAYERS = 10_000
const MAX_EMITTED_POINTS = 2_000_000
const MAX_EMITTED_DASH_ELEMENTS = 2_000_000
const MAX_DASH_ARRAY_ELEMENTS = 256
const MAX_ACTIVE_CLIPS = 128
const MAX_INTERPRETER_NESTING = 256
const MAX_LAYER_NAME_LENGTH = 256
const MAX_TITLE_LENGTH = 512

type LayerSpec = Readonly<{ hidden: boolean; name: string }>

type PageEntry = Readonly<{
	ancestors: readonly string[]
	id: number
}>

function failure(
	diagnostics: readonly IllustratorImportDiagnostic[],
): IllustratorImportResult {
	return {
		diagnostics: Object.freeze([...diagnostics]),
		document: null,
		ok: false,
		summary: { artboards: 0, objects: 0, swatches: 0 },
	}
}

function multiply(
	left: DesignTransform,
	right: DesignTransform,
): DesignTransform {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f,
	}
}

function findPdfKeyword(
	source: string,
	start: number,
	keywords: readonly string[],
): Readonly<{ index: number; keyword: string }> | undefined {
	const delimiter = (character: string | undefined): boolean =>
		character === undefined || /[\s()<>{}[\]/%]/u.test(character)
	for (let index = start; index < source.length; index++) {
		const character = source[index]!
		if (character === "%") {
			const end = source.indexOf("\n", index + 1)
			if (end < 0) return
			index = end
			continue
		}
		if (character === "/") {
			while (index + 1 < source.length && !delimiter(source[index + 1])) index++
			continue
		}
		if (character === "(") {
			let depth = 1
			for (index++; index < source.length && depth > 0; index++) {
				if (source[index] === "\\") index++
				else if (source[index] === "(") depth++
				else if (source[index] === ")") depth--
			}
			index--
			continue
		}
		if (character === "<" && source[index + 1] !== "<") {
			const end = source.indexOf(">", index + 1)
			if (end < 0) return
			index = end
			continue
		}
		for (const keyword of keywords)
			if (
				source.startsWith(keyword, index) &&
				delimiter(source[index - 1]) &&
				delimiter(source[index + keyword.length]) &&
				(keyword !== "stream" ||
					/[\r\n]/u.test(source[index + keyword.length] ?? ""))
			)
				return { index, keyword }
	}
	return
}

function parseObjects(bytes: Uint8Array): Map<number, PdfObject> {
	const source = decoder.decode(bytes)
	const objects = new Map<number, PdfObject>()
	const objectPattern = /(?:^|[\r\n])(\d+)\s+\d+\s+obj\b/gu
	let cursor = 0
	while (cursor < source.length) {
		objectPattern.lastIndex = cursor
		const match = objectPattern.exec(source)
		if (match === null) break
		const id = Number(match[1])
		const start = match.index + match[0].length
		const marker = findPdfKeyword(source, start, ["stream", "endobj"])
		if (marker === undefined) break
		if (marker.keyword === "endobj") {
			const body = source.slice(start, marker.index)
			const dictionary = body
			objects.set(id, { body, dictionary, id })
			cursor = marker.index + 6
			continue
		}
		const streamMarker = marker.index
		const dictionary = source.slice(start, streamMarker)
		let streamStart = streamMarker + 6
		if (bytes[streamStart] === 13) streamStart++
		if (bytes[streamStart] === 10) streamStart++
		const directLength = new RegExp(
			String.raw`/Length\s+(\d+)(?!\s+\d+\s+R)`,
			"u",
		).exec(dictionary)
		let streamEnd =
			directLength === null
				? source.indexOf("endstream", streamStart)
				: streamStart + Number(directLength[1])
		if (streamEnd < streamStart) break
		if (directLength === null)
			while (bytes[streamEnd - 1] === 10 || bytes[streamEnd - 1] === 13)
				streamEnd--
		const endStream = source.indexOf("endstream", streamEnd)
		const endObject = source.indexOf(
			"endobj",
			endStream < 0 ? streamEnd : endStream + 9,
		)
		if (endObject < 0) break
		objects.set(id, {
			body: source.slice(start, endObject),
			dictionary,
			id,
			stream: bytes.slice(streamStart, streamEnd),
		})
		cursor = endObject + 6
		if (objects.size > MAX_OBJECTS) break
	}
	return objects
}

function references(value: string): number[] {
	return [...value.matchAll(/(\d+)\s+\d+\s+R/gu)].map((match) =>
		Number(match[1]),
	)
}

function dictionarySection(source: string, key: string): string | undefined {
	const index = new RegExp(String.raw`/${key}(?=[\s<])`, "u").exec(
		source,
	)?.index
	if (index === undefined) return
	const start = source.indexOf("<<", index + key.length + 1)
	if (start < 0) return
	let depth = 0
	for (let cursor = start; cursor < source.length - 1; cursor++) {
		const pair = source.slice(cursor, cursor + 2)
		if (pair === "<<") {
			depth++
			cursor++
		} else if (pair === ">>") {
			depth--
			if (depth === 0) return source.slice(start + 2, cursor)
			cursor++
		}
	}
	return
}

function namedReferences(source: string): Map<string, number> {
	return new Map(
		[...source.matchAll(/\/([^\s/<>{}[\]()]+)\s+(\d+)\s+\d+\s+R/gu)].map(
			(match) => [match[1]!, Number(match[2])],
		),
	)
}

function decodeStream(object: PdfObject): Uint8Array {
	if (object.stream === undefined) throw new Error("PDF object has no stream.")
	if (object.stream.byteLength > MAX_COMPRESSED_STREAM_BYTES)
		throw new Error(
			`PDF stream exceeds the ${MAX_COMPRESSED_STREAM_BYTES}-byte compressed limit.`,
		)
	if (!object.dictionary.includes("/Filter")) return object.stream
	if (/\/Filter\s*\/?FlateDecode\b/u.test(object.dictionary))
		return inflateSync(object.stream, {
			maxOutputLength: MAX_DECODED_STREAM_BYTES,
		})
	throw new Error(
		"Only uncompressed and FlateDecode PDF streams are supported.",
	)
}

function parseBox(
	pageDictionary: string,
	ancestorDictionaries: readonly string[],
): readonly [number, number, number, number] {
	for (const name of ["ArtBox", "CropBox", "MediaBox"]) {
		const dictionaries =
			name === "ArtBox"
				? [pageDictionary]
				: [pageDictionary, ...ancestorDictionaries]
		for (const dictionary of dictionaries) {
			const match = new RegExp(
				String.raw`/${name}\s*\[\s*(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s*\]`,
				"u",
			).exec(dictionary)
			if (match !== null) {
				const box = match.slice(1).map(Number) as [
					number,
					number,
					number,
					number,
				]
				if (box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1])
					return box
			}
		}
	}
	throw new Error("PDF page has no valid MediaBox, CropBox, or ArtBox.")
}

function parseOptionalBox(
	dictionary: string,
	name: string,
): readonly [number, number, number, number] | undefined {
	const match = new RegExp(
		String.raw`/${name}\s*\[\s*(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s*\]`,
		"u",
	).exec(dictionary)
	if (match === null) return
	const box = match.slice(1).map(Number) as [number, number, number, number]
	return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1]
		? box
		: undefined
}

function referencedDictionary(
	dictionary: string,
	key: string,
	objects: ReadonlyMap<number, PdfObject>,
): string | undefined {
	const inline = dictionarySection(dictionary, key)
	if (inline !== undefined) return inline
	const reference = new RegExp(
		String.raw`/${key}\s+(\d+)\s+\d+\s+R\b`,
		"u",
	).exec(dictionary)?.[1]
	return reference === undefined
		? undefined
		: objects.get(Number(reference))?.dictionary
}

function pdfString(value: string): string {
	return value
		.replace(/\\([()\\])/gu, "$1")
		.replace(/\\([0-7]{1,3})/gu, (_, digits: string) =>
			String.fromCharCode(Number.parseInt(digits, 8)),
		)
}

function documentTitle(source: string, fallback: string): string {
	const xmp = /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/u.exec(
		source,
	)?.[1]
	const info = /\/Title\s*\(((?:\\.|[^\\)])*)\)/u.exec(source)?.[1]
	return (xmp ?? info ?? fallback)
		.replace(/&#xA;/gu, "\n")
		.replace(/&amp;/gu, "&")
		.replace(/&lt;/gu, "<")
		.replace(/&gt;/gu, ">")
		.trim()
}

function tokenize(source: string): TokenizedStream {
	const tokens: PdfToken[] = []
	const stack: PdfToken[][] = [tokens]
	let count = 0
	let hadInlineImage = false
	const push = (token: PdfToken): void => {
		count++
		if (count > MAX_CONTENT_TOKENS)
			throw new Error(
				`A content stream exceeds the ${MAX_CONTENT_TOKENS}-token limit.`,
			)
		stack.at(-1)!.push(token)
	}
	for (let index = 0; index < source.length;) {
		const char = source[index]!
		if (/\s/u.test(char)) {
			index++
			continue
		}
		if (char === "%") {
			index = source.indexOf("\n", index)
			if (index < 0) break
			continue
		}
		if (char === "(") {
			let depth = 1
			index++
			while (index < source.length && depth > 0) {
				if (source[index] === "\\") index += 2
				else {
					if (source[index] === "(") depth++
					if (source[index] === ")") depth--
					index++
				}
			}
			push("(string)")
			continue
		}
		if (char === "[") {
			const array: PdfToken[] = []
			push(array)
			stack.push(array)
			index++
			continue
		}
		if (char === "]") {
			if (stack.length > 1) stack.pop()
			index++
			continue
		}
		const match = (
			char === "/" ? /^\/[^\s[\]()<>%/]+/u : /^[^\s[\]()<>%/]+/u
		).exec(source.slice(index))
		if (match === null) {
			index++
			continue
		}
		const value = match[0]
		if (value === "BI") {
			const dataMarker = findPdfKeyword(source, index + value.length, ["ID"])
			if (dataMarker === undefined)
				throw new Error("A PDF inline image has no ID data marker.")
			const imageEnd = /\sEI(?=\s)/u.exec(
				source.slice(dataMarker.index + dataMarker.keyword.length),
			)
			if (imageEnd === null)
				throw new Error("A PDF inline image has no bounded EI terminator.")
			hadInlineImage = true
			index =
				dataMarker.index +
				dataMarker.keyword.length +
				imageEnd.index +
				imageEnd[0].length
			continue
		}
		push(
			new RegExp(`^${numberPattern}$`, "u").test(value) ? Number(value) : value,
		)
		index += value.length
	}
	return { count, hadInlineImage, tokens }
}

function numberOperands(
	operands: readonly PdfToken[],
	count: number,
): number[] | null {
	const result = operands.slice(-count)
	return result.length === count &&
		result.every((value) => typeof value === "number")
		? (result as number[])
		: null
}

function cloneState(state: GraphicsState): GraphicsState {
	return { ...state, ctm: { ...state.ctm }, clips: [...state.clips] }
}

export function importAdobeIllustrator(
	bytes: Uint8Array,
	options: IllustratorImportOptions = {},
): IllustratorImportResult {
	const diagnostics: IllustratorImportDiagnostic[] = []
	const seenIssues = new Set<string>()
	const issue = (
		code: string,
		message: string,
		severity: IllustratorImportDiagnostic["severity"],
		stage: IllustratorImportDiagnostic["stage"],
		page?: number,
	): void => {
		const key = `${code}:${page ?? 0}`
		if (seenIssues.has(key)) return
		seenIssues.add(key)
		diagnostics.push({
			code,
			message,
			severity,
			stage,
			...(page === undefined ? {} : { page }),
		})
	}
	if (bytes.byteLength > MAX_ILLUSTRATOR_FILE_BYTES) {
		issue(
			"ai.import.file-limit",
			`The Illustrator file exceeds the ${MAX_ILLUSTRATOR_FILE_BYTES}-byte import limit.`,
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	const source = decoder.decode(bytes)
	if (!source.startsWith("%PDF-")) {
		issue(
			"ai.import.not-pdf-compatible",
			"This Illustrator file has no PDF-compatible representation. Re-save it from Illustrator with Create PDF Compatible File enabled.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	const version = /^%PDF-(\d+)\.(\d+)/u.exec(source)
	if (version === null || Number(version[1]) !== 1 || Number(version[2]) > 7) {
		issue(
			"ai.import.unsupported-pdf-version",
			`PDF version ${version?.slice(1).join(".") ?? "unknown"} is unsupported; re-save as PDF 1.7-compatible Illustrator artwork.`,
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (/\/Encrypt\b/u.test(source)) {
		issue(
			"ai.import.encrypted",
			"Encrypted Illustrator/PDF documents cannot be imported; remove document security and re-save the file.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (!/Adobe Illustrator|\/Illustrator\b|illustrator:/iu.test(source)) {
		issue(
			"ai.import.not-illustrator",
			"The file is PDF-compatible but does not identify itself as an Adobe Illustrator document.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	let objects: Map<number, PdfObject>
	try {
		objects = parseObjects(bytes)
	} catch (error) {
		issue(
			"ai.import.invalid-pdf",
			error instanceof Error ? error.message : String(error),
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (objects.size > MAX_OBJECTS) {
		issue(
			"ai.import.object-limit",
			`The PDF contains more than ${MAX_OBJECTS} indirect objects.`,
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (
		[...objects.values()].some(({ dictionary }) =>
			/\/Type\s*\/(?:ObjStm|XRef)\b/u.test(dictionary),
		)
	) {
		issue(
			"ai.import.compressed-objects",
			"PDF object and cross-reference streams are unsupported; re-save the Illustrator document with a PDF 1.4-compatible preset.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (
		[...objects.values()].some(
			({ dictionary, stream }) =>
				stream !== undefined && /\/Length\s+\d+\s+\d+\s+R\b/u.test(dictionary),
		)
	) {
		issue(
			"ai.import.indirect-stream-length",
			"PDF streams with indirect Length values are unsupported; re-save the Illustrator document with a PDF 1.4-compatible preset.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	const catalog = [...objects.values()].find((object) =>
		/\/Type\s*\/Catalog\b/u.test(object.dictionary),
	)
	const pagesRootId =
		catalog === undefined
			? undefined
			: new RegExp(String.raw`/Pages\s+(\d+)\s+\d+\s+R\b`, "u").exec(
					catalog.dictionary,
				)?.[1]
	const pageEntries: PageEntry[] = []
	const visitedPageNodes = new Set<number>()
	const visitPageNode = (
		id: number,
		depth: number,
		ancestors: readonly string[],
	): void => {
		if (depth > 32 || visitedPageNodes.has(id))
			throw new Error(
				"The PDF page tree is cyclic or exceeds the supported depth of 32.",
			)
		visitedPageNodes.add(id)
		const object = objects.get(id)
		if (object === undefined)
			throw new Error(`PDF page-tree object ${id} is missing.`)
		if (/\/Type\s*\/Page\b/u.test(object.dictionary)) {
			pageEntries.push({ id, ancestors })
			return
		}
		if (!/\/Type\s*\/Pages\b/u.test(object.dictionary))
			throw new Error(`PDF page-tree object ${id} is neither Page nor Pages.`)
		const kids = references(
			/\/Kids\s*\[([^\]]*)\]/u.exec(object.dictionary)?.[1] ?? "",
		)
		for (const child of kids)
			visitPageNode(child, depth + 1, [object.dictionary, ...ancestors])
	}
	try {
		if (pagesRootId === undefined)
			throw new Error("The PDF Catalog has no direct Pages reference.")
		visitPageNode(Number(pagesRootId), 0, [])
	} catch (error) {
		issue(
			"ai.import.page-tree",
			error instanceof Error ? error.message : String(error),
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (pageEntries.length === 0) {
		issue(
			"ai.import.no-pages",
			"The PDF-compatible Illustrator file contains no importable pages.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	if (pageEntries.length > MAX_PAGES) {
		issue(
			"ai.import.page-limit",
			`The file contains more than ${MAX_PAGES} PDF pages.`,
			"error",
			"container",
		)
		return failure(diagnostics)
	}

	const artboards: DesignDocument["artboards"][number][] = []
	const swatches: DesignSwatch[] = []
	const designObjects: DesignObject[] = []
	const groups: DesignGroup[] = []
	const layers: Array<DesignLayer & { children: DesignSceneChild[] }> = []
	const swatchIds = new Map<string, string>()
	let objectSequence = 0
	let pathPointCount = 0
	let emittedPointCount = 0
	let emittedDashElementCount = 0
	let groupSequence = 0
	let cursorX = 0
	const gap = options.artboardGap ?? 48
	if (!(Number.isFinite(gap) && gap >= 0)) {
		issue(
			"ai.import.invalid-gap",
			"artboardGap must be a finite non-negative number.",
			"error",
			"container",
		)
		return failure(diagnostics)
	}
	const swatchFor = (paint: Exclude<Paint, null>): string => {
		const found = swatchIds.get(paint.key)
		if (found !== undefined) return found
		const id = `swatch:ai-${swatches.length + 1}`
		const color = paint.color
		const name =
			color.space === "rgb"
				? `AI RGB ${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}`
				: `AI CMYK ${color.c} ${color.m} ${color.y} ${color.k}`
		swatches.push({ id, name, source: color })
		swatchIds.set(paint.key, id)
		return id
	}
	const defaultLayer: LayerSpec = { hidden: false, name: "Artwork" }
	const appendToLayer = (spec: LayerSpec, child: DesignSceneChild): void => {
		const rawName = spec.name.trim() || "Artwork"
		const name = rawName.slice(0, MAX_LAYER_NAME_LENGTH)
		if (rawName.length > MAX_LAYER_NAME_LENGTH)
			issue(
				"ai.import.metadata-limit",
				`An Illustrator layer name exceeded ${MAX_LAYER_NAME_LENGTH} characters and was truncated.`,
				"warning",
				"content",
			)
		let layer = layers.at(-1)
		if (
			layer === undefined ||
			layer.name !== name ||
			Boolean(layer.hidden) !== spec.hidden
		) {
			if (layers.length >= MAX_NATIVE_LAYERS)
				throw new Error(
					`Imported artwork exceeds the ${MAX_NATIVE_LAYERS}-layer native-document limit.`,
				)
			layer = {
				id: `layer:ai-${layers.length + 1}`,
				name,
				children: [],
				uiColor: LAYER_UI_COLORS[layers.length % LAYER_UI_COLORS.length]!,
				...(spec.hidden ? { hidden: true } : {}),
			}
			layers.push(layer)
		}
		layer.children.push(child)
	}

	const ocProperties =
		catalog === undefined
			? undefined
			: referencedDictionary(catalog.dictionary, "OCProperties", objects)
	const defaultOcConfiguration =
		ocProperties === undefined
			? undefined
			: referencedDictionary(ocProperties, "D", objects)
	const ocBaseStateOff = /\/BaseState\s*\/OFF\b/u.test(
		defaultOcConfiguration ?? "",
	)
	const offOcgs = new Set(
		references(
			/\/OFF\s*\[([^\]]*)\]/u.exec(defaultOcConfiguration ?? "")?.[1] ?? "",
		),
	)
	const onOcgs = new Set(
		references(
			/\/ON\s*\[([^\]]*)\]/u.exec(defaultOcConfiguration ?? "")?.[1] ?? "",
		),
	)
	const ocgHidden = (id: number): boolean =>
		onOcgs.has(id) ? false : offOcgs.has(id) || ocBaseStateOff
	const tokenCache = new Map<number, TokenizedStream>()
	let totalDecodedBytes = 0
	let executedTokens = 0
	const tokensFor = (object: PdfObject): TokenizedStream => {
		const found = tokenCache.get(object.id)
		if (found !== undefined) return found
		const decoded = decodeStream(object)
		totalDecodedBytes += decoded.byteLength
		if (totalDecodedBytes > MAX_TOTAL_DECODED_BYTES)
			throw new Error(
				`Imported content exceeds the ${MAX_TOTAL_DECODED_BYTES}-byte aggregate decoded-stream limit.`,
			)
		const tokenized = tokenize(decoder.decode(decoded))
		tokenCache.set(object.id, tokenized)
		return tokenized
	}

	for (const [pageIndex, pageEntry] of pageEntries.entries()) {
		const pageId = pageEntry.id
		const pageNumber = pageIndex + 1
		const page = objects.get(pageId)
		if (page === undefined) {
			issue(
				"ai.import.missing-page",
				`PDF page object ${pageId} is missing.`,
				"error",
				"container",
				pageNumber,
			)
			continue
		}
		let box: readonly [number, number, number, number]
		try {
			box = parseBox(page.dictionary, pageEntry.ancestors)
		} catch (error) {
			issue(
				"ai.import.invalid-page-box",
				error instanceof Error ? error.message : String(error),
				"error",
				"container",
				pageNumber,
			)
			continue
		}
		const [left, bottom, right, top] = box
		const userUnitMatch = new RegExp(
			String.raw`/UserUnit\s+(${numberPattern})\b`,
			"u",
		).exec(page.dictionary)
		const userUnit = userUnitMatch === null ? 1 : Number(userUnitMatch[1])
		const rotateMatch = [page.dictionary, ...pageEntry.ancestors]
			.map((dictionary) => /\/Rotate\s+([+-]?\d+)\b/u.exec(dictionary)?.[1])
			.find((value) => value !== undefined)
		const rotate =
			rotateMatch === undefined ? 0 : ((Number(rotateMatch) % 360) + 360) % 360
		if (!(Number.isFinite(userUnit) && userUnit > 0)) {
			issue(
				"ai.import.invalid-user-unit",
				"The PDF page UserUnit must be a positive finite number.",
				"error",
				"container",
				pageNumber,
			)
			continue
		}
		if (![0, 90, 180, 270].includes(rotate)) {
			issue(
				"ai.import.invalid-page-rotation",
				"The inherited PDF page Rotate value must be a multiple of 90 degrees.",
				"error",
				"container",
				pageNumber,
			)
			continue
		}
		const boxWidth = (right - left) * userUnit
		const boxHeight = (top - bottom) * userUnit
		const width = rotate === 90 || rotate === 270 ? boxHeight : boxWidth
		const height = rotate === 90 || rotate === 270 ? boxWidth : boxHeight
		const artboardX = cursorX
		artboards.push({
			id: `artboard:ai-${pageNumber}`,
			name: `Artboard ${pageNumber}`,
			x: artboardX,
			y: 0,
			width,
			height,
		})
		cursorX += width + gap
		const pageBase: DesignTransform =
			rotate === 90
				? {
						a: 0,
						b: userUnit,
						c: userUnit,
						d: 0,
						e: artboardX - bottom * userUnit,
						f: -left * userUnit,
					}
				: rotate === 180
					? {
							a: -userUnit,
							b: 0,
							c: 0,
							d: userUnit,
							e: artboardX + right * userUnit,
							f: -bottom * userUnit,
						}
					: rotate === 270
						? {
								a: 0,
								b: -userUnit,
								c: -userUnit,
								d: 0,
								e: artboardX + top * userUnit,
								f: right * userUnit,
							}
						: {
								a: userUnit,
								b: 0,
								c: 0,
								d: -userUnit,
								e: artboardX - left * userUnit,
								f: top * userUnit,
							}
		const resourceSource =
			[page.dictionary, ...pageEntry.ancestors]
				.map((dictionary) =>
					referencedDictionary(dictionary, "Resources", objects),
				)
				.find((resources) => resources !== undefined) ?? ""
		const activeForms = new Set<number>()
		let formExpansions = 0

		const processStream = (
			streamObjects: PdfObject | readonly PdfObject[],
			base: DesignTransform,
			resources: string,
			depth: number,
			initialLayer: LayerSpec,
			inheritedState?: GraphicsState,
			formBox?: readonly [number, number, number, number],
		): void => {
			if (depth > 24) {
				issue(
					"ai.import.form-depth",
					"Nested PDF Form XObjects exceed the supported depth of 24.",
					"warning",
					"content",
					pageNumber,
				)
				return
			}
			let tokens: readonly PdfToken[]
			try {
				const streams: readonly PdfObject[] = Array.isArray(streamObjects)
					? streamObjects
					: [streamObjects as PdfObject]
				const collected: PdfToken[] = []
				let invocationTokens = 0
				let hadInlineImage = false
				for (const streamObject of streams) {
					const tokenized = tokensFor(streamObject)
					invocationTokens += tokenized.count
					hadInlineImage ||= tokenized.hadInlineImage
					for (const token of tokenized.tokens) collected.push(token)
				}
				if (hadInlineImage)
					issue(
						"ai.import.unsupported-image",
						"Inline PDF images are not represented by this importer and were skipped.",
						"warning",
						"content",
						pageNumber,
					)
				executedTokens += invocationTokens
				if (executedTokens > MAX_EXECUTED_TOKENS)
					throw new Error(
						`Imported content exceeds the ${MAX_EXECUTED_TOKENS}-token aggregate execution limit.`,
					)
				tokens = collected
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				issue(
					message.includes("limit")
						? "ai.import.content-limit"
						: "ai.import.unsupported-stream-filter",
					message,
					"error",
					"content",
					pageNumber,
				)
				return
			}
			const propertyLayers = new Map<string, LayerSpec>()
			for (const [name, id] of namedReferences(
				dictionarySection(resources, "Properties") ?? "",
			)) {
				const object = objects.get(id)
				const encoded =
					object === undefined
						? undefined
						: /\/Name\s*\(([^)]*)\)/u.exec(object.dictionary)?.[1]
				propertyLayers.set(name, {
					hidden: ocgHidden(id),
					name: encoded === undefined ? name : pdfString(encoded),
				})
			}
			let state: GraphicsState =
				inheritedState === undefined
					? {
							ctm: base,
							dashArray: [],
							dashOffset: 0,
							fill: {
								color: { space: "rgb", r: 0, g: 0, b: 0 },
								key: "rgb:0:0:0",
							},
							lineCap: "butt",
							lineJoin: "miter",
							miterLimit: DEFAULT_MITER_LIMIT,
							stroke: {
								color: { space: "rgb", r: 0, g: 0, b: 0 },
								key: "rgb:0:0:0",
							},
							strokeWidth: 1,
							clips: [],
						}
					: { ...cloneState(inheritedState), ctm: base }
			if (formBox !== undefined) {
				if (state.clips.length >= MAX_ACTIVE_CLIPS)
					throw new Error(
						`Imported artwork exceeds the ${MAX_ACTIVE_CLIPS}-level active clipping hierarchy limit.`,
					)
				const [x1, y1, x2, y2] = formBox
				state.clips = [
					...state.clips,
					{
						contours: [
							{
								id: "pending",
								closed: true,
								points: [
									{ id: "pending", x: x1, y: y1 },
									{ id: "pending", x: x2, y: y1 },
									{ id: "pending", x: x2, y: y2 },
									{ id: "pending", x: x1, y: y2 },
								],
							},
						],
						fillRule: "nonzero",
						transform: base,
					},
				]
			}
			const stateStack: GraphicsState[] = []
			const markedContent: Array<LayerSpec | null> = []
			const activeLayer = (): LayerSpec =>
				markedContent.findLast((entry) => entry !== null) ?? initialLayer
			let operands: PdfToken[] = []
			let contours: DesignContour[] = []
			let current: { closed: boolean; points: DesignPoint[] } | null = null
			let pointSequence = 0
			let textDepth = 0
			let pendingClipRule: "evenodd" | "nonzero" | null = null
			const flushCurrent = (): void => {
				if (current !== null && current.points.length > 0)
					contours.push({
						id: "pending",
						closed: current.closed,
						points: current.points,
					})
				current = null
			}
			const clearPath = (): void => {
				contours = []
				current = null
			}
			const addPoint = (x: number, y: number): DesignPoint => {
				pathPointCount++
				if (pathPointCount > MAX_PATH_POINTS)
					throw new Error(
						`Imported artwork exceeds the ${MAX_PATH_POINTS}-point limit.`,
					)
				const point = { id: `pending:${pointSequence++}`, x, y }
				current ??= { closed: false, points: [] }
				current.points.push(point)
				return point
			}
			const applyPendingClip = (): void => {
				if (pendingClipRule === null) return
				if (state.clips.length >= MAX_ACTIVE_CLIPS)
					throw new Error(
						`Imported artwork exceeds the ${MAX_ACTIVE_CLIPS}-level active clipping hierarchy limit.`,
					)
				state.clips = [
					...state.clips,
					{
						contours: contours.map((contour) => ({
							...contour,
							closed: true,
						})),
						fillRule: pendingClipRule,
						transform: state.ctm,
					},
				]
				pendingClipRule = null
			}
			const paintPath = (
				fill: boolean,
				stroke: boolean,
				evenodd: boolean,
				close: boolean,
			): void => {
				if (close && current !== null) current.closed = true
				flushCurrent()
				if (contours.every((contour) => contour.points.length === 0)) {
					applyPendingClip()
					clearPath()
					return
				}
				const id = `object:ai-${++objectSequence}`
				const finalized = contours.map((contour, contourIndex) => ({
					...contour,
					id: `${id}:contour:${contourIndex}`,
					points: contour.points.map((point, pointIndex) => ({
						...point,
						id: `${id}:contour:${contourIndex}:point:${pointIndex}`,
					})),
				}))
				emittedPointCount += finalized.reduce(
					(sum, contour) => sum + contour.points.length,
					0,
				)
				if (emittedPointCount > MAX_EMITTED_POINTS)
					throw new Error(
						`Imported artwork exceeds the ${MAX_EMITTED_POINTS}-point emitted-document limit.`,
					)
				if (stroke) {
					emittedDashElementCount += state.dashArray.length
					if (emittedDashElementCount > MAX_EMITTED_DASH_ELEMENTS)
						throw new Error(
							`Imported artwork exceeds the ${MAX_EMITTED_DASH_ELEMENTS}-element emitted dash-pattern limit.`,
						)
				}
				const appearance: DesignAppearance = {
					...(fill && state.fill !== null
						? { fill: { swatchId: swatchFor(state.fill) } }
						: {}),
					...(stroke && state.stroke !== null
						? {
								stroke: {
									swatchId: swatchFor(state.stroke),
									width: state.strokeWidth,
									cap: state.lineCap,
									join: state.lineJoin,
									miterLimit: state.miterLimit,
									dashArray: state.dashArray,
									dashOffset: state.dashOffset,
								},
							}
						: {}),
				}
				const object: DesignObject = {
					id,
					name: `Imported path ${objectSequence}`,
					geometry: {
						kind: "path",
						fillRule: evenodd ? "evenodd" : "nonzero",
						contours: finalized,
					},
					transform: state.ctm,
					appearance,
				}
				if (designObjects.length >= MAX_NATIVE_OBJECTS)
					throw new Error(
						`Imported artwork exceeds the ${MAX_NATIVE_OBJECTS}-object native-document limit.`,
					)
				designObjects.push(object)
				let child: DesignSceneChild = { kind: "object", id }
				for (const clip of [...state.clips].reverse()) {
					const clipId = `object:ai-${++objectSequence}`
					emittedPointCount += clip.contours.reduce(
						(sum, contour) => sum + contour.points.length,
						0,
					)
					if (emittedPointCount > MAX_EMITTED_POINTS)
						throw new Error(
							`Imported artwork exceeds the ${MAX_EMITTED_POINTS}-point emitted-document limit.`,
						)
					const clipContours = clip.contours.map((contour, contourIndex) => ({
						...contour,
						id: `${clipId}:contour:${contourIndex}`,
						points: contour.points.map((point, pointIndex) => ({
							...point,
							id: `${clipId}:contour:${contourIndex}:point:${pointIndex}`,
						})),
					}))
					if (designObjects.length >= MAX_NATIVE_OBJECTS)
						throw new Error(
							`Imported artwork exceeds the ${MAX_NATIVE_OBJECTS}-object native-document limit.`,
						)
					designObjects.push({
						id: clipId,
						name: "Imported clipping path",
						geometry: {
							kind: "path",
							fillRule: clip.fillRule,
							contours: clipContours,
						},
						transform: clip.transform,
						appearance: {},
					})
					const groupId = `group:ai-${++groupSequence}`
					if (groups.length >= MAX_NATIVE_GROUPS)
						throw new Error(
							`Imported artwork exceeds the ${MAX_NATIVE_GROUPS}-group native-document limit.`,
						)
					groups.push({
						id: groupId,
						name: "Imported clipped artwork",
						clippingPathId: clipId,
						children: [child, { kind: "object", id: clipId }],
					})
					child = { kind: "group", id: groupId }
				}
				appendToLayer(activeLayer(), child)
				applyPendingClip()
				clearPath()
			}
			const xobjects = namedReferences(
				dictionarySection(resources, "XObject") ?? "",
			)
			for (const token of tokens) {
				if (typeof token !== "string" || token.startsWith("/")) {
					operands.push(token)
					continue
				}
				const values = (count: number) => numberOperands(operands, count)
				if (token === "BT") {
					if (textDepth >= MAX_INTERPRETER_NESTING)
						throw new Error(
							`PDF text nesting exceeds the ${MAX_INTERPRETER_NESTING}-level interpreter limit.`,
						)
					textDepth++
					issue(
						"ai.import.unsupported-text",
						"Editable PDF text is not represented by the create-design vector model and was skipped. Convert text to outlines in Illustrator for editable geometry.",
						"warning",
						"content",
						pageNumber,
					)
				} else if (token === "ET") textDepth = Math.max(0, textDepth - 1)
				else if (textDepth > 0) {
					operands = []
					continue
				} else if (token === "q") {
					if (stateStack.length >= MAX_INTERPRETER_NESTING)
						throw new Error(
							`PDF graphics-state nesting exceeds the ${MAX_INTERPRETER_NESTING}-level interpreter limit.`,
						)
					stateStack.push(cloneState(state))
				} else if (token === "Q") state = stateStack.pop() ?? state
				else if (token === "cm") {
					const v = values(6)
					if (v !== null)
						state.ctm = multiply(state.ctm, {
							a: v[0]!,
							b: v[1]!,
							c: v[2]!,
							d: v[3]!,
							e: v[4]!,
							f: v[5]!,
						})
				} else if (token === "m") {
					const v = values(2)
					flushCurrent()
					if (v !== null) {
						current = { closed: false, points: [] }
						addPoint(v[0]!, v[1]!)
					}
				} else if (token === "l") {
					const v = values(2)
					if (v !== null) addPoint(v[0]!, v[1]!)
				} else if (token === "c") {
					const v = values(6)
					const previous = current?.points.at(-1)
					if (v !== null && previous !== undefined) {
						current!.points[current!.points.length - 1] = {
							...previous,
							outgoing: { x: v[0]! - previous.x, y: v[1]! - previous.y },
						}
						const endpoint = addPoint(v[4]!, v[5]!)
						current!.points[current!.points.length - 1] = {
							...endpoint,
							incoming: { x: v[2]! - endpoint.x, y: v[3]! - endpoint.y },
						}
					}
				} else if (token === "v" || token === "y") {
					const v = values(4)
					const previous = current?.points.at(-1)
					if (v !== null && previous !== undefined) {
						const cp1 = token === "v" ? previous : { x: v[0]!, y: v[1]! }
						const endpoint = { x: v[2]!, y: v[3]! }
						const cp2 = token === "v" ? { x: v[0]!, y: v[1]! } : endpoint
						current!.points[current!.points.length - 1] = {
							...previous,
							outgoing: { x: cp1.x - previous.x, y: cp1.y - previous.y },
						}
						const added = addPoint(endpoint.x, endpoint.y)
						current!.points[current!.points.length - 1] = {
							...added,
							incoming: { x: cp2.x - endpoint.x, y: cp2.y - endpoint.y },
						}
					}
				} else if (token === "re") {
					const v = values(4)
					flushCurrent()
					if (v !== null) {
						current = { closed: true, points: [] }
						addPoint(v[0]!, v[1]!)
						addPoint(v[0]! + v[2]!, v[1]!)
						addPoint(v[0]! + v[2]!, v[1]! + v[3]!)
						addPoint(v[0]!, v[1]! + v[3]!)
					}
				} else if (token === "h") {
					if (current !== null) current.closed = true
				} else if (token === "W" || token === "W*") {
					pendingClipRule = token === "W*" ? "evenodd" : "nonzero"
				} else if (token === "n") {
					flushCurrent()
					applyPendingClip()
					clearPath()
				} else if (token === "f" || token === "F")
					paintPath(true, false, false, false)
				else if (token === "f*") paintPath(true, false, true, false)
				else if (token === "S") paintPath(false, true, false, false)
				else if (token === "s") paintPath(false, true, false, true)
				else if (["B", "B*", "b", "b*"].includes(token))
					paintPath(true, true, token.includes("*"), token.startsWith("b"))
				else if (token === "k" || token === "K") {
					const v = values(4)
					if (v !== null) {
						const rounded = v.map(
							(value) =>
								Math.round(Math.min(1, Math.max(0, value)) * 10000) / 100,
						)
						const paint = {
							color: {
								space: "cmyk" as const,
								c: rounded[0]!,
								m: rounded[1]!,
								y: rounded[2]!,
								k: rounded[3]!,
							},
							key: `cmyk:${rounded.join(":")}`,
						}
						if (token === "k") state.fill = paint
						else state.stroke = paint
					}
				} else if (token === "rg" || token === "RG") {
					const v = values(3)
					if (v !== null) {
						const rounded = v.map((value) =>
							Math.round(Math.min(1, Math.max(0, value)) * 255),
						)
						const paint = {
							color: {
								space: "rgb" as const,
								r: rounded[0]!,
								g: rounded[1]!,
								b: rounded[2]!,
							},
							key: `rgb:${rounded.join(":")}`,
						}
						if (token === "rg") state.fill = paint
						else state.stroke = paint
					}
				} else if (token === "g" || token === "G") {
					const v = values(1)
					if (v !== null) {
						const gray = Math.round(Math.min(1, Math.max(0, v[0]!)) * 255)
						const paint = {
							color: { space: "rgb" as const, r: gray, g: gray, b: gray },
							key: `rgb:${gray}:${gray}:${gray}`,
						}
						if (token === "g") state.fill = paint
						else state.stroke = paint
					}
				} else if (token === "w") {
					const v = values(1)
					if (v !== null) state.strokeWidth = v[0]!
				} else if (token === "J") {
					const v = values(1)
					if (v !== null)
						state.lineCap =
							(["butt", "round", "square"] as const)[v[0]!] ?? "butt"
				} else if (token === "j") {
					const v = values(1)
					if (v !== null)
						state.lineJoin =
							(["miter", "round", "bevel"] as const)[v[0]!] ?? "miter"
				} else if (token === "M") {
					const v = values(1)
					if (v !== null) state.miterLimit = v[0]!
				} else if (token === "d") {
					const offset = operands.at(-1)
					const array = operands.at(-2)
					if (
						typeof offset === "number" &&
						Array.isArray(array) &&
						array.every((value) => typeof value === "number")
					) {
						if (array.length > MAX_DASH_ARRAY_ELEMENTS)
							issue(
								"ai.import.dash-limit",
								`A PDF dash pattern has more than ${MAX_DASH_ARRAY_ELEMENTS} elements and was truncated.`,
								"warning",
								"content",
								pageNumber,
							)
						state.dashArray = (array as number[]).slice(
							0,
							MAX_DASH_ARRAY_ELEMENTS,
						)
						state.dashOffset = offset
					}
				} else if (token === "BDC") {
					if (markedContent.length >= MAX_INTERPRETER_NESTING)
						throw new Error(
							`PDF marked-content nesting exceeds the ${MAX_INTERPRETER_NESTING}-level interpreter limit.`,
						)
					const property = operands.at(-1)
					const tag = operands.at(-2)
					if (
						tag === "/OC" &&
						typeof property === "string" &&
						property.startsWith("/")
					)
						markedContent.push(
							propertyLayers.get(property.slice(1)) ?? {
								hidden: false,
								name: property.slice(1),
							},
						)
					else markedContent.push(null)
				} else if (token === "BMC") {
					if (markedContent.length >= MAX_INTERPRETER_NESTING)
						throw new Error(
							`PDF marked-content nesting exceeds the ${MAX_INTERPRETER_NESTING}-level interpreter limit.`,
						)
					markedContent.push(null)
				} else if (token === "EMC") {
					markedContent.pop()
				} else if (token === "Do") {
					const name = operands.at(-1)
					const target =
						typeof name === "string"
							? objects.get(xobjects.get(name.slice(1)) ?? -1)
							: undefined
					if (target === undefined)
						issue(
							"ai.import.missing-xobject",
							`A referenced PDF XObject could not be resolved.`,
							"warning",
							"content",
							pageNumber,
						)
					else if (/\/Subtype\s*\/Form\b/u.test(target.dictionary)) {
						if (/\/S\s*\/Transparency\b/u.test(target.dictionary))
							issue(
								"ai.import.unsupported-transparency",
								"PDF transparency groups are flattened only to the supported visible vector operations; group compositing is not preserved.",
								"warning",
								"content",
								pageNumber,
							)
						if (activeForms.has(target.id)) {
							issue(
								"ai.import.form-cycle",
								`Cyclic PDF Form XObject ${target.id} was skipped.`,
								"warning",
								"content",
								pageNumber,
							)
							operands = []
							continue
						}
						if (formExpansions >= MAX_FORM_EXPANSIONS) {
							issue(
								"ai.import.form-expansion-limit",
								`PDF Form expansion exceeds the ${MAX_FORM_EXPANSIONS}-invocation limit; remaining instances were skipped.`,
								"warning",
								"content",
								pageNumber,
							)
							operands = []
							continue
						}
						formExpansions++
						const matrix = new RegExp(
							String.raw`/Matrix\s*\[\s*(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s+(${numberPattern})\s*\]`,
							"u",
						)
							.exec(target.dictionary)
							?.slice(1)
							.map(Number)
						const formTransform: DesignTransform =
							matrix?.length === 6
								? {
										a: matrix[0]!,
										b: matrix[1]!,
										c: matrix[2]!,
										d: matrix[3]!,
										e: matrix[4]!,
										f: matrix[5]!,
									}
								: IDENTITY_DESIGN_TRANSFORM
						activeForms.add(target.id)
						try {
							processStream(
								target,
								multiply(state.ctm, formTransform),
								referencedDictionary(target.dictionary, "Resources", objects) ??
									resources,
								depth + 1,
								activeLayer(),
								state,
								parseOptionalBox(target.dictionary, "BBox"),
							)
						} finally {
							activeForms.delete(target.id)
						}
					} else
						issue(
							"ai.import.unsupported-image",
							"Placed or embedded PDF images are not represented by this importer and were skipped.",
							"warning",
							"content",
							pageNumber,
						)
				} else if (token === "sh")
					issue(
						"ai.import.unsupported-gradient",
						"PDF shading and gradient paint is not represented by the create-design source model and was skipped.",
						"warning",
						"content",
						pageNumber,
					)
				else if (token === "gs") {
					const name = operands.at(-1)
					const states = namedReferences(
						dictionarySection(resources, "ExtGState") ?? "",
					)
					const external =
						typeof name === "string"
							? objects.get(states.get(name.slice(1)) ?? -1)
							: undefined
					if (
						external !== undefined &&
						(/\/(?:ca|CA)\s+(?!1(?:\.0+)?\b)/u.test(external.dictionary) ||
							/\/BM\s*\/(?!Normal\b)/u.test(external.dictionary) ||
							/\/SMask\s+(?!\/None\b)/u.test(external.dictionary))
					)
						issue(
							"ai.import.unsupported-transparency",
							"Opacity and non-normal blend modes are not represented by the create-design appearance model.",
							"warning",
							"content",
							pageNumber,
						)
				} else if (["cs", "CS", "sc", "SC", "scn", "SCN"].includes(token))
					issue(
						"ai.import.unsupported-color-space",
						"A calibrated, spot, pattern, or ICC PDF color could not be preserved; affected paint may use the preceding process color.",
						"warning",
						"content",
						pageNumber,
					)
				operands = []
			}
		}

		const contentMatch = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/u.exec(
			page.dictionary,
		)?.[1]
		const contents: PdfObject[] = []
		for (const contentId of references(contentMatch ?? "")) {
			const content = objects.get(contentId)
			if (content === undefined) {
				issue(
					"ai.import.missing-content",
					`PDF content stream ${contentId} is missing.`,
					"warning",
					"container",
					pageNumber,
				)
			} else contents.push(content)
		}
		if (contents.length > 0)
			try {
				processStream(contents, pageBase, resourceSource, 0, defaultLayer)
			} catch (error) {
				issue(
					"ai.import.content-limit",
					error instanceof Error ? error.message : String(error),
					"error",
					"content",
					pageNumber,
				)
			}
	}
	if (
		artboards.length === 0 ||
		diagnostics.some(({ severity }) => severity === "error")
	)
		return failure(diagnostics)
	const authoredLayers: DesignLayer[] = layers
		.filter(({ children }) => children.length > 0)
		.map((layer) => ({ ...layer, children: Object.freeze(layer.children) }))
	const objectById = new Map(designObjects.map((object) => [object.id, object]))
	const groupById = new Map(groups.map((group) => [group.id, group]))
	const orderedObjects: DesignObject[] = []
	const collectObjects = (children: readonly DesignSceneChild[]): void => {
		for (const child of children) {
			if (child.kind === "object") {
				const object = objectById.get(child.id)
				if (object !== undefined) orderedObjects.push(object)
			} else collectObjects(groupById.get(child.id)?.children ?? [])
		}
	}
	for (const layer of authoredLayers) collectObjects(layer.children)
	const rawTitle = documentTitle(
		source,
		options.title ?? "Imported Illustrator document",
	)
	if (rawTitle.length > MAX_TITLE_LENGTH)
		issue(
			"ai.import.metadata-limit",
			`The Illustrator document title exceeded ${MAX_TITLE_LENGTH} characters and was truncated.`,
			"warning",
			"container",
		)
	const document: DesignDocument = {
		format: "create-design.document",
		version: 6,
		title: rawTitle.slice(0, MAX_TITLE_LENGTH),
		artboards,
		swatches,
		objects: orderedObjects,
		layers:
			authoredLayers.length > 0
				? authoredLayers
				: [
						{
							id: "layer:artwork",
							name: "Artwork",
							children: [],
							uiColor: "red",
						},
					],
		groups,
		guides: [],
	}
	const validated = validateDesignDocument(document)
	if (!validated.ok) {
		issue(
			"ai.import.invalid-native-document",
			`Imported artwork could not be represented as valid create-design source: ${validated.errors.map(({ message }) => message).join(" ")}`,
			"error",
			"content",
		)
		return failure(diagnostics)
	}
	return {
		diagnostics: Object.freeze(diagnostics),
		document: validated.value,
		ok: true,
		summary: {
			artboards: artboards.length,
			objects: designObjects.filter(
				({ appearance }) =>
					appearance.fill !== undefined || appearance.stroke !== undefined,
			).length,
			swatches: swatches.length,
		},
	}
}
