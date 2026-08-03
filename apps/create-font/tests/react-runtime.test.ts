import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

describe(`Browser artifact boundary`, () => {
	it(`keeps the editor implementation out of the create-font application`, async () => {
		const publicRoot = resolve(import.meta.dirname, `../dist/dev/public`)
		const entries = await readdir(publicRoot, { recursive: true })
		const javascript = (
			await Promise.all(
				entries
					.filter((entry) => entry.endsWith(`.js`))
					.map((entry) => readFile(resolve(publicRoot, entry), `utf8`)),
			)
		).join(`\n`)
		expect(javascript).toContain(`/editor/editor.js`)
		expect(javascript).not.toContain(`editor-application-root`)
		expect(javascript).not.toContain(`createEditorWorkspace`)
	})

	it(`builds the editor as a React-owned browser artifact`, async () => {
		const browserRoot = resolve(
			import.meta.dirname,
			`../../../packages/create-font/editor/dist/browser`,
		)
		const [javascript, sourceMap, styles] = await Promise.all([
			readFile(resolve(browserRoot, `editor.js`), `utf8`),
			readFile(resolve(browserRoot, `editor.js.map`), `utf8`),
			readFile(resolve(browserRoot, `editor.css`), `utf8`),
		])
		expect(sourceMap).toContain(`/react/`)
		expect(sourceMap).toContain(`/react-dom/`)
		expect(sourceMap).toContain(`/react-konva/`)
		expect(sourceMap).not.toContain(`/preact/`)
		expect(javascript).toContain(`mountEditor`)
		expect(styles).toContain(`editor-application-root`)
	})
})
