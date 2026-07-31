import { resolve } from "node:path"

import { staticPlugin } from "@elysia/static"
import { createSourceRpc } from "@create-art/source-rpc/server"
import { Elysia } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { createDesignSourceService } from "./source-service.ts"

export const CREATE_DESIGN_RPC_VERSION = 1 as const

export type CreateDesignServerOptions = Readonly<{
	adapter?: ElysiaAdapter
	assets?: string
	root: string
}>

export async function createDesignServerApp(
	options: CreateDesignServerOptions,
) {
	const root = resolve(options.root)
	const source = await createDesignSourceService(root)
	const adapter = options.adapter ?? runtimeElysiaAdapter
	const app = new Elysia({
		adapter,
		name: `create-design-server`,
	}).group(`/api`, (api) =>
		api
			.get(`/health`, () => ({
				ok: true as const,
				rpcVersion: CREATE_DESIGN_RPC_VERSION,
			}))
			.get(`/workspace`, () => ({ root }))
			.use(createSourceRpc({ adapter, assets: source, source })),
	)
	if (options.assets === undefined) return app
	return app.use(
		await staticPlugin({
			alwaysStatic: true,
			assets: resolve(options.assets),
			indexHTML: true,
			prefix: `/`,
		}),
	)
}

export type CreateDesignServerApp = Awaited<
	ReturnType<typeof createDesignServerApp>
>

export type StartCreateDesignServerOptions = CreateDesignServerOptions &
	Readonly<{
		hostname?: string
		port?: number
	}>

export async function startCreateDesignServer(
	options: StartCreateDesignServerOptions,
) {
	const app = await createDesignServerApp(options)
	app.listen({
		hostname: options.hostname ?? `127.0.0.1`,
		port: options.port ?? 3010,
	})
	const server = app.server
	if (server === null) throw new Error(`Elysia did not create a server.`)
	return { app, url: server.url }
}
