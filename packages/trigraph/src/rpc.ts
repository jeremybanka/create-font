import {
	createTrigraphRpc as createWorkspaceRpc,
	TRIGRAPH_RPC_VERSION,
	type TrigraphSourceService,
} from "@trigraph/server"

import { buildProject } from "./build.ts"

export { TRIGRAPH_RPC_VERSION }

export type CreateTrigraphRpcOptions = Readonly<{
	root?: string
	source?: TrigraphSourceService
}>

export function createTrigraphRpc(options: CreateTrigraphRpcOptions = {}) {
	return createWorkspaceRpc({
		build: () => buildProject(options.root),
		...(options.root === undefined ? {} : { root: options.root }),
		...(options.source === undefined ? {} : { source: options.source }),
	})
}

export type TrigraphRpc = ReturnType<typeof createTrigraphRpc>
