import type { EditorFontSource } from "@create-font/states"
import { StoreProvider } from "atom.io/react"
import { useEffect, useRef, useState } from "react"

import { AppShell } from "./AppShell.tsx"
import { startBrowserLiveFont } from "./browser-font-face.ts"
import css from "./EditorApplicationRoot.module.css"
import { createEditorWorkspace } from "./editor-workspace.ts"
import "./globals.css"
import type {
	EditorCollaboration,
	EditorFeatureSubstitution,
	EditorWorkspaceProject,
} from "./browser-api.ts"
import { createSourcePersistenceScheduler } from "./source-persistence.ts"
import type { EditorVersionControl } from "./version-control.ts"

export type EditorApplicationRootProps = Readonly<{
	collaboration?: EditorCollaboration
	featureSubstitutions?: readonly EditorFeatureSubstitution[]
	onSourceChange?: (source: EditorFontSource) => Promise<void> | void
	onSourceDirty?: (source: EditorFontSource) => void
	source: EditorFontSource
	validation?: Readonly<{ ok: boolean; issueCount: number }>
	versionControl?: EditorVersionControl
	workspaceProject?: EditorWorkspaceProject
}>

export function EditorApplicationRoot({
	collaboration,
	featureSubstitutions,
	onSourceChange,
	onSourceDirty,
	source,
	validation,
	versionControl,
	workspaceProject,
}: EditorApplicationRootProps) {
	const [workspace] = useState(() =>
		createEditorWorkspace(
			source,
			validation,
			featureSubstitutions,
			collaboration?.publish,
			() => collaboration?.session().role !== `viewer`,
		),
	)

	useEffect(() => {
		workspace.actions.setFeatureSubstitutions(featureSubstitutions ?? [])
	}, [featureSubstitutions, workspace])
	const applyingSource = useRef(false)
	const currentSource = useRef(source)

	useEffect(() => {
		if (collaboration === undefined) return
		return collaboration.subscribe({
			apply(command): void {
				workspace.font.applyDocumentCommand(command)
			},
			load(base, actions): void {
				applyingSource.current = true
				try {
					workspace.actions.replaceSource(base)
					for (const command of actions) {
						workspace.font.applyDocumentCommand(command)
					}
					currentSource.current = workspace.font.read.editorSource() ?? base
				} finally {
					applyingSource.current = false
				}
			},
		})
	}, [collaboration, workspace])

	useEffect(() => {
		return workspace.startBrowserNavigation()
	}, [workspace])

	useEffect(() => {
		return () => {
			workspace.dispose()
		}
	}, [workspace])

	useEffect(() => {
		const stopBrowserFont = startBrowserLiveFont(
			workspace.font.silo,
			workspace.liveFont.compilation,
			workspace.liveFont.active,
			workspace.liveFont.family,
		)
		return () => {
			stopBrowserFont()
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
		const flush = (): void => {
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
		const persistence = createSourcePersistenceScheduler(flush)
		const unsubscribe = workspace.font.silo.subscribe(
			workspace.font.atoms.documentRevision,
			() => {
				if (applyingSource.current) return
				const dirtySource = workspace.font.read.editorSource()
				if (dirtySource !== null) onSourceDirty?.(dirtySource)
				// Projecting the complete source is synchronous and can take longer than
				// one frame. Wait for an actual editing pause so a Pen gesture does not
				// pay that cost after every point.
				persistence.request()
			},
		)
		return () => {
			unsubscribe()
			persistence.cancel()
		}
	}, [onSourceChange, onSourceDirty, workspace])

	return (
		<editor-application-root className={css.class}>
			<StoreProvider store={workspace.font.silo.store}>
				<AppShell
					{...(collaboration === undefined ? {} : { collaboration })}
					workspace={workspace}
					{...(versionControl === undefined ? {} : { versionControl })}
					{...(workspaceProject === undefined ? {} : { workspaceProject })}
				/>
			</StoreProvider>
		</editor-application-root>
	)
}
