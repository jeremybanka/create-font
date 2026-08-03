import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import viteConfig from "../vite.config.ts"

describe("development editor resolution", () => {
	it("loads the shared editor from workspace source", () => {
		const aliases = viteConfig.resolve?.alias as
			| Readonly<Record<string, string>>
			| undefined

		expect(aliases?.["@create-art/editor"]).toBe(
			resolve(
				import.meta.dirname,
				"../../../packages/create-art/editor/src/index.ts",
			),
		)
	})
})
