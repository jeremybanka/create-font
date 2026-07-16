import { treaty, type Treaty } from "@elysiajs/eden"

import type { TrigraphRpc } from "./rpc.ts"

export function createTrigraphRpcClient(
	origin: string,
): Treaty.Create<TrigraphRpc> {
	return treaty<TrigraphRpc>(origin)
}

export type TrigraphRpcClient = ReturnType<typeof createTrigraphRpcClient>
