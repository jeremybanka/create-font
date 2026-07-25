import type { EditorFontSource } from "@create-font/states"
import { describe, expect, it, vi } from "vitest"

import { createSourceSyncWorkerClient } from "../public/source-sync-worker-client.ts"
import {
	applySourceSyncStatePatch,
	applySourceValuePatches,
} from "../public/source-sync-worker-patches.ts"
import type { SourceSyncState } from "../public/source-sync.ts"
import type {
	SourceSyncWorkerRequest,
	SourceSyncWorkerResponse,
} from "../public/source-sync-worker.ts"

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

		const first = client.process(state, source)
		const second = client.process(state, source)
		expect(worker.messages).toMatchObject([{ id: 0 }, { id: 1 }])

		worker.respond({ id: 1, kind: "writes", ok: true, writes: [] })
		worker.respond({
			id: 0,
			kind: "writes",
			ok: true,
			writes: [
				{
					expectedRevision: null,
					path: "metadata.json",
					value: {},
				},
			],
		})
		worker.respond({
			id: 1,
			kind: "validation",
			ok: true,
			validation: { issueCount: 2, ok: false },
		})
		worker.respond({
			id: 0,
			kind: "validation",
			ok: true,
			validation: { issueCount: 0, ok: true },
		})

		await expect(second.writes).resolves.toEqual([])
		await expect(first.writes).resolves.toEqual([
			{ expectedRevision: null, path: "metadata.json", value: {} },
		])
		await expect(second.validation).resolves.toEqual({
			issueCount: 2,
			ok: false,
		})
		await expect(first.validation).resolves.toEqual({
			issueCount: 0,
			ok: true,
		})
	})

	it("sends delta-sized source and snapshot updates after initialization", () => {
		const worker = new FakeWorker()
		const client = createSourceSyncWorkerClient(worker as unknown as Worker)
		const unchangedGlyph = { id: "glyph:unchanged", layers: [] }
		const firstSource = {
			glyphs: [
				unchangedGlyph,
				{
					id: "glyph:changed",
					layers: [{ contours: [{ points: [{ x: 10, y: 20 }] }] }],
				},
			],
		} as unknown as EditorFontSource
		const nextSource = {
			...firstSource,
			glyphs: [
				unchangedGlyph,
				{
					id: "glyph:changed",
					layers: [{ contours: [{ points: [{ x: 11, y: 20 }] }] }],
				},
			],
		} as unknown as EditorFontSource
		const metadata = {
			path: "metadata.json",
			revision: "unit:1",
			value: {},
		}
		const initialState = {
			revision: "revision:1",
			units: new Map([["metadata.json", metadata]]),
		} as SourceSyncState
		const nextMetadata = { ...metadata, revision: "unit:2" }
		const nextState = {
			revision: "revision:2",
			units: new Map([["metadata.json", nextMetadata]]),
		} as SourceSyncState

		client.process(initialState, firstSource)
		client.process(nextState, nextSource)

		expect(worker.messages[0]).toMatchObject({
			id: 0,
			kind: "initialize",
			source: firstSource,
			state: initialState,
		})
		expect(worker.messages[1]).toEqual({
			id: 1,
			kind: "patch",
			sourcePatches: [
				{
					path: ["glyphs", 1, "layers", 0, "contours", 0, "points", 0, "x"],
					value: 11,
				},
			],
			statePatch: {
				removedPaths: [],
				revision: "revision:2",
				units: [nextMetadata],
			},
		})
		const patchRequest = worker.messages[1] as Extract<
			SourceSyncWorkerRequest,
			{ kind: "patch" }
		>
		expect(
			applySourceValuePatches(firstSource, patchRequest.sourcePatches),
		).toEqual(nextSource)
		expect(
			applySourceSyncStatePatch(initialState, patchRequest.statePatch),
		).toEqual(nextState)
	})

	it("rejects validation when source splitting fails", async () => {
		const worker = new FakeWorker()
		const client = createSourceSyncWorkerClient(worker as unknown as Worker)
		const processing = client.process(state, source)

		worker.respond({
			error: "Source splitting failed.",
			id: 0,
			kind: "writes",
			ok: false,
		})

		await expect(processing.writes).rejects.toThrow("Source splitting failed.")
		await expect(processing.validation).rejects.toThrow(
			"Source splitting failed.",
		)
	})

	it("rejects pending work when disposed", async () => {
		const worker = new FakeWorker()
		const client = createSourceSyncWorkerClient(worker as unknown as Worker)
		const pending = client.process(state, source)

		client.dispose()

		expect(worker.terminate).toHaveBeenCalledOnce()
		await expect(pending.writes).rejects.toThrow("disposed")
		await expect(pending.validation).rejects.toThrow("disposed")
	})
})
