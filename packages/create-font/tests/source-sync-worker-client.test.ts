import type { EditorFontSource } from "@create-font/states"
import { describe, expect, it, vi } from "vitest"

import { createSourceSyncWorkerClient } from "../public/source-sync-worker-client.ts"
import type { SourceSyncState } from "../public/source-sync.ts"
import type { SourceSyncWorkerResponse } from "../public/source-sync-worker.ts"

class FakeWorker {
	readonly messages: unknown[] = []
	readonly terminate = vi.fn()
	readonly listeners = {
		error: [] as ((event: ErrorEvent) => void)[],
		message: [] as ((event: MessageEvent<SourceSyncWorkerResponse>) => void)[],
	}

	addEventListener(type: "error" | "message", listener: EventListener): void {
		this.listeners[type].push(listener as never)
	}

	postMessage(message: unknown): void {
		this.messages.push(message)
	}

	respond(response: SourceSyncWorkerResponse): void {
		for (const listener of this.listeners.message) {
			listener(new MessageEvent("message", { data: response }))
		}
	}
}

const state = {
	revision: "revision:1",
	units: new Map(),
} as SourceSyncState
const source = {} as EditorFontSource

describe("source sync worker client", () => {
	it("correlates off-thread source writes by request ID", async () => {
		const worker = new FakeWorker()
		const client = createSourceSyncWorkerClient(worker as unknown as Worker)

		const first = client.writes(state, source)
		const second = client.writes(state, source)
		expect(worker.messages).toMatchObject([{ id: 0 }, { id: 1 }])

		worker.respond({ id: 1, ok: true, writes: [] })
		worker.respond({
			id: 0,
			ok: true,
			writes: [
				{
					expectedRevision: null,
					path: "metadata.json",
					value: {},
				},
			],
		})

		await expect(second).resolves.toEqual([])
		await expect(first).resolves.toEqual([
			{ expectedRevision: null, path: "metadata.json", value: {} },
		])
	})

	it("rejects pending work when disposed", async () => {
		const worker = new FakeWorker()
		const client = createSourceSyncWorkerClient(worker as unknown as Worker)
		const pending = client.writes(state, source)

		client.dispose()

		expect(worker.terminate).toHaveBeenCalledOnce()
		await expect(pending).rejects.toThrow("disposed")
	})
})
