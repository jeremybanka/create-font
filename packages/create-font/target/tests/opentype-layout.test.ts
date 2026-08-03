import { describe, expect, test } from "vitest"
import {
	applySubstitutions,
	serializeGsub,
	withVariableFontSubstitutions,
} from "../src/opentype-layout.ts"
import { serializeVariableFont } from "../src/serialization.ts"
import { ingestVariableFont } from "../src/validation.ts"
import { makeGeometricOFont } from "./fixtures/geometric-o.ts"

describe("OpenType substitutions", () => {
	test("serializes liga and calt lookups into a GSUB table", () => {
		const bytes = serializeGsub([
			{ feature: "liga", from: [1, 2], to: 3 },
			{ feature: "calt", from: [4], to: 5 },
		])
		expect(new DataView(bytes.buffer).getUint32(0, false)).toBe(0x0001_0000)
		expect(new TextDecoder().decode(bytes)).toContain("DFLT")
		expect(new TextDecoder().decode(bytes)).toContain("liga")
		expect(new TextDecoder().decode(bytes)).toContain("calt")
	})

	test("shapes an f_i ligature only while liga is enabled", () => {
		const input = [
			{ glyph: 1, textStart: 0, textEnd: 1 },
			{ glyph: 2, textStart: 1, textEnd: 2 },
		]
		const rules = [{ feature: "liga", from: [1, 2], to: 3 }]
		expect(applySubstitutions(input, rules, new Set())).toHaveLength(2)
		expect(applySubstitutions(input, rules, new Set(["liga"]))).toEqual([
			{ glyph: 3, textStart: 0, textEnd: 2 },
		])
	})

	test("applies a contextual calt rule only with its lookahead", () => {
		const rules = [
			{
				feature: "calt",
				from: [4, 1],
				to: 5,
				contextIndex: 0,
			},
		]
		const glyph = (value: number, index: number) => ({
			glyph: value,
			textStart: index,
			textEnd: index + 1,
		})
		expect(
			applySubstitutions([glyph(4, 0), glyph(2, 1)], rules, new Set(["calt"])),
		).toEqual([glyph(4, 0), glyph(2, 1)])
		expect(
			applySubstitutions([glyph(4, 0), glyph(1, 1)], rules, new Set(["calt"])),
		).toEqual([glyph(5, 0), glyph(1, 1)])
		expect(() => serializeGsub(rules)).not.toThrow()
	})

	test("default font serialization consumes compilation-owned substitutions", () => {
		const ingested = ingestVariableFont(makeGeometricOFont())
		if (!ingested.ok) throw new Error("fixture failed ingestion")
		const font = withVariableFontSubstitutions(ingested.value, [
			{ feature: "liga", from: [1, 2], to: 3 },
		])
		const bytes = serializeVariableFont(font)
		const count = new DataView(bytes.buffer).getUint16(4, false)
		const tags = Array.from({ length: count }, (_, index) =>
			new TextDecoder().decode(bytes.slice(12 + index * 16, 16 + index * 16)),
		)
		expect(tags).toContain("GSUB")
	})
})
