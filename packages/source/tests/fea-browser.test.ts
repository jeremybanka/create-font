import { readFile } from "node:fs/promises"

import { describe, expect, test } from "vitest"

import {
	initializeFeaParser,
	parseFea,
	parseFeaSyntax,
} from "../src/fea-browser.ts"

describe("Adobe feature browser parser adapter", () => {
	test("initializes once and drives syntax plus semantic projection", async () => {
		const bytes = await readFile(
			new URL(
				"../../fea-parser/dist/web/create_font_fea_parser_bg.wasm",
				import.meta.url,
			),
		)
		await initializeFeaParser(bytes)
		await initializeFeaParser()

		const source = "feature liga { sub f i by f_i; } liga;"
		expect(parseFeaSyntax(source)).toMatchObject({
			abiVersion: 1,
			diagnostics: [],
		})
		expect(parseFea(source)).toMatchObject({
			ok: true,
			value: {
				features: [
					{
						tag: "liga",
						statements: [{ from: ["f", "i"], to: "f_i" }],
					},
				],
			},
		})
	})
})
