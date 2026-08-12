import { createHash } from "node:crypto"
import { lstatSync, realpathSync } from "node:fs"
import { access, readFile, readdir } from "node:fs/promises"
import { basename, dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { Elysia } from "elysia"
import { createUiLayoutRpc } from "@create-art/ui-layout/server"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { resolveApplicationAssets } from "./application-assets.ts"
import { createFontRpc, type CreateFontRpcOptions } from "./rpc.ts"
import { isSafeFontProjectId } from "./workspace.ts"

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

export type CreateFontWorkspaceMount = Readonly<{
	available?: () => boolean
	id: string
	name: string
	path: string
	root: string
	source: NonNullable<CreateFontRpcOptions["source"]>
}>

export type CreateFontServerOptions = CreateFontRpcOptions &
	Readonly<{
		activeProjectId?: string
		projects?: readonly CreateFontWorkspaceMount[]
		/** Workspace root containing fonts/, distinct from the selected font root. */
		workspaceRoot?: string
	}>

export function createFontServerApp(options: CreateFontServerOptions = {}) {
	const adapter = options.adapter ?? runtimeElysiaAdapter
	const workspaceRoot = resolve(
		options.workspaceRoot ?? options.root ?? process.cwd(),
	)
	const projects = options.projects ?? []
	for (const project of projects) {
		if (!isSafeFontProjectId(project.id))
			throw new Error(`Font route identities cannot contain path segments.`)
		const expectedPath = `fonts/${project.id}`
		if (
			project.path !== expectedPath ||
			resolve(project.root) !== resolve(workspaceRoot, expectedPath)
		)
			throw new Error(
				`Font routes must stay inside the workspace fonts directory.`,
			)
		try {
			const canonicalWorkspace = realpathSync(workspaceRoot)
			const canonicalProject = realpathSync(project.root)
			const canonicalRelative = relative(canonicalWorkspace, canonicalProject)
			if (
				lstatSync(project.root).isSymbolicLink() ||
				canonicalRelative === `..` ||
				canonicalRelative.startsWith(`..${sep}`) ||
				resolve(canonicalWorkspace, canonicalRelative) !== canonicalProject
			)
				throw new Error(`Font routes cannot escape through symbolic links.`)
		} catch (error) {
			if (
				error instanceof Error &&
				`code` in error &&
				(error as NodeJS.ErrnoException).code === `ENOENT`
			)
				continue
			throw error
		}
	}
	const activeProjectId = options.activeProjectId ?? projects[0]?.id
	if (projects.length > 0 && !projects.some(({ id }) => id === activeProjectId))
		throw new Error(`The active font is not available in this workspace.`)
	const workspaceId = `workspace:${createHash(`sha256`).update(workspaceRoot).digest(`hex`)}`
	const mountIsAvailable = (project: CreateFontWorkspaceMount): boolean => {
		try {
			return project.available?.() ?? true
		} catch {
			return false
		}
	}
	const workspace = () => {
		const availableProjects = projects.filter(mountIsAvailable)
		const availableActiveProjectId = availableProjects.some(
			({ id }) => id === activeProjectId,
		)
			? activeProjectId
			: availableProjects[0]?.id
		return availableActiveProjectId === undefined
			? undefined
			: {
					id: workspaceId,
					name: basename(workspaceRoot),
					activeProjectId: availableActiveProjectId,
					projects: availableProjects.map(({ id, name, path }) => ({
						id,
						name,
						path,
					})),
				}
	}
	const app = new Elysia({ adapter, name: `create-font-server` })
		.use(
			createFontRpc({
				adapter,
				name: `create-font-rpc:default`,
				...(options.root === undefined ? {} : { root: options.root }),
				...(projects.length === 0 && options.source !== undefined
					? { source: options.source }
					: {}),
				...(activeProjectId === undefined ? {} : { workspace }),
			}),
		)
		.group(`/api`, (api) =>
			api.use(
				createUiLayoutRpc({
					adapter,
					root: options.workspaceRoot ?? options.root ?? process.cwd(),
				}),
			),
		)
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
	for (const project of projects) {
		app.group(`/projects/${encodeURIComponent(project.id)}`, (group) =>
			group
				.onBeforeHandle(() =>
					mountIsAvailable(project)
						? undefined
						: new Response(`Font project is no longer available.`, {
								status: 404,
							}),
				)
				.use(
					createFontRpc({
						adapter,
						name: `create-font-rpc:project:${project.id}`,
						root: project.root,
						source: project.source,
					}),
				),
		)
	}
	return app
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
