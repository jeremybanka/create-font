import { describe, expect, it } from "bun:test"
import type { SourceProjectSnapshot } from "@create-font/server"

import { createSourceSnapshotRefreshController } from "../public/source-session-refresh.ts"

function deferred<Value>() {
	let resolve!: (value: Value) => void
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function project(revision: string): SourceProjectSnapshot {
	return { revision, units: [] }
}

describe(`source-session refresh coalescing`, () => {
	it(`drains a newer manifest queued while a snapshot RPC is in flight`, async () => {
		let revision: string | null = null
		const first = deferred<SourceProjectSnapshot>()
		const second = deferred<SourceProjectSnapshot>()
		const secondReadStarted = deferred<void>()
		const reads = [first.promise, second.promise]
		const applied: string[] = []
		let readCount = 0
		const controller = createSourceSnapshotRefreshController({
			applySnapshot(snapshot) {
				revision = snapshot.revision
				applied.push(snapshot.revision)
			},
			currentRevision: () => revision,
			readSnapshot: async () => {
				readCount += 1
				if (readCount === 2) secondReadStarted.resolve()
				const next = reads.shift()
				if (next === undefined) throw new Error(`Unexpected snapshot read.`)
				return next
			},
		})

		const initialRefresh = controller.refresh()
		const newerRefresh = controller.refresh(`manifest-b`)
		expect(newerRefresh).toBe(initialRefresh)

		first.resolve(project(`manifest-a`))
		await secondReadStarted.promise
		expect(applied).toEqual([`manifest-a`])

		second.resolve(project(`manifest-b`))
		await expect(initialRefresh).resolves.toBeUndefined()
		expect(applied).toEqual([`manifest-a`, `manifest-b`])
		expect(revision).toBe(`manifest-b`)
	})

	it(`starts a new drain after a failed snapshot request`, async () => {
		let revision: string | null = null
		let calls = 0
		const controller = createSourceSnapshotRefreshController({
			applySnapshot: (snapshot) => {
				revision = snapshot.revision
			},
			currentRevision: () => revision,
			readSnapshot: async () => {
				calls += 1
				if (calls === 1) throw new Error(`temporary failure`)
				return project(`manifest-a`)
			},
		})

		await expect(controller.refresh()).rejects.toThrow(`temporary failure`)
		await expect(controller.refresh()).resolves.toBeUndefined()
		expect(revision).toBe(`manifest-a`)
	})
})
