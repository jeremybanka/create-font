import css from "./EditorApplicationRoot.module.css"
import { EditorStartupShell } from "./EditorStartupShell.tsx"
import { HydratedEditorApplication } from "./HydratedEditorApplication.tsx"
import type { EditorBrowserOptions } from "./browser-api.ts"
import "./globals.css"

export function EditorApplicationRoot(props: EditorBrowserOptions) {
	return (
		<editor-application-root className={css.class}>
			{props.startup !== undefined ? (
				<EditorStartupShell state={props.startup} />
			) : (
				<HydratedEditorApplication {...props} />
			)}
		</editor-application-root>
	)
}
