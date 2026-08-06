import type { DesignDocument, DesignImageResource } from "@create-design/source"

import type { DesignSourceSession } from "./source-session.ts"

export type DesignEditorBrowserOptions = Readonly<{
	initialDocument?: DesignDocument
	imageResources?: readonly DesignImageResource[]
	sourceSession?: DesignSourceSession
}>

export type MountedDesignEditor = Readonly<{
	update: (options: DesignEditorBrowserOptions) => void
	unmount: () => void
}>

export declare function mountDesignEditor(
	host: HTMLElement,
	options?: DesignEditorBrowserOptions,
): MountedDesignEditor

export type { DesignDocument, DesignImageResource, DesignSourceSession }
