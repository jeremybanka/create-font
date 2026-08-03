import {
	ingestVariableFont,
	serializeVariableFont,
	withVariableFontSubstitutions,
	type VariableFontSource,
} from "@create-font/target"
import { describe, expect, test } from "vitest"

import {
	createFontService,
	projectTextForBrowser,
	projectTextForExport,
	type FontIdentityDescriptor,
} from "../src/index.ts"
import { makeGeometricOFont } from "../../font-target/tests/fixtures/geometric-o.ts"

const descriptor = (revision: string | number = 1): FontIdentityDescriptor => ({
	source: "test:generated",
	family: "Generated Service Fixture",
	revision,
})

function fixtureBytes(): Uint8Array {
	const source = makeGeometricOFont()
	const template = source.glyphs[1]
	if (template === undefined)
		throw new Error("Missing generated glyph template.")
	const glyph = (name: string, advanceWidth = 600) => ({
		...template,
		name,
		advanceWidth,
	})
	const expanded: VariableFontSource = {
		...source,
		names: {
			...source.names,
			family: "Generated Service Fixture",
			fullName: "Generated Service Fixture",
			uniqueId: "CRFT:Generated Service Fixture:1",
			postScriptName: "GeneratedServiceFixture",
		},
		glyphs: [
			source.glyphs[0] as (typeof source.glyphs)[number],
			glyph("O", 1_000),
			glyph("f", 400),
			glyph("i", 240),
			glyph("f_i", 560),
			glyph("A", 700),
			glyph("B", 680),
			glyph("acutecomb", 0),
		],
		cmap: [
			{ codePoint: 0x4f, glyph: 1 },
			{ codePoint: 0x66, glyph: 2 },
			{ codePoint: 0x69, glyph: 3 },
			{ codePoint: 0x41, glyph: 5 },
			{ codePoint: 0x42, glyph: 6 },
			{ codePoint: 0x0301, glyph: 7 },
			{ codePoint: 0x0627, glyph: 5 },
			{ codePoint: 0x0628, glyph: 6 },
		],
		kerning: [{ left: 5, right: 6, value: -80 }],
	}
	const ingested = ingestVariableFont(expanded)
	if (!ingested.ok) throw new Error(JSON.stringify(ingested.errors))
	const withLayout = withVariableFontSubstitutions(ingested.value, [
		{ feature: "liga", from: [2, 3], to: 4 },
	])
	return serializeVariableFont(withLayout)
}

function registered() {
	const service = createFontService()
	const result = service.registerFont(descriptor(), fixtureBytes())
	if (result.value === undefined)
		throw new Error(JSON.stringify(result.diagnostics))
	return { service, font: result.value.identity }
}

function replaceTableTag(
	bytes: Uint8Array,
	from: string,
	to: string,
): Uint8Array {
	const result = bytes.slice()
	const count = new DataView(result.buffer).getUint16(4, false)
	const decoder = new TextDecoder("latin1")
	const encoder = new TextEncoder()
	for (let index = 0; index < count; index += 1) {
		const offset = 12 + index * 16
		if (decoder.decode(result.subarray(offset, offset + 4)) !== from) continue
		result.set(encoder.encode(to), offset)
		return result
	}
	throw new Error(`Missing ${from} table.`)
}

