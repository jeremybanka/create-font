import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
	formatSourceFea,
	formatSourceJson,
	formatPortableSourceJson,
	SOURCE_FORMAT_DPRINT_VERSION,
	SOURCE_FORMAT_FEA_PLUGIN_VERSION,
	SOURCE_FORMAT_JSON_PLUGIN_VERSION,
	stringifySourceJson,
} from "../src/index.ts"
import {
	formatSourceFea as formatBrowserFea,
	formatSourceJson as formatBrowserJson,
} from "../src/browser.ts"

describe("create-art source formatting contract", () => {
	it("pins and reports the complete trusted toolchain", async () => {
		const packageJson = JSON.parse(
			await readFile(new URL("../package.json", import.meta.url), "utf8"),
		) as { dependencies: Record<string, string> }
		expect(packageJson.dependencies.dprint).toBe(SOURCE_FORMAT_DPRINT_VERSION)
		expect(packageJson.dependencies["@dprint/json"]).toBe(
			SOURCE_FORMAT_JSON_PLUGIN_VERSION,
		)
		expect(packageJson.dependencies["dprint-plugin-fea"]).toBe("workspace:*")
		expect(SOURCE_FORMAT_FEA_PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/u)
	})

	it("formats golden JSON facts idempotently across line endings", () => {
		const value = {
			z: "Unicode café \u2028 and escaping \"\\\b\f\n\r\t",
			order: [3.141592653589793, -0, 1e-7, 1e21],
			long: Array.from({ length: 24 }, (_, index) => index + 0.25),
			a: { second: true, first: null },
		}
		const formatted = formatSourceJson(value)
		expect(formatted).toBe(formatPortableSourceJson(value))
		expect(formatBrowserJson(value)).toBe(formatted)
		expect(formatted).toMatchInlineSnapshot(`
			"{
				"a": { "first": null, "second": true },
				"long": [
					0.25,
					1.25,
					2.25,
					3.25,
					4.25,
					5.25,
					6.25,
					7.25,
					8.25,
					9.25,
					10.25,
					11.25,
					12.25,
					13.25,
					14.25,
					15.25,
					16.25,
					17.25,
					18.25,
					19.25,
					20.25,
					21.25,
					22.25,
					23.25
				],
				"order": [3.141592653589793, -0, 1e-7, 1e+21],
				"z": "Unicode café   and escaping \\"\\\\\\b\\f\\n\\r\\t"
			}
			"
		`)
		expect(formatSourceJson(JSON.parse(formatted))).toBe(formatted)
		expect(formatted.endsWith("\n")).toBe(true)
		expect(formatted.endsWith("\n\n")).toBe(false)
		expect(createHash("sha256").update(formatted).digest("hex")).toHaveLength(64)
		expect(stringifySourceJson(value).indexOf('"a"')).toBeLessThan(
			stringifySourceJson(value).indexOf('"z"'),
		)
		for (const candidate of [
			{ short: [1, 2, 3], object: { a: true, b: false } },
			{
				values: Array.from({ length: 3 }, (_, index) => ({
					index,
					label: "value".repeat(index),
				})),
			},
		]) {
			expect(formatBrowserJson(candidate)).toBe(formatSourceJson(candidate))
		}
	})

	it("formats Adobe feature text idempotently with LF", () => {
		const formatted = formatSourceFea(
			"feature liga {\r\n sub f i by f_i;\r\n} liga;\r\n",
		)
		expect(formatted).toBe(
			"feature liga {\n  sub f i by f_i;\n} liga;\n",
		)
		expect(formatSourceFea(formatted)).toBe(formatted)
		expect(() => formatBrowserFea()).toThrow(/trusted Node adapter/u)
	})
})
