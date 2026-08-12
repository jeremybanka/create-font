import type { EditorFontSource } from "@create-font/states"

import type { EditorVersionControl } from "./version-control.ts"

type EditorBrowserSharedOptions = Readonly<{
	featureSubstitutions?: readonly EditorFeatureSubstitution[]
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	onSourceDirty?: (source: EditorFontSource) => void
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
	workspaceProject?: EditorWorkspaceProject
}>

export type EditorWorkspaceProject = Readonly<{
	id: string
	onChange: (
		projectId: string,
		source: EditorFontSource,
	) => boolean | Promise<boolean>
	projects: readonly Readonly<{ id: string; name: string; path: string }>[]
}>

export type EditorStartupState =
	| Readonly<{ type: `loading` }>
	| Readonly<{ type: `error`; message: string; onRetry: () => void }>

export type EditorBrowserOptions = EditorBrowserSharedOptions &
	Readonly<
		| { source: EditorFontSource; startup?: never }
		| { source?: never; startup: EditorStartupState }
	>

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

export declare function mountEditor(
	host: HTMLElement,
	options: EditorBrowserOptions,
): MountedEditor

export type { EditorFontSource }
