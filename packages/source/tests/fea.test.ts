import { describe, expect, test } from "vitest"
import {
	lowerFeaSubstitutions,
	parseFea,
	parseFeaSyntax,
	type FeaSyntaxElement,
} from "../src/fea.ts"

describe("Adobe feature source", () => {
	test("parses source-located liga and calt substitutions and lowers names", () => {
		const parsed = parseFea(
			`# comment\nfeature liga { sub f i by f_i; } liga;\nfeature calt { sub a' f by a.alt; } calt;`,
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
			{ feature: "calt", from: [4, 1], to: 5 },
		])
		expect(lowered.ir[1]?.contextIndex).toBe(0)
	})

	test("reports unresolved glyph names at the statement", () => {
		const parsed = parseFea("feature liga { sub f i by f_i; } liga;")
		if (!parsed.ok) throw new Error("fixture failed to parse")
		const lowered = lowerFeaSubstitutions(parsed.value, new Map([["f", 1]]))
		expect(lowered.errors[0]?.message).toContain("i, f_i")
	})

	test("exposes the complete lossless Wasm tree for valid Adobe syntax", () => {
		const source = "include(layout.fea);\nfeature kern { pos A V -80; } kern;\n"
		const parsed = parseFeaSyntax(source)
		expect(parsed.diagnostics).toEqual([])
		expect(parsed.root.children).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "IncludeNode" }),
				expect.objectContaining({ kind: "FeatureNode" }),
			]),
		)
		const sourceText = (element: FeaSyntaxElement): string =>
			element.type === "token"
				? element.text
				: element.children.map(sourceText).join("")
		expect(sourceText(parsed.root)).toBe(source)
	})

	test.each([
		[
			"feature liga { sub f $ i by f_i; } liga;",
			"expected ligature substitution",
		],
		[
			"feature liga { sub f @ i by f_i; } liga;",
			"Unsupported create-font Adobe feature semantics",
		],
		[
			"include(layout.fea);",
			"Unsupported create-font Adobe feature semantics in IncludeNode",
		],
		[
			"feature kern { pos A V -80; } kern;",
			"Unsupported create-font Adobe feature semantics in GposType2",
		],
	])(
		"rejects unsupported create-font semantics without misclassifying Wasm syntax",
		(source, message) => {
			const parsed = parseFea(source)
			expect(parsed.ok).toBe(false)
			if (!parsed.ok) expect(parsed.errors[0]?.message).toContain(message)
		},
	)

	test("converts Rust UTF-8 diagnostic bytes to TypeScript UTF-16 positions", () => {
		const source = "# café\nfeature liga { sub f by ; } liga;"
		const parsed = parseFea(source)
		expect(parsed.ok).toBe(false)
		if (!parsed.ok) {
			expect(parsed.errors[0]?.range.line).toBe(2)
			expect(
				source.slice(
					parsed.errors[0]?.range.start,
					parsed.errors[0]?.range.end,
				),
			).toBe(";")
		}
	})
})
