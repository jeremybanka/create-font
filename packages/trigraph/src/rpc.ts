import { resolve } from "node:path"

import { Elysia } from "elysia"

import { buildProject } from "./build.ts"

export const TRIGRAPH_RPC_VERSION = 1 as const

export type CreateTrigraphRpcOptions = Readonly<{
	root?: string
}>

export function createTrigraphRpc(options: CreateTrigraphRpcOptions = {}) {
	const root = resolve(options.root ?? process.cwd())

	return new Elysia({
		name: `trigraph-rpc`,
		prefix: `/api`,
	})
		.get(`/health`, () => ({
			ok: true as const,
			rpcVersion: TRIGRAPH_RPC_VERSION,
		}))
		.get(`/workspace`, () => ({
			root,
		}))
		.post(`/build`, () => buildProject(root))
}

export type TrigraphRpc = ReturnType<typeof createTrigraphRpc>
