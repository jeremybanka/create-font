import { createCmapEncodingPlan, type CmapEncodingPlan } from "./cmap.ts"
export type { CmapEncodingPlan } from "./cmap.ts"
import type {
	CharacterMapEntry,
	FontNames,
	GlyphVariation,
	NamedInstance,
	SimpleGlyph,
	VariationAxis,
	KerningPair,
} from "./model.ts"
import { getGposLength } from "./gpos.ts"

/** Required v1 tables in bytewise SFNT-directory order. */
export const REQUIRED_TABLE_TAGS = Object.freeze([
	"OS/2",
	"STAT",
	"cmap",
	"fvar",
	"glyf",
	"gvar",
	"head",
	"hhea",
	"hmtx",
	"loca",
	"maxp",
	"name",
	"post",
] as const)

export type RequiredTableTag = (typeof REQUIRED_TABLE_TAGS)[number]
export type TableTag = RequiredTableTag | "avar" | "GPOS"

export interface CanonicalEncodingInput {
	readonly axes: readonly VariationAxis[]
	readonly instances: readonly NamedInstance[]
	readonly glyphs: readonly SimpleGlyph[]
	readonly cmap: readonly CharacterMapEntry[]
	readonly names: FontNames
	readonly kerning?: readonly KerningPair[]
}

export interface TableLengthPlan {
	readonly tag: TableTag
	readonly length: number
}

export interface CanonicalEncodingPlan {
	readonly tableLengths: readonly TableLengthPlan[]
	/** Padded single-font SFNT size, including its table directory. */
	readonly sfntSize: number
	readonly cmap: CmapEncodingPlan
	readonly indexToLocFormat: 1
	readonly os2Version: 4
	readonly postFormat: 3
	readonly statAxisValueFormat: 1 | 4
	readonly numberOfHMetrics: number
	readonly nameRecordCount: number
	readonly nameStorageBytes: number
	readonly fvarHasPostScriptNameIds: boolean
	readonly glyfCoordinates: "uncompressed"
	readonly gvarOffsets: "long"
	readonly gvarPointNumbers: "all"
	readonly gvarSharedTupleCount: 0
}

function align4(value: number): number {
	return Math.ceil(value / 4) * 4
}

export function packedDeltaSize(values: readonly number[]): number {
	let size = 0
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
		size += 1 + byteSize * runLength
		index += runLength
	}
	return size
}

export function getPackedVariationDataSize(variation: GlyphVariation): number {
	const xDeltas = [
		...variation.deltas.points.map((delta) => delta.x as number),
		variation.deltas.phantom.left,
		variation.deltas.phantom.right,
		0,
		0,
	]
	const yDeltas = [
		...variation.deltas.points.map((delta) => delta.y as number),
		0,
		0,
		variation.deltas.phantom.top,
		variation.deltas.phantom.bottom,
	]
	return 1 + packedDeltaSize(xDeltas) + packedDeltaSize(yDeltas)
}

export function getNumberOfHMetrics(glyphs: readonly SimpleGlyph[]): number {
	let count = glyphs.length
	while (count > 1) {
		const current = glyphs[count - 1]
		const previous = glyphs[count - 2]
		if (
			current === undefined ||
			previous === undefined ||
			current.advanceWidth !== previous.advanceWidth
		) {
			break
		}
		count -= 1
	}
	return count
}

function getGlyfLength(glyphs: readonly SimpleGlyph[]): number {
	let length = 0
	for (const glyph of glyphs) {
		const pointCount = glyph.contours.reduce(
			(count, contour) => count + contour.length,
			0,
		)
		if (pointCount === 0) continue
		const uncompressedLength = 12 + glyph.contours.length * 2 + pointCount * 5
		length += uncompressedLength + (uncompressedLength & 1)
	}
	return length
}

function getGvarLength(
	glyphs: readonly SimpleGlyph[],
	axisCount: number,
): number {
	let glyphVariationDataLength = 0
	for (const glyph of glyphs) {
		if (glyph.variations.length === 0) continue
		const intermediateCount = glyph.variations.filter(
			(variation) => variation.region.kind === "intermediate",
		).length
		glyphVariationDataLength +=
			4 +
			glyph.variations.length * 4 +
			glyph.variations.length * axisCount * 2 +
			intermediateCount * axisCount * 4 +
			glyph.variations.reduce(
				(length, variation) => length + getPackedVariationDataSize(variation),
				0,
			)
	}
	return 20 + (glyphs.length + 1) * 4 + glyphVariationDataLength
}

