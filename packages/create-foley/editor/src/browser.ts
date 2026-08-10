import { createElement } from "react"
import { createRoot } from "react-dom/client"

import type {
	FoleyEditorBrowserOptions,
	MountedFoleyEditor,
} from "./browser-api.ts"
import { FoleyApplication } from "./FoleyApplication.tsx"

export function mountFoleyEditor(
	host: HTMLElement,
	options: FoleyEditorBrowserOptions = {},
): MountedFoleyEditor {
	const root = createRoot(host)
	let mounted = true
	let revision = 0
	let previous: FoleyEditorBrowserOptions | undefined
	const update = (next: FoleyEditorBrowserOptions): void => {
		if (!mounted) throw new Error("Cannot update an unmounted foley editor.")
		if (previous?.initialProject !== next.initialProject) revision += 1
		previous = next
		root.render(createElement(FoleyApplication, { ...next, key: revision }))
	}
	update(options)
	return {
		update,
		unmount() {
			if (!mounted) return
			mounted = false
			root.unmount()
		},
	}
}

export type {
	FoleyEditorBrowserOptions,
	MountedFoleyEditor,
} from "./browser-api.ts"
export type { FoleyProject } from "@create-foley/source"
