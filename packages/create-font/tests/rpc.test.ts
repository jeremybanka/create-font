import { describe, expect, it } from "bun:test"

import { createFontServerApp } from "../src/server.ts"

describe(`create-font RPC`, () => {
	it(`composes health, workspace, and build operations with the editor app`, async () => {
		const app = createFontServerApp({ root: import.meta.dir })

		const health = await app
			.handle(new Request(`http://localhost/api/health`))
			.then((response) => response.json())
		expect(health).toEqual({
			ok: true,
			rpcVersion: 5,
		})

		const workspace = await app
			.handle(new Request(`http://localhost/api/workspace`))
			.then((response) => response.json())
		expect(workspace.root).toBe(import.meta.dir)

		const worker = await app.handle(
			new Request(`http://localhost/source-session.worker.js`),
		)
		expect(worker.headers.get(`cache-control`)).toBe(`no-store`)
		expect(worker.headers.get(`content-type`)).toStartWith(`text/javascript`)

		const build = await app
			.handle(
				new Request(`http://localhost/api/build`, {
					method: `POST`,
				}),
			)
			.then((response) => response.json())
		expect(build).toEqual(
			expect.objectContaining({
				ok: false,
			}),
		)
	})
})
