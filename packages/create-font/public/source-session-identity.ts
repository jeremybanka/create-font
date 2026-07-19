import { CREATE_FONT_EDITOR_VERSION } from "@create-font/states"

export function sourceSessionWorkerName(editorVersion: number): string {
	return `create-font-source-session-v${editorVersion}`
}

/**
 * Prevent an upgraded editor from reconnecting to a SharedWorker that still
 * holds source assembled for an older editor contract.
 */
export const SOURCE_SESSION_WORKER_NAME = sourceSessionWorkerName(
	CREATE_FONT_EDITOR_VERSION,
)
