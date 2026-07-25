import type { SourceUnitWrite } from "@create-font/server"
import type { EditorFontSource } from "@create-font/states"

import type { SourceSyncState } from "./source-sync.ts"
import type {
	SourceSyncWorkerRequest,
	SourceSyncWorkerResponse,
} from "./source-sync-worker.ts"

export interface SourceSyncWorkerClient {
	readonly writes: (
		state: SourceSyncState,
		source: EditorFontSource,
	) => Promise<readonly SourceUnitWrite[]>
	readonly dispose: () => void
}

export function createSourceSyncWorkerClient(
	worker: Worker = new Worker(
		new URL("./source-sync-worker.ts", import.meta.url),
		{ type: "module" },
	),
): SourceSyncWorkerClient {
	const pending = new Map<
		number,
		Readonly<{
			reject: (error: Error) => void
			resolve: (writes: readonly SourceUnitWrite[]) => void
		}>
	>()
	let nextId = 0
	worker.addEventListener(
		"message",
		(event: MessageEvent<SourceSyncWorkerResponse>) => {
			const request = pending.get(event.data.id)
			if (request === undefined) return
			pending.delete(event.data.id)
			if (event.data.ok) request.resolve(event.data.writes)
			else request.reject(new Error(event.data.error))
		},
	)
	worker.addEventListener("error", (event) => {
		const error = new Error(
			event.message || "Source synchronization worker failed.",
		)
		for (const request of pending.values()) request.reject(error)
		pending.clear()
	})
	return {
		writes: (state, source) =>
			new Promise((resolve, reject) => {
				const id = nextId++
				pending.set(id, { reject, resolve })
				try {
					worker.postMessage({
						id,
						source,
						state,
					} satisfies SourceSyncWorkerRequest)
				} catch (error) {
					pending.delete(id)
					reject(error instanceof Error ? error : new Error(String(error)))
				}
			}),
		dispose(): void {
			worker.terminate()
			const error = new Error("Source synchronization worker was disposed.")
			for (const request of pending.values()) request.reject(error)
			pending.clear()
		},
	}
}
