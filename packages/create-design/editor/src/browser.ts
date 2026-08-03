import { createElement } from "react"
import { createRoot } from "react-dom/client"

import type {
	DesignEditorBrowserOptions,
	MountedDesignEditor,
} from "./browser-api.ts"
import { DesignApplication } from "./DesignApplication.tsx"
import { migrateDesignTilingStorage } from "./design-tile-registry.ts"

export function mountDesignEditor(
	host: HTMLElement,
	options: DesignEditorBrowserOptions = {},
): MountedDesignEditor {
	try {
		migrateDesignTilingStorage(localStorage)
	} catch {
		// Layout persistence is best-effort in restricted browser contexts.
	}
	const root = createRoot(host)
	let mounted = true
	const update = (nextOptions: DesignEditorBrowserOptions): void => {
		if (!mounted) throw new Error("Cannot update an unmounted design editor.")
		root.render(createElement(DesignApplication, nextOptions))
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
	DesignDocument,
	DesignEditorBrowserOptions,
	DesignSourceSession,
	MountedDesignEditor,
} from "./browser-api.ts"
