import type { FoleyProject } from "@create-foley/source"

export type FoleyEditorBrowserOptions = Readonly<{
	initialProject?: FoleyProject
	onSave?: (project: FoleyProject) => Promise<void>
}>

export type MountedFoleyEditor = Readonly<{
	update: (options: FoleyEditorBrowserOptions) => void
	unmount: () => void
}>

export declare function mountFoleyEditor(
	host: HTMLElement,
	options?: FoleyEditorBrowserOptions,
): MountedFoleyEditor

export type { FoleyProject }
