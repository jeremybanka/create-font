import {
	Blob as HarfBuzzBlob,
	Buffer as HarfBuzzBuffer,
	Direction,
	Face,
	Feature,
	Font,
	Variation,
	shape as shapeBuffer,
} from "harfbuzzjs"

import type {
	FontAxis,
	FontDiagnostic,
	FontIdentity,
	FontIdentityDescriptor,
	FontMetrics,
	FontResult,
	FontService,
	FontServiceCacheStats,
	GlyphBounds,
	GlyphOutline,
	GlyphOutlineRequest,
	OutlineCommand,
	PositionedGlyph,
	RegisteredFont,
	ShapeTextRequest,
	ShapedLine,
	ShapedText,
	TextDirection,
	VariationCoordinates,
} from "./types.ts"

interface ParsedFont {
	readonly blob: HarfBuzzBlob
	readonly bytes: Uint8Array
	readonly diagnostics: readonly FontDiagnostic[]
	readonly face: Face
	readonly identity: FontIdentity
	readonly outlineTable: string | undefined
}

interface Counter {
	hits: number
	misses: number
}

function contentHash(bytes: Uint8Array): string {
	// Two independent 64-bit FNV-1a streams make accidental cache collisions
	// vanishingly unlikely without requiring ambient WebCrypto or Node crypto.
	let first = 0xcbf29ce484222325n
	let second = 0x84222325cbf29ce4n
	for (let index = 0; index < bytes.length; index += 1) {
		const byte = BigInt(bytes[index] ?? 0)
		first = BigInt.asUintN(64, (first ^ byte) * 0x100000001b3n)
		second = BigInt.asUintN(
			64,
			(second ^ (byte + BigInt(index & 0xff))) * 0x100000001b3n,
		)
	}
	return `${first.toString(16).padStart(16, "0")}${second
		.toString(16)
		.padStart(16, "0")}`
}

function identityFor(
	descriptor: FontIdentityDescriptor,
	bytes: Uint8Array,
): FontIdentity {
	const faceIndex = descriptor.faceIndex ?? 0
	const binaryHash = contentHash(bytes)
	const fields = [
		descriptor.source,
		descriptor.family,
		String(faceIndex),
		String(descriptor.revision),
		binaryHash,
	]
	const key = `font:${fields.map((field) => encodeURIComponent(field)).join("/")}`
	return Object.freeze({ ...descriptor, faceIndex, binaryHash, key })
}

function diagnostic(
	value: Omit<FontDiagnostic, "severity"> &
		Partial<Pick<FontDiagnostic, "severity">>,
): FontDiagnostic {
	return Object.freeze({ severity: "error", ...value })
}

function tableDirectory(
	bytes: Uint8Array,
	faceIndex: number,
): FontResult<ReadonlySet<string>> {
	const malformed = (message: string): FontResult<ReadonlySet<string>> => ({
		diagnostics: [diagnostic({ code: "font.malformed", message })],
	})
	if (bytes.byteLength < 12)
		return malformed("Font data is shorter than an SFNT header.")
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const tagAt = (offset: number): string =>
		new TextDecoder("latin1").decode(bytes.subarray(offset, offset + 4))
	let sfntOffset = 0
	if (tagAt(0) === "ttcf") {
		if (bytes.byteLength < 12)
			return malformed("Font collection header is truncated.")
		const count = view.getUint32(8, false)
		if (faceIndex < 0 || faceIndex >= count)
			return malformed(`Font collection does not contain face ${faceIndex}.`)
		const location = 12 + faceIndex * 4
		if (location + 4 > bytes.byteLength)
			return malformed("Font collection face directory is truncated.")
		sfntOffset = view.getUint32(location, false)
	} else if (faceIndex !== 0) {
		return malformed("A non-collection font only contains face 0.")
	}
	if (sfntOffset + 12 > bytes.byteLength)
		return malformed("SFNT table directory is outside the font data.")
	const signature = view.getUint32(sfntOffset, false)
	const signatureTag = tagAt(sfntOffset)
	if (
		signature !== 0x0001_0000 &&
		signatureTag !== "OTTO" &&
		signatureTag !== "true"
	)
		return malformed(
			`Unsupported SFNT signature ${JSON.stringify(signatureTag)}.`,
		)
	const tableCount = view.getUint16(sfntOffset + 4, false)
	const directoryEnd = sfntOffset + 12 + tableCount * 16
	if (directoryEnd > bytes.byteLength)
		return malformed("SFNT table records are truncated.")
	const tags = new Set<string>()
	for (let index = 0; index < tableCount; index += 1) {
		const record = sfntOffset + 12 + index * 16
		const tag = tagAt(record)
		const offset = view.getUint32(record + 8, false)
		const length = view.getUint32(record + 12, false)
		if (offset > bytes.byteLength || length > bytes.byteLength - offset)
			return malformed(
				`SFNT table ${JSON.stringify(tag)} lies outside the font data.`,
			)
		tags.add(tag)
	}
	for (const required of ["head", "maxp", "cmap", "hhea", "hmtx"]) {
		if (!tags.has(required))
			return malformed(`SFNT font is missing required ${required} table.`)
	}
	return { value: tags, diagnostics: [] }
}

