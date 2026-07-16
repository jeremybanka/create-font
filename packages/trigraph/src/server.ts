import { basename, resolve } from "node:path"

import { staticPlugin } from "@elysia/static"
import { Elysia } from "elysia"

import { createTrigraphRpc, type CreateTrigraphRpcOptions } from "./rpc.ts"

const isBundledApplication = basename(import.meta.dir) === `dist`
const editorAssets = resolve(
	import.meta.dir,
	isBundledApplication ? `public` : `../public`,
)

const editorApplication = await staticPlugin({
	alwaysStatic: isBundledApplication,
	assets: editorAssets,
	bunFullstack: !isBundledApplication,
	indexHTML: true,
	prefix: `/`,
})
const sourceSessionWorker = isBundledApplication
	? Bun.file(resolve(editorAssets, `source-session.worker.js`))
	: (
			await Bun.build({
				entrypoints: [resolve(editorAssets, `source-session.worker.ts`)],
				target: `browser`,
			})
		).outputs[0]
if (sourceSessionWorker === undefined) {
	throw new Error(`Bun did not build the source session worker.`)
}

export type CreateTrigraphServerOptions = CreateTrigraphRpcOptions

export function createTrigraphServerApp(
	options: CreateTrigraphServerOptions = {},
) {
	return new Elysia({ name: `trigraph-server` })
		.use(createTrigraphRpc(options))
		.get(
			`/source-session.worker.js`,
			() =>
				new Response(sourceSessionWorker, {
					headers: {
						"content-type": `text/javascript; charset=utf-8`,
					},
				}),
		)
		.use(editorApplication)
}

export type TrigraphServerApp = ReturnType<typeof createTrigraphServerApp>

export type StartTrigraphServerOptions = CreateTrigraphServerOptions &
	Readonly<{
		hostname?: string
		port?: number
	}>

export function startTrigraphServer(options: StartTrigraphServerOptions = {}) {
	const app = createTrigraphServerApp(options).listen({
		development: {
			console: true,
			// Bun 1.3.14 drops CSS Module imports from its HMR chunks.
			// Runtime full-stack bundling works correctly without that transform.
			hmr: false,
		},
		hostname: options.hostname ?? `127.0.0.1`,
		port: options.port ?? 4173,
	})
	const server = app.server
	if (server === null) {
		throw new Error(`Elysia did not create a Bun server.`)
	}
	return {
		app,
		url: server.url,
	}
}
