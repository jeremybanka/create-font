/// <reference lib="webworker" />
import { exportPng } from "@create-design/png"
import type {
	PngWorkerRequest,
	PngWorkerResponse,
} from "./png-worker-protocol.ts"

const worker = self as unknown as DedicatedWorkerGlobalScope
worker.onmessage = (event: MessageEvent<PngWorkerRequest>) => {
	const { document, id, request } = event.data
	void exportPng(document, request).then(
		(result) => {
			const response: PngWorkerResponse = { ...result, id, ok: true }
			worker.postMessage(
				response,
				result.artifacts.map(({ bytes }) => bytes.buffer),
			)
		},
		(error) =>
			worker.postMessage({
				error: error instanceof Error ? error.message : String(error),
				id,
				ok: false,
			} satisfies PngWorkerResponse),
	)
}