function variationEntries(
	variations: VariationCoordinates | undefined,
): readonly (readonly [string, number])[] {
	return Object.freeze(
		Object.entries(variations ?? {}).sort(([left], [right]) =>
			left.localeCompare(right),
		),
	)
}

function variationKey(variations: VariationCoordinates | undefined): string {
	return variationEntries(variations)
		.map(([tag, value]) => `${tag}=${value}`)
		.join(",")
}

function featureKey(request: ShapeTextRequest): string {
	return (request.features ?? [])
		.map(
			({ tag, value = 1, start = 0, end = 0xffff_ffff }) =>
				`${tag}=${value}[${start}:${end}]`,
		)
		.join(",")
}

function resolvedDirection(text: string, direction: TextDirection = "auto") {
	if (direction !== "auto") return direction
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0
		if (
			(codePoint >= 0x0590 && codePoint <= 0x08ff) ||
			(codePoint >= 0xfb1d && codePoint <= 0xfdff) ||
			(codePoint >= 0xfe70 && codePoint <= 0xfeff)
		)
			return "rtl"
		if (/\p{Letter}/u.test(character)) return "ltr"
	}
	return "ltr"
}

const directionValue = {
	ltr: Direction.LTR,
	rtl: Direction.RTL,
	ttb: Direction.TTB,
	btt: Direction.BTT,
} as const

function linesOf(text: string): readonly Readonly<{
	text: string
	start: number
	end: number
	breakEnd: number
}>[] {
	const lines: {
		text: string
		start: number
		end: number
		breakEnd: number
	}[] = []
	let start = 0
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index)
		if (code !== 0x0a && code !== 0x0d) continue
		const breakEnd =
			code === 0x0d && text.charCodeAt(index + 1) === 0x0a
				? index + 2
				: index + 1
		lines.push({ text: text.slice(start, index), start, end: index, breakEnd })
		start = breakEnd
		index = breakEnd - 1
	}
	lines.push({
		text: text.slice(start),
		start,
		end: text.length,
		breakEnd: text.length,
	})
	return lines
}

function boundsFromExtents(
	extents: Readonly<{
		xBearing: number
		yBearing: number
		width: number
		height: number
	}>,
	x: number,
	y: number,
): GlyphBounds {
	const firstX = x + extents.xBearing
	const secondX = firstX + extents.width
	const firstY = y + extents.yBearing
	const secondY = firstY + extents.height
	return Object.freeze({
		x: Math.min(firstX, secondX),
		y: Math.min(firstY, secondY),
		width: Math.abs(extents.width),
		height: Math.abs(extents.height),
	})
}

function outlineCommands(
	commands: readonly Readonly<{ type: string; values: number[] }>[],
): readonly OutlineCommand[] {
	return Object.freeze(
		commands.flatMap(({ type, values }): readonly OutlineCommand[] => {
			if (type === "M" || type === "L") {
				const [x, y] = values
				return x === undefined || y === undefined ? [] : [{ type, x, y }]
			}
			if (type === "Q") {
				const [cx, cy, x, y] = values
				return cx === undefined ||
					cy === undefined ||
					x === undefined ||
					y === undefined
					? []
					: [{ type, cx, cy, x, y }]
			}
			if (type === "C") {
				const [c1x, c1y, c2x, c2y, x, y] = values
				return [c1x, c1y, c2x, c2y, x, y].some((value) => value === undefined)
					? []
					: [
							{
								type,
								c1x: c1x as number,
								c1y: c1y as number,
								c2x: c2x as number,
								c2y: c2y as number,
								x: x as number,
								y: y as number,
							},
						]
			}
			return type === "Z" ? [{ type: "Z" }] : []
		}),
	)
}

