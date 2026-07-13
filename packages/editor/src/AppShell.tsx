import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	ariaKeyShortcut,
	formatHotkey,
	MOD_KEY_LABEL,
	TOOLBAR_LAYOUT,
	useHotkeys,
} from "./editor-tools-and-hotkeys.ts"
import css from "./AppShell.module.css"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { useO, useTimeline } from "./state-hooks.ts"

export interface AppShellProps {
	readonly workspace: EditorWorkspace
}

export function AppShell({ workspace }: AppShellProps) {
	const source = workspace.document
	const compilation = useO(workspace.font.selectors.compilation)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const history = useTimeline(workspace.font.historyFor(activeGlyphId))
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	const toolContext = { activeGlyphId, history, workspace }
	useHotkeys(toolContext)

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
					{TOOLBAR_LAYOUT.flat().map((tool) => {
						const hotkey = formatHotkey(tool.hotkey).join("+")
						return (
							<button
								key={tool.id}
								type="button"
								title={`${tool.displayName} (${hotkey})`}
								aria-label={tool.displayName}
								aria-keyshortcuts={ariaKeyShortcut(tool.hotkey)}
								disabled={tool.status(toolContext) === "disabled"}
								onClick={() => tool.do(toolContext)}
							>
								<span aria-hidden="true">{tool.icon}</span>
							</button>
						)
					})}
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
					Type · Double-click to edit · Esc to type · Scroll to pan ·
					{` ${MOD_KEY_LABEL}-wheel to zoom`}
				</keyboard-help>
				<format-label>Trigraph editor v{source.editorVersion}</format-label>
			</footer>
		</app-shell>
	)
}
