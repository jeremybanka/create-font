import { access, readFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { staticPlugin } from "@elysia/static"
import { Elysia } from "elysia"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { createFontRpc, type CreateFontRpcOptions } from "./rpc.ts"

const isBundledApplication = basename(import.meta.dirname) === `dist`
const applicationAssets = resolve(
	import.meta.dirname,
	isBundledApplication ? `public` : `../dist/dev/public`,
)
const editorPackageRoot = dirname(
	fileURLToPath(import.meta.resolve(`@create-font/editor/package.json`)),
)
const editorBrowserAssets = resolve(editorPackageRoot, `dist/browser`)
const editorBrowserJavaScript = resolve(editorBrowserAssets, `editor.js`)
const editorBrowserStyles = resolve(editorBrowserAssets, `editor.css`)

if (isBundledApplication) {
	const assetsExist = await Promise.all([
		access(editorBrowserJavaScript).then(
			() => true,
			() => false,
		),
		access(editorBrowserStyles).then(
			() => true,
			() => false,
		),
	])
	if (!assetsExist.every(Boolean)) {
		throw new Error(
			`@create-font/editor browser assets are missing. Build the editor package before starting create-font.`,
		)
	}
}

const editorApplication = await staticPlugin({
	alwaysStatic: true,
	assets: applicationAssets,
	indexHTML: true,
	prefix: `/`,
})

export type CreateFontServerOptions = CreateFontRpcOptions

export function createFontServerApp(options: CreateFontServerOptions = {}) {
	const adapter = options.adapter ?? runtimeElysiaAdapter
	return new Elysia({ adapter, name: `create-font-server` })
		.use(createFontRpc({ ...options, adapter }))
		.get(
			`/editor/editor.js`,
			async () =>
				new Response(await readFile(editorBrowserJavaScript), {
					headers: {
						"cache-control": `public, max-age=0, must-revalidate`,
						"content-type": `text/javascript; charset=utf-8`,
					},
				}),
		)
		.get(
			`/editor/editor.css`,
			async () =>
				new Response(await readFile(editorBrowserStyles), {
					headers: {
						"cache-control": `public, max-age=0, must-revalidate`,
						"content-type": `text/css; charset=utf-8`,
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
		throw new Error(`Elysia did not create a server.`)
	}
	return {
		app,
		url: server.url,
	}
}
