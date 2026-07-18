import { h, render } from "preact"

import { EditorApplicationRoot } from "./EditorApplicationRoot.tsx"
import type { EditorBrowserOptions, MountedEditor } from "./browser-api.ts"

/**
 * Mount the editor into a host element while keeping its Preact renderer inside
 * the editor package's browser artifact.
 */
export function mountEditor(
	host: HTMLElement,
	options: EditorBrowserOptions,
): MountedEditor {
	let mounted = true
	const update = (nextOptions: EditorBrowserOptions): void => {
		if (!mounted) throw new Error(`Cannot update an unmounted editor.`)
		render(h(EditorApplicationRoot, nextOptions), host)
	}
	update(options)
	return {
		update,
		unmount: () => {
			if (!mounted) return
			mounted = false
			render(null, host)
		},
	}
}

export type {
	EditorBrowserOptions,
	EditorFontSource,
	MountedEditor,
} from "./browser-api.ts"
