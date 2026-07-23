import {
	createFontRpc as createWorkspaceRpc,
	CREATE_FONT_RPC_VERSION,
	type CreateFontSourceService,
} from "@create-font/server"
import type { ElysiaAdapter } from "elysia/adapter"

import { buildProject } from "./build.ts"
import { runtimeElysiaAdapter } from "./elysia-adapter.ts"

export { CREATE_FONT_RPC_VERSION }

export type CreateFontRpcOptions = Readonly<{
	adapter?: ElysiaAdapter
	root?: string
	source?: CreateFontSourceService
}>

export function createFontRpc(options: CreateFontRpcOptions = {}) {
	const adapter = options.adapter ?? runtimeElysiaAdapter
	return createWorkspaceRpc({
		adapter,
		build: () => buildProject(options.root),
		...(options.root === undefined ? {} : { root: options.root }),
		...(options.source === undefined ? {} : { source: options.source }),
	})
}

export type CreateFontRpc = ReturnType<typeof createFontRpc>
