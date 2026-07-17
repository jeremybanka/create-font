import { describe, expect, it } from "vitest"

import {
	createLoweringPlan,
	ingestVariableFont,
	serializeVariableFont,
	type VariableFontSource,
} from "../src/index.ts"
import { makeGeometricOFont } from "./fixtures/geometric-o.ts"

interface TableRecord {
	readonly checksum: number
	readonly length: number
	readonly offset: number
}

function checksum(bytes: Uint8Array): number {
	let sum = 0
	for (let offset = 0; offset < bytes.length; offset += 4) {
		const word =
			((bytes[offset] ?? 0) << 24) |
			((bytes[offset + 1] ?? 0) << 16) |
			((bytes[offset + 2] ?? 0) << 8) |
			(bytes[offset + 3] ?? 0)
		sum = (sum + (word >>> 0)) >>> 0
	}
	return sum
}

function tableDirectory(bytes: Uint8Array): ReadonlyMap<string, TableRecord> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const count = view.getUint16(4)
	const records = new Map<string, TableRecord>()
	for (let index = 0; index < count; index += 1) {
		const recordOffset = 12 + index * 16
		const tag = String.fromCharCode(
			...bytes.slice(recordOffset, recordOffset + 4),
		)
		records.set(tag, {
			checksum: view.getUint32(recordOffset + 4),
			offset: view.getUint32(recordOffset + 8),
			length: view.getUint32(recordOffset + 12),
		})
	}
	return records
}

function tableBytes(bytes: Uint8Array, record: TableRecord): Uint8Array {
	return bytes.slice(record.offset, record.offset + record.length)
}

function readNameStrings(
	bytes: Uint8Array,
	record: TableRecord,
): ReadonlyMap<number, string> {
	const table = tableBytes(bytes, record)
	const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
	const count = view.getUint16(2)
	const storage = view.getUint16(4)
	const names = new Map<number, string>()
	for (let index = 0; index < count; index += 1) {
		const offset = 6 + index * 12
		const nameId = view.getUint16(offset + 6)
		const length = view.getUint16(offset + 8)
		const stringOffset = storage + view.getUint16(offset + 10)
		let value = ``
		for (let byte = 0; byte < length; byte += 2) {
			value += String.fromCharCode(view.getUint16(stringOffset + byte))
		}
		names.set(nameId, value)
	}
	return names
}

function cmapGlyph(
	bytes: Uint8Array,
	record: TableRecord,
	codePoint: number,
): number | null {
	const table = tableBytes(bytes, record)
	const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
	const subtable = view.getUint32(8)
	const format = view.getUint16(subtable)
	if (format === 12) {
		const groupCount = view.getUint32(subtable + 12)
		for (let index = 0; index < groupCount; index += 1) {
			const offset = subtable + 16 + index * 12
			const start = view.getUint32(offset)
			const end = view.getUint32(offset + 4)
			if (codePoint >= start && codePoint <= end) {
				return view.getUint32(offset + 8) + codePoint - start
			}
		}
		return null
	}
	if (format !== 4 || codePoint > 0xffff) return null
	const segmentCount = view.getUint16(subtable + 6) / 2
	const endCodes = subtable + 14
	const startCodes = endCodes + segmentCount * 2 + 2
	const deltas = startCodes + segmentCount * 2
	const rangeOffsets = deltas + segmentCount * 2
	for (let index = 0; index < segmentCount; index += 1) {
		const start = view.getUint16(startCodes + index * 2)
		const end = view.getUint16(endCodes + index * 2)
		if (codePoint < start || codePoint > end) continue
		const delta = view.getUint16(deltas + index * 2)
		const rangeOffset = view.getUint16(rangeOffsets + index * 2)
		if (rangeOffset === 0) return (codePoint + delta) & 0xffff
		const glyphOffset =
			rangeOffsets + index * 2 + rangeOffset + (codePoint - start) * 2
		const glyph = view.getUint16(glyphOffset)
		return glyph === 0 ? 0 : (glyph + delta) & 0xffff
	}
	return null
}

