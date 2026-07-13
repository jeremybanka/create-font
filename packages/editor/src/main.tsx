import { StoreProvider } from "atom.io/react"
import { render } from "preact"

import { AppShell } from "./AppShell.tsx"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")

const workspace = createEditorWorkspace()
render(
	<StoreProvider store={workspace.font.silo.store}>
		<AppShell workspace={workspace} />
	</StoreProvider>,
	mount,
)
