import { MagnifyingGlassIcon } from "@radix-ui/react-icons"
import { useEffect, useRef, useState } from "preact/hooks"

import {
	isCommandPaletteKeyboardEvent,
	type PaletteCommand,
} from "./command-palette.ts"
import { AppAnchor } from "./AppAnchor.tsx"
import { CommandPalette } from "./CommandPalette.tsx"
import { useEditorDocumentMetadata } from "./document-metadata.ts"
import { EditorIcon } from "./EditorIcon.tsx"
import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	ALT_KEY_LABEL,
	formatHotkey,
	IS_MAC_LIKE,
	MOD_KEY_LABEL,
	type ToolContext,
	TOOLS,
	TOOLBAR_LAYOUT,
	toolDisabledReason,
	useHotkeys,
} from "./editor-tools-and-hotkeys.ts"
import css from "./AppShell.module.css"
import { FontInfo } from "./FontInfo.tsx"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { GlyphLibrary } from "./GlyphLibrary.tsx"
import { useO, useOF, useTL } from "./state-hooks.ts"
import { TooltipButton } from "./TooltipButton.tsx"
import { visualDebugPaletteCommands } from "./visual-debug.ts"

export interface AppShellProps {
	readonly workspace: EditorWorkspace
}

export function AppShell({ workspace }: AppShellProps) {
	const [addingGlyphs, setAddingGlyphs] = useState(false)
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
	const commandCenterRef = useRef<HTMLButtonElement>(null)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const glyph = useOF(workspace.font.selectors.editorGlyphSource, activeGlyphId)
	const master = useOF(workspace.font.atoms.master, activeMasterId)
	const names = useO(workspace.font.atoms.names) ?? workspace.document.names
	const validation = useO(workspace.ui.validation)
	const activeLayer = useO(workspace.ui.activeLayer)
	const activeTool = useO(workspace.ui.activeTool)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const selection = useO(workspace.ui.selection)
	const routeName = useO(workspace.ui.routeName)
	const previewText = useO(workspace.ui.previewText)
	const faviconHref = useO(workspace.ui.faviconHref)
	const visualDebug = useO(workspace.ui.visualDebug)
	const history = useTL(
		workspace.font.glyphHistoryTimelines,
		activeGlyphId,
		workspace.font.actions.markDocumentChanged,
	)
	const toolContext = {
		activeGlyphId,
		activeLayer,
		activeMasterId,
		activeTool,
		editingTextIndex,
		history,
		selection,
		workspace,
	}
	useEditorDocumentMetadata(faviconHref, routeName, previewText)
	useHotkeys(toolContext, routeName === "canvas")
	const openCommandPalette = (): void => {
		setAddingGlyphs(false)
		setCommandPaletteOpen(true)
	}
	const closeCommandPalette = (): void => {
		setCommandPaletteOpen(false)
		requestAnimationFrame(() => commandCenterRef.current?.focus())
	}

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (!isCommandPaletteKeyboardEvent(event, IS_MAC_LIKE)) return
			event.preventDefault()
			openCommandPalette()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	const commands: readonly PaletteCommand[] = [
		{
			id: "add-glyphs",
			displayName: "Add glyphs",
			category: "Glyphs",
			icon: "PlusIcon",
			keywords: ["new", "create", "character"],
			do: () => {
				workspace.actions.navigate("/glyphs")
				setAddingGlyphs(true)
			},
		},
		...Object.values(TOOLS).map((tool) => ({
			id: tool.id,
			displayName:
				tool.id === "select" || tool.id === "pen" || tool.id === "transform"
					? `${tool.displayName} tool`
					: tool.displayName,
			category:
				tool.id === "select" || tool.id === "pen" || tool.id === "transform"
					? "Tools"
					: "Edit",
			icon: tool.icon,
			keywords: [tool.id],
			shortcut: formatHotkey(tool.hotkey).join("+"),
			disabled:
				routeName !== "canvas" || tool.status(toolContext) === "disabled",
			disabledReason:
				routeName !== "canvas"
					? "Open the canvas to use this editor command."
					: toolDisabledReason(tool, toolContext),
			do: () => tool.do(toolContext),
		})),
		...visualDebugPaletteCommands(visualDebug, (id) =>
			workspace.actions.toggleVisualDebug(id),
		),
	]

	const familyName = names.typographicFamily ?? names.family ?? "Untitled font"
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
						<strong>create-font</strong>
						<span>{familyName}</span>
					</project-name>
				</brand-lockup>
				<command-center>
					<button
						ref={commandCenterRef}
						type="button"
						aria-label="Open Command Palette"
						aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
						onClick={openCommandPalette}
					>
						<MagnifyingGlassIcon aria-hidden="true" />
						<strong>Commands</strong>
						<kbd>{MOD_KEY_LABEL}+Shift+P</kbd>
					</button>
				</command-center>
				<header-actions>
					<document-status
						role="status"
						aria-live="polite"
						data-state={validation.ok ? "valid" : "invalid"}
					>
						<i />
						<span>
							{validation.ok ? "Technically valid" : "Needs attention"}
						</span>
					</document-status>
					<view-tabs aria-label="Application views">
						<AppAnchor
							href="/"
							aria-current={routeName === "canvas" ? "page" : undefined}
						>
							Canvas
						</AppAnchor>
						<AppAnchor
							href="/glyphs"
							aria-current={routeName === "glyphs" ? "page" : undefined}
						>
							Glyphs
						</AppAnchor>
						<AppAnchor
							href="/info"
							aria-current={routeName === "info" ? "page" : undefined}
						>
							Font Info
						</AppAnchor>
					</view-tabs>
				</header-actions>
			</header>
			<main data-view={routeName}>
				{routeName === "canvas" ? (
					<>
						<FontNavigator workspace={workspace} />
						<editor-workspace>
							<EditorToolbar context={toolContext} />
							<GlyphCanvas workspace={workspace} />
						</editor-workspace>
						<GlyphInspector workspace={workspace} />
					</>
				) : routeName === "glyphs" ? (
					<GlyphLibrary
						workspace={workspace}
						addingGlyphs={addingGlyphs}
						onAddingGlyphsChange={setAddingGlyphs}
					/>
				) : routeName === "info" ? (
					<FontInfo workspace={workspace} />
				) : (
					<not-found-view>
						<strong>View not found</strong>
						<AppAnchor href="/">Return to the canvas</AppAnchor>
					</not-found-view>
				)}
			</main>
			<footer>
				<active-context>
					<strong>
						{routeName === "canvas"
							? (glyph?.name ?? "—")
							: routeName === "glyphs"
								? "Glyph library"
								: routeName === "info"
									? "Font info"
									: "Unknown view"}
					</strong>
					<span>
						{routeName === "canvas" ? (master?.name ?? "—") : familyName}
					</span>
				</active-context>
				<keyboard-help>
					{routeName === "canvas"
						? `Q Pen · V Select · T Transform · Shift+A Align · Shift+R Reverse · Shift+F Make First · Esc to type · Scroll to pan · ${MOD_KEY_LABEL}/${ALT_KEY_LABEL}-wheel to zoom · ${MOD_KEY_LABEL}+Shift+P Commands`
						: `${MOD_KEY_LABEL}+Shift+P Commands · Modified click opens a view in a new tab`}
				</keyboard-help>
				<format-label>
					create-font editor v{workspace.document.editorVersion}
				</format-label>
			</footer>
			{commandPaletteOpen ? (
				<CommandPalette
					commands={commands}
					onCancel={closeCommandPalette}
					onExecute={(command) => {
						setCommandPaletteOpen(false)
						command.do()
					}}
				/>
			) : null}
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
						const disabledReason = toolDisabledReason(tool, context)
						return (
							<TooltipButton
								key={tool.id}
								label={tool.displayName}
								description={tool.description}
								hotkey={tool.hotkey}
								aria-pressed={status === "active"}
								data-status={status}
								disabled={status === "disabled"}
								disabledReason={disabledReason}
								onClick={() => tool.do(context)}
							>
								<EditorIcon name={tool.icon} />
							</TooltipButton>
						)
					})}
				</tool-island>
			))}
		</editor-toolbar>
	)
}
