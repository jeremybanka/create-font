import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	ALT_KEY_LABEL,
	ariaKeyShortcut,
	formatHotkey,
	MOD_KEY_LABEL,
	type ToolContext,
	TOOLBAR_LAYOUT,
	useHotkeys,
} from "./editor-tools-and-hotkeys.ts"
import css from "./AppShell.module.css"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { useO, useTL } from "./state-hooks.ts"

export interface AppShellProps {
	readonly workspace: EditorWorkspace
}

export function AppShell({ workspace }: AppShellProps) {
	const source =
		useO(workspace.font.selectors.editorSource) ?? workspace.document
	const compilation = useO(workspace.font.selectors.compilation)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const activeTool = useO(workspace.ui.activeTool)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const history = useTL(workspace.font.glyphHistoryTimelines, activeGlyphId)
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	const toolContext = {
		activeGlyphId,
		activeTool,
		editingTextIndex,
		history,
		workspace,
	}
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
					<EditorToolbar context={toolContext} />
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
					Q Pen · V Select · Esc to type · Scroll to pan ·
					{` ${MOD_KEY_LABEL}/${ALT_KEY_LABEL}-wheel to zoom`}
				</keyboard-help>
				<format-label>Trigraph editor v{source.editorVersion}</format-label>
			</footer>
		</app-shell>
	)
}

function EditorToolbar({ context }: { readonly context: ToolContext }) {
	return (
		<editor-toolbar aria-label="Editor tools">
			{TOOLBAR_LAYOUT.map((tools) => (
				<tool-island key={tools.map((tool) => tool.id).join("-")}>
					{tools.map((tool) => {
						const status = tool.status(context)
						const hotkey = formatHotkey(tool.hotkey).join("+")
						return (
							<button
								key={tool.id}
								type="button"
								title={`${tool.displayName} (${hotkey})`}
								aria-label={tool.displayName}
								aria-keyshortcuts={ariaKeyShortcut(tool.hotkey)}
								aria-pressed={status === "active"}
								data-status={status}
								disabled={status === "disabled"}
								onClick={() => tool.do(context)}
							>
								<span aria-hidden="true">{tool.icon}</span>
							</button>
						)
					})}
				</tool-island>
			))}
		</editor-toolbar>
	)
}
