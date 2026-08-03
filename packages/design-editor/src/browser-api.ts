import type { DesignDocument } from "@create-design/source"

import type { DesignSourceSession } from "./source-session.ts"

export type DesignEditorBrowserOptions = Readonly<{
	initialDocument?: DesignDocument
	sourceSession?: DesignSourceSession
}>

export type MountedDesignEditor = Readonly<{
	update: (options: DesignEditorBrowserOptions) => void
	unmount: () => void
}>

export type { DesignDocument, DesignSourceSession }
