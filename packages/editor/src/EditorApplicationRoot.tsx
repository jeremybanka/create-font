import type { EditorFontSource } from "@create-font/states"
import { useEffect, useRef, useState } from "preact/hooks"

import { AppShell } from "./AppShell.tsx"
import { startBrowserLiveFont } from "./browser-font-face.ts"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { EditorStateContext } from "./state-hooks.ts"
import type { EditorVersionControl } from "./version-control.ts"

export type EditorApplicationRootProps = Readonly<{
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
}>

export function EditorApplicationRoot({
	onSourceChange,
	source,
	validation,
	versionControl,
}: EditorApplicationRootProps) {
	const [workspace] = useState(() => createEditorWorkspace(source, validation))
	const applyingSource = useRef(false)
	const currentSource = useRef(source)

	useEffect(() => {
		workspace.liveFont.start()
		const stopBrowserFont = startBrowserLiveFont(
			workspace.font.silo,
			workspace.liveFont.compilation,
			workspace.liveFont.active,
			workspace.liveFont.family,
		)
		return () => {
			stopBrowserFont()
			workspace.liveFont.stop()
		}
	}, [workspace])

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
			if (nextSource !== null) {
				// The parent renders this same source object again when the save is
				// acknowledged so that validation can update. Record its identity now;
				// otherwise the acknowledgement looks like an external replacement and
				// clears the glyph timeline and selection.
				currentSource.current = nextSource
				void onSourceChange(nextSource)
			}
		}
		const unsubscribe = workspace.font.silo.subscribe(
			workspace.font.atoms.documentRevision,
			() => {
				if (applyingSource.current) return
				if (idleCallback !== null) cancelIdleCallback(idleCallback)
				if (timeout !== null) clearTimeout(timeout)
				// Persist a settled edit burst after the latency-sensitive live font has
				// compiled. An immediate idle callback can otherwise win the race with
				// the compilation timer and assemble the complete editor source first.
				timeout = setTimeout(() => {
					timeout = null
					if (typeof requestIdleCallback === "function") {
						idleCallback = requestIdleCallback(flush, { timeout: 500 })
					} else flush()
				}, 100)
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
				<AppShell
					workspace={workspace}
					{...(versionControl === undefined ? {} : { versionControl })}
				/>
			</EditorStateContext.Provider>
		</editor-application-root>
	)
}
