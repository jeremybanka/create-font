import {
	createLoweringPlan,
	type Bounds,
	type LoweringPlan,
} from "./lowering.ts"
import type {
	CharacterMapEntry,
	GlyphVariation,
	SimpleGlyph,
	VariableFont,
	VariationAxis,
} from "./model.ts"

function serializeGpos(font: VariableFont): Uint8Array {
	const grouped = new Map<number, { right: number; value: number }[]>()
	for (const pair of font.kerning) {
		const left = Number(pair.left)
		const list = grouped.get(left) ?? []
		list.push({ right: Number(pair.right), value: Number(pair.value) })
		grouped.set(left, list)
	}
	const groups = [...grouped]
		.sort(([a], [b]) => a - b)
		.map(([left, pairs]) => ({
			left,
			pairs: pairs.sort((a, b) => a.right - b.right),
		}))
	const writer = new BinaryWriter()
	writer.u16(1)
	writer.u16(0)
	writer.u16(10)
	writer.u16(30)
	writer.u16(44)
	// DFLT/default language system enables the only `kern` feature.
	writer.u16(1)
	writer.tag("DFLT")
	writer.u16(8)
	writer.u16(4)
	writer.u16(0)
	writer.u16(0)
	writer.u16(0xffff)
	writer.u16(1)
	writer.u16(0)
	writer.u16(1)
	writer.tag("kern")
	writer.u16(8)
	writer.u16(0)
	writer.u16(1)
	writer.u16(0)
	writer.u16(1)
	writer.u16(4)
	writer.u16(2)
	writer.u16(0)
	writer.u16(1)
	writer.u16(8)
	const pairPosStart = writer.length
	const headerLength = 10 + groups.length * 2
	const pairSetsLength = groups.reduce(
		(sum, group) => sum + 2 + group.pairs.length * 4,
		0,
	)
	writer.u16(1)
	writer.u16(headerLength + pairSetsLength)
	writer.u16(0x0004)
	writer.u16(0)
	writer.u16(groups.length)
	let pairSetOffset = headerLength
	for (const group of groups) {
		writer.u16(pairSetOffset)
		pairSetOffset += 2 + group.pairs.length * 4
	}
	for (const group of groups) {
		writer.u16(group.pairs.length)
		for (const pair of group.pairs) {
			writer.u16(pair.right)
			writer.i16(pair.value)
		}
	}
	writer.u16(1)
	writer.u16(groups.length)
	for (const group of groups) writer.u16(group.left)
	if (pairPosStart !== 56) throw new Error("Unexpected GPOS PairPos offset.")
	return writer.toUint8Array()
}

const SFNT_CHECKSUM_MAGIC = 0xb1b0_afba
const HEAD_MAGIC = 0x5f0f_3cf5
const NAME_ID_START = 256

class BinaryWriter {
	readonly #bytes: number[] = []

	get length(): number {
		return this.#bytes.length
	}

	u8(value: number): void {
		this.#bytes.push(value & 0xff)
	}

	i8(value: number): void {
		this.u8(value)
	}

	u16(value: number): void {
		this.u8(value >>> 8)
		this.u8(value)
	}

	i16(value: number): void {
		this.u16(value)
	}

	u32(value: number): void {
		const unsigned = value >>> 0
		this.u8(unsigned >>> 24)
		this.u8(unsigned >>> 16)
		this.u8(unsigned >>> 8)
		this.u8(unsigned)
	}

	i32(value: number): void {
		this.u32(value)
	}

	fixed(value: number): void {
		this.i32(Math.round(value * 65_536))
	}

	f2dot14(value: number): void {
		this.i16(Math.round(value * 16_384))
	}

	u64(value: bigint): void {
		for (let shift = 56n; shift >= 0n; shift -= 8n) {
			this.u8(Number((value >> shift) & 0xffn))
		}
	}

	tag(value: string): void {
		if (value.length !== 4) throw new TypeError(`Expected a four-byte tag.`)
		for (let index = 0; index < 4; index += 1) {
			this.u8(value.charCodeAt(index))
		}
	}

	bytes(value: Uint8Array | readonly number[]): void {
		for (const byte of value) this.u8(byte)
	}

	padTo(alignment: number): void {
		while (this.length % alignment !== 0) this.u8(0)
	}