export function createFontService(): FontService {
	const owned = new Map<string, Uint8Array>()
	const locators = new Map<string, string>()
	const parsing = new Map<string, ParsedFont>()
	const shaping = new Map<string, ShapedText>()
	const metricsCache = new Map<string, FontResult<FontMetrics>>()
	const outlines = new Map<string, GlyphOutline>()
	const counters: Record<
		"parsing" | "shaping" | "metrics" | "outlines",
		Counter
	> = {
		parsing: { hits: 0, misses: 0 },
		shaping: { hits: 0, misses: 0 },
		metrics: { hits: 0, misses: 0 },
		outlines: { hits: 0, misses: 0 },
	}

	const locator = (identity: FontIdentity): string =>
		`${identity.source}\u0000${identity.family}\u0000${identity.faceIndex}`

	const clearFontCaches = (key: string): void => {
		parsing.delete(key)
		for (const cache of [shaping, metricsCache, outlines]) {
			for (const cacheKey of cache.keys()) {
				if (cacheKey.startsWith(`${key}\u0000`)) cache.delete(cacheKey)
			}
		}
	}

	const missingFont = (font: FontIdentity): FontResult<never> => ({
		diagnostics: [
			diagnostic({
				code: "font.missing",
				font,
				message: `Font ${JSON.stringify(font.key)} is not registered.`,
			}),
		],
	})

	const parsedFont = (font: FontIdentity): FontResult<ParsedFont> => {
		const cached = parsing.get(font.key)
		if (cached !== undefined) {
			counters.parsing.hits += 1
			return { value: cached, diagnostics: cached.diagnostics }
		}
		counters.parsing.misses += 1
		const bytes = owned.get(font.key)
		if (bytes === undefined) return missingFont(font)
		const directory = tableDirectory(bytes, font.faceIndex)
		if (directory.value === undefined) return directory
		try {
			const blob = new HarfBuzzBlob(bytes)
			const face = new Face(blob, font.faceIndex)
			if (!Number.isFinite(face.upem) || face.upem <= 0)
				return {
					diagnostics: [
						diagnostic({
							code: "font.malformed",
							font,
							message: "Font units-per-em is missing or invalid.",
						}),
					],
				}
			const outlineTable = ["glyf", "CFF ", "CFF2"].find((tag) =>
				directory.value?.has(tag),
			)
			const parseDiagnostics = Object.freeze(
				outlineTable === undefined
					? [
							diagnostic({
								code: "font.unsupported-table",
								font,
								message:
									"Font has no supported glyf, CFF, or CFF2 outline table.",
								severity: "warning",
								table: "outline",
							}),
						]
					: [],
			)
			const parsed = Object.freeze({
				blob,
				bytes,
				diagnostics: parseDiagnostics,
				face,
				identity: font,
				outlineTable,
			})
			parsing.set(font.key, parsed)
			return {
				value: parsed,
				diagnostics: parseDiagnostics,
			}
		} catch (error) {
			return {
				diagnostics: [
					diagnostic({
						code: "font.malformed",
						font,
						message: error instanceof Error ? error.message : String(error),
					}),
				],
			}
		}
	}

	const fontWithVariations = (
		parsed: ParsedFont,
		variations: VariationCoordinates | undefined,
	): Readonly<{ font: Font; diagnostics: readonly FontDiagnostic[] }> => {
		const font = new Font(parsed.face)
		font.setScale(parsed.face.upem, parsed.face.upem)
		const axes = parsed.face.getAxisInfos()
		const diagnostics: FontDiagnostic[] = []
		const resolved = variationEntries(variations).flatMap(([tag, value]) => {
			const axis = axes[tag]
			if (axis === undefined) {
				diagnostics.push(
					diagnostic({
						code: "variation.unsupported-axis",
						font: parsed.identity,
						message: `Font does not define variation axis ${JSON.stringify(tag)}.`,
						severity: "warning",
					}),
				)
				return []
			}
			const clamped = Math.max(axis.min, Math.min(axis.max, value))
			if (clamped !== value)
				diagnostics.push(
					diagnostic({
						code: "variation.out-of-range",
						font: parsed.identity,
						message: `Variation ${tag}=${value} is outside [${axis.min}, ${axis.max}]; using ${clamped}.`,
						severity: "warning",
					}),
				)
			return [new Variation(tag, clamped)]
		})
		font.setVariations(resolved)
		return { font, diagnostics: Object.freeze(diagnostics) }
	}

	const metrics = (
		identity: FontIdentity,
		variations?: VariationCoordinates,
	): FontResult<FontMetrics> => {
		const key = `${identity.key}\u0000${variationKey(variations)}`
		const cached = metricsCache.get(key)
		if (cached !== undefined) {
			counters.metrics.hits += 1
			return cached
		}
		counters.metrics.misses += 1
		const parsed = parsedFont(identity)
		if (parsed.value === undefined) return parsed
		const varied = fontWithVariations(parsed.value, variations)
		const extents = varied.font.hExtents()
		const axes = Object.entries(parsed.value.face.getAxisInfos())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(
				([tag, axis]): FontAxis =>
					Object.freeze({
						tag,
						min: axis.min,
						default: axis.default,
						max: axis.max,
					}),
			)
		const value = Object.freeze({
			unitsPerEm: parsed.value.face.upem,
			ascender: extents.ascender,
			descender: extents.descender,
			lineGap: extents.lineGap,
			axes: Object.freeze(axes),
		})
		const result = Object.freeze({
			value,
			diagnostics: Object.freeze([
				...parsed.diagnostics,
				...varied.diagnostics,
			]),
		})
		metricsCache.set(key, result)
		return result
	}

	const shape = (request: ShapeTextRequest): FontResult<ShapedText> => {
		const direction = resolvedDirection(request.text, request.direction)
		const key = [
			request.font.key,
			request.text,
			direction,
			request.script ?? "",
			request.language ?? "",
			featureKey(request),
			variationKey(request.variations),
			request.lineHeight ?? "auto",
		].join("\u0000")
		const cached = shaping.get(key)
		if (cached !== undefined) {
			counters.shaping.hits += 1
			return { value: cached, diagnostics: cached.diagnostics }
		}
		counters.shaping.misses += 1
		const parsed = parsedFont(request.font)
		if (parsed.value === undefined) return parsed
		const fontMetrics = metrics(request.font, request.variations)
		if (fontMetrics.value === undefined) return fontMetrics
		const varied = fontWithVariations(parsed.value, request.variations)
		const diagnostics: FontDiagnostic[] = [...fontMetrics.diagnostics]
		const glyphs: PositionedGlyph[] = []
		const lines: ShapedLine[] = []
		const lineHeight =
			request.lineHeight ??
			fontMetrics.value.ascender -
				fontMetrics.value.descender +
				fontMetrics.value.lineGap
		for (const [lineIndex, line] of linesOf(request.text).entries()) {
			const baseline = lineIndex === 0 ? 0 : -lineIndex * lineHeight
			for (let offset = 0; offset < line.text.length;) {
				const codePoint = line.text.codePointAt(offset)
				if (codePoint === undefined) break
				if (varied.font.nominalGlyph(codePoint) === undefined)
					diagnostics.push(
						diagnostic({
							code: "glyph.missing",
							font: request.font,
							message: `Font has no glyph for U+${codePoint
								.toString(16)
								.toUpperCase()
								.padStart(4, "0")}.`,
							textIndex: line.start + offset,
						}),
					)
				offset += codePoint > 0xffff ? 2 : 1
			}
			const buffer = new HarfBuzzBuffer()
			buffer.addText(line.text)
			buffer.guessSegmentProperties()
			buffer.setDirection(directionValue[direction])
			if (request.script !== undefined) buffer.setScript(request.script)
			if (request.language !== undefined) buffer.setLanguage(request.language)
			const features = (request.features ?? []).map(
				({ tag, value = 1, start = line.start, end = line.end }) =>
					new Feature(
						tag,
						value,
						Math.max(0, start - line.start),
						Math.max(0, Math.min(line.text.length, end - line.start)),
					),
			)
			shapeBuffer(varied.font, buffer, features)
			const shaped = buffer.getGlyphInfosAndPositions()
			const clusters = [...new Set(shaped.map(({ cluster }) => cluster))].sort(
				(left, right) => left - right,
			)
			const clusterEnd = new Map(
				clusters.map((cluster, index) => [
					cluster,
					clusters[index + 1] ?? line.text.length,
				]),
			)
			const glyphStart = glyphs.length
			let x = 0
			let y = baseline
			for (const item of shaped) {
				const xAdvance = item.xAdvance ?? 0
				const yAdvance = item.yAdvance ?? 0
				const xOffset = item.xOffset ?? 0
				const yOffset = item.yOffset ?? 0
				const extents = varied.font.glyphExtents(item.codepoint)
				glyphs.push(
					Object.freeze({
						glyphId: item.codepoint,
						cluster: line.start + item.cluster,
						clusterEnd:
							line.start + (clusterEnd.get(item.cluster) ?? line.text.length),
						lineIndex,
						x,
						y,
						xAdvance,
						yAdvance,
						xOffset,
						yOffset,
						...(extents === undefined
							? {}
							: {
									bounds: boundsFromExtents(extents, x + xOffset, y + yOffset),
								}),
					}),
				)
				x += xAdvance
				y += yAdvance
			}
			lines.push(
				Object.freeze({
					textStart: line.start,
					textEnd: line.end,
					breakEnd: line.breakEnd,
					baseline,
					advanceX: x,
					advanceY: y + lineIndex * lineHeight,
					glyphStart,
					glyphEnd: glyphs.length,
				}),
			)
		}
		const value = Object.freeze({
			font: request.font,
			text: request.text,
			direction,
			metrics: fontMetrics.value,
			lineHeight,
			glyphs: Object.freeze(glyphs),
			lines: Object.freeze(lines),
			diagnostics: Object.freeze(diagnostics),
		})
		shaping.set(key, value)
		return { value, diagnostics: value.diagnostics }
	}

	const outline = (request: GlyphOutlineRequest): FontResult<GlyphOutline> => {
		const key = `${request.font.key}\u0000${variationKey(request.variations)}\u0000${request.glyphId}`
		const cached = outlines.get(key)
		if (cached !== undefined) {
			counters.outlines.hits += 1
			return { value: cached, diagnostics: cached.diagnostics }
		}
		counters.outlines.misses += 1
		const parsed = parsedFont(request.font)
		if (parsed.value === undefined) return parsed
		if (parsed.value.outlineTable === undefined) {
			const unsupported = diagnostic({
				code: "font.unsupported-table",
				font: request.font,
				glyphId: request.glyphId,
				message: "Font has no supported outline table.",
				table: "outline",
			})
			return { diagnostics: [unsupported] }
		}
		const varied = fontWithVariations(parsed.value, request.variations)
		const extents = varied.font.glyphExtents(request.glyphId)
		const commands = outlineCommands(varied.font.glyphToJson(request.glyphId))
		const diagnostics = Object.freeze([
			...parsed.diagnostics,
			...varied.diagnostics,
		])
		const value = Object.freeze({
			font: request.font,
			glyphId: request.glyphId,
			commands,
			...(extents === undefined
				? {}
				: { bounds: boundsFromExtents(extents, 0, 0) }),
			diagnostics,
		})
		outlines.set(key, value)
		return { value, diagnostics }
	}

	return Object.freeze({
		registerFont(
			descriptor: FontIdentityDescriptor,
			input: Uint8Array | ArrayBuffer,
		): FontResult<RegisteredFont> {
			const source = input instanceof Uint8Array ? input : new Uint8Array(input)
			const bytes = source.slice()
			const identity = identityFor(descriptor, bytes)
			const identityLocator = locator(identity)
			const existing = locators.get(identityLocator)
			owned.set(identity.key, bytes)
			const parsed = parsedFont(identity)
			if (parsed.value === undefined) {
				owned.delete(identity.key)
				clearFontCaches(identity.key)
				return parsed
			}
			if (existing !== undefined && existing !== identity.key) {
				owned.delete(existing)
				clearFontCaches(existing)
			}
			locators.set(identityLocator, identity.key)
			return {
				value: Object.freeze({ identity, byteLength: bytes.byteLength }),
				diagnostics: parsed.diagnostics,
			}
		},
		unregisterFont(identity: FontIdentity): boolean {
			const removed = owned.delete(identity.key)
			if (locators.get(locator(identity)) === identity.key)
				locators.delete(locator(identity))
			clearFontCaches(identity.key)
			return removed
		},
		metrics,
		shape,
		outline,
		cacheStats(): FontServiceCacheStats {
			const entry = (name: keyof typeof counters, entries: number) =>
				Object.freeze({ entries, ...counters[name] })
			return Object.freeze({
				parsing: entry("parsing", parsing.size),
				shaping: entry("shaping", shaping.size),
				metrics: entry("metrics", metricsCache.size),
				outlines: entry("outlines", outlines.size),
			})
		},
		clearCaches(): void {
			parsing.clear()
			shaping.clear()
			metricsCache.clear()
			outlines.clear()
		},
	})
}
