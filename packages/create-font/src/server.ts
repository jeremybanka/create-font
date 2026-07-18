import { basename, resolve } from "node:path"

import { staticPlugin } from "@elysia/static"
import { Elysia } from "elysia"

import { createFontRpc, type CreateFontRpcOptions } from "./rpc.ts"

const isBundledApplication = basename(import.meta.dir) === `dist`
const editorAssets = resolve(
	import.meta.dir,
	isBundledApplication ? `public` : `../dist/dev/public`,
)

const editorApplication = await staticPlugin({
	alwaysStatic: true,
	assets: editorAssets,
	indexHTML: true,
	prefix: `/`,
})
const sourceSessionWorker = Bun.file(
	resolve(editorAssets, `source-session.worker.js`),
)

export type CreateFontServerOptions = CreateFontRpcOptions

export function createFontServerApp(options: CreateFontServerOptions = {}) {
	return new Elysia({ name: `create-font-server` })
		.use(createFontRpc(options))
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

export type CreateFontServerApp = ReturnType<typeof createFontServerApp>

export type StartCreateFontServerOptions = CreateFontServerOptions &
	Readonly<{
		hostname?: string
		port?: number
	}>

export function startCreateFontServer(
	options: StartCreateFontServerOptions = {},
) {
	const app = createFontServerApp(options).listen({
		development: {
			console: true,
			hmr: false,
		},
		hostname: options.hostname ?? `127.0.0.1`,
		port: options.port ?? 3000,
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