	toUint8Array(): Uint8Array {
		return Uint8Array.from(this.#bytes)
	}
}

interface NameRecordPlan {
	readonly id: number
	readonly value: string
}

interface NamePlan {
	readonly records: readonly NameRecordPlan[]
	readonly axisNameIds: readonly number[]
	readonly instanceNameIds: readonly number[]
	readonly instancePostScriptNameIds: readonly (number | null)[]
}

function createNamePlan(font: VariableFont): NamePlan {
	const records: NameRecordPlan[] = [
		{ id: 1, value: String(font.names.family) },
		{ id: 2, value: String(font.names.subfamily) },
		{ id: 3, value: String(font.names.uniqueId) },
		{ id: 4, value: String(font.names.fullName) },
		{ id: 5, value: String(font.names.version) },
		{ id: 6, value: String(font.names.postScriptName) },
		{ id: 16, value: String(font.names.typographicFamily) },
		{ id: 17, value: String(font.names.typographicSubfamily) },
	]
	let nextId = NAME_ID_START
	const axisNameIds = font.axes.map((axis) => {
		const id = nextId
		nextId += 1
		records.push({ id, value: String(axis.name) })
		return id
	})
	const instanceNameIds = font.instances.map((instance) => {
		const id = nextId
		nextId += 1
		records.push({ id, value: String(instance.name) })
		return id
	})
	const instancePostScriptNameIds = font.instances.map((instance) => {
		if (instance.postScriptName === null) return null
		const id = nextId
		nextId += 1
		records.push({ id, value: String(instance.postScriptName) })
		return id
	})
	return { records, axisNameIds, instanceNameIds, instancePostScriptNameIds }
}

function assertLength(
	tag: string,
	bytes: Uint8Array,
	expected: number,
): Uint8Array {
	if (bytes.length !== expected) {
		throw new RangeError(
			`${tag} serialized to ${bytes.length} bytes; lowering planned ${expected}.`,
		)
	}
	return bytes
}

function writeUtf16Be(value: string): Uint8Array {
	const writer = new BinaryWriter()
	for (let index = 0; index < value.length; index += 1) {
		writer.u16(value.charCodeAt(index))
	}
	return writer.toUint8Array()
}

function serializeName(font: VariableFont, names: NamePlan): Uint8Array {
	const writer = new BinaryWriter()
	const encoded = new Map<string, Uint8Array>()
	const offsets = new Map<string, number>()
	let storageLength = 0
	for (const record of names.records) {
		if (encoded.has(record.value)) continue
		const bytes = writeUtf16Be(record.value)
		encoded.set(record.value, bytes)
		offsets.set(record.value, storageLength)
		storageLength += bytes.length
	}
	writer.u16(0)
	writer.u16(names.records.length)
	writer.u16(6 + names.records.length * 12)
	for (const record of names.records) {
		const bytes = encoded.get(record.value)
		if (bytes === undefined) throw new Error(`Missing encoded name string.`)
		writer.u16(3)
		writer.u16(1)
		writer.u16(0x0409)
		writer.u16(record.id)
		writer.u16(bytes.length)
		writer.u16(offsets.get(record.value) ?? 0)
	}
	for (const bytes of encoded.values()) writer.bytes(bytes)
	return writer.toUint8Array()
}

function serializeFvar(font: VariableFont, names: NamePlan): Uint8Array {
	const writer = new BinaryWriter()
	const hasPostScriptNameIds = names.instancePostScriptNameIds.some(
		(id) => id !== null,
	)
	const instanceSize = 4 + font.axes.length * 4 + (hasPostScriptNameIds ? 2 : 0)
	writer.u16(1)
	writer.u16(0)
	writer.u16(16)
	writer.u16(2)
	writer.u16(font.axes.length)
	writer.u16(20)
	writer.u16(font.instances.length)
	writer.u16(instanceSize)
	for (let index = 0; index < font.axes.length; index += 1) {
		const axis = font.axes[index]
		if (axis === undefined) continue
		writer.tag(String(axis.tag))
		writer.fixed(Number(axis.min))
		writer.fixed(Number(axis.default))
		writer.fixed(Number(axis.max))
		writer.u16(axis.hidden ? 1 : 0)
		writer.u16(names.axisNameIds[index] ?? 0)
	}
	for (let index = 0; index < font.instances.length; index += 1) {
		const instance = font.instances[index]
		if (instance === undefined) continue
		writer.u16(names.instanceNameIds[index] ?? 0)
		writer.u16(0)
		for (const coordinate of instance.coordinates) {
			writer.fixed(Number(coordinate))
		}
		if (hasPostScriptNameIds) {
			writer.u16(names.instancePostScriptNameIds[index] ?? 0xffff)
		}
	}
	return writer.toUint8Array()
}

function serializeStat(font: VariableFont, names: NamePlan): Uint8Array {
	const writer = new BinaryWriter()
	const axisValueOffsetsStart = 20 + font.axes.length * 8
	const valueSizes = font.instances.map(() =>
		font.axes.length === 1 ? 12 : 8 + font.axes.length * 6,
	)
	writer.u16(1)
	writer.u16(2)
	writer.u16(8)
	writer.u16(font.axes.length)
	writer.u32(20)
	writer.u16(font.instances.length)
	writer.u32(font.instances.length === 0 ? 0 : axisValueOffsetsStart)
	writer.u16(2)
	for (let index = 0; index < font.axes.length; index += 1) {
		const axis = font.axes[index]
		if (axis === undefined) continue
		writer.tag(String(axis.tag))
		writer.u16(names.axisNameIds[index] ?? 0)
		writer.u16(index)
	}
	let valueOffset = font.instances.length * 2
	for (const size of valueSizes) {
		writer.u16(valueOffset)
		valueOffset += size
	}
	for (
		let instanceIndex = 0;
		instanceIndex < font.instances.length;
		instanceIndex += 1
	) {
		const instance = font.instances[instanceIndex]
		if (instance === undefined) continue
		const flags = instance.elidable ? 0x0002 : 0
		if (font.axes.length === 1) {
			writer.u16(1)
			writer.u16(0)
			writer.u16(flags)
			writer.u16(names.instanceNameIds[instanceIndex] ?? 0)
			writer.fixed(Number(instance.coordinates[0] ?? 0))
			continue
		}
		writer.u16(4)
		writer.u16(font.axes.length)
		writer.u16(flags)
		writer.u16(names.instanceNameIds[instanceIndex] ?? 0)
		for (let axisIndex = 0; axisIndex < font.axes.length; axisIndex += 1) {
			writer.u16(axisIndex)
			writer.fixed(Number(instance.coordinates[axisIndex] ?? 0))
		}
	}
	return writer.toUint8Array()
}

function serializeAvar(axes: readonly VariationAxis[]): Uint8Array {
	const writer = new BinaryWriter()
	writer.u16(1)
	writer.u16(0)
	writer.u16(0)
	writer.u16(axes.length)
	for (const axis of axes) {
		const map = axis.map ?? [
			{ from: -1, to: -1 },
			{ from: 0, to: 0 },
			{ from: 1, to: 1 },
		]
		writer.u16(map.length)
		for (const entry of map) {
			writer.f2dot14(Number(entry.from))
			writer.f2dot14(Number(entry.to))
		}
	}
	return writer.toUint8Array()
}

interface Format4Segment {
	readonly start: number
	readonly end: number
	readonly delta: number
	readonly glyphs: readonly number[] | null
}

interface Format4State {
	readonly bytes: number
	readonly glyphWords: number
	readonly segments: readonly Format4Segment[]
}

interface GlyphRangeCandidate {
	readonly prefix: Format4State
	readonly start: number
	readonly term: number
}

function betterFormat4State(
	left: Format4State,
	right: Format4State,
): Format4State {
	if (left.bytes !== right.bytes) return left.bytes < right.bytes ? left : right
	if (left.segments.length !== right.segments.length) {
		return left.segments.length < right.segments.length ? left : right
	}
	return left.glyphWords <= right.glyphWords ? left : right
}

function betterGlyphRange(
	left: GlyphRangeCandidate,
	right: GlyphRangeCandidate,
): GlyphRangeCandidate {
	if (left.term !== right.term) return left.term < right.term ? left : right
	if (left.prefix.segments.length !== right.prefix.segments.length) {
		return left.prefix.segments.length < right.prefix.segments.length
			? left
			: right
	}
	return left.prefix.glyphWords <= right.prefix.glyphWords ? left : right
}

function createFormat4Segments(
	entries: readonly CharacterMapEntry[],
): readonly Format4Segment[] {
	const atoms: { start: number; end: number; delta: number }[] = []
	for (const entry of entries) {
		const codePoint = Number(entry.codePoint)
		if (codePoint >= 0xffff) continue
		const delta = (Number(entry.glyph) - codePoint) & 0xffff
		const previous = atoms.at(-1)
		if (
			previous !== undefined &&
			codePoint === previous.end + 1 &&
			delta === previous.delta
		) {
			previous.end = codePoint
		} else {
			atoms.push({ start: codePoint, end: codePoint, delta })
		}
	}
	const glyphByCodePoint = new Map(
		entries.map((entry) => [Number(entry.codePoint), Number(entry.glyph)]),
	)
	let state: Format4State = { bytes: 0, glyphWords: 0, segments: [] }
	let bestGlyphRange: GlyphRangeCandidate | undefined
	for (const atom of atoms) {
		const candidate: GlyphRangeCandidate = {
			prefix: state,
			start: atom.start,
			term: state.bytes - 2 * atom.start,
		}
		bestGlyphRange =
			bestGlyphRange === undefined
				? candidate
				: betterGlyphRange(bestGlyphRange, candidate)
		const glyphRange = bestGlyphRange
		const deltaState: Format4State = {
			bytes: state.bytes + 8,
			glyphWords: state.glyphWords,
			segments: [
				...state.segments,
				{ start: atom.start, end: atom.end, delta: atom.delta, glyphs: null },
			],
		}
		const glyphs = Array.from(
			{ length: atom.end - glyphRange.start + 1 },
			(_value, index) => glyphByCodePoint.get(glyphRange.start + index) ?? 0,
		)
		const glyphRangeState: Format4State = {
			bytes: glyphRange.prefix.bytes + 8 + glyphs.length * 2,
			glyphWords: glyphRange.prefix.glyphWords + glyphs.length,
			segments: [
				...glyphRange.prefix.segments,
				{
					start: glyphRange.start,
					end: atom.end,
					delta: 0,
					glyphs,
				},
			],
		}
		state = betterFormat4State(deltaState, glyphRangeState)
	}
	return [
		...state.segments,
		{ start: 0xffff, end: 0xffff, delta: 1, glyphs: null },
	]
}

function serializeCmapFormat4(
	entries: readonly CharacterMapEntry[],
): Uint8Array {
	const segments = createFormat4Segments(entries)
	const glyphWords = segments.flatMap((segment) => segment.glyphs ?? [])
	const segmentCount = segments.length
	const subtableLength = 16 + segmentCount * 8 + glyphWords.length * 2
	const writer = new BinaryWriter()
	writer.u16(0)
	writer.u16(1)
	writer.u16(3)
	writer.u16(1)
	writer.u32(12)
	writer.u16(4)
	writer.u16(subtableLength)
	writer.u16(0)
	writer.u16(segmentCount * 2)
	const power = 2 ** Math.floor(Math.log2(segmentCount))
	writer.u16(power * 2)
	writer.u16(Math.log2(power))
	writer.u16(segmentCount * 2 - power * 2)
	for (const segment of segments) writer.u16(segment.end)
	writer.u16(0)
	for (const segment of segments) writer.u16(segment.start)
	for (const segment of segments) writer.u16(segment.delta)
	let glyphOffset = 0
	for (let index = 0; index < segments.length; index += 1) {
		const glyphs = segments[index]?.glyphs
		if (glyphs === null || glyphs === undefined) {
			writer.u16(0)
			continue
		}
		writer.u16(2 * (segmentCount - index + glyphOffset))
		glyphOffset += glyphs.length
	}
	for (const glyph of glyphWords) writer.u16(glyph)
	return writer.toUint8Array()
}

function serializeCmapFormat12(
	entries: readonly CharacterMapEntry[],
): Uint8Array {
	const groups: { start: number; end: number; glyph: number }[] = []
	for (const entry of entries) {
		const previous = groups.at(-1)
		if (
			previous !== undefined &&
			Number(entry.codePoint) === previous.end + 1 &&
			Number(entry.glyph) ===
				previous.glyph + (previous.end - previous.start) + 1
		) {
			previous.end = Number(entry.codePoint)
		} else {
			groups.push({
				start: Number(entry.codePoint),
				end: Number(entry.codePoint),
				glyph: Number(entry.glyph),
			})
		}
	}
	const writer = new BinaryWriter()
	writer.u16(0)
	writer.u16(1)
	writer.u16(3)
	writer.u16(10)
	writer.u32(12)
	writer.u16(12)
	writer.u16(0)
	writer.u32(16 + groups.length * 12)
	writer.u32(0)
	writer.u32(groups.length)
	for (const group of groups) {
		writer.u32(group.start)
		writer.u32(group.end)
		writer.u32(group.glyph)
	}
	return writer.toUint8Array()
}

function serializeCmap(font: VariableFont, plan: LoweringPlan): Uint8Array {
	return plan.encoding.cmap.format === 4
		? serializeCmapFormat4(font.cmap)
		: serializeCmapFormat12(font.cmap)
}

function serializeGlyf(
	font: VariableFont,
	plan: LoweringPlan,
): { readonly glyf: Uint8Array; readonly loca: Uint8Array } {
	const glyf = new BinaryWriter()
	const offsets: number[] = []
	for (let glyphIndex = 0; glyphIndex < font.glyphs.length; glyphIndex += 1) {
		const glyph = font.glyphs[glyphIndex]
		const glyphPlan = plan.glyphs[glyphIndex]
		if (glyph === undefined || glyphPlan === undefined) continue
		offsets.push(glyf.length)
		const points = glyph.contours.flat()
		if (points.length === 0) continue
		glyf.i16(glyph.contours.length)
		glyf.i16(glyphPlan.bounds.xMin)
		glyf.i16(glyphPlan.bounds.yMin)
		glyf.i16(glyphPlan.bounds.xMax)
		glyf.i16(glyphPlan.bounds.yMax)
		let endpoint = -1
		for (const contour of glyph.contours) {
			endpoint += contour.length
			glyf.u16(endpoint)
		}
		glyf.u16(0)
		for (let index = 0; index < points.length; index += 1) {
			const point = points[index]
			glyf.u8(
				(point?.onCurve ? 0x01 : 0) | (index === 0 && glyph.overlap ? 0x40 : 0),
			)
		}
		let previousX = 0
		for (const point of points) {
			glyf.i16(Number(point.x) - previousX)
			previousX = Number(point.x)
		}
		let previousY = 0
		for (const point of points) {
			glyf.i16(Number(point.y) - previousY)
			previousY = Number(point.y)
		}
		glyf.padTo(2)
	}
	offsets.push(glyf.length)
	const loca = new BinaryWriter()
	for (const offset of offsets) loca.u32(offset)
	return { glyf: glyf.toUint8Array(), loca: loca.toUint8Array() }
}

function serializeHead(font: VariableFont, bounds: Bounds): Uint8Array {
	const writer = new BinaryWriter()
	writer.fixed(1)
	writer.fixed(Number(font.metadata.fontRevision))
	writer.u32(0)
	writer.u32(HEAD_MAGIC)
	writer.u16(0x0003)
	writer.u16(Number(font.metadata.unitsPerEm))
	writer.u64(BigInt(font.metadata.createdAt))
	writer.u64(BigInt(font.metadata.modifiedAt))
	writer.i16(bounds.xMin)
	writer.i16(bounds.yMin)
	writer.i16(bounds.xMax)
	writer.i16(bounds.yMax)
	writer.u16((font.style.bold ? 1 : 0) | (font.style.italic ? 2 : 0))
	writer.u16(Number(font.metadata.lowestPpem))
	writer.i16(2)
	writer.i16(1)
	writer.i16(0)
	return writer.toUint8Array()
}

function serializeHhea(font: VariableFont, plan: LoweringPlan): Uint8Array {
	const writer = new BinaryWriter()
	writer.fixed(1)
	writer.i16(Number(font.metrics.ascender))
	writer.i16(Number(font.metrics.descender))
	writer.i16(Number(font.metrics.lineGap))
	writer.u16(plan.hhea.advanceWidthMax)
	writer.i16(plan.hhea.minLeftSideBearing)
	writer.i16(plan.hhea.minRightSideBearing)
	writer.i16(plan.hhea.xMaxExtent)
	writer.i16(1)
	writer.i16(0)
	writer.i16(0)
	for (let index = 0; index < 4; index += 1) writer.i16(0)
	writer.i16(0)
	writer.u16(plan.hhea.numberOfHMetrics)
	return writer.toUint8Array()
}

function serializeHmtx(font: VariableFont, plan: LoweringPlan): Uint8Array {
	const writer = new BinaryWriter()
	for (let index = 0; index < plan.hhea.numberOfHMetrics; index += 1) {
		const glyph = font.glyphs[index]
		if (glyph === undefined) continue
		writer.u16(Number(glyph.advanceWidth))
		writer.i16(Number(glyph.leftSideBearing))
	}
	for (
		let index = plan.hhea.numberOfHMetrics;
		index < font.glyphs.length;
		index += 1
	) {
		writer.i16(Number(font.glyphs[index]?.leftSideBearing ?? 0))
	}
	return writer.toUint8Array()
}

function serializeMaxp(plan: LoweringPlan): Uint8Array {
	const writer = new BinaryWriter()
	writer.fixed(1)
	writer.u16(plan.maxp.numGlyphs)
	writer.u16(plan.maxp.maxPoints)
	writer.u16(plan.maxp.maxContours)
	writer.u16(plan.maxp.maxCompositePoints)
	writer.u16(plan.maxp.maxCompositeContours)
	writer.u16(plan.maxp.maxZones)
	writer.u16(plan.maxp.maxTwilightPoints)
	writer.u16(plan.maxp.maxStorage)
	writer.u16(plan.maxp.maxFunctionDefs)
	writer.u16(plan.maxp.maxInstructionDefs)
	writer.u16(plan.maxp.maxStackElements)
	writer.u16(plan.maxp.maxSizeOfInstructions)
	writer.u16(plan.maxp.maxComponentElements)
	writer.u16(plan.maxp.maxComponentDepth)
	return writer.toUint8Array()
}

function setUnicodeRangeBit(ranges: number[], bit: number): void {
	const word = Math.floor(bit / 32)
	ranges[word] = ((ranges[word] ?? 0) | (1 << (bit % 32))) >>> 0
}

function unicodeRanges(
	entries: readonly CharacterMapEntry[],
): readonly number[] {
	const ranges = [0, 0, 0, 0]
	for (const entry of entries) {
		const codePoint = Number(entry.codePoint)
		if (codePoint <= 0x007f) setUnicodeRangeBit(ranges, 0)
		else if (codePoint <= 0x00ff) setUnicodeRangeBit(ranges, 1)
		else if (codePoint <= 0x017f) setUnicodeRangeBit(ranges, 2)
		else if (codePoint <= 0x024f) setUnicodeRangeBit(ranges, 3)
		else if (codePoint >= 0x2000 && codePoint <= 0x206f) {
			setUnicodeRangeBit(ranges, 31)
		}
		if (codePoint > 0xffff) setUnicodeRangeBit(ranges, 57)
	}
	return ranges
}

function serializeOs2(font: VariableFont): Uint8Array {
	const writer = new BinaryWriter()
	const advances = font.glyphs
		.map((glyph) => Number(glyph.advanceWidth))
		.filter((advance) => advance !== 0)
	const averageAdvance =
		advances.length === 0
			? 0
			: Math.round(
					advances.reduce((sum, advance) => sum + advance, 0) / advances.length,
				)
	const codePoints = font.cmap.map((entry) => Number(entry.codePoint))
	const firstCodePoint = Math.min(...codePoints, 0xffff)
	const lastCodePoint = Math.min(Math.max(...codePoints), 0xffff)
	const ranges = unicodeRanges(font.cmap)
	const regular = !font.style.bold && !font.style.italic && !font.style.oblique
	const selection =
		(font.style.italic ? 0x0001 : 0) |
		(font.style.bold ? 0x0020 : 0) |
		(regular ? 0x0040 : 0) |
		0x0080 |
		(font.style.oblique ? 0x0200 : 0)
	writer.u16(4)
	writer.i16(averageAdvance)
	writer.u16(Number(font.style.weightClass))
	writer.u16(Number(font.style.widthClass))
	writer.u16(0)
	for (let index = 0; index < 10; index += 1) writer.i16(0)
	writer.i16(0)
	for (let index = 0; index < 10; index += 1) writer.u8(0)
	for (const range of ranges) writer.u32(range)
	writer.tag(String(font.metadata.vendorId))
	writer.u16(selection)
	writer.u16(firstCodePoint)
	writer.u16(lastCodePoint)
	writer.i16(Number(font.metrics.ascender))
	writer.i16(Number(font.metrics.descender))
	writer.i16(Number(font.metrics.lineGap))
	writer.u16(Number(font.metrics.winAscent))
	writer.u16(Number(font.metrics.winDescent))
	writer.u32(((ranges[0] ?? 0) & 1) !== 0 ? 1 : 0)
	writer.u32(0)
	writer.i16(Number(font.metrics.xHeight))
	writer.i16(Number(font.metrics.capHeight))
	writer.u16(0)
	writer.u16(codePoints.includes(0x20) ? 0x20 : 0)
	writer.u16(1)
	return writer.toUint8Array()
}

function serializePost(font: VariableFont): Uint8Array {
	const writer = new BinaryWriter()
	writer.fixed(3)
	writer.fixed(Number(font.style.italicAngle))
	writer.i16(Number(font.metrics.underlinePosition))
	writer.i16(Number(font.metrics.underlineThickness))
	writer.u32(0)
	writer.u32(0)
	writer.u32(0)
	writer.u32(0)
	writer.u32(0)
	return writer.toUint8Array()
}

function packedDeltas(values: readonly number[]): Uint8Array {
	const writer = new BinaryWriter()
	let index = 0
	while (index < values.length) {
		const value = values[index] ?? 0
		const byteSize = value === 0 ? 0 : value >= -128 && value <= 127 ? 1 : 2
		let runLength = 1
		while (runLength < 64 && index + runLength < values.length) {
			const next = values[index + runLength] ?? 0
			const nextByteSize = next === 0 ? 0 : next >= -128 && next <= 127 ? 1 : 2
			if (nextByteSize !== byteSize) break
			runLength += 1
		}
		writer.u8(
			(runLength - 1) | (byteSize === 0 ? 0x80 : byteSize === 2 ? 0x40 : 0),
		)
		if (byteSize === 1) {
			for (let offset = 0; offset < runLength; offset += 1) {
				writer.i8(values[index + offset] ?? 0)
			}
		} else if (byteSize === 2) {
			for (let offset = 0; offset < runLength; offset += 1) {
				writer.i16(values[index + offset] ?? 0)
			}
		}
		index += runLength
	}
	return writer.toUint8Array()
}

function variationData(variation: GlyphVariation): Uint8Array {
	const x = [
		...variation.deltas.points.map((delta) => Number(delta.x)),
		Number(variation.deltas.phantom.left),
		Number(variation.deltas.phantom.right),
		0,
		0,
	]
	const y = [
		...variation.deltas.points.map((delta) => Number(delta.y)),
		0,
		0,
		Number(variation.deltas.phantom.top),
		Number(variation.deltas.phantom.bottom),
	]
	const writer = new BinaryWriter()
	writer.u8(0)
	writer.bytes(packedDeltas(x))
	writer.bytes(packedDeltas(y))
	return writer.toUint8Array()
}

function serializeGlyphVariations(
	glyph: SimpleGlyph,
	axisCount: number,
): Uint8Array {
	if (glyph.variations.length === 0) return new Uint8Array()
	const data = glyph.variations.map(variationData)
	const headerSize =
		4 +
		glyph.variations.reduce(
			(size, variation) =>
				size +
				4 +
				axisCount * 2 +
				(variation.region.kind === "intermediate" ? axisCount * 4 : 0),
			0,
		)
	const writer = new BinaryWriter()
	writer.u16(glyph.variations.length)
	writer.u16(headerSize)
	for (let index = 0; index < glyph.variations.length; index += 1) {
		const variation = glyph.variations[index]
		if (variation === undefined) continue
		writer.u16(data[index]?.length ?? 0)
		writer.u16(
			0x8000 | 0x2000 | (variation.region.kind === "intermediate" ? 0x4000 : 0),
		)
		for (const coordinate of variation.region.peak) {
			writer.f2dot14(Number(coordinate))
		}
		if (variation.region.kind === "intermediate") {
			for (const coordinate of variation.region.start) {
				writer.f2dot14(Number(coordinate))
			}
			for (const coordinate of variation.region.end) {
				writer.f2dot14(Number(coordinate))
			}
		}
	}
	for (const tupleData of data) writer.bytes(tupleData)
	return writer.toUint8Array()
}

function serializeGvar(font: VariableFont): Uint8Array {
	const glyphData = font.glyphs.map((glyph) =>
		serializeGlyphVariations(glyph, font.axes.length),
	)
	const dataOffset = 20 + (font.glyphs.length + 1) * 4
	const writer = new BinaryWriter()
	writer.u16(1)
	writer.u16(0)
	writer.u16(font.axes.length)
	writer.u16(0)
	writer.u32(dataOffset)
	writer.u16(font.glyphs.length)
	writer.u16(1)
	writer.u32(dataOffset)
	let offset = 0
	for (const data of glyphData) {
		writer.u32(offset)
		offset += data.length
	}
	writer.u32(offset)
	for (const data of glyphData) writer.bytes(data)
	return writer.toUint8Array()
}

function tableChecksum(bytes: Uint8Array): number {
	let checksum = 0
	for (let offset = 0; offset < bytes.length; offset += 4) {
		const word =
			((bytes[offset] ?? 0) << 24) |
			((bytes[offset + 1] ?? 0) << 16) |
			((bytes[offset + 2] ?? 0) << 8) |
			(bytes[offset + 3] ?? 0)
		checksum = (checksum + (word >>> 0)) >>> 0
	}
	return checksum
}

function setU16(view: DataView, offset: number, value: number): void {
	view.setUint16(offset, value, false)
}

function setU32(view: DataView, offset: number, value: number): void {
	view.setUint32(offset, value >>> 0, false)
}

function setTag(bytes: Uint8Array, offset: number, tag: string): void {
	for (let index = 0; index < 4; index += 1) {
		bytes[offset + index] = tag.charCodeAt(index)
	}
}

/** Serializes one validated target-v1 font to deterministic TrueType SFNT bytes. */
export function serializeVariableFont(font: VariableFont): Uint8Array {
	const plan = createLoweringPlan(font)
	const names = createNamePlan(font)
	const glyf = serializeGlyf(font, plan)
	const expectedLengths = new Map(
		plan.encoding.tableLengths.map(({ tag, length }) => [tag, length]),
	)
	const tables = new Map<string, Uint8Array>([
		["OS/2", serializeOs2(font)],
		["STAT", serializeStat(font, names)],
		["cmap", serializeCmap(font, plan)],
		["fvar", serializeFvar(font, names)],
		["glyf", glyf.glyf],
		["gvar", serializeGvar(font)],
		["head", serializeHead(font, plan.head)],
		["hhea", serializeHhea(font, plan)],
		["hmtx", serializeHmtx(font, plan)],
		["loca", glyf.loca],
		["maxp", serializeMaxp(plan)],
		["name", serializeName(font, names)],
		["post", serializePost(font)],
	])
	if (font.axes.some((axis) => axis.map !== null)) {
		tables.set("avar", serializeAvar(font.axes))
	}
	if (font.kerning.length > 0) tables.set("GPOS", serializeGpos(font))
	for (const tag of plan.tableTags) {
		const table = tables.get(tag)
		const expected = expectedLengths.get(tag)
		if (table === undefined || expected === undefined) {
			throw new Error(`Missing planned ${tag} table.`)
		}
		assertLength(tag, table, expected)
	}
	const bytes = new Uint8Array(plan.encoding.sfntSize)
	const view = new DataView(bytes.buffer)
	const numTables = plan.tableTags.length
	const power = 2 ** Math.floor(Math.log2(numTables))
	setU32(view, 0, plan.sfntVersion)
	setU16(view, 4, numTables)
	setU16(view, 6, power * 16)
	setU16(view, 8, Math.log2(power))
	setU16(view, 10, numTables * 16 - power * 16)
	let tableOffset = 12 + numTables * 16
	let headOffset = -1
	for (let index = 0; index < plan.tableTags.length; index += 1) {
		const tag = plan.tableTags[index]
		if (tag === undefined) continue
		const table = tables.get(tag)
		if (table === undefined) throw new Error(`Missing ${tag} table.`)
		const recordOffset = 12 + index * 16
		setTag(bytes, recordOffset, tag)
		setU32(view, recordOffset + 4, tableChecksum(table))
		setU32(view, recordOffset + 8, tableOffset)
		setU32(view, recordOffset + 12, table.length)
		bytes.set(table, tableOffset)
		if (tag === "head") headOffset = tableOffset
		tableOffset += Math.ceil(table.length / 4) * 4
	}
	if (tableOffset !== bytes.length || headOffset < 0) {
		throw new Error(`Serialized SFNT size does not match its lowering plan.`)
	}
	setU32(
		view,
		headOffset + 8,
		(SFNT_CHECKSUM_MAGIC - tableChecksum(bytes)) >>> 0,
	)
	if (tableChecksum(bytes) !== SFNT_CHECKSUM_MAGIC) {
		throw new Error(`SFNT checksum adjustment failed.`)
	}
	return bytes
}
