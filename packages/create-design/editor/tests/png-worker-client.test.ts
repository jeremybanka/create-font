import { describe, expect, it, vi } from "vitest"
import { createInitialDocument } from "../src/document.ts"
import { createPngWorkerClient } from "../src/png-worker-client.ts"
import type {
	PngWorkerRequest,
	PngWorkerResponse,
} from "../src/png-worker-protocol.ts"

class FakeWorker {
	onerror: ((event: ErrorEvent) => unknown) | null = null
	onmessage: ((event: MessageEvent<PngWorkerResponse>) => unknown) | null = null
	readonly messages: PngWorkerRequest[] = []
	readonly terminate = vi.fn()
	postMessage(message: PngWorkerRequest): void {
		this.messages.push(message)
	}
	respond(response: PngWorkerResponse): void {
		this.onmessage?.(new MessageEvent("message", { data: response }))
	}
}

describe("PNG worker client", () => {
	it("transfers a correlated production result and releases the worker", async () => {
		const worker = new FakeWorker()
		const client = createPngWorkerClient({
			createWorker: () => worker as unknown as Worker,
		})
		const document = createInitialDocument()
		const request = { scope: { kind: "all" as const } }
		const task = client.rasterize(document, request)
		expect(worker.messages).toEqual([{ document, id: 1, request }])
		const result = {
			artifacts: [],
			preflight: {
				artboards: [],
				decision: "ready" as const,
				diagnostics: [],
				summary: { errors: 0, warnings: 0, infos: 0 },
				target: "png" as const,
			},
		}
		worker.respond({ ...result, id: 1, ok: true })
		await expect(task.promise).resolves.toEqual(result)
		expect(worker.terminate).toHaveBeenCalledOnce()
	})

	it("terminates and rejects stale work with AbortError", async () => {
		const worker = new FakeWorker()
		const client = createPngWorkerClient({
			createWorker: () => worker as unknown as Worker,
		})
		const task = client.rasterize(createInitialDocument(), {
			scope: { kind: "all" },
		})
		task.cancel()
		await expect(task.promise).rejects.toMatchObject({ name: "AbortError" })
		expect(worker.terminate).toHaveBeenCalledOnce()
	})
})
