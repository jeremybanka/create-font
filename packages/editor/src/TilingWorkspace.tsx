import {
	BookmarkFilledIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	Cross2Icon,
	DragHandleDots2Icon,
	EnterFullScreenIcon,
	ExitFullScreenIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	QuestionMarkCircledIcon,
} from "@radix-ui/react-icons"
import {
	useCallback,
	useEffect,
	useReducer,
	useRef,
	useState,
} from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { CanvasToolbar } from "./CanvasToolbar.tsx"
import { CompatibilityTile } from "./CompatibilityTile.tsx"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { PreviewTile } from "./PreviewTile.tsx"
import { KerningTile } from "./KerningTile.tsx"
import { SelectionDimensions } from "./SelectionDimensions.tsx"
import { VersionControlTile } from "./VersionControlTile.tsx"
import type { EditorVersionControl } from "./version-control.ts"
import css from "./TilingWorkspace.module.css"
import {
	addTile,
	columnHitSurface,
	columnOverflowState,
	columnSlotAllocation,
	createDefaultTilingLayout,
	createTilingHistory,
	duplicateTile,
	editTilingHistory,
	findTile,
	hotbarClearanceForColumn,
	moveTile,
	moveTileBy,
	moveTileToEdge,
	parseTilingLayout,
	redoTilingHistory,
	removeTile,
	serializeTilingLayout,
	setColumnAlignment,
	setTileFill,
	scrollbarScrollTopFromPointer,
	TILING_DRAFT_STORAGE_KEY,
	TILING_SAVED_STORAGE_KEY,
	toggleColumnCollapsed,
	visibleColumnIds,
	type ColumnOverflowState,
	type TileColumn,
	type TileColumnId,
	type TileInstance,
	type TileKind,
	type TilingHistory,
	type TilingLayout,
	undoTilingHistory,
} from "./tiling-workspace.ts"

export interface TilingWorkspaceStatus {
	readonly dirty: boolean
	readonly management: boolean
}

export interface TilingWorkspaceProps {
	readonly diffView?: boolean
	readonly workspace: EditorWorkspace
	readonly enabled?: boolean
	readonly onStatusChange?: (status: TilingWorkspaceStatus) => void
	readonly onReviewGlyph?: Parameters<
		typeof VersionControlTile
	>[0]["onReviewGlyph"]
	readonly onDiffViewChange?: Parameters<
		typeof VersionControlTile
	>[0]["onDiffViewChange"]
	readonly versionControl?: EditorVersionControl
}

interface TileDefinition {
	readonly kind: TileKind
	readonly name: string
	readonly description: string
}

interface TileShortcut {
	readonly keys: string
	readonly action: string
}

type PendingCommand = "move" | "align" | null
type DragPayload =
	| { readonly type: "tile"; readonly tileId: string }
	| { readonly type: "pool"; readonly kind: TileKind }

type HistoryAction =
	| { readonly type: "edit"; readonly layout: TilingLayout }
	| { readonly type: "replace"; readonly layout: TilingLayout }
	| { readonly type: "undo" }
	| { readonly type: "redo" }

const TILE_DEFINITIONS: readonly TileDefinition[] = [
	{
		kind: "version-control",
		name: "Version Control",
		description: "Review and commit discrete working-source changes.",
	},
	{
		kind: "font-navigation",
		name: "Masters & instances",
		description: "Navigate font masters and named instances.",
	},
	{
		kind: "canvas-toolbar",
		name: "Canvas toolbar",
		description: "Control design-space coordinates and the canvas viewport.",
	},
	{
		kind: "kerning",
		name: "Kerning",
		description: "Inspect and edit the glyph pair at the text cursor.",
	},
	{
		kind: "preview",
		name: "Preview",
		description: "Proof custom text, samples, and variation settings.",
	},
	{
		kind: "compatibility",
		name: "Master compatibility",
		description: "Compare master topology, offset overlays, and reorder paths.",
	},
	{
		kind: "glyph-attributes",
		name: "Glyph attributes",
		description: "Inspect glyph metrics, selection, and preview state.",
	},
	{
		kind: "selection-dimensions",
		name: "Selection dimensions",
		description: "Inspect and transform a selection from nine origins.",
	},
]

const TILE_SHORTCUTS: readonly TileShortcut[] = [
	{ keys: "⇧ Space", action: "Enter or exit management" },
	{ keys: "⇧ 1–4", action: "Toggle column outside management" },
	{ keys: "1–4", action: "Select column or destination" },
	{ keys: "J / K · ↓ / ↑", action: "Select next or previous tile" },
	{ keys: "⇧ J / ⇧ K", action: "Reorder selected tile" },
	{ keys: "G / ⇧ G", action: "Move tile to top or bottom" },
	{ keys: "M → 1–4", action: "Move tile to column" },
	{ keys: "A → T / B", action: "Pack column top or bottom" },
	{ keys: "C", action: "Collapse or expand column" },
	{ keys: "F", action: "Toggle fill affinity" },
	{ keys: "N", action: "Focus tile pool" },
	{ keys: "↑ / ↓ · Enter", action: "Choose and add tile from pool" },
	{ keys: "D", action: "Duplicate selected tile" },
	{ keys: "X · Del · ⌫", action: "Remove selected tile" },
	{ keys: "⌘/Ctrl Z", action: "Undo layout edit" },
	{ keys: "⌘/Ctrl ⇧ Z", action: "Redo layout edit" },
	{ keys: "S", action: "Save workspace" },
	{ keys: "R", action: "Revert to saved workspace" },
	{ keys: "?", action: "Toggle keyboard help" },
	{ keys: "Esc", action: "Cancel pending command" },
]

