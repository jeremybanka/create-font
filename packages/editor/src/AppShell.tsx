import { MagnifyingGlassIcon } from "@radix-ui/react-icons"
import { useCallback, useEffect, useRef, useState } from "preact/hooks"

import {
	assignPaletteCommandToHotbar,
	DEFAULT_HOTBAR_SLOTS,
	HOTBAR_STORAGE_KEY,
	parseHotbarSlots,
	type HotbarSlots,
} from "./action-hotbar.ts"
import { ActionHotbar } from "./ActionHotbar.tsx"
import {
	isCommandPaletteKeyboardEvent,
	type PaletteCommand,
} from "./command-palette.ts"
import { AppAnchor } from "./AppAnchor.tsx"
import { CommandPalette } from "./CommandPalette.tsx"
import { useEditorDocumentMetadata } from "./document-metadata.ts"
import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	formatHotkey,
	IS_MAC_LIKE,
	MOD_KEY_LABEL,
	type ToolContext,
	TOOLS,
	toolDisabledReason,
	useHotkeys,
} from "./editor-tools-and-hotkeys.ts"
import css from "./AppShell.module.css"
import { FontInfo } from "./FontInfo.tsx"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphLibrary } from "./GlyphLibrary.tsx"
import { masterPaletteCommands } from "./master-commands.ts"
import {
	useO,
	useOF,
	useOptionalOF,
	useOptionalTL,
	useTimeline,
} from "./state-hooks.ts"
import { selectionProportionPaletteCommand } from "./selection-proportions.ts"
import {
	TilingWorkspace,
	type TilingWorkspaceStatus,
} from "./TilingWorkspace.tsx"
import { visualDebugPaletteCommands } from "./visual-debug.ts"
import type { EditorVersionControl } from "./version-control.ts"

const svg = {
	MagnifyingGlass: MagnifyingGlassIcon,
}

export interface AppShellProps {
	readonly workspace: EditorWorkspace
	readonly versionControl?: EditorVersionControl
}

function readInitialHotbarSlots(): HotbarSlots {
	if (typeof window === "undefined") return DEFAULT_HOTBAR_SLOTS
	try {
		return (
			parseHotbarSlots(localStorage.getItem(HOTBAR_STORAGE_KEY)) ??
			DEFAULT_HOTBAR_SLOTS
		)
	} catch {
		return DEFAULT_HOTBAR_SLOTS
	}
}

