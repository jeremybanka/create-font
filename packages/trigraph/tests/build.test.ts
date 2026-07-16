import { describe, expect, it } from "bun:test"

import { buildProject } from "../src/build.ts"

describe(`buildProject`, () => {
	it(`reports the preliminary build boundary`, async () => {
		const result = await buildProject(import.meta.dir)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toEqual([
			expect.objectContaining({
				code: `build.not_implemented`,
				severity: `error`,
			}),
		])
	})
})
