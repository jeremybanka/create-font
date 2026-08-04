import {
	preflightPngExport,
	type PngExportRequest,
	type PngPreflightResult,
} from "@create-design/png"
import type { DesignDocument } from "./types.ts"
import { createPngWorkerClient } from "./png-worker-client.ts"

export interface PngDownloadEnvironment {
	readonly activate: (url: string, filename: string) => void
	readonly createObjectURL: (blob: Blob) => string
	readonly revokeObjectURL: (url: string) => void
}

export function browserPngDownloadEnvironment(): PngDownloadEnvironment {
	return {
		activate(url, filename) {
			const anchor = window.document.createElement("a")
			anchor.href = url
			anchor.download = filename
			anchor.click()
		},
		createObjectURL: (blob) => URL.createObjectURL(blob),
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	}
}

export function createPngDownloadManager(
	environment = browserPngDownloadEnvironment(),
) {
	const client = createPngWorkerClient()
	let generation = 0
	let disposed = false
	let controller: AbortController | null = null
	return {
		dispose(): void {
			disposed = true
			generation += 1
			controller?.abort()
			client.dispose()
		},
		preflight(
			document: DesignDocument,
			request: PngExportRequest,
		): PngPreflightResult {
			return preflightPngExport(document, request)
		},
		async request(
			document: DesignDocument,
			request: PngExportRequest,
		): Promise<boolean> {
			if (
				disposed ||
				preflightPngExport(document, request).decision === "blocked"
			)
				return false
			const current = ++generation
			controller?.abort()
			controller = new AbortController()
			const task = client.rasterize(document, request)
			controller.signal.addEventListener("abort", task.cancel, { once: true })
			const result = await task.promise
			if (disposed || current !== generation) return false
			for (const artifact of result.artifacts) {
				const url = environment.createObjectURL(
					new Blob([new Uint8Array(artifact.bytes).buffer], {
						type: "image/png",
					}),
				)
				if (disposed || current !== generation) {
					environment.revokeObjectURL(url)
					return false
				}
				environment.activate(url, artifact.filename)
				setTimeout(() => environment.revokeObjectURL(url), 0)
			}
			return true
		},
	}
}
