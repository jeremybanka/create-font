import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"

import { staticPlugin } from "@elysia/static"
import { createSourceRpc } from "@create-art/source-rpc/server"
import { Elysia } from "elysia"
import type { ElysiaAdapter } from "elysia/adapter"

import { runtimeElysiaAdapter } from "./elysia-adapter.ts"
import { createDesignSourceService } from "./source-service.ts"
import { coordinateDesignSourceVersionControl } from "./version-control.ts"
import {
	discoverDesignProjects,
	isSafeDesignProjectId,
	selectDesignProject,
	type DesignProject,
} from "./workspace.ts"

export const CREATE_DESIGN_RPC_VERSION = 2 as const

export type CreateDesignServerOptions = Readonly<{
	adapter?: ElysiaAdapter
	assets?: string
	root: string
	design?: string
}>

async function sourcePlugin(
	project: DesignProject,
	adapter: ElysiaAdapter,
	mountId: string,
) {
	const storedSource = await createDesignSourceService(project.root)
	const { assets, source, versionControl } =
		coordinateDesignSourceVersionControl(project.root, storedSource)
	return createSourceRpc({
		adapter,
		assets,
		name: `create-design-source:${project.name}:${mountId}`,
		source,
		versionControl,
	})
}

export async function createDesignServerApp(
	options: CreateDesignServerOptions,
) {
	const root = resolve(options.root)
	if (options.design !== undefined && !isSafeDesignProjectId(options.design))
		throw new Error("Design route identities cannot contain path segments.")
	const adapter = options.adapter ?? runtimeElysiaAdapter
	const direct = await selectDesignProject(root, options.design).catch(
		() => undefined,
	)
	const discovered = await discoverDesignProjects(root)
	const projects =
		direct?.root === root
			? [direct]
			: discovered.length > 0
				? discovered
				: direct === undefined
					? [{ name: basename(root), path: ".", root }]
					: [direct]
	const mountedProjects = (
		await Promise.all(
			projects.map(async (project) => {
				const plugin = await sourcePlugin(project, adapter, "workspace").catch(
					() => undefined,
				)
				return plugin === undefined ? null : { project, plugin }
			}),
		)
	).filter((value) => value !== null)
	const requestedActive =
		options.design === undefined
			? direct
			: projects.find(({ name }) => name === options.design)
	const activeMount =
		mountedProjects.find(
			({ project }) => project.root === requestedActive?.root,
		) ?? mountedProjects[0]
	if (activeMount === undefined)
		throw new Error("No valid design projects are available in this workspace.")
	const active = activeMount.project
	const app = new Elysia({
		adapter,
		name: `create-design-server`,
	}).group(`/api`, (api) =>
		api
			.get(`/health`, () => ({
				ok: true as const,
				rpcVersion: CREATE_DESIGN_RPC_VERSION,
			}))
			.get(`/workspace`, () => ({
				id: `workspace:${createHash("sha256").update(root).digest("hex")}`,
				name: discovered.length === 0 ? basename(active.root) : basename(root),
				activeProjectId: active.name,
				projects: mountedProjects.map(({ project: { name, path } }) => ({
					id: name,
					name,
					path,
				})),
			})),
	)
	const activePlugin = await sourcePlugin(active, adapter, "default")
	app.group(`/api`, (group) => group.use(activePlugin))
	for (const { project, plugin } of mountedProjects) {
		app.group(`/projects/${encodeURIComponent(project.name)}/api`, (group) =>
			group.use(plugin),
		)
	}
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
