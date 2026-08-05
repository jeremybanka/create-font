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
	let graphRevision = 0
	let previousOptions: DesignEditorBrowserOptions | undefined
	const update = (nextOptions: DesignEditorBrowserOptions): void => {
		if (!mounted) throw new Error("Cannot update an unmounted design editor.")
		if (
			previousOptions !== undefined &&
			(previousOptions.initialDocument !== nextOptions.initialDocument ||
				previousOptions.imageResources !== nextOptions.imageResources ||
				previousOptions.sourceSession !== nextOptions.sourceSession)
		)
			graphRevision += 1
		previousOptions = nextOptions
		root.render(
			createElement(DesignApplication, {
				...nextOptions,
				key: `design-editor:${graphRevision}`,
			}),
		)
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
	DesignImageResource,
	DesignSourceSession,
	MountedDesignEditor,
} from "./browser-api.ts"
