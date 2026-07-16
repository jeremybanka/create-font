import { describe, expect, it } from "bun:test"

import { createTrigraphServerApp } from "../src/server.ts"

describe(`Trigraph RPC`, () => {
	it(`composes health, workspace, and build operations with the editor app`, async () => {
		const app = createTrigraphServerApp({ root: import.meta.dir })

		const health = await app
			.handle(new Request(`http://localhost/api/health`))
			.then((response) => response.json())
		expect(health).toEqual({
			ok: true,
			rpcVersion: 2,
		})

		const workspace = await app
			.handle(new Request(`http://localhost/api/workspace`))
			.then((response) => response.json())
		expect(workspace.root).toBe(import.meta.dir)

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
