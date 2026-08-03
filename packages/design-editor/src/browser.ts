import { h, render } from "preact"

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
	let mounted = true
	const update = (nextOptions: DesignEditorBrowserOptions): void => {
		if (!mounted) throw new Error("Cannot update an unmounted design editor.")
		render(h(DesignApplication, nextOptions), host)
	}
	update(options)
	return {
		update,
		unmount() {
			if (!mounted) return
			mounted = false
			render(null, host)
		},
	}
}

export type {
	DesignDocument,
	DesignEditorBrowserOptions,
	DesignSourceSession,
	MountedDesignEditor,
} from "./browser-api.ts"
