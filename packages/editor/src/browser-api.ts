import type { EditorFontSource } from "@create-font/states"

import type { EditorVersionControl } from "./version-control.ts"

export type EditorBrowserOptions = Readonly<{
	featureSubstitutions?: readonly EditorFeatureSubstitution[]
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
}>

export interface EditorFeatureSubstitution {
	readonly feature: string
	readonly from: readonly string[]
	readonly to: string
	readonly contextIndex?: number
}

export type MountedEditor = Readonly<{
	update: (options: EditorBrowserOptions) => void
	unmount: () => void
}>

export type { EditorFontSource }
