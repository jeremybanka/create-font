import { useState } from "preact/hooks"

import { AppShell } from "./AppShell.tsx"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { EditorStateContext } from "./state-hooks.ts"

export function EditorApplicationRoot() {
	const [workspace] = useState(createEditorWorkspace)

	return (
		<editor-application-root className={css.class}>
			<EditorStateContext.Provider value={workspace.font.silo}>
				<AppShell workspace={workspace} />
			</EditorStateContext.Provider>
		</editor-application-root>
	)
}
