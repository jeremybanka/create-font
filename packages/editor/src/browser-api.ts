import type { EditorFontSource } from "@create-font/states"

import type { EditorVersionControl } from "./version-control.ts"

export type EditorBrowserOptions = Readonly<{
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
}>

export type MountedEditor = Readonly<{
	update: (options: EditorBrowserOptions) => void
	unmount: () => void
}>

export type { EditorFontSource }
