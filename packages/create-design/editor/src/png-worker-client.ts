import {
	exportPng,
	type PngExportRequest,
	type PngExportResult,
} from "@create-design/png"
import type { DesignDocument } from "./types.ts"
import type {
	PngWorkerRequest,
	PngWorkerResponse,
} from "./png-worker-protocol.ts"

export interface PngWorkerTask {
	readonly promise: Promise<PngExportResult>
	cancel(): void
}

/** Browser worker facade with a chunk-yielding headless fallback for tests/SSR. */
export function createPngWorkerClient(
	options: Readonly<{
		createWorker?: () => Worker
	}> = {},
) {
	let sequence = 0
	let disposed = false
	let active: Readonly<{
		cancel: () => void
		id: number
		worker: Worker
	}> | null = null
	const cancelActive = (): void => {
		active?.cancel()
	}
	return {
		rasterize(
			document: DesignDocument,
			request: PngExportRequest,
		): PngWorkerTask {
			const id = ++sequence
			cancelActive()
			if (disposed)
				return {
					cancel() {},
					promise: Promise.reject(new Error("PNG worker client is disposed.")),
				}
			if (options.createWorker === undefined && typeof Worker !== "function") {
				const controller = new AbortController()
				return {
					cancel: () => controller.abort(),
					promise: exportPng(document, request, { signal: controller.signal }),
				}
			}
			const worker =
				options.createWorker?.() ??
				new Worker(new URL("./png-worker.ts", import.meta.url), {
					type: "module",
				})
			const promise = new Promise<PngExportResult>((resolve, reject) => {
				let settled = false
				const cancel = (): void => {
					if (settled) return
					settled = true
					worker.terminate()
					if (active?.id === id) active = null
					reject(
						new DOMException("PNG worker task was cancelled.", "AbortError"),
					)
				}
				active = { cancel, id, worker }
				worker.onmessage = (event: MessageEvent<PngWorkerResponse>) => {
					if (event.data.id !== id || active?.id !== id) return
					settled = true
					worker.terminate()
					active = null
					if (event.data.ok)
						resolve({
							artifacts: event.data.artifacts,
							preflight: event.data.preflight,
						})
					else reject(new Error(event.data.error))
				}
				worker.onerror = (event) => {
					if (settled) return
					settled = true
					worker.terminate()
					if (active?.id === id) active = null
					reject(new Error(event.message || "PNG worker failed."))
				}
			})
			worker.postMessage({ document, id, request } satisfies PngWorkerRequest)
			return {
				cancel: () => {
					if (active?.id === id) active.cancel()
				},
				promise,
			}
		},
		dispose(): void {
			disposed = true
			sequence += 1
			cancelActive()
		},
	}
}
