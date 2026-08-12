import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"
import {
	prettyUiLayoutFile,
	uiLayoutFileV1Schema,
	uiLayoutJsonSchema,
} from "../src/schema.ts"
import { designLayout, fontLayout } from "./fixtures.ts"

describe("ui.json v1 schema", () => {
	it("round-trips strict font and design records and publishes Draft 2020-12", () => {
		const value = uiLayoutFileV1Schema.parse([fontLayout, designLayout])
		expect(JSON.parse(prettyUiLayoutFile(value))).toEqual(value)
		expect(uiLayoutJsonSchema.$schema).toBe(
			"https://json-schema.org/draft/2020-12/schema",
		)
		expect(prettyUiLayoutFile(value)).toMatch(/\n  \{/)
		expect(prettyUiLayoutFile(value).endsWith("\n")).toBe(true)
	})

	it("keeps the checked JSON Schema generated from the Zod validator", async () => {
		const checked = JSON.parse(
			await readFile(
				new URL("../ui-layout.schema.json", import.meta.url),
				"utf8",
			),
		)
		expect(checked).toEqual(uiLayoutJsonSchema)
	})

	it("rejects unknown fields, forward versions, malformed tiling, and hotbars", () => {
		for (const value of [
			{ ...fontLayout, version: 2 },
			{ ...fontLayout, future: true },
			{
				...fontLayout,
				state: {
					...fontLayout.state,
					hotbars: { ...fontLayout.state.hotbars, primary: ["select"] },
				},
			},
			{
				...fontLayout,
				state: {
					...fontLayout.state,
					tiling: {
						...fontLayout.state.tiling,
						columns: fontLayout.state.tiling.columns.map((column) => ({
							...column,
							id: 1,
						})),
					},
				},
			},
		]) {
			expect(uiLayoutFileV1Schema.safeParse([value]).success).toBe(false)
		}
	})

	it("diagnoses duplicate stable identities and case-insensitive names", () => {
		const result = uiLayoutFileV1Schema.safeParse([
			fontLayout,
			{ ...fontLayout, name: fontLayout.name.toUpperCase() },
		])
		expect(result.success).toBe(false)
		if (!result.success)
			expect(result.error.issues.map(({ path }) => path)).toEqual(
				expect.arrayContaining([
					[1, "id"],
					[1, "name"],
				]),
			)
	})
})
