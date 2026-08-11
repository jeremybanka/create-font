import type {
	IllustratorSourceArtboard,
	IllustratorSourceContour,
	IllustratorSourceColor,
	IllustratorSourceDiagnostic,
	IllustratorSourceDocument,
	IllustratorSourceGroup,
	IllustratorSourceLayer,
	IllustratorSourceNode,
	IllustratorSourcePath,
	IllustratorSourceSpan,
	IllustratorSourceStatement,
	IllustratorSourceText,
	IllustratorSourceUnknown,
	IllustratorTextResource,
	IllustratorTextStory,
} from "./illustrator-source-types.ts"

type SourceString = Readonly<{ kind: "string"; value: string }>
type SourceArray = Readonly<{ kind: "array"; values: readonly number[] }>
type TokenValue = number | string | SourceString | SourceArray
type Token = Readonly<{ value: TokenValue; span: IllustratorSourceSpan }>

type MutablePoint = {
	x: number
	y: number
	mode: "hard" | "soft"
	incoming?: { x: number; y: number }
	outgoing?: { x: number; y: number }
}
type MutableContour = { closed: boolean; points: MutablePoint[] }
type MutableContainer = {
	groupKind: IllustratorSourceGroup["groupKind"]
	children: IllustratorSourceNode[]
	start: IllustratorSourceSpan
	clippingPath?: IllustratorSourcePath
	pendingCompoundContours: IllustratorSourceContour[]
	savedState?: PaintState
	name?: string
}
type PaintState = {
	fill: IllustratorSourceColor
	stroke: IllustratorSourceColor
	fillRule: "nonzero" | "evenodd"
	width: number
	cap: "butt" | "round" | "square"
	join: "miter" | "round" | "bevel"
	miterLimit: number
	dashArray: readonly number[]
	dashOffset: number
	locked: boolean
}

