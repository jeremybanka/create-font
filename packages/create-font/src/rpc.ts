import {
	createFontRpc as createWorkspaceRpc,
	CREATE_FONT_RPC_VERSION,
	type CreateFontSourceService,
} from "@create-font/server"

import { buildProject } from "./build.ts"

export { CREATE_FONT_RPC_VERSION }

export type CreateFontRpcOptions = Readonly<{
	root?: string
	source?: CreateFontSourceService
}>

export function createFontRpc(options: CreateFontRpcOptions = {}) {
	return createWorkspaceRpc({
		build: () => buildProject(options.root),
		...(options.root === undefined ? {} : { root: options.root }),
		...(options.source === undefined ? {} : { source: options.source }),
	})
}

export type CreateFontRpc = ReturnType<typeof createFontRpc>
