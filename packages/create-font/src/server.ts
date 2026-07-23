import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { staticPlugin } from "@elysia/static"
import { Elysia } from "elysia"

import { createFontRpc, type CreateFontRpcOptions } from "./rpc.ts"

const isBundledApplication = basename(import.meta.dir) === `dist`
const applicationAssets = resolve(
	import.meta.dir,
	isBundledApplication ? `public` : `../dist/dev/public`,
)
const editorPackageRoot = dirname(
	fileURLToPath(import.meta.resolve(`@create-font/editor/package.json`)),
)
const editorBrowserAssets = resolve(editorPackageRoot, `dist/browser`)
const editorBrowserJavaScript = Bun.file(
	resolve(editorBrowserAssets, `editor.js`),
)
const editorBrowserStyles = Bun.file(resolve(editorBrowserAssets, `editor.css`))

if (
	isBundledApplication &&
	(!(await editorBrowserJavaScript.exists()) ||
		!(await editorBrowserStyles.exists()))
) {
	throw new Error(
		`@create-font/editor browser assets are missing. Build the editor package before starting create-font.`,
	)
}

const editorApplication = await staticPlugin({
	alwaysStatic: true,
	assets: applicationAssets,
	indexHTML: true,
	prefix: `/`,
})

export type CreateFontServerOptions = CreateFontRpcOptions

export function createFontServerApp(options: CreateFontServerOptions = {}) {
	return new Elysia({ name: `create-font-server` })
		.use(createFontRpc(options))
		.get(
			`/editor/editor.js`,
			() =>
				new Response(editorBrowserJavaScript, {
					headers: {
						"cache-control": `public, max-age=0, must-revalidate`,
						"content-type": `text/javascript; charset=utf-8`,
					},
				}),
		)
		.get(
			`/editor/editor.css`,
			() =>
				new Response(editorBrowserStyles, {
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
		throw new Error(`Elysia did not create a Bun server.`)
	}
	return {
		app,
		url: server.url,
	}
}
