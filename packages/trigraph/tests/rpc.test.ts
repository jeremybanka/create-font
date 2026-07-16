import { describe, expect, it } from "bun:test"
import { treaty } from "@elysiajs/eden"

import { createTrigraphServerApp } from "../src/server.ts"

describe(`Trigraph RPC`, () => {
	it(`exposes health, workspace, and build operations through Eden`, async () => {
		const app = createTrigraphServerApp({ root: import.meta.dir })
		const rpc = treaty(app)

		const health = await rpc.api.health.get()
		expect(health.error).toBeNull()
		expect(health.data).toEqual({
			ok: true,
			rpcVersion: 1,
		})

		const workspace = await rpc.api.workspace.get()
		expect(workspace.error).toBeNull()
		expect(workspace.data?.root).toBe(import.meta.dir)

		const build = await rpc.api.build.post()
		expect(build.error).toBeNull()
		expect(build.data).toEqual(
			expect.objectContaining({
				ok: false,
			}),
		)
	})
})
