import { CREATE_FONT_EDITOR_VERSION } from "@create-font/states"

export const SOURCE_SESSION_PROTOCOL_VERSION = 2

export function sourceSessionWorkerName(
	editorVersion: number,
	protocolVersion: number,
): string {
	return `create-font-source-session-v${editorVersion}.${protocolVersion}`
}

/**
 * Prevent an upgraded editor or source protocol from reconnecting to a
 * SharedWorker that still holds source assembled by an incompatible bundle.
 */
export const SOURCE_SESSION_WORKER_NAME = sourceSessionWorkerName(
	CREATE_FONT_EDITOR_VERSION,
	SOURCE_SESSION_PROTOCOL_VERSION,
)
