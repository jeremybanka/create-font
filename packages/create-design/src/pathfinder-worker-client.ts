import type {
	PathfinderWorkerProgress,
	PathfinderWorkerRequest,
	PathfinderWorkerResponse,
} from "./pathfinder-worker-protocol.ts"

export type PathfinderWorkerOutcome = Readonly<
	| { status: "cancelled" }
	| {
			result: Extract<PathfinderWorkerResponse, { kind: "result" }>["result"]
			status: "completed"
	  }
	| { error: string; status: "failed" }
>

export interface PathfinderWorkerTask {
	readonly cancel: () => void
	readonly result: Promise<PathfinderWorkerOutcome>
}

export interface PathfinderWorkerClient {
	readonly run: (
		input: Omit<PathfinderWorkerRequest, "id">,
		onProgress: (progress: PathfinderWorkerProgress) => void,
	) => PathfinderWorkerTask
}

type PathfinderWorkerLike = Pick<
	Worker,
	"addEventListener" | "postMessage" | "terminate"
>

export interface PathfinderWorkerClientOptions {
	readonly createWorker?: () => PathfinderWorkerLike
}

const defaultWorker = (): Worker =>
	new Worker(new URL("./pathfinder-worker.ts", import.meta.url), {
		type: "module",
	})

export function createPathfinderWorkerClient(
	options: PathfinderWorkerClientOptions = {},
): PathfinderWorkerClient {
	const createWorker = options.createWorker ?? defaultWorker
	let nextId = 0
	return {
		run(input, onProgress): PathfinderWorkerTask {
			const worker = createWorker()
			const id = nextId++
			let settled = false
			let resolveOutcome!: (outcome: PathfinderWorkerOutcome) => void
			const result = new Promise<PathfinderWorkerOutcome>((resolve) => {
				resolveOutcome = resolve
			})
			const settle = (outcome: PathfinderWorkerOutcome): void => {
				if (settled) return
				settled = true
				worker.terminate()
				resolveOutcome(outcome)
			}
			worker.addEventListener("message", (event) => {
				const response = (event as MessageEvent<PathfinderWorkerResponse>).data
				if (response.id !== id || settled) return
				if (response.kind === "progress") {
					onProgress(response.progress)
					return
				}
				if (response.kind === "failed") {
					settle({ error: response.error, status: "failed" })
					return
				}
				settle({ result: response.result, status: "completed" })
			})
			worker.addEventListener("error", (event) => {
				const error = event as ErrorEvent
				settle({
					error: error.message || "Pathfinder worker failed.",
					status: "failed",
				})
			})
			try {
				worker.postMessage({ ...input, id } satisfies PathfinderWorkerRequest)
			} catch (error) {
				settle({
					error: error instanceof Error ? error.message : String(error),
					status: "failed",
				})
			}
			return {
				cancel: () => settle({ status: "cancelled" }),
				result,
			}
		},
	}
}