export function AppShell({ workspace, versionControl }: AppShellProps) {
	const [addingGlyphs, setAddingGlyphs] = useState(false)
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
	const [hotbarSlots, setHotbarSlots] = useState(readInitialHotbarSlots)
	const [diffView, setDiffView] = useState(false)
	const [tilingStatus, setTilingStatus] = useState<TilingWorkspaceStatus>({
		dirty: false,
		management: false,
	})
	const commandCenterRef = useRef<HTMLButtonElement>(null)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const masterIds = useO(workspace.font.atoms.masterIds)
	const glyph = useOptionalOF(
		workspace.font.selectors.editorGlyphSource,
		activeGlyphId,
	)
	const master = useOF(workspace.font.atoms.master, activeMasterId)
	const names = useO(workspace.font.atoms.names) ?? workspace.document.names
	const validation = useO(workspace.ui.validation)
	const activeLayer = useO(workspace.ui.activeLayer)
	const activeTool = useO(workspace.ui.activeTool)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const selection = useO(workspace.ui.selection)
	const routeName = useO(workspace.ui.routeName)
	const previewText = useO(workspace.ui.previewText)
	const faviconPreview = useO(workspace.ui.faviconPreview)
	const visualDebug = useO(workspace.ui.visualDebug)
	const constrainProportions = useO(workspace.ui.constrainProportions)
	const glyphHistory = useOptionalTL(
		workspace.font.glyphHistoryTimelines,
		activeGlyphId,
		workspace.font.actions.markDocumentChanged,
	)
	const kerningHistory = useTimeline(
		workspace.font.kerningTimeline,
		workspace.font.actions.markDocumentChanged,
	)
	const activeKerningPair = useO(workspace.ui.activeKerningPair)
	const history = activeKerningPair === null ? glyphHistory : kerningHistory
	const toolContext: ToolContext = {
		activeGlyphId,
		activeLayer,
		activeMasterId,
		activeTool,
		editingTextIndex,
		history,
		selection,
		workspace,
	}
	useEditorDocumentMetadata(faviconPreview, routeName, previewText)
	useHotkeys(toolContext, routeName === "canvas" && !tilingStatus.management)
	const updateTilingStatus = useCallback((status: TilingWorkspaceStatus) => {
		setTilingStatus((current) =>
			current.dirty === status.dirty && current.management === status.management
				? current
				: status,
		)
	}, [])
	const openCommandPalette = (): void => {
		setAddingGlyphs(false)
		setCommandPaletteOpen(true)
	}
	const closeCommandPalette = (): void => {
		setCommandPaletteOpen(false)
		requestAnimationFrame(() => commandCenterRef.current?.focus())
	}

	useEffect(() => {
		try {
			localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(hotbarSlots))
		} catch {
			// Hotbar persistence is best-effort in restricted browsing contexts.
		}
	}, [hotbarSlots])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (
				tilingStatus.management ||
				!isCommandPaletteKeyboardEvent(event, IS_MAC_LIKE)
			)
				return
			event.preventDefault()
			openCommandPalette()
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [tilingStatus.management])

	const commands: readonly PaletteCommand[] = [
		{
			id: "toggle-diff-view",
			displayName: "Toggle Diff View",
			category: "Version Control",
			description: "Compare the active glyph with the selected baseline.",
			icon: "CircleIcon",
			keywords: ["git", "changes", "review", "baseline"],
			checked: diffView,
			disabled: versionControl?.comparison === undefined,
			disabledReason: "Load a version-control comparison first.",
			do: () => setDiffView((enabled) => !enabled),
		},
		{
			id: "add-glyphs",
			displayName: "Add glyphs",
			category: "Glyphs",
			description: "Add one or more glyphs to the font.",
			icon: "PlusIcon",
			keywords: ["new", "create", "character"],
			do: () => {
				workspace.actions.navigate("/glyphs")
				setAddingGlyphs(true)
			},
		},
		...masterPaletteCommands(
			masterIds.length,
			workspace.actions.selectPreviousMaster,
			workspace.actions.selectNextMaster,
		),
		...Object.values(TOOLS).map((tool) => {
			const editingTool = [
				"select",
				"pen",
				"rect",
				"ellipse",
				"knife",
				"transform",
			].includes(tool.id)
			return {
				id: tool.id,
				displayName: editingTool
					? `${tool.displayName} tool`
					: tool.displayName,
				category: editingTool ? "Tools" : "Edit",
				description: tool.description,
				icon: tool.icon,
				keywords: [tool.id],
				shortcut: formatHotkey(tool.hotkey).join("+"),
				checked: tool.status(toolContext) === "active",
				disabled:
					routeName !== "canvas" || tool.status(toolContext) === "disabled",
				disabledReason:
					routeName !== "canvas"
						? "Open the canvas to use this editor command."
						: toolDisabledReason(tool, toolContext),
				do: () => tool.do(toolContext),
			}
		}),
		selectionProportionPaletteCommand(
			constrainProportions,
			workspace.actions.toggleConstrainProportions,
		),
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
						<svg.MagnifyingGlass aria-hidden="true" />
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
					<editor-workspace>
						<GlyphCanvas
							workspace={workspace}
							disabled={tilingStatus.management}
							diffView={diffView}
							{...(versionControl === undefined ? {} : { versionControl })}
						/>
						<ActionHotbar
							commands={commands}
							enabled={!tilingStatus.management && !commandPaletteOpen}
							paletteOpen={commandPaletteOpen}
							slots={hotbarSlots}
							onAssignCommand={(commandId, slotIndex) => {
								setHotbarSlots(
									(current) =>
										assignPaletteCommandToHotbar(
											current,
											slotIndex,
											commandId,
											"drag",
										).slots,
								)
							}}
							onOpenCommands={openCommandPalette}
							onSlotsChange={setHotbarSlots}
						/>
						<TilingWorkspace
							workspace={workspace}
							diffView={diffView}
							enabled={!commandPaletteOpen}
							onDiffViewChange={setDiffView}
							onStatusChange={updateTilingStatus}
							{...(versionControl === undefined ? {} : { versionControl })}
							onReviewGlyph={(glyphId) => {
								workspace.actions.reviewGlyph(glyphId)
								setDiffView(true)
								requestAnimationFrame(() =>
									document.querySelector<HTMLElement>("glyph-canvas")?.focus(),
								)
							}}
						/>
					</editor-workspace>
				) : routeName === "glyphs" ? (
					<GlyphLibrary
						workspace={workspace}
						addingGlyphs={addingGlyphs}
						onAddingGlyphsChange={setAddingGlyphs}
						{...(versionControl === undefined ? {} : { versionControl })}
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
						? tilingStatus.management
							? "Tile management · 1–4 columns · J/K tiles · M move · A align · N new · S save · Shift+Space done"
							: `1–= Hotbar · Shift+1–4 Columns · Q Pen · R Rect · O Ellipse · K Knife · V Select · T Transform · Shift+A Align · Shift+R Reverse · Shift+H/V Invert · Shift+F Make First · Shift+Space Tiles${tilingStatus.dirty ? " (unsaved)" : ""} · ${MOD_KEY_LABEL}+Shift+P Commands`
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
					onAssign={(command, slotIndex) => {
						const assignment = assignPaletteCommandToHotbar(
							hotbarSlots,
							slotIndex,
							command.id,
							"keyboard",
						)
						setHotbarSlots(assignment.slots)
						if (assignment.closePalette) closeCommandPalette()
					}}
				/>
			) : null}
		</app-shell>
	)
}
