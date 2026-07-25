import type { SourceUnitWrite } from "@create-font/server"
import type { EditorFontSource } from "@create-font/states"

import { compileFontValidation } from "./source-validation.ts"
import { sourceUnitWrites, type SourceSyncState } from "./source-sync.ts"
import {
	applySourceSyncStatePatch,
	applySourceValuePatches,
	type SourceSyncStatePatch,
	type SourceValuePatch,
} from "./source-sync-worker-patches.ts"

export type SourceSyncWorkerRequest = Readonly<
	| {
			id: number
			kind: `initialize`
			source: EditorFontSource
			state: SourceSyncState
	  }
	| {
			id: number
			kind: `patch`
			sourcePatches: readonly SourceValuePatch[]
			statePatch: SourceSyncStatePatch
	  }
>

export type SourceSyncWorkerResponse = Readonly<
	| {
			id: number
			kind: `writes`
			ok: true
			writes: readonly SourceUnitWrite[]
	  }
	| {
			id: number
			kind: `validation`
			ok: true
			validation: ReturnType<typeof compileFontValidation>
	  }
	| {
			error: string
			id: number
			kind: `writes` | `validation`
			ok: false
	  }
>

let currentSource: EditorFontSource | undefined
let currentState: SourceSyncState | undefined

function applyRequest(request: SourceSyncWorkerRequest): void {
	if (request.kind === `initialize`) {
		currentSource = request.source
		currentState = request.state
		return
	}
	if (currentSource === undefined || currentState === undefined) {
		throw new Error(`Source synchronization worker is not initialized.`)
	}
	currentSource = applySourceValuePatches(currentSource, request.sourcePatches)
	currentState = applySourceSyncStatePatch(currentState, request.statePatch)
}

self.addEventListener(
	"message",
	(event: MessageEvent<SourceSyncWorkerRequest>) => {
		const { id } = event.data
		try {
			applyRequest(event.data)
			if (currentSource === undefined || currentState === undefined) {
				throw new Error(`Source synchronization worker is not initialized.`)
			}
			self.postMessage({
				id,
				kind: `writes`,
				ok: true,
				writes: sourceUnitWrites(currentState, currentSource),
			} satisfies SourceSyncWorkerResponse)
		} catch (error) {
			self.postMessage({
				error: error instanceof Error ? error.message : String(error),
				id,
				kind: `writes`,
				ok: false,
			} satisfies SourceSyncWorkerResponse)
			return
		}
		try {
			self.postMessage({
				id,
				kind: `validation`,
				ok: true,
				validation: compileFontValidation(currentSource),
			} satisfies SourceSyncWorkerResponse)
		} catch (error) {
			self.postMessage({
				error: error instanceof Error ? error.message : String(error),
				id,
				kind: `validation`,
				ok: false,
			} satisfies SourceSyncWorkerResponse)
		}
	},
)