const numberPattern = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`
const MAX_TOKENS = 1_000_000
const MAX_POINTS = 1_000_000
const MAX_NESTING = 512
export const MAX_ILLUSTRATOR_ARRAY_VALUES = 16_384
export const MAX_ILLUSTRATOR_SOURCE_CHARACTERS = 64 * 1024 * 1024
export const MAX_ILLUSTRATOR_SOURCE_STATEMENTS = 250_000
export const MAX_ILLUSTRATOR_TEXT_RESOURCE_CHARACTERS = 16 * 1024 * 1024

export interface ParseIllustratorSourceOptions {
	/** Testable lower bound; never raises the hard source limit. */
	readonly maxSourceCharacters?: number
	/** Testable lower bound; never raises the hard statement limit. */
	readonly maxStatements?: number
	/** Testable lower bound; never raises the hard AI11 resource limit. */
	readonly maxTextResourceCharacters?: number
}

function boundedLimit(
	requested: number | undefined,
	hardLimit: number,
): number {
	return requested === undefined ||
		!Number.isSafeInteger(requested) ||
		requested < 1
		? hardLimit
		: Math.min(requested, hardLimit)
}

function limitedDocument(
	source: string,
	code: string,
	message: string,
): IllustratorSourceDocument {
	return {
		format: "adobe-illustrator.source",
		metadata: { rawHeaders: {} },
		artboards: [],
		layers: [],
		rawSource: source,
		statements: [],
		resources: {},
		diagnostics: [{ code, message, severity: "error" }],
		stats: {
			layers: 0,
			paths: 0,
			paintedPaths: 0,
			groups: 0,
			textFrames: 0,
			unknownOperators: {},
		},
	}
}

function statementCountExceeds(source: string, limit: number): boolean {
	let count = 0
	let lineStart = 0
	for (let index = 0; index < source.length; index++) {
		if (source[index] === "\r") {
			if (source[index + 1] === "\n") index++
			if (++count > limit) return true
			lineStart = index + 1
		} else if (source[index] === "\n") {
			if (++count > limit) return true
			lineStart = index + 1
		}
	}
	return lineStart < source.length && ++count > limit
}

function textResourceLength(source: string): number {
	const begin = source.indexOf("%AI11_BeginTextDocument")
	if (begin < 0) return 0
	const end = source.indexOf("%AI11_EndTextDocument", begin)
	return (end < 0 ? source.length : end) - begin
}

function spanAt(
	source: string,
	start: number,
	end = start,
): IllustratorSourceSpan {
	let line = 1
	let lineStart = 0
	for (let index = 0; index < start; index++)
		if (
			source.charCodeAt(index) === 10 ||
			(source.charCodeAt(index) === 13 && source.charCodeAt(index + 1) !== 10)
		) {
			line++
			lineStart = index + 1
		}
	return { start, end, line, column: start - lineStart + 1 }
}

function decodeString(source: string): string {
	return source.replace(
		/\\(\r\n|\r|\n|[0-7]{1,3}|.)/gsu,
		(_match, escape: string) => {
			if (/^[0-7]+$/u.test(escape))
				return String.fromCharCode(Number.parseInt(escape, 8))
			if (escape === "n") return "\n"
			if (escape === "r") return "\r"
			if (escape === "t") return "\t"
			if (escape === "b") return "\b"
			if (escape === "f") return "\f"
			if (escape === "\n" || escape === "\r" || escape === "\r\n") return ""
			return escape
		},
	)
}

function lex(source: string, start: number): Token[] {
	const tokens: Token[] = []
	const lineStarts = [0]
	for (let cursor = 0; cursor < source.length; cursor++) {
		if (source.charCodeAt(cursor) === 10) lineStarts.push(cursor + 1)
		else if (
			source.charCodeAt(cursor) === 13 &&
			source.charCodeAt(cursor + 1) !== 10
		)
			lineStarts.push(cursor + 1)
	}
	const tokenSpan = (from: number, to: number): IllustratorSourceSpan => {
		let low = 0
		let high = lineStarts.length
		while (low + 1 < high) {
			const middle = (low + high) >>> 1
			if (lineStarts[middle]! <= from) low = middle
			else high = middle
		}
		return {
			start: from,
			end: to,
			line: low + 1,
			column: from - lineStarts[low]! + 1,
		}
	}
	let index = start
	const push = (value: TokenValue, from: number, to: number): void => {
		if (tokens.length >= MAX_TOKENS)
			throw new Error(
				`Illustrator source exceeds the ${MAX_TOKENS}-token limit.`,
			)
		tokens.push({ value, span: tokenSpan(from, to) })
	}
	while (index < source.length) {
		const character = source[index]!
		if (/\s/u.test(character)) {
			index++
			continue
		}
		if (character === "%") {
			const lf = source.indexOf("\n", index)
			const cr = source.indexOf("\r", index)
			const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr)
			index = end < 0 ? source.length : end + 1
			continue
		}
		if (character === "(") {
			const from = index++
			let depth = 1
			let value = ""
			while (index < source.length && depth > 0) {
				const next = source[index++]!
				if (next === "\\") {
					let escaped = source[index++] ?? ""
					if (/[0-7]/u.test(escaped)) {
						for (
							let count = 1;
							count < 3 && /[0-7]/u.test(source[index] ?? "");
							count++
						)
							escaped += source[index++]
					}
					value += `\\${escaped}`
				} else if (next === "(") {
					depth++
					value += next
				} else if (next === ")") {
					depth--
					if (depth > 0) value += next
				} else value += next
			}
			push({ kind: "string", value: decodeString(value) }, from, index)
			continue
		}
		if (character === "[") {
			const from = index++
			const end = source.indexOf("]", index)
			if (end < 0)
				throw new Error("An Illustrator array has no closing bracket.")
			const values: number[] = []
			for (const match of source
				.slice(index, end)
				.matchAll(new RegExp(numberPattern, "gu"))) {
				if (values.length >= MAX_ILLUSTRATOR_ARRAY_VALUES)
					throw new Error(
						`An Illustrator array exceeds the ${MAX_ILLUSTRATOR_ARRAY_VALUES}-value limit.`,
					)
				values.push(Number(match[0]))
			}
			push({ kind: "array", values }, from, end + 1)
			index = end + 1
			continue
		}
		const match = /^[^\s[\]()<>%]+/u.exec(source.slice(index))
		if (match === null) {
			index++
			continue
		}
		const raw = match[0]
		push(
			new RegExp(`^${numberPattern}$`, "u").test(raw) ? Number(raw) : raw,
			index,
			index + raw.length,
		)
		index += raw.length
	}
	return tokens
}

function artboardsFrom(source: string): IllustratorSourceArtboard[] {
	const arrayAt = source.indexOf("(ArtboardArray)")
	if (arrayAt < 0) return []
	const from = Math.max(0, arrayAt - 128 * 1024)
	const prefix = source.slice(from, arrayAt)
	const dictionaries = prefix.split(/%_?\/Dictionary\s*:/u)
	const point = (name: string): RegExp =>
		new RegExp(
			`(${numberPattern})\\s+(${numberPattern})\\s+/RealPointRelToROrigin\\s+%_?\\s*\\(${name}\\)`,
			"u",
		)
	const result: IllustratorSourceArtboard[] = []
	const bleedValue = (side: string): number | undefined => {
		const value = new RegExp(
			`(${numberPattern})\\s+/Real\\s+\\(Bleed${side}Value\\)`,
			"u",
		).exec(source)?.[1]
		return value === undefined ? undefined : Number(value)
	}
	const bleedValues = {
		top: bleedValue("Top"),
		right: bleedValue("Right"),
		bottom: bleedValue("Bottom"),
		left: bleedValue("Left"),
	}
	const bleed = Object.values(bleedValues).every((value) => value !== undefined)
		? (bleedValues as {
				top: number
				right: number
				bottom: number
				left: number
			})
		: undefined
	let searchAt = from
	for (const dictionary of dictionaries) {
		const first = point("PositionPoint1").exec(dictionary)
		const second = point("PositionPoint2").exec(dictionary)
		const name =
			/%_?\s*\(((?:\\.|[^\\)])*)\)\s+\/UnicodeString\s+\(Name\)/u.exec(
				dictionary,
			)
		const local = source.indexOf(
			dictionary.slice(0, Math.min(dictionary.length, 80)),
			searchAt,
		)
		if (local >= 0) searchAt = local + dictionary.length
		if (first === null || second === null || name === null) continue
		const rawProperties: Record<string, number | string | boolean> = {}
		for (const property of dictionary.matchAll(
			new RegExp(
				`%_?\\s*(${numberPattern})\\s+/(Real|Int|Bool)\\s+\\(([^)]*)\\)`,
				"gu",
			),
		))
			rawProperties[property[3]!] =
				property[2] === "Bool" ? Number(property[1]) !== 0 : Number(property[1])
		for (const property of dictionary.matchAll(
			/%_?\s*\(((?:\\.|[^\\)])*)\)\s+\/(?:UnicodeString|String)\s+\(([^)]*)\)/gu,
		))
			rawProperties[property[2]!] = decodeString(property[1]!)
		const rulerOrigin = new RegExp(
			String.raw`(${numberPattern})\s+(${numberPattern})\s+/RealPoint[\s\r\n%_]*\s*\(RulerOrigin\)`,
			"u",
		).exec(dictionary)
		result.push({
			name: decodeString(name[1]!),
			...(typeof rawProperties.ArtboardUUID === "string"
				? { uuid: rawProperties.ArtboardUUID }
				: {}),
			left: Number(first[1]),
			top: Number(first[2]),
			right: Number(second[1]),
			bottom: Number(second[2]),
			...(bleed === undefined ? {} : { bleed }),
			...(typeof rawProperties.IsArtboardSelected === "boolean"
				? { selected: rawProperties.IsArtboardSelected }
				: {}),
			...(typeof rawProperties.IsArtboardLocked === "boolean"
				? { locked: rawProperties.IsArtboardLocked }
				: {}),
			...(typeof rawProperties.PAR === "number"
				? { pixelAspectRatio: rawProperties.PAR }
				: {}),
			...(rulerOrigin === null
				? {}
				: {
						rulerOrigin: {
							x: Number(rulerOrigin[1]),
							y: Number(rulerOrigin[2]),
						},
					}),
			rawProperties,
			span: spanAt(
				source,
				Math.max(from, local),
				Math.max(from, local) + dictionary.length,
			),
		})
	}
	return result
}

function sourceStatements(source: string): IllustratorSourceStatement[] {
	const result: IllustratorSourceStatement[] = []
	const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu
	let match: RegExpExecArray | null
	let line = 1
	while ((match = pattern.exec(source)) !== null && match[0].length > 0) {
		const start = match.index
		result.push({
			kind: match[0].startsWith("%") ? "comment" : "code",
			raw: match[0],
			span: {
				start,
				end: start + match[0].length,
				line,
				column: 1,
			},
		})
		line++
	}
	return result
}

function decodeAscii85(value: string): string | undefined {
	const compact = value.replace(/^%/gmu, "").replace(/\s/gu, "")
	const terminator = compact.indexOf("~>")
	if (terminator < 0) return undefined
	const bytes: number[] = []
	let group: number[] = []
	for (const character of compact.slice(0, terminator)) {
		if (character === "z" && group.length === 0) {
			bytes.push(0, 0, 0, 0)
			continue
		}
		const digit = character.charCodeAt(0) - 33
		if (digit < 0 || digit > 84) return undefined
		group.push(digit)
		if (group.length === 5) {
			let word = 0
			for (const part of group) word = word * 85 + part
			bytes.push(
				(word >>> 24) & 255,
				(word >>> 16) & 255,
				(word >>> 8) & 255,
				word & 255,
			)
			group = []
		}
	}
	if (group.length > 0) {
		const count = group.length
		while (group.length < 5) group.push(84)
		let word = 0
		for (const part of group) word = word * 85 + part
		for (let index = 0; index < count - 1; index++)
			bytes.push((word >>> (24 - index * 8)) & 255)
	}
	let decoded = ""
	for (let offset = 0; offset < bytes.length; offset += 32_768)
		decoded += String.fromCharCode(...bytes.slice(offset, offset + 32_768))
	return decoded
}

function postScriptUtf16Strings(
	source: string,
): Array<{ at: number; text: string }> {
	const result: Array<{ at: number; text: string }> = []
	let index = 0
	while (index < source.length) {
		if (source[index] !== "(") {
			index++
			continue
		}
		const at = index
		let depth = 1
		let raw = ""
		index++
		while (index < source.length && depth > 0) {
			const character = source[index]!
			if (character === "\\") {
				raw += character
				index++
				if (index < source.length) raw += source[index]!
			} else if (character === "(") {
				depth++
				raw += character
			} else if (character === ")") {
				depth--
				if (depth > 0) raw += character
			} else raw += character
			index++
		}
		const value = decodeString(raw)
		if (
			value.charCodeAt(0) !== 0xfe ||
			value.charCodeAt(1) !== 0xff ||
			value.length < 4 ||
			value.length % 2 !== 0
		)
			continue
		const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))
		result.push({
			at,
			text: new TextDecoder("utf-16be", { fatal: false }).decode(
				bytes.slice(2),
			),
		})
	}
	return result
}

function textResourceFrom(source: string): IllustratorTextResource | undefined {
	const begin = source.indexOf("%AI11_BeginTextDocument")
	const end = source.indexOf("%AI11_EndTextDocument", begin)
	if (begin < 0 || end < 0) return undefined
	const header = source.indexOf("/AI11TextDocument", begin)
	const firstBreak = header < 0 ? -1 : /[\r\n]/u.exec(source.slice(header))
	if (firstBreak === null || header < 0) return undefined
	const payloadAt = header + firstBreak.index + firstBreak[0].length
	const raw = source.slice(payloadAt, end)
	const decoded = decodeAscii85(raw)
	if (decoded === undefined) return undefined
	const strings = postScriptUtf16Strings(decoded)
	const candidates = strings.filter(
		({ text }) => text.endsWith("\r") && text.length > 1,
	)
	const stories: IllustratorTextStory[] = []
	const fonts = strings
		.map(({ at, text: name }) => ({ at, name }))
		.filter(({ at, name }) => at < 2_000 && !name.startsWith("Version "))
		.map(({ at, name }, selector) => ({
			selector,
			postScriptName: name,
			raw: decoded.slice(at, decoded.indexOf(">> >>", at) + 5),
		}))
	for (
		let candidateIndex = 0;
		candidateIndex < candidates.length;
		candidateIndex++
	) {
		const candidate = candidates[candidateIndex]!
		const following = decoded.slice(
			candidate.at,
			candidates[candidateIndex + 1]?.at ?? decoded.length,
		)
		const storyIndex = /\/99\s+\/F\s+\/10\s+(\d+)/u.exec(following)
		const position =
			/\/99\s+\/F[\s\S]{0,160}?\/0\s+<<\s+\/0\s+\[\s*([\d.+-]+)\s+([\d.+-]+)/u.exec(
				following,
			)
		const style =
			/\/6\s+<<\s+\/0\s+\d+\s+\/1\s+([\d.+-]+)[\s\S]{0,180}?\/91\s+(\d+)/u.exec(
				following,
			)
		const fallbackSize = /\/99\s+\/S\s+\/15\s+<<\s+\/0\s+([\d.+-]+)/u.exec(
			following,
		)?.[1]
		const fallbackSelector = /\/6\s+<<\s+\/11\s+(\d+)/u.exec(following)?.[1]
		if (storyIndex === null) continue
		stories.push({
			index: Number(storyIndex[1]),
			text: candidate.text,
			...(position === null
				? {}
				: {
						position: {
							x: Number(position[1]) - 8192,
							y: 8192 - Number(position[2]),
						},
					}),
			...(style !== null
				? { size: Number(style[1]), fontSelector: Number(style[2]) }
				: {
						...(fallbackSize === undefined
							? {}
							: { size: Number(fallbackSize) }),
						...(fallbackSelector === undefined
							? {}
							: { fontSelector: Number(fallbackSelector) }),
					}),
			raw: following,
		})
	}
	return { encoding: "ASCII85", raw, decoded, stories, fonts }
}

function sourceBounds(source: string): IllustratorSourceDocument["bounds"] {
	const match = new RegExp(
		`%%HiResBoundingBox:\\s*(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})`,
		"u",
	).exec(source)
	if (match === null) return undefined
	return {
		left: Number(match[1]),
		bottom: Number(match[2]),
		right: Number(match[3]),
		top: Number(match[4]),
	}
}

function sourceMetadata(source: string): IllustratorSourceDocument["metadata"] {
	const headers: Record<string, string> = {}
	for (const match of source.matchAll(/^%%([^:\r\n]+):\s*([^\r\n]*)/gmu))
		headers[match[1]!] = match[2]!
	const text = (name: string): string | undefined => {
		const value = headers[name]
		if (value === undefined) return undefined
		return value.startsWith("(") && value.endsWith(")")
			? decodeString(value.slice(1, -1))
			: value
	}
	const origin = new RegExp(
		`(${numberPattern})\\s+(${numberPattern})\\s+/RealPoint[^\r\n]*\\(RulerOrigin\\)`,
		"u",
	).exec(source)
	return {
		...(text("Title") === undefined ? {} : { title: text("Title") }),
		...(text("Creator") === undefined ? {} : { creator: text("Creator") }),
		...(text("CreationDate") === undefined
			? {}
			: { creationDate: text("CreationDate") }),
		...(text("AI8_CreatorVersion") === undefined
			? {}
			: { fileFormatVersion: text("AI8_CreatorVersion") }),
		...(text("AI8_CreatorBuild") === undefined
			? {}
			: { buildVersion: text("AI8_CreatorBuild") }),
		...(text("DocumentProcessColors") === undefined
			? {}
			: { colorModel: text("DocumentProcessColors") }),
		...(origin === null
			? {}
			: { pageOrigin: { x: Number(origin[1]), y: Number(origin[2]) } }),
		rawHeaders: headers,
	}
}

const rgb = (r: number, g: number, b: number): IllustratorSourceColor => ({
	space: "rgb",
	r,
	g,
	b,
})
const cmyk = (
	c: number,
	m: number,
	y: number,
	k: number,
): IllustratorSourceColor => ({
	space: "cmyk",
	c,
	m,
	y,
	k,
})
const defaultBlack = (): IllustratorSourceColor => ({ space: "gray", value: 0 })

function publicOperand(value: TokenValue): number | string | readonly number[] {
	if (typeof value === "object")
		return value.kind === "string" ? value.value : value.values
	return value
}

/** Parses decompressed Illustrator PostScript into a typed, canvas-oriented AST. */
export function parseIllustratorSource(
	source: string,
	options: ParseIllustratorSourceOptions = {},
): IllustratorSourceDocument {
	const maxSourceCharacters = boundedLimit(
		options.maxSourceCharacters,
		MAX_ILLUSTRATOR_SOURCE_CHARACTERS,
	)
	if (source.length > maxSourceCharacters)
		return limitedDocument(
			source,
			"ai.source.source-limit",
			`Illustrator source exceeds the ${maxSourceCharacters}-character parse limit.`,
		)
	const maxStatements = boundedLimit(
		options.maxStatements,
		MAX_ILLUSTRATOR_SOURCE_STATEMENTS,
	)
	if (statementCountExceeds(source, maxStatements))
		return limitedDocument(
			source,
			"ai.source.statement-limit",
			`Illustrator source exceeds the ${maxStatements}-statement parse limit.`,
		)
	const maxTextResourceCharacters = boundedLimit(
		options.maxTextResourceCharacters,
		MAX_ILLUSTRATOR_TEXT_RESOURCE_CHARACTERS,
	)
	if (textResourceLength(source) > maxTextResourceCharacters)
		return limitedDocument(
			source,
			"ai.source.text-resource-limit",
			`Illustrator AI11 text resource exceeds the ${maxTextResourceCharacters}-character parse limit.`,
		)
	const diagnostics: IllustratorSourceDiagnostic[] = []
	const statements = sourceStatements(source)
	const textResource = textResourceFrom(source)
	const resources = textResource === undefined ? {} : { text: textResource }
	const firstLayer = source.indexOf("%AI5_BeginLayer")
	if (firstLayer < 0)
		return {
			format: "adobe-illustrator.source",
			metadata: sourceMetadata(source),
			bounds: sourceBounds(source),
			artboards: artboardsFrom(source),
			layers: [],
			rawSource: source,
			statements,
			resources,
			diagnostics: [
				{
					code: "ai.source.no-layers",
					message: "Illustrator source contains no AI5 layer records.",
					severity: "error",
				},
			],
			stats: {
				layers: 0,
				paths: 0,
				paintedPaths: 0,
				groups: 0,
				textFrames: 0,
				unknownOperators: {},
			},
		}
	const end = source.indexOf("%%PageTrailer", firstLayer)
	let tokens: Token[]
	try {
		tokens = lex(source.slice(0, end < 0 ? source.length : end), firstLayer)
	} catch (error) {
		return {
			format: "adobe-illustrator.source",
			metadata: sourceMetadata(source),
			bounds: sourceBounds(source),
			artboards: artboardsFrom(source),
			layers: [],
			rawSource: source,
			statements,
			resources,
			diagnostics: [
				{
					code: "ai.source.token-limit",
					message: error instanceof Error ? error.message : String(error),
					severity: "error",
				},
			],
			stats: {
				layers: 0,
				paths: 0,
				paintedPaths: 0,
				groups: 0,
				textFrames: 0,
				unknownOperators: {},
			},
		}
	}

	const layers: IllustratorSourceLayer[] = []
	let layer:
		| {
				name: string
				hidden: boolean
				locked: boolean
				preview: boolean
				printable: boolean
				color?: { r: number; g: number; b: number }
				children: IllustratorSourceNode[]
				start: IllustratorSourceSpan
		  }
		| undefined
	const containers: MutableContainer[] = []
	let state: PaintState = {
		fill: defaultBlack(),
		stroke: defaultBlack(),
		fillRule: "nonzero",
		width: 1,
		cap: "butt",
		join: "miter",
		miterLimit: 4,
		dashArray: [],
		dashOffset: 0,
		locked: false,
	}
	let operands: Token[] = []
	let contours: MutableContour[] = []
	let current: MutableContour | undefined
	let pointCount = 0
	let pathStart: IllustratorSourceSpan | undefined
	let pendingName: string | undefined
	let pathCount = 0
	let paintedPathCount = 0
	let groupCount = 0
	let textFrameCount = 0
	let activeTextRecord:
		| { properties: Record<string, number>; start: IllustratorSourceSpan }
		| undefined
	const unknownCounts = new Map<string, number>()
	const unknownSpans = new Map<string, IllustratorSourceSpan>()
	const fidelityIssues = new Set<string>()

	const target = (): IllustratorSourceNode[] | undefined =>
		containers.at(-1)?.children ?? layer?.children
	const flushContour = (): void => {
		if (current !== undefined && current.points.length > 0)
			contours.push(current)
		current = undefined
	}
	const clearPath = (): void => {
		contours = []
		current = undefined
		pathStart = undefined
	}
	const addPoint = (
		x: number,
		y: number,
		mode: "hard" | "soft",
	): MutablePoint => {
		if (++pointCount > MAX_POINTS)
			throw new Error(
				`Illustrator source exceeds the ${MAX_POINTS}-point limit.`,
			)
		const point: MutablePoint = { x, y, mode }
		current ??= { closed: false, points: [] }
		current.points.push(point)
		return point
	}
	const numbers = (count: number): number[] | undefined => {
		const values = operands.slice(-count).map(({ value }) => value)
		return values.length === count &&
			values.every((value) => typeof value === "number")
			? (values as number[])
			: undefined
	}
	const immutableContours = (
		items: readonly MutableContour[],
	): IllustratorSourceContour[] =>
		items.map((contour) => ({
			closed: contour.closed,
			points: contour.points.map((point) => ({ ...point })),
		}))
	const path = (
		token: Token,
		fill: boolean,
		stroke: boolean,
		close: boolean,
	): IllustratorSourcePath | undefined => {
		if (current !== undefined) current.closed ||= close
		flushContour()
		let finished: IllustratorSourceContour[] = immutableContours(contours)
		const compound = containers.findLast(
			({ groupKind }) => groupKind === "compound",
		)
		if (compound !== undefined && compound.pendingCompoundContours.length > 0) {
			finished = [...compound.pendingCompoundContours, ...finished]
			compound.pendingCompoundContours = []
		}
		const completedSpan = { ...(pathStart ?? token.span), end: token.span.end }
		clearPath()
		if (finished.length === 0) return undefined
		pathCount++
		if (fill || stroke) paintedPathCount++
		const authoredName = pendingName
		pendingName = undefined
		return {
			kind: "path",
			contours: finished,
			fillRule: state.fillRule,
			locked: state.locked,
			...(authoredName === undefined ? {} : { name: authoredName }),
			...(fill ? { fill: state.fill } : {}),
			...(stroke
				? {
						stroke: {
							color: state.stroke,
							width: state.width,
							cap: state.cap,
							join: state.join,
							miterLimit: state.miterLimit,
							dashArray: state.dashArray,
							dashOffset: state.dashOffset,
						},
					}
				: {}),
			span: completedSpan,
		}
	}
	const closeContainer = (
		token: Token,
		expected: IllustratorSourceGroup["groupKind"] | "any",
	): void => {
		const container = containers.pop()
		if (container === undefined) return
		if (container.savedState !== undefined) state = container.savedState
		if (expected !== "any" && container.groupKind !== expected)
			diagnostics.push({
				code: "ai.source.unbalanced-group",
				message: `Expected to close ${expected}, found ${container.groupKind}.`,
				severity: "warning",
				span: token.span,
			})
		groupCount++
		const group: IllustratorSourceGroup = {
			kind: "group",
			groupKind: container.groupKind,
			...(container.name === undefined ? {} : { name: container.name }),
			children: container.children,
			...(container.clippingPath === undefined
				? {}
				: { clippingPath: container.clippingPath }),
			span: { ...container.start, end: token.span.end },
		}
		target()?.push(group)
	}

	const unsupportedOperators = new Map<
		string,
		Readonly<{ code: string; message: string }>
	>([
		[
			"Bg",
			{
				code: "ai.source.unsupported-gradient",
				message:
					"Illustrator gradient artwork remains in the source AST but cannot yet be lowered.",
			},
		],
		[
			"Bb",
			{
				code: "ai.source.unsupported-gradient",
				message:
					"Illustrator gradient artwork remains in the source AST but cannot yet be lowered.",
			},
		],
		[
			"BB",
			{
				code: "ai.source.unsupported-gradient",
				message:
					"Illustrator gradient artwork remains in the source AST but cannot yet be lowered.",
			},
		],
		[
			"XI",
			{
				code: "ai.source.unsupported-image",
				message:
					"Placed or raster Illustrator artwork remains in the source AST but cannot yet be lowered.",
			},
		],
		[
			"XI1",
			{
				code: "ai.source.unsupported-image",
				message:
					"Placed or raster Illustrator artwork remains in the source AST but cannot yet be lowered.",
			},
		],
		[
			"XI2",
			{
				code: "ai.source.unsupported-image",
				message:
					"Placed or raster Illustrator artwork remains in the source AST but cannot yet be lowered.",
			},
		],
	])
	const knownNoops = new Set([
		"AE",
		"Ae",
		"Ap",
		"As",
		"Xd",
		"Xw",
		":",
		",",
		";",
		"Aq",
		"Ar",
		"Br",
		"Bd",
		"Bm",
		"Bn",
		"Bs",
		"D",
		"Xy",
		"XP",
		"Xm",
		"XW",
		"XT",
		"To",
		"Tp",
		"Tr",
		"Tf",
		"Tx",
		"TX",
		"Tj",
		"Tk",
		"Tz",
		"Tc",
		"Tl",
		"Ts",
		"T*",
		"X!",
		"X#",
		"XG",
		"Xh",
		"XJ",
		"Xn",
		"Xo",
		"Xr",
		"Xs",
	])
	try {
		for (const token of tokens) {
			if (typeof token.value !== "string" || token.value.startsWith("/")) {
				operands.push(token)
				continue
			}
			const operator = token.value
			if (activeTextRecord !== undefined) {
				if (operator === ",") {
					const value = operands.find(
						({ value }) => typeof value === "number",
					)?.value
					const name = operands.find(
						({ value }) => typeof value === "string" && value.startsWith("/"),
					)?.value
					if (typeof value === "number" && typeof name === "string")
						activeTextRecord.properties[name.slice(1)] = value
				} else if (operator === ";") {
					const properties = activeTextRecord.properties
					const storyIndex = properties.StoryIndex
					if (storyIndex !== undefined) {
						const text: IllustratorSourceText = {
							kind: "text",
							storyIndex,
							frameIndex: properties.FrameIndex ?? 0,
							freeUndo: properties.FreeUndo === 1,
							fill: state.fill,
							story: textResource?.stories.find(
								({ index }) => index === storyIndex,
							),
							rawProperties: properties,
							span: { ...activeTextRecord.start, end: token.span.end },
						}
						target()?.push(text)
						textFrameCount++
					}
					activeTextRecord = undefined
				}
				operands = []
				continue
			}
			if (
				operator === ":" &&
				operands.some(({ value }) => value === "/AI11Text")
			) {
				activeTextRecord = { properties: {}, start: token.span }
			} else if (operator === "Lb") {
				if (layer !== undefined)
					layers.push({
						...layer,
						span: { ...layer.start, end: token.span.start },
					})
				const flags = operands
					.filter(({ value }) => typeof value === "number")
					.map(({ value }) => value as number)
				layer = {
					name: `Layer ${layers.length + 1}`,
					hidden: flags[0] === 0,
					preview: flags[1] !== 0,
					locked: flags[2] === 0,
					printable: flags[3] !== 0,
					...(flags.length >= 11
						? {
								color: {
									r: flags[8]! / 255,
									g: flags[9]! / 255,
									b: flags[10]! / 255,
								},
							}
						: {}),
					children: [],
					start: token.span,
				}
			} else if (operator === "Ln") {
				const name = operands.findLast(
					({ value }) => typeof value === "object" && value.kind === "string",
				)?.value
				if (
					layer !== undefined &&
					typeof name === "object" &&
					name.kind === "string"
				)
					layer.name = name.value
			} else if (operator === "LB") {
				if (containers.length > 0)
					diagnostics.push({
						code: "ai.source.unbalanced-group",
						message: `Illustrator layer ended with ${containers.length} unclosed structural group${containers.length === 1 ? "" : "s"}; recovered at the layer boundary.`,
						severity: "warning",
						span: token.span,
					})
				while (containers.length > 0) closeContainer(token, "any")
				if (layer !== undefined) {
					layers.push({
						...layer,
						span: { ...layer.start, end: token.span.end },
					})
					layer = undefined
				}
			} else if (operator === "u" || operator === "*u" || operator === "q") {
				if (containers.length >= MAX_NESTING)
					throw new Error(
						`Illustrator source exceeds the ${MAX_NESTING}-group nesting limit.`,
					)
				containers.push({
					groupKind:
						operator === "u"
							? "normal"
							: operator === "*u"
								? "compound"
								: "clip",
					children: [],
					start: token.span,
					pendingCompoundContours: [],
					...(operator === "q"
						? { savedState: { ...state, dashArray: [...state.dashArray] } }
						: {}),
					...(pendingName === undefined ? {} : { name: pendingName }),
				})
				pendingName = undefined
			} else if (operator === "U") closeContainer(token, "normal")
			else if (operator === "*U") closeContainer(token, "compound")
			else if (operator === "Q") closeContainer(token, "clip")
			else if (operator === "m") {
				flushContour()
				const value = numbers(2)
				if (value !== undefined) {
					pathStart ??= operands.at(-2)?.span ?? token.span
					current = { closed: false, points: [] }
					addPoint(value[0]!, value[1]!, "hard")
				}
			} else if (["l", "L"].includes(operator)) {
				const value = numbers(2)
				if (value !== undefined)
					addPoint(value[0]!, value[1]!, operator === "L" ? "hard" : "soft")
			} else if (["c", "C"].includes(operator)) {
				const value = numbers(6)
				const previous = current?.points.at(-1)
				if (value !== undefined && previous !== undefined) {
					previous.outgoing = {
						x: value[0]! - previous.x,
						y: value[1]! - previous.y,
					}
					const endpoint = addPoint(
						value[4]!,
						value[5]!,
						operator === "C" ? "hard" : "soft",
					)
					endpoint.incoming = {
						x: value[2]! - endpoint.x,
						y: value[3]! - endpoint.y,
					}
				}
			} else if (["v", "V", "y", "Y"].includes(operator)) {
				const value = numbers(4)
				const previous = current?.points.at(-1)
				if (value !== undefined && previous !== undefined) {
					const cp1 =
						operator.toLowerCase() === "v"
							? { x: previous.x, y: previous.y }
							: { x: value[0]!, y: value[1]! }
					const endpoint = addPoint(
						value[2]!,
						value[3]!,
						operator === operator.toUpperCase() ? "hard" : "soft",
					)
					const cp2 =
						operator.toLowerCase() === "y"
							? { x: endpoint.x, y: endpoint.y }
							: { x: value[0]!, y: value[1]! }
					previous.outgoing = { x: cp1.x - previous.x, y: cp1.y - previous.y }
					endpoint.incoming = { x: cp2.x - endpoint.x, y: cp2.y - endpoint.y }
				}
			} else if (operator === "h" || operator === "H") {
				if (current !== undefined && operator === "h") current.closed = true
			} else if (operator === "W") {
				const clip = path(token, false, false, false)
				const container = containers.at(-1)
				if (clip !== undefined && container?.groupKind === "clip")
					container.clippingPath = clip
			} else if (["f", "F", "s", "S", "b", "B", "n", "N"].includes(operator)) {
				const compound = containers.findLast(
					({ groupKind }) => groupKind === "compound",
				)
				if ((operator === "N" || operator === "n") && compound !== undefined) {
					if (current !== undefined) current.closed ||= operator === "n"
					flushContour()
					compound.pendingCompoundContours.push(...immutableContours(contours))
					clearPath()
				} else {
					const rendered = path(
						token,
						"fFbB".includes(operator),
						"sSbB".includes(operator),
						"fsbn".includes(operator),
					)
					if (
						rendered !== undefined &&
						(rendered.fill !== undefined || rendered.stroke !== undefined)
					)
						target()?.push(rendered)
				}
			} else if (operator === "XR")
				state.fillRule = numbers(1)?.[0] === 1 ? "evenodd" : "nonzero"
			else if (operator === "g" || operator === "G") {
				const value = numbers(1)?.[0]
				if (value !== undefined) {
					if (operator === "g") state.fill = { space: "gray", value }
					else state.stroke = { space: "gray", value }
				}
			} else if (operator === "k" || operator === "K") {
				const value = numbers(4)
				if (value !== undefined) {
					const color = cmyk(value[0]!, value[1]!, value[2]!, value[3]!)
					if (operator === "k") state.fill = color
					else state.stroke = color
				}
			} else if (["x", "X", "Xk", "XK", "Xx", "XX"].includes(operator)) {
				const numeric = operands
					.filter(({ value }) => typeof value === "number")
					.map(({ value }) => value as number)
				const name = operands.find(
					({ value }) => typeof value === "object" && value.kind === "string",
				)?.value
				const authoredName =
					typeof name === "object" && name.kind === "string"
						? name.value
						: undefined
				let custom: IllustratorSourceColor | undefined
				if ((operator === "x" || operator === "X") && numeric.length >= 5)
					custom = {
						...cmyk(numeric[0]!, numeric[1]!, numeric[2]!, numeric[3]!),
						...(authoredName === undefined ? {} : { name: authoredName }),
						alternateGray: numeric.at(-1)!,
					}
				else if (
					(operator === "Xk" || operator === "XK") &&
					numeric.length >= 6
				)
					custom = {
						...cmyk(numeric[0]!, numeric[1]!, numeric[2]!, numeric[3]!),
						...(authoredName === undefined ? {} : { name: authoredName }),
						tint: numeric.at(-2)!,
						colorType: numeric.at(-1)!,
					}
				else if (
					(operator === "Xx" || operator === "XX") &&
					numeric.length >= 5
				) {
					const tint = numeric.at(-2)!
					const colorType = numeric.at(-1)!
					custom =
						colorType === 1 && numeric.length >= 5
							? {
									...rgb(numeric[0]!, numeric[1]!, numeric[2]!),
									...(authoredName === undefined ? {} : { name: authoredName }),
									tint,
									colorType,
								}
							: numeric.length >= 6
								? {
										...cmyk(numeric[0]!, numeric[1]!, numeric[2]!, numeric[3]!),
										...(authoredName === undefined
											? {}
											: { name: authoredName }),
										tint,
										colorType,
									}
								: undefined
				}
				if (custom !== undefined) {
					const encodedTint =
						"tint" in custom && custom.tint !== undefined
							? custom.tint
							: custom.space === "cmyk"
								? custom.alternateGray
								: undefined
					if (encodedTint !== undefined && encodedTint !== 0) {
						const code = "ai.source.unsupported-custom-color-tint"
						if (!fidelityIssues.has(code)) {
							fidelityIssues.add(code)
							diagnostics.push({
								code,
								message:
									encodedTint < 0 || encodedTint > 1
										? "A named Illustrator color uses an out-of-range tint; its process-color approximation was clamped while the authored value remains in the source AST."
										: "A named Illustrator ink tint was flattened to its best process-color approximation; its base components and encoded tint remain in the source AST.",
								severity: "warning",
								span: token.span,
							})
						}
					}
					if (["x", "Xk", "Xx"].includes(operator)) state.fill = custom
					else state.stroke = custom
				}
			} else if (operator === "Xa" || operator === "XA") {
				const all = operands
					.filter(({ value }) => typeof value === "number")
					.map(({ value }) => value as number)
				const value = all.slice(-3)
				const color =
					value.length === 3
						? {
								...rgb(value[0]!, value[1]!, value[2]!),
								...(all.length >= 7
									? {
											alternate: {
												space: "cmyk" as const,
												c: all[0]!,
												m: all[1]!,
												y: all[2]!,
												k: all[3]!,
											},
										}
									: {}),
							}
						: undefined
				if (color !== undefined) {
					if (operator === "Xa") state.fill = color
					else state.stroke = color
				}
			} else if (operator === "w") state.width = numbers(1)?.[0] ?? state.width
			else if (operator === "J")
				state.cap =
					(["butt", "round", "square"] as const)[numbers(1)?.[0] ?? -1] ??
					state.cap
			else if (operator === "j")
				state.join =
					(["miter", "round", "bevel"] as const)[numbers(1)?.[0] ?? -1] ??
					state.join
			else if (operator === "M")
				state.miterLimit = numbers(1)?.[0] ?? state.miterLimit
			else if (operator === "d") {
				const array = operands.find(
					({ value }) => typeof value === "object" && value.kind === "array",
				)?.value
				const offset = operands.findLast(
					({ value }) => typeof value === "number",
				)?.value
				if (typeof array === "object" && array.kind === "array")
					state.dashArray = array.values
				if (typeof offset === "number") state.dashOffset = offset
			} else if (operator === "O" || operator === "R") {
				if ((numbers(1)?.[0] ?? 0) !== 0) {
					const code = "ai.source.unsupported-overprint"
					if (!fidelityIssues.has(code)) {
						fidelityIssues.add(code)
						diagnostics.push({
							code,
							message:
								"Illustrator fill or stroke overprint remains in the source AST but is not represented by create-design paint.",
							severity: "warning",
							span: token.span,
						})
					}
					unknownCounts.set(operator, (unknownCounts.get(operator) ?? 0) + 1)
					unknownSpans.set(operator, unknownSpans.get(operator) ?? token.span)
					target()?.push({
						kind: "unknown",
						operator,
						operands: operands.map(({ value }) => publicOperand(value)),
						span: token.span,
					})
				}
			} else if (operator === "A") state.locked = numbers(1)?.[0] === 1
			else if (operator === "XW") {
				const value = operands.findLast(
					({ value }) => typeof value === "object" && value.kind === "string",
				)?.value
				if (
					typeof value === "object" &&
					value.kind === "string" &&
					value.value.trim() !== ""
				)
					pendingName = value.value
			} else if (unsupportedOperators.has(operator)) {
				unknownCounts.set(operator, (unknownCounts.get(operator) ?? 0) + 1)
				unknownSpans.set(operator, unknownSpans.get(operator) ?? token.span)
				const fidelity = unsupportedOperators.get(operator)!
				if (!fidelityIssues.has(fidelity.code)) {
					fidelityIssues.add(fidelity.code)
					diagnostics.push({
						code: fidelity.code,
						message: fidelity.message,
						severity: "warning",
						span: token.span,
					})
				}
				target()?.push({
					kind: "unknown",
					operator,
					operands: operands.map(({ value }) => publicOperand(value)),
					span: token.span,
				})
			} else if (!knownNoops.has(operator)) {
				unknownCounts.set(operator, (unknownCounts.get(operator) ?? 0) + 1)
				unknownSpans.set(operator, unknownSpans.get(operator) ?? token.span)
				const unknown: IllustratorSourceUnknown = {
					kind: "unknown",
					operator,
					operands: operands.map(({ value }) => publicOperand(value)),
					span: token.span,
				}
				target()?.push(unknown)
			}
			operands = []
		}
	} catch (error) {
		diagnostics.push({
			code: "ai.source.resource-limit",
			message: error instanceof Error ? error.message : String(error),
			severity: "error",
		})
	}
	if (layer !== undefined)
		layers.push({ ...layer, span: { ...layer.start, end: source.length } })
	const finalLayers = layers
	for (const [operator, count] of unknownCounts)
		if (
			!unsupportedOperators.has(operator) &&
			operator !== "O" &&
			operator !== "R"
		)
			diagnostics.push({
				code: "ai.source.unknown-operator",
				message: `Preserved unsupported Illustrator operator ${operator} (${count} occurrence${count === 1 ? "" : "s"}).`,
				severity: "warning",
				...(unknownSpans.get(operator) === undefined
					? {}
					: { span: unknownSpans.get(operator)! }),
			})
	if (artboardsFrom(source).length === 0)
		diagnostics.push({
			code: "ai.source.no-artboards",
			message: "Illustrator source contains no recoverable artboard metadata.",
			severity: "error",
		})
	return {
		format: "adobe-illustrator.source",
		metadata: sourceMetadata(source),
		bounds: sourceBounds(source),
		artboards: artboardsFrom(source),
		layers: finalLayers,
		rawSource: source,
		statements,
		resources,
		diagnostics,
		stats: {
			layers: finalLayers.length,
			paths: pathCount,
			paintedPaths: paintedPathCount,
			groups: groupCount,
			textFrames: textFrameCount,
			unknownOperators: Object.fromEntries(unknownCounts),
		},
	}
}
