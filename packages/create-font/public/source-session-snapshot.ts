import type {
	SourceProjectSnapshot,
	SourceServiceUnavailable,
} from "@create-font/server"

export type SourceProjectSnapshotResponse = Readonly<{
	data: SourceProjectSnapshot | SourceServiceUnavailable | null
	error: Readonly<{ status: number }> | null
}>

/** Translate the typed RPC result into the worker's startup contract. */
export function sourceProjectSnapshotFromResponse(
	response: SourceProjectSnapshotResponse,
): SourceProjectSnapshot {
	if (response.error !== null || response.data === null) {
		throw new Error(
			`Read source snapshot failed with HTTP ${response.error?.status ?? 500}.`,
		)
	}
	if (`code` in response.data) {
		throw new Error(`Font source is not available.`)
	}
	return response.data
}
