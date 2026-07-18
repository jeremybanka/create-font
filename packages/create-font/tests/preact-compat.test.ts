import { resolve } from "node:path"
import { readFile } from "node:fs/promises"

import { describe, expect, it } from "bun:test"

describe(`Browser artifact boundary`, () => {
	it(`keeps the editor implementation out of the create-font application`, async () => {
		const result = await Bun.build({
			define: { __CREATE_FONT_DEVELOPMENT__: `false` },
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
		expect(javascript).toContain(`/editor/editor.js`)
		expect(javascript).not.toContain(`editor-application-root`)
		expect(javascript).not.toContain(`createEditorWorkspace`)
	})

	it(`builds the editor as a Preact-owned browser artifact`, async () => {
		const browserRoot = resolve(import.meta.dir, `../../editor/dist/browser`)
		const [javascript, sourceMap, styles] = await Promise.all([
			readFile(resolve(browserRoot, `editor.js`), `utf8`),
			readFile(resolve(browserRoot, `editor.js.map`), `utf8`),
			readFile(resolve(browserRoot, `editor.css`), `utf8`),
		])
		expect(javascript).not.toContain(`/react/cjs/react.`)
		expect(sourceMap).toContain(`/preact/compat/`)
		expect(javascript).toContain(`mountEditor`)
		expect(styles).toContain(`editor-application-root`)
	})
})
