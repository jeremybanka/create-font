import type { EditorFontSource } from "@create-font/states"
import { useEffect, useRef, useState } from "preact/hooks"

import { AppShell } from "./AppShell.tsx"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { EditorStateContext } from "./state-hooks.ts"

export type EditorApplicationRootProps = Readonly<{
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
}>

export function EditorApplicationRoot({
	onSourceChange,
	source,
	validation,
}: EditorApplicationRootProps) {
	const [workspace] = useState(() => createEditorWorkspace(source, validation))
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
		if (validation !== undefined) {
			workspace.font.silo.setState(workspace.ui.validation, validation)
		}
	}, [validation, workspace])

	useEffect(() => {
		if (onSourceChange === undefined) return
		let idleCallback: number | null = null
		let timeout: ReturnType<typeof setTimeout> | null = null
		const flush = (): void => {
			idleCallback = null
			timeout = null
			if (applyingSource.current) return
			const nextSource = workspace.font.read.editorSource()
			if (nextSource !== null) void onSourceChange(nextSource)
		}
		const unsubscribe = workspace.font.silo.subscribe(
			workspace.font.atoms.documentRevision,
			() => {
				if (applyingSource.current || idleCallback !== null || timeout !== null)
					return
				if (typeof requestIdleCallback === "function") {
					idleCallback = requestIdleCallback(flush, { timeout: 500 })
				} else {
					timeout = setTimeout(flush, 0)
				}
			},
		)
		return () => {
			unsubscribe()
			if (idleCallback !== null) cancelIdleCallback(idleCallback)
			if (timeout !== null) clearTimeout(timeout)
		}
	}, [onSourceChange, workspace])

	return (
		<editor-application-root className={css.class}>
			<EditorStateContext.Provider value={workspace.font.silo}>
				<AppShell workspace={workspace} />
			</EditorStateContext.Provider>
		</editor-application-root>
	)
}
