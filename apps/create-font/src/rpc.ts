import {
	createFontRpc as createWorkspaceRpc,
	CREATE_FONT_RPC_VERSION,
	type CreateFontSourceService,
	type FontWorkspaceInventory,
} from "@create-font/server"
import type { ElysiaAdapter } from "elysia/adapter"

import { buildProject } from "./build.ts"
import { runtimeElysiaAdapter } from "./elysia-adapter.ts"

export { CREATE_FONT_RPC_VERSION }

export type CreateFontRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	name?: string
	root?: string
	source?: CreateFontSourceService
	workspace?: FontWorkspaceInventory
}>

export function createFontRpc(options: CreateFontRpcOptions = {}) {
	const adapter = options.adapter ?? runtimeElysiaAdapter
	return createWorkspaceRpc({
		adapter,
		build: () => buildProject(options.root),
		...(options.name === undefined ? {} : { name: options.name }),
		...(options.root === undefined ? {} : { root: options.root }),
		...(options.source === undefined ? {} : { source: options.source }),
		...(options.workspace === undefined
			? {}
			: { workspace: options.workspace }),
	})
}

export type CreateFontRpc = ReturnType<typeof createFontRpc>
