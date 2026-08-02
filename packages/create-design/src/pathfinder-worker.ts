/// <reference lib="webworker" />

import { executePathfinderWorkerRequest } from "./pathfinder-worker-execution.ts"
import type {
	PathfinderWorkerRequest,
	PathfinderWorkerResponse,
} from "./pathfinder-worker-protocol.ts"

self.addEventListener(
	"message",
	(event: MessageEvent<PathfinderWorkerRequest>) => {
		const request = event.data
		try {
			executePathfinderWorkerRequest(request, (response) =>
				self.postMessage(response),
			)
		} catch (error) {
			self.postMessage({
				error: error instanceof Error ? error.message : String(error),
				id: request.id,
				kind: "failed",
			} satisfies PathfinderWorkerResponse)
		}
	},
)
