import { render } from "preact"

import { AppShell } from "./AppShell.tsx"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { EditorStateProvider } from "./state-hooks.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const workspace = createEditorWorkspace()
render(
	<EditorStateProvider silo={workspace.font.silo}>
		<AppShell workspace={workspace} />
	</EditorStateProvider>,
	mount,
)