function getNameFacts(
	names: FontNames,
	axes: readonly VariationAxis[],
	instances: readonly NamedInstance[],
): { readonly recordCount: number; readonly storageBytes: number } {
	const strings = [
		names.family,
		names.subfamily,
		names.uniqueId,
		names.fullName,
		names.version,
		names.postScriptName,
		names.typographicFamily,
		names.typographicSubfamily,
		...axes.map((axis) => axis.name),
		...instances.map((instance) => instance.name),
		...instances.flatMap((instance) =>
			instance.postScriptName === null ? [] : [instance.postScriptName],
		),
	]
	const uniqueStrings = new Set(strings)
	let storageBytes = 0
	for (const string of uniqueStrings) storageBytes += string.length * 2
	return { recordCount: strings.length, storageBytes }
}

function compareTags(left: TableTag, right: TableTag): number {
	return left < right ? -1 : left > right ? 1 : 0
}

export function getCanonicalTableTags(
	axes: readonly VariationAxis[],
	kerning: readonly KerningPair[] = [],
): readonly TableTag[] {
	if (!axes.some((axis) => axis.map !== null) && kerning.length === 0)
		return REQUIRED_TABLE_TAGS
	return Object.freeze(
		(
			[
				...REQUIRED_TABLE_TAGS,
				...(axes.some((axis) => axis.map !== null) ? (["avar"] as const) : []),
				...(kerning.length > 0 ? (["GPOS"] as const) : []),
			] satisfies TableTag[]
		).sort(compareTags),
	)
}

/** Computes every byte-length and encoding choice fixed by the v1 profile. */
export function createCanonicalEncodingPlan(
	font: CanonicalEncodingInput,
): CanonicalEncodingPlan {
	const axisCount = font.axes.length
	const glyphCount = font.glyphs.length
	const instanceCount = font.instances.length
	const hasAvar = font.axes.some((axis) => axis.map !== null)
	const kerning = font.kerning ?? []
	const fvarHasPostScriptNameIds = font.instances.some(
		(instance) => instance.postScriptName !== null,
	)
	const numberOfHMetrics = getNumberOfHMetrics(font.glyphs)
	const name = getNameFacts(font.names, font.axes, font.instances)
	const cmap = createCmapEncodingPlan(font.cmap)
	const statAxisValueFormat = axisCount === 1 ? 1 : 4
	const statAxisValueLength = statAxisValueFormat === 1 ? 12 : 8 + 6 * axisCount

	const lengths = new Map<TableTag, number>([
		["OS/2", 96],
		[
			"STAT",
			20 +
				8 * axisCount +
				2 * instanceCount +
				instanceCount * statAxisValueLength,
		],
		["cmap", cmap.tableLength],
		[
			"fvar",
			16 +
				20 * axisCount +
				instanceCount *
					(4 + 4 * axisCount + (fvarHasPostScriptNameIds ? 2 : 0)),
		],
		["glyf", getGlyfLength(font.glyphs)],
		["gvar", getGvarLength(font.glyphs, axisCount)],
		["head", 54],
		["hhea", 36],
		["hmtx", 4 * numberOfHMetrics + 2 * (glyphCount - numberOfHMetrics)],
		["loca", 4 * (glyphCount + 1)],
		["maxp", 32],
		["name", 6 + 12 * name.recordCount + name.storageBytes],
		["post", 32],
	])
	if (hasAvar) {
		lengths.set(
			"avar",
			8 +
				font.axes.reduce(
					(length, axis) => length + 2 + 4 * (axis.map?.length ?? 3),
					0,
				),
		)
	}
	if (kerning.length > 0) lengths.set("GPOS", getGposLength(kerning))
	const tableLengths = [...lengths]
		.map(([tag, length]): TableLengthPlan => ({ tag, length }))
		.sort((left, right) => compareTags(left.tag, right.tag))
	const sfntSize =
		12 +
		16 * tableLengths.length +
		tableLengths.reduce((size, table) => size + align4(table.length), 0)

	return {
		tableLengths,
		sfntSize,
		cmap,
		indexToLocFormat: 1,
		os2Version: 4,
		postFormat: 3,
		statAxisValueFormat,
		numberOfHMetrics,
		nameRecordCount: name.recordCount,
		nameStorageBytes: name.storageBytes,
		fvarHasPostScriptNameIds,
		glyfCoordinates: "uncompressed",
		gvarOffsets: "long",
		gvarPointNumbers: "all",
		gvarSharedTupleCount: 0,
	}
}
