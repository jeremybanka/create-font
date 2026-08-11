/* eslint-disable lasertag/render-tag-with-own-name -- Headless atom.io history boundaries intentionally return caller-owned controls without DOM wrappers. */
import { MagnifyingGlassIcon } from "@radix-ui/react-icons"
import type { GlyphId } from "@create-font/states"
import { type TimelineMeta, useO, useTL } from "atom.io/react"
import type { ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
	ALTERNATE_HOTBAR_STORAGE_KEY,
	DEFAULT_ALTERNATE_HOTBAR_SLOTS,
	DEFAULT_HOTBAR_SLOTS,
	HOTBAR_STORAGE_KEY,
} from "./action-hotbar.ts"
import {
	ActionHotbar,
	assignPaletteCommandToHotbar,
	isCommandPaletteKeyboardEvent,
	parseHotbarSlots,
	type ActionHotbarProps,
	type HotbarSlots,
	type PaletteCommand,
	UiLayoutControl,
	type TilingLayout,
	type UiLayoutRecordV1,
} from "@create-art/editor"
import { AppAnchor } from "./AppAnchor.tsx"
import { CommandPalette } from "@create-art/editor"
import { useEditorDocumentMetadata } from "./document-metadata.ts"
import { isCurvatureShortcut } from "./curvature-comb.ts"
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
import {
	DEFAULT_FONT_TILING_LAYOUT,
	FONT_TILE_REGISTRY,
	FONT_TILING_STORAGE_KEY,
	parseFontTilingLayout,
	type FontTileContext,
	type FontTileKind,
} from "./font-tile-registry.ts"
import { GlyphCanvas } from "./GlyphCanvas.tsx"
import { GlyphLibrary } from "./GlyphLibrary.tsx"
import { masterPaletteCommands } from "./master-commands.ts"
import { selectionProportionPaletteCommand } from "./selection-proportions.ts"
import {
	TilingWorkspace,
	type TileCommandRequest,
	type TilingWorkspaceStatus,
} from "@create-art/editor"
import { tileRegistryCommands } from "@create-art/editor"
import { visualDebugPaletteCommands } from "./visual-debug.ts"
import type { EditorVersionControl } from "./version-control.ts"
import type { EditorWorkspaceProject } from "./browser-api.ts"

const svg = {
	MagnifyingGlass: MagnifyingGlassIcon,
}

export interface AppShellProps {
	readonly workspace: EditorWorkspace
	readonly versionControl?: EditorVersionControl
	readonly workspaceProject?: EditorWorkspaceProject
}

interface EditorHistoryBoundaryProps {
	readonly activeGlyphId: GlyphId | null
	readonly kerningActive: boolean
	readonly render: (history: TimelineMeta | null) => ReactNode
	readonly workspace: EditorWorkspace
}

function GlyphHistoryBoundary({
	glyphId,
	render,
	workspace,
}: Pick<EditorHistoryBoundaryProps, "render" | "workspace"> & {
	readonly glyphId: GlyphId
}) {
	const history = useTL(workspace.font.glyphHistoryTimelines, glyphId)
	return render(history)
}

function KerningHistoryBoundary({
	render,
	workspace,
}: Pick<EditorHistoryBoundaryProps, "render" | "workspace">) {
	const history = useTL(workspace.font.kerningTimeline)
	return render(history)
}

function EditorHistoryBoundary({
	activeGlyphId,
	kerningActive,
	render,
	workspace,
}: EditorHistoryBoundaryProps) {
	if (kerningActive) {
		return <KerningHistoryBoundary workspace={workspace} render={render} />
	}
	if (activeGlyphId !== null) {
		return (
			<GlyphHistoryBoundary
				workspace={workspace}
				glyphId={activeGlyphId}
				render={render}
			/>
		)
	}
	return render(null)
}