const LEFT_COLUMNS = [1, 2] as const
const RIGHT_COLUMNS = [3, 4] as const
const ALL_COLUMNS = [1, 2, 3, 4] as const

function historyReducer(
	history: TilingHistory,
	action: HistoryAction,
): TilingHistory {
	switch (action.type) {
		case "edit":
			return editTilingHistory(history, action.layout)
		case "replace":
			return createTilingHistory(action.layout)
		case "undo":
			return undoTilingHistory(history)
		case "redo":
			return redoTilingHistory(history)
	}
}

function readInitialState(): {
	readonly history: TilingHistory
	readonly saved: string
} {
	const fallback = createDefaultTilingLayout()
	if (typeof window === "undefined") {
		return {
			history: createTilingHistory(fallback),
			saved: serializeTilingLayout(fallback),
		}
	}
	try {
		const saved =
			parseTilingLayout(localStorage.getItem(TILING_SAVED_STORAGE_KEY)) ??
			fallback
		const draft = parseTilingLayout(
			localStorage.getItem(TILING_DRAFT_STORAGE_KEY),
		)
		return {
			history: createTilingHistory(draft ?? saved),
			saved: serializeTilingLayout(saved),
		}
	} catch {
		return {
			history: createTilingHistory(fallback),
			saved: serializeTilingLayout(fallback),
		}
	}
}

function isColumnId(value: number): value is TileColumnId {
	return value === 1 || value === 2 || value === 3 || value === 4
}

function tileName(kind: TileKind): string {
	return (
		TILE_DEFINITIONS.find((definition) => definition.kind === kind)?.name ??
		kind
	)
}

function matchesTypeahead(query: string, value: string): boolean {
	let previous = -1
	for (const character of query) {
		const index = value.indexOf(character, previous + 1)
		if (index < 0) return false
		previous = index
	}
	return true
}

function filterTileDefinitions(query: string): readonly TileDefinition[] {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (tokens.length === 0) return TILE_DEFINITIONS
	return TILE_DEFINITIONS.filter((definition) => {
		const searchable =
			`${definition.name} ${definition.description} ${definition.kind}`
				.toLowerCase()
				.replaceAll("-", " ")
		return tokens.every((token) => matchesTypeahead(token, searchable))
	})
}

