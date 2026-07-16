import { resolve } from "node:path"

import { describe, expect, it } from "bun:test"

describe(`Preact compatibility bundling`, () => {
	it(`resolves React dependencies to Preact in the browser application`, async () => {
		const result = await Bun.build({
			entrypoints: [resolve(import.meta.dir, `../public/index.html`)],
			target: `browser`,
			write: false,
		})

		expect(result.success).toBe(true)
		const javascript = (
			await Promise.all(
				result.outputs
					.filter((output) => output.type.startsWith(`text/javascript`))
					.map((output) => output.text()),
			)
		).join(`\n`)
		expect(javascript).not.toContain(`/react/cjs/react.`)
		expect(javascript).toContain(`/preact/compat/`)
	})
})
