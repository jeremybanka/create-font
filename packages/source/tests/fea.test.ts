import { describe, expect, test } from "vitest"
import { lowerFeaSubstitutions, parseFea } from "../src/fea.ts"

describe("Adobe feature source", () => {
	test("parses source-located liga and calt substitutions and lowers names", () => {
		const parsed = parseFea(
			`# comment\nfeature liga { sub f i by f_i; } liga;\nfeature calt { sub a by a.alt; } calt;`,
		)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.features.map(({ tag }) => tag)).toEqual([
			"liga",
			"calt",
		])
		expect(parsed.value.features[0]?.statements[0]?.range.line).toBe(2)
		const lowered = lowerFeaSubstitutions(
			parsed.value,
			new Map([
				["f", 1],
				["i", 2],
				["f_i", 3],
				["a", 4],
				["a.alt", 5],
			]),
		)
		expect(lowered.errors).toEqual([])
		expect(
			lowered.ir.map(({ feature, from, to }) => ({ feature, from, to })),
		).toEqual([
			{ feature: "liga", from: [1, 2], to: 3 },
			{ feature: "calt", from: [4], to: 5 },
		])
	})

	test("reports unresolved glyph names at the statement", () => {
		const parsed = parseFea("feature liga { sub f i by f_i; } liga;")
		if (!parsed.ok) throw new Error("fixture failed to parse")
		const lowered = lowerFeaSubstitutions(parsed.value, new Map([["f", 1]]))
		expect(lowered.errors[0]?.message).toContain("i, f_i")
	})
})