function HistoryActionHotbar({
	hotkeysEnabled,
	toolContext,
	...props
}: ActionHotbarProps & {
	readonly hotkeysEnabled: boolean
	readonly toolContext: ToolContext
}) {
	useHotkeys(toolContext, hotkeysEnabled)
	return <ActionHotbar {...props} />
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

function readInitialAlternateHotbarSlots(): HotbarSlots {
	if (typeof window === "undefined") return DEFAULT_ALTERNATE_HOTBAR_SLOTS
	try {
		return (
			parseHotbarSlots(localStorage.getItem(ALTERNATE_HOTBAR_STORAGE_KEY)) ??
			DEFAULT_ALTERNATE_HOTBAR_SLOTS
		)
	} catch {
		return DEFAULT_ALTERNATE_HOTBAR_SLOTS
	}
}

function readInitialTilingLayout(): TilingLayout<FontTileKind> {
	if (typeof window === "undefined") return DEFAULT_FONT_TILING_LAYOUT
	try {
		return (
			(parseFontTilingLayout(
				localStorage.getItem(`${FONT_TILING_STORAGE_KEY}:draft:v1`),
			) as TilingLayout<FontTileKind> | null) ?? DEFAULT_FONT_TILING_LAYOUT
		)
	} catch {
		return DEFAULT_FONT_TILING_LAYOUT
	}
}

export function AppShell({
	workspace,
	versionControl,
	workspaceProject,
}: AppShellProps) {
	const [addingGlyphs, setAddingGlyphs] = useState(false)
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
	const [hotbarSlots, setHotbarSlots] = useState(readInitialHotbarSlots)
	const [alternateHotbarSlots, setAlternateHotbarSlots] = useState(
		readInitialAlternateHotbarSlots,
	)
	const [diffView, setDiffView] = useState(false)
	const [tilingLayout, setTilingLayout] = useState(readInitialTilingLayout)
	const [tilingStatus, setTilingStatus] = useState<TilingWorkspaceStatus>({
		dirty: false,
		management: false,
	})
	const [tileCommandRequest, setTileCommandRequest] =
		useState<TileCommandRequest<FontTileKind> | null>(null)
	const tileCommandSequence = useRef(0)
	const commandCenterRef = useRef<HTMLButtonElement>(null)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const masterIds = useO(workspace.font.atoms.masterIds)
	const glyph = useO(workspace.ui.activeGlyphSource)
	const master = useO(workspace.font.atoms.master, activeMasterId)
	const names = useO(workspace.font.atoms.names) ?? workspace.document.names
	const validation = useO(workspace.ui.validation)
	const activeLayer = useO(workspace.ui.activeLayer)
	const activeTool = useO(workspace.ui.activeTool)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const selection = useO(workspace.ui.selection)
	const routeName = useO(workspace.ui.routeName)
	const previewText = useO(workspace.ui.previewText)
	const uiLayout = {
		version: 1,
		id: "local",
		name: "My layout",
		product: "create-font",
		state: {
			tiling: tilingLayout,
			hotbars: { primary: hotbarSlots, alternate: alternateHotbarSlots },
			preferences: { diffView },
		},
	} satisfies UiLayoutRecordV1
	const applyUiLayout = useCallback((record: UiLayoutRecordV1) => {
		if (record.product !== "create-font") return
		setTilingLayout(record.state.tiling as TilingLayout<FontTileKind>)
		setHotbarSlots(record.state.hotbars.primary as HotbarSlots)
		setAlternateHotbarSlots(record.state.hotbars.alternate as HotbarSlots)
		setDiffView(record.state.preferences.diffView)
	}, [])
	const faviconPreview = useO(workspace.ui.faviconPreview)
	const visualDebug = useO(workspace.ui.visualDebug)
	const constrainProportions = useO(workspace.ui.constrainProportions)
	const showCurvature = useO(workspace.ui.showCurvature)
	const activeKerningPair = useO(workspace.ui.activeKerningPair)
	const toolContextForHistory = (
		history: TimelineMeta | null,
	): ToolContext => ({
		activeGlyphId,
		activeLayer,
		activeMasterId,
		activeTool,
		editingTextIndex,
		history,
		selection,
		workspace,
	})
	const fontTileContext: FontTileContext = {
		diffView,
		onDiffViewChange: setDiffView,
		onReviewGlyph: (glyphId) => {
			workspace.actions.reviewGlyph(glyphId)
			setDiffView(true)
			requestAnimationFrame(() =>
				document.querySelector<HTMLElement>("glyph-canvas")?.focus(),
			)
		},
		...(versionControl === undefined ? {} : { versionControl }),
		workspace,
	}
	useEditorDocumentMetadata(faviconPreview, routeName, previewText)
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
		try {
			localStorage.setItem(
				ALTERNATE_HOTBAR_STORAGE_KEY,
				JSON.stringify(alternateHotbarSlots),
			)
		} catch {
			// Hotbar persistence is best-effort in restricted browsing contexts.
		}
	}, [alternateHotbarSlots])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (tilingStatus.management) return
			if (isCurvatureShortcut(event, IS_MAC_LIKE)) {
				event.preventDefault()
				workspace.actions.toggleCurvature()
				return
			}
			if (isCommandPaletteKeyboardEvent(event, IS_MAC_LIKE)) {
				event.preventDefault()
				openCommandPalette()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [tilingStatus.management, workspace])

	const commandsForHistory = (
		history: TimelineMeta | null,
	): readonly PaletteCommand[] => {
		const toolContext = toolContextForHistory(history)
		return [
			{
				id: "toggle-curvature-comb",
				displayName: "Toggle Curvature Comb",
				category: "View",
				description:
					"Show a perpendicular, color-mapped visualization of cubic curvature.",
				icon: "Half2Icon",
				keywords: ["speed punk", "bezier", "continuity", "comb"],
				shortcut: `${MOD_KEY_LABEL}+Shift+X`,
				checked: showCurvature,
				disabled: routeName !== "canvas" || editingTextIndex === null,
				disabledReason:
					routeName !== "canvas"
						? "Open the canvas to use the curvature comb."
						: "Double-click a glyph to enter outline editing.",
				do: workspace.actions.toggleCurvature,
			},
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
			...tileRegistryCommands(FONT_TILE_REGISTRY, fontTileContext).map(
				(command): PaletteCommand => ({
					...command,
					do: () => {
						tileCommandSequence.current += 1
						setTileCommandRequest({
							id: tileCommandSequence.current,
							kind: command.kind,
						})
					},
				}),
			),
		]
	}

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
						{(workspaceProject?.projects.length ?? 0) < 2 ? (
							<strong>create-font</strong>
						) : (
							<label>
								<select
									aria-label="Active workspace font"
									value={workspaceProject?.id}
									onChange={(event) => {
										const select = event.currentTarget
										const source = workspace.font.read.editorSource()
										if (source !== null && workspaceProject !== undefined)
											void Promise.resolve(
												workspaceProject.onChange(
													event.currentTarget.value,
													source,
												),
											).then((switched) => {
												if (!switched) select.value = workspaceProject.id
											})
									}}
								>
									{workspaceProject?.projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name}
										</option>
									))}
								</select>
							</label>
						)}
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
					<UiLayoutControl
						product="create-font"
						current={uiLayout}
						onApply={applyUiLayout}
					/>
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
						<EditorHistoryBoundary
							activeGlyphId={activeGlyphId}
							kerningActive={activeKerningPair !== null}
							workspace={workspace}
							render={(history) => (
								<HistoryActionHotbar
									alternateSlots={alternateHotbarSlots}
									commands={commandsForHistory(history)}
									enabled={!tilingStatus.management && !commandPaletteOpen}
									hotkeysEnabled={
										routeName === "canvas" && !tilingStatus.management
									}
									paletteOpen={commandPaletteOpen}
									slots={hotbarSlots}
									toolContext={toolContextForHistory(history)}
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
									onAlternateAssignCommand={(commandId, slotIndex) => {
										setAlternateHotbarSlots(
											(current) =>
												assignPaletteCommandToHotbar(
													current,
													slotIndex,
													commandId,
													"drag",
												).slots,
										)
									}}
									onAlternateSlotsChange={setAlternateHotbarSlots}
									onOpenCommands={openCommandPalette}
									onSlotsChange={setHotbarSlots}
								/>
							)}
						/>
						<TilingWorkspace
							context={fontTileContext}
							registry={FONT_TILE_REGISTRY}
							defaultLayout={DEFAULT_FONT_TILING_LAYOUT}
							storageKey={FONT_TILING_STORAGE_KEY}
							parseLayout={parseFontTilingLayout}
							commandRequest={tileCommandRequest}
							enabled={!commandPaletteOpen}
							onStatusChange={updateTilingStatus}
							layout={tilingLayout}
							onLayoutChange={setTilingLayout}
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
				<EditorHistoryBoundary
					activeGlyphId={activeGlyphId}
					kerningActive={activeKerningPair !== null}
					workspace={workspace}
					render={(history) => (
						<CommandPalette
							commands={commandsForHistory(history)}
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
					)}
				/>
			) : null}
		</app-shell>
	)
}
