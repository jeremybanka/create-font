export const SOURCE_SAVE_QUIET_MS = 500

export interface SourcePersistenceScheduler {
	readonly request: () => void
	readonly cancel: () => void
}

/**
 * Collapse a burst of document revisions before running the synchronous,
 * whole-document source projection.
 */
export function createSourcePersistenceScheduler(
	flush: () => void,
	quietMs = SOURCE_SAVE_QUIET_MS,
): SourcePersistenceScheduler {
	let timeout: ReturnType<typeof setTimeout> | null = null
	return {
		request(): void {
			if (timeout !== null) clearTimeout(timeout)
			timeout = setTimeout(() => {
				timeout = null
				flush()
			}, quietMs)
		},
		cancel(): void {
			if (timeout === null) return
			clearTimeout(timeout)
			timeout = null
		},
	}
}
