import { resolve } from "node:path"

import { staticPlugin } from "@elysia/static"
import { validateFoleyProject } from "@create-foley/source"
import { Elysia } from "elysia"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { readFoleyProject, writeFoleyProject } from "./source-store.ts"

export type CreateFoleyServerOptions = Readonly<{
	assets?: string
	root: string
}>

export async function createFoleyServerApp(options: CreateFoleyServerOptions) {
	const root = resolve(options.root)
	const app = new Elysia({ adapter: runtimeElysiaAdapter, name: "create-foley-server" })
		.group("/api", (api) => api
			.get("/health", () => ({ ok: true as const, version: 1 as const }))
			.get("/project", () => readFoleyProject(root))
			.put("/project", async ({ body, set }) => {
				try {
					const project = validateFoleyProject(body)
					await writeFoleyProject(root, project)
					return { ok: true as const }
				} catch (error) {
					set.status = 400
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
				}
			}),
		)
	if (options.assets === undefined) return app
	return app.use(await staticPlugin({
		alwaysStatic: true,
		assets: resolve(options.assets),
		indexHTML: true,
		prefix: "/",
	}))
}

export async function startCreateFoleyServer(
	options: CreateFoleyServerOptions & Readonly<{ hostname?: string; port?: number }>,
) {
	const app = await createFoleyServerApp(options)
	app.listen({ hostname: options.hostname ?? "127.0.0.1", port: options.port ?? 3012 })
	if (app.server === null) throw new Error("Elysia did not create a server.")
	return { app, url: app.server.url }
}
