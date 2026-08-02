import { applyDesignPathCommand } from "./path-commands.ts"
import type {
	PathfinderWorkerRequest,
	PathfinderWorkerResponse,
} from "./pathfinder-worker-protocol.ts"

/** Runs one worker request synchronously inside the worker's isolated thread. */
export function executePathfinderWorkerRequest(
	request: PathfinderWorkerRequest,
	post: (response: PathfinderWorkerResponse) => void,
): void {
	let sequence = 0
	const result = applyDesignPathCommand(request.command, request.context, {
		nextId: () => `${request.idSeed}:${sequence++}`,
		...(request.pathfinderTolerance === undefined
			? {}
			: { pathfinderTolerance: request.pathfinderTolerance }),
		onPathfinderProgress: (progress) => {
			post({
				id: request.id,
				kind: "progress",
				progress: { ...progress, phase: "partitioning" },
			})
			if (progress.completedRegions === progress.totalRegions)
				post({
					id: request.id,
					kind: "progress",
					progress: { ...progress, phase: "materializing" },
				})
		},
	})
	post({ id: request.id, kind: "result", result })
}
