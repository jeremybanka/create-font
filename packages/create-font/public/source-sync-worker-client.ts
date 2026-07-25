import type { SourceUnitWrite } from "@create-font/server"
import type { EditorFontSource } from "@create-font/states"

import type { SourceSyncState } from "./source-sync.ts"
import {
	sourceSyncStatePatch,
	sourceValuePatches,
} from "./source-sync-worker-patches.ts"
import type { FontValidationStatus } from "./source-validation.ts"
import type {
	SourceSyncWorkerRequest,
	SourceSyncWorkerResponse,
} from "./source-sync-worker.ts"

export interface SourceSyncWorkerClient {
	readonly process: (
		state: SourceSyncState,
		source: EditorFontSource,
	) => Readonly<{
		validation: Promise<FontValidationStatus>
		writes: Promise<readonly SourceUnitWrite[]>
	}>
	readonly dispose: () => void
}

export function createSourceSyncWorkerClient(
	worker: Worker = new Worker(
		new URL("./source-sync-worker.ts", import.meta.url),
		{
			type: "module",
		},
	),
): SourceSyncWorkerClient {
	let previousSource: EditorFontSource | undefined
	let previousState: SourceSyncState | undefined
	const pending = new Map<
		number,
		Readonly<{
			reject: (error: Error) => void
			rejectValidation: (error: Error) => void
			resolve: (writes: readonly SourceUnitWrite[]) => void
			resolveValidation: (validation: FontValidationStatus) => void
		}>
	>()
	let nextId = 0

	worker.addEventListener(
		"message",
		(event: MessageEvent<SourceSyncWorkerResponse>) => {
			const request = pending.get(event.data.id)
			if (request === undefined) return
			if (event.data.kind === `writes`) {
				if (event.data.ok) request.resolve(event.data.writes)
				else {
					const error = new Error(event.data.error)
					request.reject(error)
					request.rejectValidation(error)
					pending.delete(event.data.id)
				}
			} else {
				pending.delete(event.data.id)
				if (event.data.ok) request.resolveValidation(event.data.validation)
				else request.rejectValidation(new Error(event.data.error))
			}
		},
	)
	worker.addEventListener("error", (event) => {
		const error = new Error(
			event.message || "Source synchronization worker failed.",
		)
		for (const request of pending.values()) {
			request.reject(error)
			request.rejectValidation(error)
		}
		pending.clear()
	})
	return {
		process: (state, source) => {
			let resolveWrites!: (writes: readonly SourceUnitWrite[]) => void
			let rejectWrites!: (error: Error) => void
			const writes = new Promise<readonly SourceUnitWrite[]>(
				(resolve, reject) => {
					resolveWrites = resolve
					rejectWrites = reject
				},
			)
			let resolveValidation!: (validation: FontValidationStatus) => void
			let rejectValidation!: (error: Error) => void
			const validation = new Promise<FontValidationStatus>(
				(resolve, reject) => {
					resolveValidation = resolve
					rejectValidation = reject
				},
			)
			const id = nextId++
			const request =
				previousSource === undefined || previousState === undefined
					? ({
							id,
							kind: `initialize`,
							source,
							state,
						} satisfies SourceSyncWorkerRequest)
					: ({
							id,
							kind: `patch`,
							sourcePatches: sourceValuePatches(previousSource, source),
							statePatch: sourceSyncStatePatch(previousState, state),
						} satisfies SourceSyncWorkerRequest)
			pending.set(id, {
				reject: rejectWrites,
				rejectValidation,
				resolve: resolveWrites,
				resolveValidation,
			})
			try {
				worker.postMessage(request)
				previousSource = source
				previousState = state
			} catch (error) {
				pending.delete(id)
				const failure =
					error instanceof Error ? error : new Error(String(error))
				rejectWrites(failure)
				rejectValidation(failure)
			}
			return { validation, writes }
		},
		dispose(): void {
			worker.terminate()
			const error = new Error("Source synchronization worker was disposed.")
			for (const request of pending.values()) {
				request.reject(error)
				request.rejectValidation(error)
			}
			pending.clear()
		},
	}
}
