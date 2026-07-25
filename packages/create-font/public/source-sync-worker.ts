import type { SourceUnitWrite } from "@create-font/server"
import type { EditorFontSource } from "@create-font/states"

import { sourceUnitWrites, type SourceSyncState } from "./source-sync.ts"

export type SourceSyncWorkerRequest = Readonly<{
	id: number
	source: EditorFontSource
	state: SourceSyncState
}>

export type SourceSyncWorkerResponse = Readonly<
	| { id: number; ok: true; writes: readonly SourceUnitWrite[] }
	| { error: string; id: number; ok: false }
>

self.addEventListener(
	"message",
	(event: MessageEvent<SourceSyncWorkerRequest>) => {
		const { id, source, state } = event.data
		try {
			self.postMessage({
				id,
				ok: true,
				writes: sourceUnitWrites(state, source),
			} satisfies SourceSyncWorkerResponse)
		} catch (error) {
			self.postMessage({
				error: error instanceof Error ? error.message : String(error),
				id,
				ok: false,
			} satisfies SourceSyncWorkerResponse)
		}
	},
)
