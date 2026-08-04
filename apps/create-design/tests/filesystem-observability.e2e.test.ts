// @vitest-environment happy-dom

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	applySourceSyncDelta,
	sourceSyncStateFromSnapshot,
	type SourceSyncState,
} from "@create-art/source-rpc"
import { assembleDesignDocument } from "@create-design/source"
import { act, h, render } from "../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignApplication } from "../../../packages/create-design/editor/src/DesignApplication.tsx"
import { createDesignSourceService } from "../src/source-service.ts"
import {
	designSourceTransaction,
	type DesignExternalSourceUpdate,
	type DesignSourceSession,
} from "../src/source-sync.ts"
import type { DesignDocument } from "@create-design/source"

const hosts: HTMLElement[] = []
const roots: string[] = []
const subscriptions: Array<() => void> = []

afterEach(async () => {
	for (const host of hosts) {
		act(() => render(null, host))
		host.remove()
	}
	hosts.length = 0
	for (const stop of subscriptions) stop()
	subscriptions.length = 0
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
	)
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function stubBrowserLayout(): void {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		function (this: HTMLCanvasElement) {
			const context = {
				canvas: this,
				createImageData: (width: number, height: number) => ({
					data: new Uint8ClampedArray(width * height * 4),
					height,
					width,
				}),
				getImageData: () => ({ data: new Uint8ClampedArray(4) }),
				measureText: () => ({ width: 0 }),
			}
			return new Proxy(context, {
				get: (target, key) =>
					key in target ? target[key as keyof typeof target] : () => undefined,
			}) as unknown as CanvasRenderingContext2D
		},
	)
	vi.stubGlobal(
		"ResizeObserver",
		class {
			readonly callback: ResizeObserverCallback
			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
			}
			observe() {
				this.callback(
					[
						{
							contentRect: { height: 720, width: 960 },
						} as ResizeObserverEntry,
					],
					this as unknown as ResizeObserver,
				)
			}
			disconnect() {}
			unobserve() {}
		},
	)
}

function assemble(state: SourceSyncState): DesignDocument {
	const result = assembleDesignDocument(
		Object.fromEntries(
			[...state.units].map(([path, unit]) => [path, unit.value]),
		),
	)
	if (!result.ok) {
		throw new Error(result.errors.map(({ message }) => message).join(`\n`))
	}
	return result.value
}

async function withDeadline<Value>(
	phase: string,
	promise: Promise<Value>,
	timeout = 5_000,
): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${phase} did not complete within ${timeout}ms.`)),
			timeout,
		)
	})
	try {
		return await Promise.race([promise, deadline])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

describe(`create-design filesystem observability`, () => {
	it(`replaces an in-editor UI change when the source file is restored`, async () => {
		stubBrowserLayout()
		const root = await mkdtemp(join(tmpdir(), `create-design-observability-`))
		roots.push(root)
		const source = await createDesignSourceService(root)
		let state = sourceSyncStateFromSnapshot(await source.readSnapshot())
		const initialDocument = assemble(state)
		const originalTitle = initialDocument.title
		const documentPath = join(root, `document.json`)
		const originalText = await readFile(documentPath, `utf8`)
		const documentListeners = new Set<
			(update: DesignExternalSourceUpdate) => void
		>()
		const localOperations = new Set<string>()
		let pendingSave: PromiseWithResolvers<void> | undefined
		let pendingExternalUpdate: PromiseWithResolvers<void> | undefined
		let tail: Promise<void> = Promise.resolve()
		const enqueue = (operation: () => Promise<void>): Promise<void> => {
			const result = tail.then(operation, operation)
			tail = result.catch(() => undefined)
			return result
		}
		const stop = source.subscribe?.((event) => {
			if (
				event.operationId !== undefined &&
				localOperations.delete(event.operationId)
			) {
				return
			}
			const completion = pendingExternalUpdate
			pendingExternalUpdate = undefined
			void enqueue(async () => {
				const applied = applySourceSyncDelta(state, event)
				state =
					applied.kind === `gap`
						? sourceSyncStateFromSnapshot(await source.readSnapshot())
						: applied.state
				const document = assemble(state)
				await act(async () => {
					for (const listener of documentListeners)
						listener({
							ok: true,
							document,
							fonts: [],
							revision: state.revision,
						})
				})
			}).then(completion?.resolve, completion?.reject)
		})
		if (stop === undefined)
			throw new Error(`Source subscription is unavailable.`)
		subscriptions.push(stop)

		const session = {
			initialDocument,
			initialRevision: state.revision,
			async reload() {
				state = sourceSyncStateFromSnapshot(await source.readSnapshot())
				return {
					ok: true as const,
					document: assemble(state),
					fonts: [],
					revision: state.revision,
				}
			},
			async save(document: DesignDocument) {
				const completion = pendingSave
				pendingSave = undefined
				try {
					await enqueue(async () => {
						const transaction = designSourceTransaction(state, document)
						if (transaction.writes.length + transaction.removals.length === 0) {
							return
						}
						const idempotencyKey = crypto.randomUUID()
						localOperations.add(idempotencyKey)
						const result = await source.writeUnits({
							idempotencyKey,
							...transaction,
						})
						const applied = applySourceSyncDelta(state, {
							type: `source.changed`,
							operationId: idempotencyKey,
							previousRevision: result.previousRevision,
							removedPaths: result.removedPaths,
							revision: result.revision,
							units: result.units,
						})
						if (applied.kind === `gap`) {
							state = sourceSyncStateFromSnapshot(await source.readSnapshot())
						} else {
							state = applied.state
						}
					})
					completion?.resolve()
				} catch (error) {
					completion?.reject(error)
					throw error
				}
				return { revision: state.revision }
			},
			subscribeDocument(
				listener: (update: DesignExternalSourceUpdate) => void,
			) {
				documentListeners.add(listener)
				return () => {
					documentListeners.delete(listener)
				}
			},
			subscribeStatus() {
				return () => undefined
			},
		} satisfies DesignSourceSession

		const host = document.createElement(`section`)
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(DesignApplication, {
					initialDocument: session.initialDocument,
					sourceSession: session,
				}),
				host,
			),
		)
		const titleInput = host.querySelector<HTMLInputElement>(
			`design-canvas-tile input[aria-label="Document title"]`,
		)
		if (titleInput === null) throw new Error(`Document title input is missing.`)

		for (let cycle = 1; cycle <= 3; cycle += 1) {
			const editedTitle = `Observed design ${cycle} ${crypto.randomUUID()}`
			const saved = Promise.withResolvers<void>()
			pendingSave = saved
			act(() => {
				titleInput.value = editedTitle
				titleInput.dispatchEvent(new Event(`input`, { bubbles: true }))
			})
			await withDeadline(`cycle ${cycle} source save`, saved.promise)
			expect(await readFile(documentPath, `utf8`)).toContain(editedTitle)
			expect(titleInput.value).toBe(editedTitle)

			const restored = Promise.withResolvers<void>()
			pendingExternalUpdate = restored
			await writeFile(documentPath, originalText)
			await withDeadline(`cycle ${cycle} external restore`, restored.promise)
			expect(titleInput.value).toBe(originalTitle)
			expect(document.title).toBe(`${originalTitle} — create-design`)
		}
	}, 20_000)
})
