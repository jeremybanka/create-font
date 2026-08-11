import { access, readFile, readdir } from "node:fs/promises"
import { basename, dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { Elysia } from "elysia"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { resolveApplicationAssets } from "./application-assets.ts"
import { createFontRpc, type CreateFontRpcOptions } from "./rpc.ts"

const applicationAssets = await resolveApplicationAssets(import.meta.dirname)
const isBundledApplication = basename(import.meta.dirname) === `dist`
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

const applicationContentTypes: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
}

async function applicationFilePaths(root: string): Promise<readonly string[]> {
	const paths: string[] = []
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name)
			if (entry.isDirectory()) await visit(path)
			else if (entry.isFile()) paths.push(path)
		}
	}
	await visit(root)
	return paths.toSorted()
}

const editorApplication = new Elysia({ name: `create-font-application` })
for (const path of await applicationFilePaths(applicationAssets)) {
	const relativePath = relative(applicationAssets, path).split(sep).join(`/`)
	const route = `/${relativePath}`
	const serve = async () =>
		new Response(await readFile(path), {
			headers: {
				"cache-control": `public, max-age=0, must-revalidate`,
				"content-type":
					applicationContentTypes[extname(path)] ?? `application/octet-stream`,
			},
		})
	editorApplication.get(route, serve)
	if (relativePath === `index.html`) editorApplication.get(`/`, serve)
	else if (relativePath.endsWith(`/index.html`)) {
		editorApplication.get(route.slice(0, -`/index.html`.length), serve)
	}
}

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
	// The Node adapter's underlying server may be unreferenced. A CLI-owned
	// workspace server must keep the process alive until it is explicitly stopped.
	server.ref()
	return {
		app,
		url: server.url,
	}
}
