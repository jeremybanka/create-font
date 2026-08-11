import { describe, expect, it } from "vitest"

import { importGlyphsSource, lowerGlyphsSource } from "../src/index.ts"
import { parseGlyphsSource } from "../src/parser.ts"

const minimalSource = `{
.formatVersion = 3;
familyName = Parsed;
fontMaster = ({ id = regular; });
glyphs = ();
pluginData = { vendor = { enabled = 1; payload = (alpha, beta); }; };
}`

describe("Glyphs source parser", () => {
	it("retains the complete source tree before create-font lowering", () => {
		const parsed = parseGlyphsSource(minimalSource)

		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value).toMatchObject({
			format: "glyphs.source",
			formatVersion: 3,
			root: {
				familyName: "Parsed",
				pluginData: {
					vendor: { enabled: "1", payload: ["alpha", "beta"] },
				},
			},
			rawSource: minimalSource,
		})
	})

	it("reports a source span for syntax failures", () => {
		const parsed = parseGlyphsSource("{\nfamilyName = MissingSemicolon\n}")

		expect(parsed).toEqual({
			ok: false,
			errors: [
				{
					severity: "error",
					code: "glyphs.parse",
					path: "$",
					message: 'Expected ";".',
					span: { start: 32, end: 33, line: 3, column: 1 },
				},
			],
		})
	})

	it("retains a leading byte-order mark without shifting diagnostics", () => {
		const source = `\uFEFF{\nfamilyName = MissingSemicolon\n}`
		const parsed = parseGlyphsSource(source)

		expect(parsed).toMatchObject({
			ok: false,
			errors: [
				{
					span: { start: 33, end: 34, line: 3, column: 1 },
				},
			],
		})
	})

	it("exposes lowering independently from the convenience import", () => {
		const parsed = parseGlyphsSource(minimalSource)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		expect(lowerGlyphsSource(parsed.value)).toEqual(
			importGlyphsSource(minimalSource),
		)
	})
})