describe("runtime-portable font service", () => {
	test("owns immutable bytes and reports stable content identities", () => {
		const service = createFontService()
		const bytes = fixtureBytes()
		const first = service.registerFont(descriptor(), bytes)
		if (first.value === undefined) throw new Error("Font did not register.")
		bytes.fill(0)
		expect(
			service.shape({ font: first.value.identity, text: "O" }).value?.glyphs,
		).toHaveLength(1)

		const duplicate = service.registerFont(descriptor(), fixtureBytes())
		expect(duplicate.value?.identity).toEqual(first.value.identity)
		expect(duplicate.value?.byteLength).toBeGreaterThan(100)
	})

	test("applies ligatures, feature ranges, and GPOS kerning", () => {
		const { service, font } = registered()
		const ligature = service.shape({ font, text: "fi" }).value
		const separate = service.shape({
			font,
			text: "fi",
			features: [{ tag: "liga", value: 0 }],
		}).value
		expect(ligature?.glyphs.map(({ glyphId }) => glyphId)).toEqual([4])
		expect(ligature?.glyphs[0]).toMatchObject({ cluster: 0, clusterEnd: 2 })
		expect(separate?.glyphs.map(({ glyphId }) => glyphId)).toEqual([2, 3])

		const kerned = service.shape({ font, text: "AB" }).value
		const unkerned = service.shape({
			font,
			text: "AB",
			features: [{ tag: "kern", value: 0 }],
		}).value
		expect(kerned?.lines[0]?.advanceX).toBe(1_300)
		expect(unkerned?.lines[0]?.advanceX).toBe(1_380)
	})

	test("keeps combining marks in their cluster with zero advance", () => {
		const { service, font } = registered()
		const shaped = service.shape({ font, text: "A\u0301" }).value
		expect(shaped?.diagnostics).toEqual([])
		expect(shaped?.glyphs).toHaveLength(2)
		expect(shaped?.glyphs.some(({ xAdvance }) => xAdvance === 0)).toBe(true)
		expect(new Set(shaped?.glyphs.map(({ cluster }) => cluster))).toEqual(
			new Set([0]),
		)
	})

	test("shapes right-to-left runs in visual glyph order", () => {
		const { service, font } = registered()
		const shaped = service.shape({
			font,
			text: "\u0627\u0628",
			direction: "auto",
			script: "Arab",
			language: "ar",
		}).value
		expect(shaped?.direction).toBe("rtl")
		expect(shaped?.glyphs.map(({ glyphId }) => glyphId)).toEqual([6, 5])
		expect(shaped?.glyphs.map(({ cluster }) => cluster)).toEqual([1, 0])
	})

	test("returns deterministic multiline metrics and positioned baselines", () => {
		const { service, font } = registered()
		const shaped = service.shape({ font, text: "A\r\nB\nO" }).value
		expect(shaped?.metrics).toMatchObject({
			unitsPerEm: 1_000,
			ascender: 800,
			descender: -200,
		})
		expect(
			shaped?.lines.map(({ textStart, textEnd, breakEnd }) => [
				textStart,
				textEnd,
				breakEnd,
			]),
		).toEqual([
			[0, 1, 3],
			[3, 4, 5],
			[5, 6, 6],
		])
		expect(shaped?.lines.map(({ baseline }) => baseline)).toEqual([
			0, -1_000, -2_000,
		])
	})

	test("applies variation coordinates to metrics and outlines", () => {
		const { service, font } = registered()
		const axes = service.metrics(font).value?.axes
		expect(axes).toContainEqual({
			tag: "wght",
			min: 100,
			default: 100,
			max: 900,
		})
		const razor = service.outline({
			font,
			glyphId: 1,
			variations: { wght: 100 },
		})
		const black = service.outline({
			font,
			glyphId: 1,
			variations: { wght: 900 },
		})
		expect(razor.value?.commands.length).toBeGreaterThan(4)
		expect(black.value?.commands).not.toEqual(razor.value?.commands)
		expect(
			service
				.metrics(font, { wght: 2_000, nope: 1 })
				.diagnostics.map(({ code }) => code),
		).toEqual(["variation.unsupported-axis", "variation.out-of-range"])
	})

	test("uses independent parse, shape, metrics, and outline caches", () => {
		const { service, font } = registered()
		service.shape({ font, text: "AB" })
		service.shape({ font, text: "AB" })
		service.metrics(font)
		service.metrics(font)
		service.outline({ font, glyphId: 5 })
		service.outline({ font, glyphId: 5 })
		expect(service.cacheStats()).toMatchObject({
			parsing: { entries: 1 },
			shaping: { entries: 1, hits: 1, misses: 1 },
			metrics: { entries: 1 },
			outlines: { entries: 1, hits: 1, misses: 1 },
		})
	})

	test("invalidates every derived cache when a stable source is replaced", () => {
		const { service, font } = registered()
		service.shape({ font, text: "O" })
		service.outline({ font, glyphId: 1 })
		const replacement = service.registerFont(descriptor(2), fixtureBytes())
		if (replacement.value === undefined) throw new Error("Replacement failed.")
		expect(service.shape({ font, text: "O" }).diagnostics[0]?.code).toBe(
			"font.missing",
		)
		expect(service.cacheStats()).toMatchObject({
			parsing: { entries: 1 },
			shaping: { entries: 0 },
			outlines: { entries: 0 },
		})
		expect(
			service.shape({ font: replacement.value.identity, text: "O" }).value,
		).toBeDefined()
	})

	test("keeps the last good revision when replacement bytes are malformed", () => {
		const { service, font } = registered()
		const failed = service.registerFont(descriptor(2), new Uint8Array(4))
		expect(failed.diagnostics[0]?.code).toBe("font.malformed")
		expect(service.shape({ font, text: "O" }).value?.glyphs).toHaveLength(1)
	})

	test("emits structured malformed, unsupported-table, missing-font, and missing-glyph diagnostics", () => {
		const malformed = createFontService().registerFont(
			descriptor(),
			new Uint8Array(4),
		)
		expect(malformed.diagnostics[0]).toMatchObject({ code: "font.malformed" })

		const service = createFontService()
		const unsupported = service.registerFont(
			descriptor(),
			replaceTableTag(fixtureBytes(), "glyf", "SVG "),
		)
		expect(unsupported.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "font.unsupported-table",
				table: "outline",
			}),
		)
		if (unsupported.value === undefined)
			throw new Error("Font did not register.")
		expect(
			service.outline({ font: unsupported.value.identity, glyphId: 1 })
				.diagnostics[0],
		).toMatchObject({ code: "font.unsupported-table" })
		expect(
			service
				.shape({ font: unsupported.value.identity, text: "?" })
				.diagnostics.find(({ code }) => code === "glyph.missing"),
		).toMatchObject({ code: "glyph.missing", textIndex: 0 })
		service.unregisterFont(unsupported.value.identity)
		expect(
			service.shape({ font: unsupported.value.identity, text: "A" })
				.diagnostics[0],
		).toMatchObject({ code: "font.missing" })
	})

	test("gives browser and noninteractive export the same cached contract", () => {
		const { service, font } = registered()
		const request = {
			font,
			text: "fi\nAB",
			variations: { wght: 500 },
		} as const
		const browser = projectTextForBrowser(service, request)
		const exported = projectTextForExport(service, request)
		expect(exported.value).toBe(browser.value)
		expect(JSON.stringify(exported)).toBe(JSON.stringify(browser))
	})
})
