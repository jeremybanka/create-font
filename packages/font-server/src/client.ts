import { treaty, type Treaty } from "@elysiajs/eden"

import type { CreateFontRpc } from "./rpc.ts"

export function createFontRpcClient(
	origin: string,
): Treaty.Create<CreateFontRpc> {
	return treaty<CreateFontRpc>(origin)
}

export type CreateFontRpcClient = ReturnType<typeof createFontRpcClient>
