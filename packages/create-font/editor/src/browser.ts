import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { EditorApplicationRoot } from "./EditorApplicationRoot.tsx"
import type { EditorBrowserOptions, MountedEditor } from "./browser-api.ts"

/**
 * Mount the editor into a host element while keeping its React renderer inside
 * the editor package's browser artifact.
 */
export function mountEditor(
	host: HTMLElement,
	options: EditorBrowserOptions,
): MountedEditor {
	const root = createRoot(host)
	let mounted = true
	const update = (nextOptions: EditorBrowserOptions): void => {
		if (!mounted) throw new Error(`Cannot update an unmounted editor.`)
		root.render(createElement(EditorApplicationRoot, nextOptions))
	}
	update(options)
	return {
		update,
		unmount: () => {
			if (!mounted) return
			mounted = false
			root.unmount()
		},
	}
}

export type {
	EditorBrowserOptions,
	EditorFontSource,
	MountedEditor,
} from "./browser-api.ts"
export type {
	EditorVersionControl,
	VersionControlChangeUnit,
	VersionControlCommitRequest,
	VersionControlComparison,
} from "./version-control.ts"