export function TilingWorkspace({
	workspace,
	diffView = false,
	enabled = true,
	onDiffViewChange = () => undefined,
	onStatusChange,
	onReviewGlyph = () => undefined,
	versionControl,
}: TilingWorkspaceProps) {
	const [initial] = useState(readInitialState)
	const [history, dispatch] = useReducer(historyReducer, initial.history)
	const [saved, setSaved] = useState(initial.saved)
	const [management, setManagement] = useState(false)
	const [selectedColumn, setSelectedColumn] = useState<TileColumnId>(3)
	const [activeLeft, setActiveLeft] = useState<1 | 2>(1)
	const [activeRight, setActiveRight] = useState<3 | 4>(3)
	const [selectedTileId, setSelectedTileId] = useState<string | null>(
		"canvas-toolbar:default",
	)
	const [pending, setPending] = useState<PendingCommand>(null)
	const [poolFocused, setPoolFocused] = useState(false)
	const [poolQuery, setPoolQuery] = useState("")
	const [poolIndex, setPoolIndex] = useState(0)
	const [helpOpen, setHelpOpen] = useState(false)
	const [viewportWidth, setViewportWidth] = useState(() =>
		typeof window === "undefined" ? 1_200 : window.innerWidth,
	)
	const [dragging, setDragging] = useState(false)
	const [columnClearance, setColumnClearance] = useState<
		Partial<Record<TileColumnId, number>>
	>({})
	const [columnOverflow, setColumnOverflow] = useState<
		Partial<Record<TileColumnId, ColumnOverflowState>>
	>({})
	const dragPayload = useRef<DragPayload | null>(null)
	const poolInputRef = useRef<HTMLInputElement>(null)
	const workspaceRef = useRef<HTMLElement>(null)
	const columnRefs = useRef(new Map<TileColumnId, HTMLElement>())
	const scrollRefs = useRef(new Map<TileColumnId, HTMLElement>())
	const scrollbarRefs = useRef(new Map<TileColumnId, HTMLElement>())
	const scrollbarDrag = useRef<{
		readonly columnId: TileColumnId
		readonly pointerId: number
		readonly grabOffset: number
	} | null>(null)
	const layout = history.present
	const dirty = serializeTilingLayout(layout) !== saved
	const allocation = columnSlotAllocation(viewportWidth)
	const visibleColumns = visibleColumnIds(
		allocation,
		activeLeft,
		activeRight,
		selectedColumn,
	)
	const filteredTileDefinitions = filterTileDefinitions(poolQuery)
	const activeTileDefinition = filteredTileDefinitions[poolIndex]

	const selectColumn = (columnId: TileColumnId): void => {
		setSelectedColumn(columnId)
		if (columnId === 1 || columnId === 2) setActiveLeft(columnId)
		else setActiveRight(columnId)
		const column = layout.columns.find((item) => item.id === columnId)
		if (!column?.tiles.some((tile) => tile.id === selectedTileId)) {
			setSelectedTileId(column?.tiles[0]?.id ?? null)
		}
	}

	const applyEdit = (next: TilingLayout, nextTileId?: string | null): void => {
		dispatch({ type: "edit", layout: next })
		if (nextTileId !== undefined) setSelectedTileId(nextTileId)
	}

	const addTileToColumn = (
		kind: TileKind,
		columnId: TileColumnId,
		beforeTileId?: string,
	): void => {
		const added = addTile(layout, kind, columnId, beforeTileId)
		applyEdit(added.layout, added.tileId)
		selectColumn(columnId)
		setSelectedTileId(added.tileId)
		setPoolFocused(false)
		setPoolQuery("")
	}

	const moveSelectedTile = (columnId: TileColumnId): void => {
		if (selectedTileId === null) return
		applyEdit(moveTile(layout, selectedTileId, columnId), selectedTileId)
		selectColumn(columnId)
		setSelectedTileId(selectedTileId)
	}

	const deleteTile = (tileId: string): void => {
		const found = findTile(layout, tileId)
		if (found === null) return
		const column = layout.columns.find((item) => item.id === found.columnId)
		const nextTile =
			column?.tiles[found.index + 1] ?? column?.tiles[found.index - 1] ?? null
		applyEdit(
			removeTile(layout, tileId),
			selectedTileId === tileId ? (nextTile?.id ?? null) : selectedTileId,
		)
	}

	const save = (): void => {
		const serialized = serializeTilingLayout(layout)
		try {
			localStorage.setItem(TILING_SAVED_STORAGE_KEY, serialized)
			localStorage.setItem(TILING_DRAFT_STORAGE_KEY, serialized)
		} catch {
			// Saving still establishes the in-memory baseline when storage is unavailable.
		}
		setSaved(serialized)
	}

	const revert = (): void => {
		const savedLayout = parseTilingLayout(saved)
		if (savedLayout === null) return
		dispatch({ type: "replace", layout: savedLayout })
		setSelectedTileId(
			savedLayout.columns.find((column) => column.id === selectedColumn)
				?.tiles[0]?.id ?? null,
		)
	}

	const toggleManagement = (): void => {
		if (!enabled && !management) return
		setManagement((active) => !active)
		setPoolFocused(false)
		setPoolQuery("")
		setHelpOpen(false)
		setPending(null)
	}

	useEffect(() => {
		const handleResize = (): void => setViewportWidth(window.innerWidth)
		window.addEventListener("resize", handleResize)
		return () => window.removeEventListener("resize", handleResize)
	}, [])

	const measureColumnClearance = useCallback((): void => {
		if (management) {
			setColumnClearance((current) =>
				Object.keys(current).length === 0 ? current : {},
			)
			return
		}
		const root = workspaceRef.current
		const hotbar = document.querySelector<HTMLElement>("action-hotbar")
		if (root === null || hotbar === null) return
		const hotbarBounds = hotbar.getBoundingClientRect()
		const workspaceBounds = root.getBoundingClientRect()
		const next: Partial<Record<TileColumnId, number>> = {}
		for (const columnId of visibleColumns) {
			const column = columnRefs.current.get(columnId)
			if (column === undefined) continue
			const clearance = hotbarClearanceForColumn(
				column.getBoundingClientRect(),
				hotbarBounds,
				workspaceBounds.bottom,
			)
			if (clearance > 0) next[columnId] = clearance
		}
		setColumnClearance((current) => {
			for (const id of ALL_COLUMNS) {
				if ((current[id] ?? 0) !== (next[id] ?? 0)) return next
			}
			return current
		})
	}, [activeLeft, activeRight, management, selectedColumn, viewportWidth])

	const measureColumnOverflow = useCallback((): void => {
		const next: Partial<Record<TileColumnId, ColumnOverflowState>> = {}
		for (const columnId of visibleColumns) {
			const scroll = scrollRefs.current.get(columnId)
			if (scroll === undefined) continue
			next[columnId] = columnOverflowState(scroll)
			const scrollbar = scrollbarRefs.current.get(columnId)
			if (scrollbar !== undefined) {
				const maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
				const thumbRatio =
					scroll.scrollHeight <= 0
						? 1
						: Math.max(0.12, scroll.clientHeight / scroll.scrollHeight)
				const progress = maximum <= 0 ? 0 : scroll.scrollTop / maximum
				const thumbHeight = Math.max(18, scrollbar.clientHeight * thumbRatio)
				const thumbTop =
					progress * Math.max(0, scrollbar.clientHeight - thumbHeight)
				scrollbar.style.setProperty("--scroll-thumb-height", `${thumbHeight}px`)
				scrollbar.style.setProperty("--scroll-thumb-top", `${thumbTop}px`)
				scrollbar.setAttribute("aria-valuemax", String(Math.round(maximum)))
				scrollbar.setAttribute(
					"aria-valuenow",
					String(Math.round(scroll.scrollTop)),
				)
			}
		}
		setColumnOverflow((current) => {
			for (const id of ALL_COLUMNS) {
				if (current[id] !== next[id]) return next
			}
			return current
		})
	}, [activeLeft, activeRight, selectedColumn, viewportWidth])

	const scrollColumnFromPointer = (
		event: PointerEvent,
		columnId: TileColumnId,
		grabOffset: number,
	): void => {
		const scroll = scrollRefs.current.get(columnId)
		if (scroll === undefined) return
		const track = event.currentTarget
		if (!(track instanceof HTMLElement)) return
		const bounds = track.getBoundingClientRect()
		const thumb = track.firstElementChild
		if (!(thumb instanceof HTMLElement)) return
		scroll.scrollTop = scrollbarScrollTopFromPointer({
			pointerPosition: event.clientY,
			trackStart: bounds.top,
			trackSize: bounds.height,
			thumbSize: thumb.getBoundingClientRect().height,
			maximum: scroll.scrollHeight - scroll.clientHeight,
			grabOffset,
		})
		measureColumnOverflow()
	}

	const scrollColumnFromKeyboard = (
		event: KeyboardEvent,
		columnId: TileColumnId,
	): void => {
		const scroll = scrollRefs.current.get(columnId)
		if (scroll === undefined) return
		const maximum = scroll.scrollHeight - scroll.clientHeight
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? maximum
					: event.key === "PageUp"
						? scroll.scrollTop - scroll.clientHeight
						: event.key === "PageDown"
							? scroll.scrollTop + scroll.clientHeight
							: event.key === "ArrowUp"
								? scroll.scrollTop - 40
								: event.key === "ArrowDown"
									? scroll.scrollTop + 40
									: null
		if (next === null) return
		event.preventDefault()
		scroll.scrollTop = Math.max(0, Math.min(maximum, next))
		measureColumnOverflow()
	}

	useEffect(() => {
		const frame = requestAnimationFrame(measureColumnClearance)
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measureColumnClearance)
		const root = workspaceRef.current
		const hotbar = document.querySelector<HTMLElement>("action-hotbar")
		if (root !== null) observer?.observe(root)
		if (hotbar !== null) observer?.observe(hotbar)
		for (const column of columnRefs.current.values()) observer?.observe(column)
		return () => {
			cancelAnimationFrame(frame)
			observer?.disconnect()
		}
	}, [layout, measureColumnClearance])

	useEffect(() => {
		const frame = requestAnimationFrame(measureColumnOverflow)
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measureColumnOverflow)
		for (const scroll of scrollRefs.current.values()) {
			observer?.observe(scroll)
			const stack = scroll.firstElementChild
			if (stack instanceof HTMLElement) observer?.observe(stack)
		}
		return () => {
			cancelAnimationFrame(frame)
			observer?.disconnect()
		}
	}, [columnClearance, columnOverflow, layout, measureColumnOverflow])

	useEffect(() => {
		try {
			localStorage.setItem(
				TILING_DRAFT_STORAGE_KEY,
				serializeTilingLayout(layout),
			)
		} catch {
			// Recovery is best-effort in restricted or private browsing contexts.
		}
	}, [layout])

	useEffect(() => {
		if (selectedTileId === null) return
		const selected = findTile(layout, selectedTileId)
		if (selected !== null) {
			if (selected.columnId !== selectedColumn) {
				setSelectedColumn(selected.columnId)
				if (selected.columnId === 1 || selected.columnId === 2) {
					setActiveLeft(selected.columnId)
				} else {
					setActiveRight(selected.columnId)
				}
			}
			return
		}
		setSelectedTileId(
			layout.columns.find((column) => column.id === selectedColumn)?.tiles[0]
				?.id ?? null,
		)
	}, [layout, selectedColumn, selectedTileId])

	useEffect(() => {
		onStatusChange?.({ dirty, management })
	}, [dirty, management, onStatusChange])

	useEffect(() => {
		if (enabled || !management) return
		setManagement(false)
		setPending(null)
		setPoolFocused(false)
		setPoolQuery("")
		setHelpOpen(false)
	}, [enabled, management])

	useEffect(() => {
		if (!poolFocused) return
		const frame = requestAnimationFrame(() => {
			poolInputRef.current?.focus()
			poolInputRef.current?.select()
		})
		return () => cancelAnimationFrame(frame)
	}, [poolFocused])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			const digit = event.code.startsWith("Digit")
				? Number(event.code.slice("Digit".length))
				: Number.NaN
			const isModeToggle =
				event.code === "Space" &&
				event.shiftKey &&
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey
			if (isModeToggle) {
				event.preventDefault()
				event.stopImmediatePropagation()
				toggleManagement()
				return
			}
			const editableTarget =
				event.target instanceof HTMLInputElement ||
				event.target instanceof HTMLTextAreaElement ||
				event.target instanceof HTMLSelectElement ||
				(event.target instanceof HTMLElement && event.target.isContentEditable)
			if (
				enabled &&
				!management &&
				event.shiftKey &&
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				!editableTarget &&
				isColumnId(digit)
			) {
				event.preventDefault()
				event.stopImmediatePropagation()
				selectColumn(digit)
				applyEdit(toggleColumnCollapsed(layout, digit))
				return
			}
			if (!management) return
			if (event.target === poolInputRef.current) return
			event.stopImmediatePropagation()

			if (
				isColumnId(digit) &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault()
				if (pending === "move") {
					moveSelectedTile(digit)
					setPending(null)
				} else if (poolFocused) {
					if (activeTileDefinition !== undefined)
						addTileToColumn(activeTileDefinition.kind, digit)
				} else {
					selectColumn(digit)
				}
				return
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault()
				dispatch({ type: event.shiftKey ? "redo" : "undo" })
				return
			}
			if (event.metaKey || event.ctrlKey || event.altKey) return

			const key = event.key.toLowerCase()
			if (pending === "align" && (key === "t" || key === "b")) {
				event.preventDefault()
				applyEdit(
					setColumnAlignment(
						layout,
						selectedColumn,
						key === "t" ? "top" : "bottom",
					),
				)
				setPending(null)
				return
			}
			if (event.key === "Escape") {
				event.preventDefault()
				if (helpOpen) setHelpOpen(false)
				else {
					setPending(null)
					setPoolFocused(false)
					setPoolQuery("")
				}
				return
			}
			if (event.key === "?") {
				event.preventDefault()
				setHelpOpen((open) => !open)
				setPoolFocused(false)
				setPoolQuery("")
				setPending(null)
				return
			}
			if (key === "n") {
				event.preventDefault()
				setPoolFocused(true)
				setPoolQuery("")
				setPoolIndex(0)
				setHelpOpen(false)
				setPending(null)
				return
			}
			if (key === "m") {
				event.preventDefault()
				setPending("move")
				setPoolFocused(false)
				return
			}
			if (key === "a") {
				event.preventDefault()
				setPending("align")
				setPoolFocused(false)
				return
			}
			if (
				key === "j" ||
				event.key === "ArrowDown" ||
				key === "k" ||
				event.key === "ArrowUp"
			) {
				event.preventDefault()
				const column = layout.columns.find((item) => item.id === selectedColumn)
				if (column === undefined || column.tiles.length === 0) return
				const direction = key === "j" || event.key === "ArrowDown" ? 1 : -1
				const index = column.tiles.findIndex(
					(tile) => tile.id === selectedTileId,
				)
				if (event.shiftKey && selectedTileId !== null) {
					applyEdit(
						moveTileBy(layout, selectedTileId, direction),
						selectedTileId,
					)
				} else {
					const next = Math.max(
						0,
						Math.min(
							column.tiles.length - 1,
							(index < 0 ? 0 : index) + direction,
						),
					)
					setSelectedTileId(column.tiles[next]?.id ?? null)
				}
				return
			}
			if (key === "g" && selectedTileId !== null) {
				event.preventDefault()
				applyEdit(
					moveTileToEdge(
						layout,
						selectedTileId,
						event.shiftKey ? "bottom" : "top",
					),
					selectedTileId,
				)
				return
			}
			if (key === "c") {
				event.preventDefault()
				applyEdit(toggleColumnCollapsed(layout, selectedColumn))
				return
			}
			if (key === "f" && selectedTileId !== null) {
				event.preventDefault()
				const tile = findTile(layout, selectedTileId)?.tile
				if (tile !== undefined)
					applyEdit(setTileFill(layout, tile.id, !tile.fill), tile.id)
				return
			}
			if (key === "d" && selectedTileId !== null) {
				event.preventDefault()
				const duplicated = duplicateTile(layout, selectedTileId)
				if (duplicated !== null) applyEdit(duplicated.layout, duplicated.tileId)
				return
			}
			if (
				(key === "x" || event.key === "Delete" || event.key === "Backspace") &&
				selectedTileId !== null
			) {
				event.preventDefault()
				deleteTile(selectedTileId)
				return
			}
			if (key === "s") {
				event.preventDefault()
				save()
				return
			}
			if (key === "r") {
				event.preventDefault()
				revert()
			}
		}
		window.addEventListener("keydown", handleKeyDown, { capture: true })
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true })
	}, [
		enabled,
		layout,
		management,
		helpOpen,
		pending,
		poolFocused,
		activeTileDefinition,
		saved,
		selectedColumn,
		selectedTileId,
	])

	const dropPayload = (columnId: TileColumnId, beforeTileId?: string): void => {
		const payload = dragPayload.current
		if (payload === null) return
		if (payload.type === "pool") {
			addTileToColumn(payload.kind, columnId, beforeTileId)
		} else {
			applyEdit(
				moveTile(layout, payload.tileId, columnId, beforeTileId),
				payload.tileId,
			)
			selectColumn(columnId)
			setSelectedTileId(payload.tileId)
		}
		dragPayload.current = null
		setDragging(false)
	}

	const renderColumn = (column: TileColumn) => {
		const selected = column.id === selectedColumn
		if (column.collapsed) {
			return (
				<collapsed-column
					key={column.id}
					data-side={column.id <= 2 ? "left" : "right"}
					data-selected={management && selected ? "true" : "false"}
				>
					<button
						type="button"
						aria-label={`Expand column ${column.id}`}
						onDragOver={(event) => {
							if (management) event.preventDefault()
						}}
						onDrop={(event) => {
							if (!management) return
							event.preventDefault()
							dropPayload(column.id)
						}}
						onClick={() => {
							selectColumn(column.id)
							applyEdit(toggleColumnCollapsed(layout, column.id))
						}}
					>
						<EnterFullScreenIcon aria-hidden="true" />
						<strong>{column.id}</strong>
						<small>{column.tiles.length}</small>
					</button>
				</collapsed-column>
			)
		}
		return (
			<tile-column
				key={column.id}
				ref={(element: HTMLElement | null) => {
					if (element === null) columnRefs.current.delete(column.id)
					else columnRefs.current.set(column.id, element)
				}}
				data-selected={management && selected ? "true" : "false"}
				data-alignment={column.alignment}
				data-hit-surface={columnHitSurface(management)}
				data-hotbar-clearance={
					(columnClearance[column.id] ?? 0) > 0 ? "true" : "false"
				}
				data-overflow={columnOverflow[column.id] ?? "fit"}
				style={{
					"--tile-column-clearance": `${columnClearance[column.id] ?? 0}px`,
				}}
				onClick={() => management && selectColumn(column.id)}
				onDragOver={(event: DragEvent) => {
					if (!management) return
					event.preventDefault()
				}}
				onDrop={(event: DragEvent) => {
					event.preventDefault()
					event.stopPropagation()
					dropPayload(column.id)
				}}
			>
				<column-heading>
					<button
						type="button"
						aria-expanded="true"
						aria-label={`Collapse column ${column.id}`}
						onClick={(event) => {
							event.stopPropagation()
							selectColumn(column.id)
							applyEdit(toggleColumnCollapsed(layout, column.id))
						}}
					>
						<strong>{column.id}</strong>
						<span>Column {column.id}</span>
						<column-state>
							{column.alignment === "top" ? (
								<ChevronUpIcon aria-label="Top aligned" />
							) : (
								<ChevronDownIcon aria-label="Bottom aligned" />
							)}
							<ExitFullScreenIcon aria-label="Collapse column" />
						</column-state>
					</button>
				</column-heading>
				<column-scroll
					id={`tile-column-scroll-${column.id}`}
					ref={(element: HTMLElement | null) => {
						if (element === null) scrollRefs.current.delete(column.id)
						else scrollRefs.current.set(column.id, element)
					}}
					onScroll={measureColumnOverflow}
				>
					<tile-stack>
						{column.tiles.map((tile) => renderTile(column, tile))}
						{column.tiles.length === 0 ? (
							<empty-column>
								<span>Empty column</span>
								<small>Drop a tile here or press N</small>
							</empty-column>
						) : null}
					</tile-stack>
				</column-scroll>
				{columnOverflow[column.id] === "fit" ? null : (
					<column-scrollbar
						ref={(element: HTMLElement | null) => {
							if (element === null) scrollbarRefs.current.delete(column.id)
							else scrollbarRefs.current.set(column.id, element)
						}}
						role="scrollbar"
						tabIndex={0}
						aria-label={`Scroll column ${column.id}`}
						aria-controls={`tile-column-scroll-${column.id}`}
						aria-orientation="vertical"
						aria-valuemin={0}
						onKeyDown={(event: KeyboardEvent) =>
							scrollColumnFromKeyboard(event, column.id)
						}
						onPointerDown={(event: PointerEvent) => {
							const target = event.currentTarget
							if (target instanceof HTMLElement) {
								const thumb = target.firstElementChild
								if (!(thumb instanceof HTMLElement)) return
								const thumbBounds = thumb.getBoundingClientRect()
								const grabbedThumb =
									event.clientY >= thumbBounds.top &&
									event.clientY <= thumbBounds.bottom
								const grabOffset = grabbedThumb
									? event.clientY - thumbBounds.top
									: thumbBounds.height / 2
								scrollbarDrag.current = {
									columnId: column.id,
									pointerId: event.pointerId,
									grabOffset,
								}
								target.setPointerCapture(event.pointerId)
								scrollColumnFromPointer(event, column.id, grabOffset)
							}
						}}
						onPointerMove={(event: PointerEvent) => {
							const target = event.currentTarget
							const drag = scrollbarDrag.current
							if (
								target instanceof HTMLElement &&
								target.hasPointerCapture(event.pointerId) &&
								drag?.pointerId === event.pointerId &&
								drag.columnId === column.id
							) {
								scrollColumnFromPointer(event, column.id, drag.grabOffset)
							}
						}}
						onPointerUp={(event: PointerEvent) => {
							if (scrollbarDrag.current?.pointerId === event.pointerId) {
								scrollbarDrag.current = null
							}
						}}
						onPointerCancel={(event: PointerEvent) => {
							if (scrollbarDrag.current?.pointerId === event.pointerId) {
								scrollbarDrag.current = null
							}
						}}
					>
						<span />
					</column-scrollbar>
				)}
			</tile-column>
		)
	}

	const renderTile = (column: TileColumn, tile: TileInstance) => (
		<workspace-tile
			key={tile.id}
			data-kind={tile.kind}
			data-selected={
				management && selectedTileId === tile.id ? "true" : "false"
			}
			data-fill={tile.fill ? "true" : "false"}
			draggable={management}
			onClick={(event: MouseEvent) => {
				if (!management) return
				event.stopPropagation()
				selectColumn(column.id)
				setSelectedTileId(tile.id)
			}}
			onDragStart={(event: DragEvent) => {
				dragPayload.current = { type: "tile", tileId: tile.id }
				setDragging(true)
				if (event.dataTransfer !== null)
					event.dataTransfer.effectAllowed = "move"
			}}
			onDragEnd={() => {
				dragPayload.current = null
				setDragging(false)
			}}
			onDragOver={(event: DragEvent) => {
				if (!management) return
				event.preventDefault()
				event.stopPropagation()
			}}
			onDrop={(event: DragEvent) => {
				event.preventDefault()
				event.stopPropagation()
				dropPayload(column.id, tile.id)
			}}
		>
			<tile-heading>
				<DragHandleDots2Icon aria-hidden="true" />
				<strong>{tileName(tile.kind)}</strong>
				<tile-actions>
					{tile.fill ? <span>Fill</span> : null}
					{management ? (
						<button
							type="button"
							aria-label={`Remove ${tileName(tile.kind)}`}
							onClick={(event) => {
								event.stopPropagation()
								deleteTile(tile.id)
							}}
						>
							<Cross2Icon aria-hidden="true" />
						</button>
					) : null}
				</tile-actions>
			</tile-heading>
			<tile-content
				aria-hidden={management ? "true" : undefined}
				inert={management}
			>
				{tile.kind === "version-control" ? (
					<VersionControlTile
						diffView={diffView}
						onDiffViewChange={onDiffViewChange}
						onReviewGlyph={onReviewGlyph}
						{...(versionControl === undefined ? {} : { versionControl })}
					/>
				) : tile.kind === "font-navigation" ? (
					<FontNavigator workspace={workspace} />
				) : tile.kind === "canvas-toolbar" ? (
					<CanvasToolbar workspace={workspace} />
				) : tile.kind === "kerning" ? (
					<KerningTile workspace={workspace} />
				) : tile.kind === "preview" ? (
					<PreviewTile workspace={workspace} tileId={tile.id} />
				) : tile.kind === "compatibility" ? (
					<CompatibilityTile workspace={workspace} />
				) : tile.kind === "glyph-attributes" ? (
					<GlyphInspector workspace={workspace} />
				) : (
					<SelectionDimensions workspace={workspace} />
				)}
			</tile-content>
		</workspace-tile>
	)

	const renderLane = (
		side: "left" | "right",
		columns: readonly TileColumnId[],
		visibleSlots: number,
		pageIndex: number,
	) => (
		<tile-lane data-side={side} data-slots={visibleSlots}>
			<tile-track
				style={{
					transform: `translateX(calc(${pageIndex} * (var(--tile-column-width) + var(--tile-column-gap)) * -1))`,
				}}
				onTransitionEnd={() => {
					measureColumnClearance()
					measureColumnOverflow()
				}}
			>
				{columns.map((id) => {
					const column = layout.columns.find((item) => item.id === id)
					return column === undefined ? null : renderColumn(column)
				})}
			</tile-track>
		</tile-lane>
	)

	const singleSlot = allocation.left === 0
	return (
		<tiling-workspace
			ref={workspaceRef}
			className={css.class}
			data-management={management ? "true" : "false"}
			data-dirty={dirty ? "true" : "false"}
		>
			{management ? <management-backdrop /> : null}
			{singleSlot ? (
				renderLane("right", ALL_COLUMNS, 1, selectedColumn - 1)
			) : (
				<>
					{renderLane(
						"left",
						LEFT_COLUMNS,
						allocation.left,
						allocation.left === 2 ? 0 : activeLeft - 1,
					)}
					{renderLane(
						"right",
						RIGHT_COLUMNS,
						allocation.right,
						allocation.right === 2 ? 0 : activeRight - 3,
					)}
				</>
			)}
			{management ? (
				<>
					<tile-pool data-focused={poolFocused ? "true" : "false"}>
						<pool-heading>
							<span>Tile pool</span>
						</pool-heading>
						<pool-search>
							<MagnifyingGlassIcon aria-hidden="true" />
							<input
								ref={poolInputRef}
								type="search"
								role="combobox"
								aria-label="Search tile types"
								aria-controls="tile-pool-results"
								aria-expanded="true"
								aria-activedescendant={
									activeTileDefinition === undefined
										? undefined
										: `tile-pool-${activeTileDefinition.kind}`
								}
								placeholder="Search tiles…"
								value={poolQuery}
								onFocus={() => setPoolFocused(true)}
								onBlur={() => setPoolFocused(false)}
								onInput={(event) => {
									setPoolQuery(event.currentTarget.value)
									setPoolIndex(0)
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault()
										setPoolFocused(false)
										setPoolQuery("")
										event.currentTarget.blur()
										return
									}
									if (event.key === "?") {
										event.preventDefault()
										setHelpOpen(true)
										setPoolFocused(false)
										setPoolQuery("")
										event.currentTarget.blur()
										return
									}
									if (event.key === "ArrowDown" || event.key === "ArrowUp") {
										event.preventDefault()
										if (filteredTileDefinitions.length === 0) return
										const direction = event.key === "ArrowDown" ? 1 : -1
										setPoolIndex(
											(index) =>
												(index + direction + filteredTileDefinitions.length) %
												filteredTileDefinitions.length,
										)
										return
									}
									if (event.key === "Enter") {
										event.preventDefault()
										if (activeTileDefinition !== undefined)
											addTileToColumn(activeTileDefinition.kind, selectedColumn)
										return
									}
									const digit = event.code.startsWith("Digit")
										? Number(event.code.slice("Digit".length))
										: Number.NaN
									if (
										isColumnId(digit) &&
										!event.metaKey &&
										!event.ctrlKey &&
										!event.altKey
									) {
										event.preventDefault()
										if (activeTileDefinition !== undefined)
											addTileToColumn(activeTileDefinition.kind, digit)
									}
								}}
							/>
							<kbd>N</kbd>
						</pool-search>
						<pool-items id="tile-pool-results" role="listbox">
							{filteredTileDefinitions.map((definition, index) => (
								<button
									key={definition.kind}
									id={`tile-pool-${definition.kind}`}
									type="button"
									role="option"
									aria-selected={poolIndex === index}
									data-selected={poolIndex === index ? "true" : "false"}
									draggable
									onMouseEnter={() => setPoolIndex(index)}
									onClick={() => {
										setPoolIndex(index)
										addTileToColumn(definition.kind, selectedColumn)
									}}
									onDragStart={(event) => {
										dragPayload.current = {
											type: "pool",
											kind: definition.kind,
										}
										setDragging(true)
										if (event.dataTransfer !== null) {
											event.dataTransfer.effectAllowed = "copy"
										}
									}}
									onDragEnd={() => {
										dragPayload.current = null
										setDragging(false)
									}}
								>
									<PlusIcon aria-hidden="true" />
									<strong>{definition.name}</strong>
									<span>{definition.description}</span>
								</button>
							))}
							{filteredTileDefinitions.length === 0 ? (
								<pool-empty>No tiles match “{poolQuery}”</pool-empty>
							) : null}
						</pool-items>
						<small>
							Enter adds to column {selectedColumn}. Press 1–4 for another
							destination, or drag a result.
						</small>
					</tile-pool>
					{helpOpen ? (
						<tile-help role="dialog" aria-label="Tile management shortcuts">
							<help-heading>
								<help-title>
									<strong>Keyboard commands</strong>
									<span>Tile management</span>
								</help-title>
								<button
									type="button"
									aria-label="Close keyboard help"
									onClick={() => setHelpOpen(false)}
								>
									<Cross2Icon aria-hidden="true" />
								</button>
							</help-heading>
							<dl>
								{TILE_SHORTCUTS.map((shortcut) => (
									<shortcut-command key={shortcut.keys}>
										<dt>
											<kbd>{shortcut.keys}</kbd>
										</dt>
										<dd>{shortcut.action}</dd>
									</shortcut-command>
								))}
							</dl>
						</tile-help>
					) : null}
					<management-hud>
						<column-targets aria-label="Column targets">
							{ALL_COLUMNS.map((columnId) => (
								<button
									key={columnId}
									type="button"
									aria-pressed={selectedColumn === columnId}
									data-drop-active={dragging ? "true" : "false"}
									onClick={() => selectColumn(columnId)}
									onDragOver={(event) => event.preventDefault()}
									onDrop={(event) => {
										event.preventDefault()
										dropPayload(columnId)
									}}
								>
									{columnId}
								</button>
							))}
						</column-targets>
						<command-status role="status" aria-live="polite">
							<strong>
								{pending === "move"
									? "Move to column…"
									: pending === "align"
										? "Align T · B"
										: poolFocused
											? "Choose a tile, then 1–4"
											: `Column ${selectedColumn}`}
							</strong>
							<span>X remove · N new · S save · ? help</span>
						</command-status>
						<hud-actions>
							<button
								type="button"
								data-help
								aria-label="Keyboard commands"
								aria-pressed={helpOpen}
								onClick={() => setHelpOpen((open) => !open)}
							>
								<QuestionMarkCircledIcon aria-hidden="true" />
							</button>
							<button type="button" data-save onClick={save} disabled={!dirty}>
								<BookmarkFilledIcon aria-hidden="true" />
								{dirty ? "Save" : "Saved"}
							</button>
						</hud-actions>
					</management-hud>
				</>
			) : null}
			<mode-entry>
				<button
					type="button"
					aria-label={management ? "Exit tile management" : "Manage tiles"}
					aria-pressed={management}
					onClick={toggleManagement}
				>
					{management ? (
						<ExitFullScreenIcon aria-hidden="true" />
					) : (
						<DragHandleDots2Icon aria-hidden="true" />
					)}
					<span>{management ? "Done" : "Tiles"}</span>
					<kbd>⇧ Space</kbd>
				</button>
			</mode-entry>
		</tiling-workspace>
	)
}
