import { treaty } from "@elysiajs/eden"

import type { TrigraphServerApp } from "./server.ts"

export function createTrigraphRpcClient(origin: string) {
	return treaty<TrigraphServerApp>(origin)
}

export type TrigraphRpcClient = ReturnType<typeof createTrigraphRpcClient>
