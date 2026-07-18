import type { SourceProjectSnapshot } from "@create-font/server"

export type SourceSnapshotRefreshOptions = Readonly<{
	applySnapshot(
		snapshot: SourceProjectSnapshot,
		initialLoad: boolean,
	): Promise<void> | void
	currentRevision(): string | null
	readSnapshot(initialLoad: boolean): Promise<SourceProjectSnapshot>
}>

/**
 * Coalesces source-change notifications while guaranteeing that a newer
 * revision queued during an in-flight snapshot read is drained before the
 * shared refresh promise resolves.
 */
export function createSourceSnapshotRefreshController(
	options: SourceSnapshotRefreshOptions,
) {
	let pendingRevision: string | undefined
	let refreshQueue: Promise<void> | null = null

	const refresh = (requestedRevision?: string): Promise<void> => {
		if (requestedRevision === options.currentRevision())
			return Promise.resolve()
		if (requestedRevision !== undefined) pendingRevision = requestedRevision
		if (refreshQueue !== null) return refreshQueue

		const drain = async (): Promise<void> => {
			try {
				do {
					const requested = pendingRevision
					pendingRevision = undefined
					if (requested === options.currentRevision()) continue
					const initialLoad = options.currentRevision() === null
					const snapshot = await options.readSnapshot(initialLoad)
					if (snapshot.revision === options.currentRevision()) continue
					await options.applySnapshot(snapshot, initialLoad)
				} while (
					pendingRevision !== undefined &&
					pendingRevision !== options.currentRevision()
				)
			} finally {
				// This runs without an await after the final pending-revision check, so a
				// later request either joins the active drain or starts a new one.
				refreshQueue = null
			}
		}

		refreshQueue = drain()
		return refreshQueue
	}

	return { refresh }
}
