import { useEffect } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./AppShell.module.css"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { useO, useTimeline } from "./state-hooks.ts"

export interface AppShellProps {
	readonly workspace: EditorWorkspace
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

export function AppShell({ workspace }: AppShellProps) {
	const source = workspace.document
	const compilation = useO(workspace.font.selectors.compilation)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const history = useTimeline(workspace.font.historyFor(activeGlyphId))
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isEditableTarget(event.target)) return
			if (
				!(event.metaKey || event.ctrlKey) ||
				event.key.toLowerCase() !== "z"
			) {
				return
			}
			event.preventDefault()
			if (event.shiftKey) workspace.font.redo(activeGlyphId)
			else workspace.font.undo(activeGlyphId)
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [activeGlyphId, workspace])

	const familyName =
		source.names.typographicFamily ?? source.names.family ?? "Untitled font"
	return (
		<app-shell className={css.class}>
			<header>
				<brand-lockup>
					<brand-mark aria-hidden="true">
						<i />
						<i />
						<i />
					</brand-mark>
					<project-name>
						<strong>Trigraph</strong>
						<span>{familyName}</span>
					</project-name>
				</brand-lockup>
				<history-controls
					aria-label={`Edit history for ${glyph?.name ?? "glyph"}`}
				>
					<button
						type="button"
						title="Undo (⌘Z)"
						aria-label="Undo"
						disabled={history.at === 0}
						onClick={() => workspace.font.undo(activeGlyphId)}
					>
						<span aria-hidden="true">↶</span>
					</button>
					<button
						type="button"
						title="Redo (⇧⌘Z)"
						aria-label="Redo"
						disabled={history.at === history.length}
						onClick={() => workspace.font.redo(activeGlyphId)}
					>
						<span aria-hidden="true">↷</span>
					</button>
				</history-controls>
				<document-status
					role="status"
					aria-live="polite"
					data-state={compilation.ok ? "valid" : "invalid"}
				>
					<i />
					<span>
						{compilation.ok ? "Technically valid" : "Needs attention"}
					</span>
				</document-status>
			</header>
			<main>
				<FontNavigator workspace={workspace} />
				<editor-workspace>
					<GlyphCanvas workspace={workspace} />
				</editor-workspace>
				<GlyphInspector workspace={workspace} />
			</main>
			<footer>
				<active-context>
					<strong>{glyph?.name ?? "—"}</strong>
					<span>{master?.name ?? "—"}</span>
				</active-context>
				<keyboard-help>
					Type · Double-click to edit · Esc to type · Scroll to pan · ⌘-wheel to
					zoom
				</keyboard-help>
				<format-label>Trigraph editor v{source.editorVersion}</format-label>
			</footer>
		</app-shell>
	)
}
