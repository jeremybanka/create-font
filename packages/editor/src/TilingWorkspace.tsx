import {
	BookmarkFilledIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	Cross2Icon,
	DragHandleDots2Icon,
	EnterFullScreenIcon,
	ExitFullScreenIcon,
	PlusIcon,
} from "@radix-ui/react-icons"
import { useEffect, useReducer, useRef, useState } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { CanvasToolbar } from "./CanvasToolbar.tsx"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import css from "./TilingWorkspace.module.css"
import {
	addTile,
	columnSlotAllocation,
	createDefaultTilingLayout,
	createTilingHistory,
	duplicateTile,
	editTilingHistory,
	findTile,
	moveTile,
	moveTileBy,
	moveTileToEdge,
	parseTilingLayout,
	redoTilingHistory,
	removeTile,
	serializeTilingLayout,
	setColumnAlignment,
	setTileFill,
	TILING_DRAFT_STORAGE_KEY,
	TILING_SAVED_STORAGE_KEY,
	toggleColumnCollapsed,
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
	readonly workspace: EditorWorkspace
	readonly enabled?: boolean
	readonly onStatusChange?: (status: TilingWorkspaceStatus) => void
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
		kind: "glyph-attributes",
		name: "Glyph attributes",
		description: "Inspect glyph metrics, selection, and preview state.",
	},
]

const TILE_SHORTCUTS: readonly TileShortcut[] = [
	{ keys: "⇧ Space", action: "Enter or exit management" },
	{ keys: "1–4", action: "Select column or destination" },
	{ keys: "J / K · ↓ / ↑", action: "Select next or previous tile" },
	{ keys: "⇧ J / ⇧ K", action: "Reorder selected tile" },
	{ keys: "G / ⇧ G", action: "Move tile to top or bottom" },
	{ keys: "M → 1–4", action: "Move tile to column" },
	{ keys: "A → T / B", action: "Pack column top or bottom" },
	{ keys: "C", action: "Collapse or expand column" },
	{ keys: "F", action: "Toggle fill affinity" },
	{ keys: "N", action: "Focus tile pool" },
	{ keys: "← / →", action: "Choose tile type in pool" },
	{ keys: "D", action: "Duplicate selected tile" },
	{ keys: "X · Del · ⌫", action: "Remove selected tile" },
	{ keys: "⌘/Ctrl Z", action: "Undo layout edit" },
	{ keys: "⌘/Ctrl ⇧ Z", action: "Redo layout edit" },
	{ keys: "S", action: "Save workspace" },
	{ keys: "R", action: "Revert to saved workspace" },
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

export function TilingWorkspace({
	workspace,
	enabled = true,
	onStatusChange,
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
	const [poolIndex, setPoolIndex] = useState(0)
	const [viewportWidth, setViewportWidth] = useState(() =>
		typeof window === "undefined" ? 1_200 : window.innerWidth,
	)
	const [dragging, setDragging] = useState(false)
	const dragPayload = useRef<DragPayload | null>(null)
	const layout = history.present
	const dirty = serializeTilingLayout(layout) !== saved
	const allocation = columnSlotAllocation(viewportWidth)

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
		setPending(null)
	}

	useEffect(() => {
		const handleResize = (): void => setViewportWidth(window.innerWidth)
		window.addEventListener("resize", handleResize)
		return () => window.removeEventListener("resize", handleResize)
	}, [])

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
	}, [enabled, management])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
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
			if (!management) return
			event.stopImmediatePropagation()

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
				if (pending === "move") {
					moveSelectedTile(digit)
					setPending(null)
				} else if (poolFocused) {
					const definition = TILE_DEFINITIONS[poolIndex]
					if (definition !== undefined) addTileToColumn(definition.kind, digit)
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
				setPending(null)
				setPoolFocused(false)
				return
			}
			if (
				poolFocused &&
				(event.key === "ArrowLeft" || event.key === "ArrowRight")
			) {
				event.preventDefault()
				setPoolIndex((index) =>
					event.key === "ArrowLeft"
						? (index - 1 + TILE_DEFINITIONS.length) % TILE_DEFINITIONS.length
						: (index + 1) % TILE_DEFINITIONS.length,
				)
				return
			}
			if (key === "n") {
				event.preventDefault()
				setPoolFocused(true)
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
		pending,
		poolFocused,
		poolIndex,
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
					data-selected={selected ? "true" : "false"}
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
				data-selected={selected ? "true" : "false"}
				data-alignment={column.alignment}
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
				<column-scroll>
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
			</tile-column>
		)
	}

	const renderTile = (column: TileColumn, tile: TileInstance) => (
		<workspace-tile
			key={tile.id}
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
				{tile.kind === "font-navigation" ? (
					<FontNavigator workspace={workspace} />
				) : tile.kind === "canvas-toolbar" ? (
					<CanvasToolbar workspace={workspace} />
				) : (
					<GlyphInspector workspace={workspace} />
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
							<kbd>N</kbd>
						</pool-heading>
						<pool-items>
							{TILE_DEFINITIONS.map((definition, index) => (
								<button
									key={definition.kind}
									type="button"
									data-selected={poolIndex === index ? "true" : "false"}
									draggable
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
						</pool-items>
						<small>
							Click to add to column {selectedColumn}, or drag to a numbered
							target.
						</small>
						<command-view aria-label="Tile management shortcuts">
							<strong>Keyboard commands</strong>
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
						</command-view>
					</tile-pool>
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
							<span>
								X remove · N new · S save · full reference in the tile pool
							</span>
						</command-status>
						<button type="button" data-save onClick={save} disabled={!dirty}>
							<BookmarkFilledIcon aria-hidden="true" />
							{dirty ? "Save" : "Saved"}
						</button>
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
