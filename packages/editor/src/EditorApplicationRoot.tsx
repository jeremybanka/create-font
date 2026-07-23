import type { EditorFontSource } from "@create-font/states"
import { useEffect, useRef, useState } from "preact/hooks"

import { AppShell } from "./AppShell.tsx"
import { startBrowserLiveFont } from "./browser-font-face.ts"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import { EditorStateContext } from "./state-hooks.ts"
import type { EditorVersionControl } from "./version-control.ts"
import type { EditorFeatureSubstitution } from "./browser-api.ts"

const SOURCE_SAVE_DEBOUNCE_MS = 40

export type EditorApplicationRootProps = Readonly<{
	featureSubstitutions?: readonly EditorFeatureSubstitution[]
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	onSourceDirty?: () => void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
}>

export function EditorApplicationRoot({
	featureSubstitutions,
	onSourceChange,
	onSourceDirty,
	source,
	validation,
	versionControl,
}: EditorApplicationRootProps) {
	const [workspace] = useState(() =>
		createEditorWorkspace(source, validation, featureSubstitutions),
	)

	useEffect(() => {
		workspace.actions.setFeatureSubstitutions(featureSubstitutions ?? [])
	}, [featureSubstitutions, workspace])
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
		let timeout: ReturnType<typeof setTimeout> | null = null
		const flush = (): void => {
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
				onSourceDirty?.()
				if (timeout !== null) clearTimeout(timeout)
				// Persist a settled edit burst after the latency-sensitive live font has
				// compiled, without deferring cross-window delivery to browser idle time.
				timeout = setTimeout(flush, SOURCE_SAVE_DEBOUNCE_MS)
			},
		)
		return () => {
			unsubscribe()
			if (timeout !== null) clearTimeout(timeout)
		}
	}, [onSourceChange, onSourceDirty, workspace])

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