function compile(source: VariableFontSource) {
	const result = ingestVariableFont(source)
	if (!result.ok) throw new Error(JSON.stringify(result.errors))
	return result.value
}

describe(`target-v1 SFNT serialization`, () => {
	it(`emits deterministic aligned tables with valid checksums`, () => {
		const font = compile(makeGeometricOFont())
		const first = serializeVariableFont(font)
		const second = serializeVariableFont(font)
		const plan = createLoweringPlan(font)
		const records = tableDirectory(first)

		expect(first).toEqual(second)
		expect(first.length).toBe(plan.encoding.sfntSize)
		expect(checksum(first)).toBe(0xb1b0_afba)
		expect([...records.keys()]).toEqual(plan.tableTags)
		for (const { tag, length } of plan.encoding.tableLengths) {
			const record = records.get(tag)
			expect(record?.length).toBe(length)
			expect(record?.offset % 4).toBe(0)
			if (record === undefined) continue
			const table = tableBytes(first, record)
			if (tag === `head`) table.fill(0, 8, 12)
			expect(checksum(table)).toBe(record.checksum)
		}
	})

	it(`is independently readable across outline, variation, cmap, and naming tables`, () => {
		const bytes = serializeVariableFont(compile(makeGeometricOFont()))
		const records = tableDirectory(bytes)
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const names = readNameStrings(bytes, records.get(`name`)!)

		expect(view.getUint32(0)).toBe(0x0001_0000)
		expect(names.get(1)).toBe(`Create Font O Razor`)
		expect(names.get(16)).toBe(`Create Font O`)
		expect(cmapGlyph(bytes, records.get(`cmap`)!, 0x4f)).toBe(1)

		const maxp = records.get(`maxp`)!
		expect(view.getUint16(maxp.offset + 4)).toBe(2)
		const loca = records.get(`loca`)!
		const glyph0Offset = view.getUint32(loca.offset)
		const glyph1Offset = view.getUint32(loca.offset + 4)
		const glyph2Offset = view.getUint32(loca.offset + 8)
		expect(glyph0Offset).toBe(0)
		expect(glyph1Offset).toBeGreaterThan(glyph0Offset)
		expect(glyph2Offset).toBeGreaterThan(glyph1Offset)

		const fvar = records.get(`fvar`)!
		expect(view.getUint16(fvar.offset + 8)).toBe(1)
		expect(view.getUint16(fvar.offset + 12)).toBe(2)
		const gvar = records.get(`gvar`)!
		expect(view.getUint16(gvar.offset)).toBe(1)
		expect(view.getUint16(gvar.offset + 4)).toBe(1)
		expect(view.getUint16(gvar.offset + 12)).toBe(2)
	})

	it(`serializes optional avar, format-12 cmap, and mixed delta run widths`, () => {
		const source = makeGeometricOFont()
		const points = source.glyphs[0]?.variations[0]?.deltas.points ?? []
		const variedPoints = points.map((delta, index) =>
			index === 0 ? { x: 1, y: delta.y } : delta,
		)
		const extended: VariableFontSource = {
			...source,
			axes: source.axes.map((axis) => ({
				...axis,
				map: [
					{ from: -1, to: -1 },
					{ from: 0, to: 0 },
					{ from: 0.5, to: 0.75 },
					{ from: 1, to: 1 },
				],
			})),
			glyphs: source.glyphs.map((glyph, glyphIndex) =>
				glyphIndex !== 0
					? glyph
					: {
							...glyph,
							variations: glyph.variations.map((variation) => ({
								...variation,
								deltas: { ...variation.deltas, points: variedPoints },
							})),
						},
			),
			cmap: [...source.cmap, { codePoint: 0x1f600, glyph: 1 }],
		}
		const bytes = serializeVariableFont(compile(extended))
		const records = tableDirectory(bytes)

		expect(records.has(`avar`)).toBe(true)
		expect(cmapGlyph(bytes, records.get(`cmap`)!, 0x4f)).toBe(1)
		expect(cmapGlyph(bytes, records.get(`cmap`)!, 0x1f600)).toBe(1)
	})
})
