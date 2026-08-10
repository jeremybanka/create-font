import { createElement } from "react"
import { createRoot } from "react-dom/client"

import type { MountedSpriteEditor, SpriteEditorBrowserOptions } from "./browser-api.ts"
import { SpriteApplication } from "./SpriteApplication.tsx"

export function mountSpriteEditor(host: HTMLElement, options: SpriteEditorBrowserOptions): MountedSpriteEditor {
	const root = createRoot(host)
	let mounted = true
	let revision = 0
	const update = (next: SpriteEditorBrowserOptions): void => {
		if (!mounted) throw new Error(`Cannot update an unmounted sprite editor.`)
		revision += 1
		root.render(createElement(SpriteApplication, { ...next, key: `sprite-editor:${revision}` }))
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

export type { MountedSpriteEditor, SpriteEditorBrowserOptions, SpriteSourceSession } from "./browser-api.ts"
export type { SpriteProject } from "./model.ts"
