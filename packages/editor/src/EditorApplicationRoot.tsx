import type { EditorFontSource } from "@create-font/states"
import { useEffect, useRef, useState } from "preact/hooks"

import { AppShell } from "./AppShell.tsx"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { subscribeToSettledState } from "./settled-subscription.ts"
import { EditorStateContext } from "./state-hooks.ts"

export type EditorApplicationRootProps = Readonly<{
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	source: EditorFontSource
}>

export function EditorApplicationRoot({
	onSourceChange,
	source,
}: EditorApplicationRootProps) {
	const [workspace] = useState(() => createEditorWorkspace(source))
	const applyingSource = useRef(false)
	const currentSource = useRef(source)

	useEffect(() => {
		if (currentSource.current === source) return
		currentSource.current = source
		applyingSource.current = true
		try {
			workspace.actions.replaceSource(source)
		} finally {
			applyingSource.current = false
		}
	}, [source, workspace])

	useEffect(() => {
		if (onSourceChange === undefined) return
		return subscribeToSettledState(
			workspace.font.silo,
			workspace.font.selectors.editorSource,
			() => {
				const nextSource = workspace.font.silo.getState(
					workspace.font.selectors.editorSource,
				)
				if (nextSource !== null && !applyingSource.current) {
					void onSourceChange(nextSource)
				}
			},
		)
	}, [onSourceChange, workspace])

	return (
		<editor-application-root className={css.class}>
			<EditorStateContext.Provider value={workspace.font.silo}>
				<AppShell workspace={workspace} />
			</EditorStateContext.Provider>
		</editor-application-root>
	)
}
