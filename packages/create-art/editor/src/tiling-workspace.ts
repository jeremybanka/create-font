export const COLUMN_IDS = [1, 2, 3, 4] as const

export type TileColumnId = (typeof COLUMN_IDS)[number]
export type TileColumnAlignment = "top" | "bottom"
export type TileKind = string

export interface TileInstance<Kind extends string = string> {
	readonly id: string
	readonly kind: Kind
	readonly fill: boolean
}

export interface TileColumn<Kind extends string = string> {
	readonly id: TileColumnId
	readonly alignment: TileColumnAlignment
	readonly collapsed: boolean
	readonly tiles: readonly TileInstance<Kind>[]
}

export interface TilingLayout<Kind extends string = string> {
	readonly version: 3
	readonly columns: readonly TileColumn<Kind>[]
}

export interface ColumnSlotAllocation {
	readonly left: 0 | 1 | 2
	readonly right: 1 | 2
}

export interface LayoutRect {
	readonly left: number
	readonly right: number
	readonly top: number
	readonly bottom: number
}

export interface ScrollMetrics {
	readonly scrollTop: number
	readonly clientHeight: number
	readonly scrollHeight: number
}

export interface ScrollbarPointerMetrics {
	readonly pointerPosition: number
	readonly trackStart: number
	readonly trackSize: number
	readonly thumbSize: number
	readonly maximum: number
	readonly grabOffset: number
}

export type ColumnOverflowState = "fit" | "more" | "end"
export type ColumnHitSurface = "content" | "column"

export interface TilingHistory {
	readonly past: readonly TilingLayout[]
	readonly present: TilingLayout
	readonly future: readonly TilingLayout[]
}

let nextTileId = 0

function tileId(kind: string): string {
	nextTileId += 1
	return `${kind}:${Date.now().toString(36)}:${nextTileId.toString(36)}`
}

export function createEmptyTilingLayout(): TilingLayout {
	return {
		version: 3,
		columns: COLUMN_IDS.map((id) => ({
			id,
			alignment: "top",
			collapsed: false,
			tiles: [],
		})),
	}
}

export function columnSlotAllocation(
	viewportWidth: number,
): ColumnSlotAllocation {
	if (viewportWidth < 800) return { left: 0, right: 1 }
	if (viewportWidth < 1_000) return { left: 1, right: 1 }
	if (viewportWidth < 1_200) return { left: 1, right: 2 }
	return { left: 2, right: 2 }
}

export function visibleColumnIds(
	allocation: ColumnSlotAllocation,
	activeLeft: 1 | 2,
	activeRight: 3 | 4,
	selectedColumn: TileColumnId,
): readonly TileColumnId[] {
	if (allocation.left === 0) return [selectedColumn]
	return [
		...(allocation.left === 2 ? ([1, 2] as const) : [activeLeft]),
		...(allocation.right === 2 ? ([3, 4] as const) : [activeRight]),
	]
}

export function hotbarClearanceForColumn(
	column: LayoutRect,
	hotbar: LayoutRect,
	workspaceBottom: number,
): number {
	const horizontallyIntersects =
		column.left < hotbar.right && column.right > hotbar.left
	if (!horizontallyIntersects) return 0
	return Math.max(0, workspaceBottom - hotbar.top)
}

export function columnOverflowState(
	{ scrollTop, clientHeight, scrollHeight }: ScrollMetrics,
	tolerance = 1,
): ColumnOverflowState {
	if (scrollHeight <= clientHeight + tolerance) return "fit"
	return scrollTop + clientHeight >= scrollHeight - tolerance ? "end" : "more"
}

export function scrollbarScrollTopFromPointer({
	pointerPosition,
	trackStart,
	trackSize,
	thumbSize,
	maximum,
	grabOffset,
}: ScrollbarPointerMetrics): number {
	const travel = Math.max(0, trackSize - thumbSize)
	if (travel === 0 || maximum <= 0) return 0
	const thumbStart = Math.max(
		0,
		Math.min(travel, pointerPosition - trackStart - grabOffset),
	)
	return (thumbStart / travel) * maximum
}

export function columnHitSurface(management: boolean): ColumnHitSurface {
	return management ? "column" : "content"
}

export function serializeTilingLayout(layout: TilingLayout): string {
	return JSON.stringify(layout)
}

export function parseTilingLayout(value: string | null): TilingLayout | null {
	if (value === null) return null
	try {
		return normalizeTilingLayout(JSON.parse(value))
	} catch {
		return null
	}
}

export function normalizeTilingLayout(value: unknown): TilingLayout | null {
	if (typeof value !== "object" || value === null) return null
	const candidate = value as { version?: unknown; columns?: unknown }
	if (
		(candidate.version !== 1 &&
			candidate.version !== 2 &&
			candidate.version !== 3) ||
		!Array.isArray(candidate.columns)
	)
		return null
	const candidateColumns: readonly unknown[] = candidate.columns
	const seenTiles = new Set<string>()
	const columns = COLUMN_IDS.map((id): TileColumn | null => {
		const column = candidateColumns.find(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				(item as { id?: unknown }).id === id,
		) as
			| {
					alignment?: unknown
					collapsed?: unknown
					tiles?: unknown
			  }
			| undefined
		if (
			column === undefined ||
			(column.alignment !== "top" && column.alignment !== "bottom") ||
			typeof column.collapsed !== "boolean" ||
			!Array.isArray(column.tiles)
		) {
			return null
		}
		const tiles: TileInstance[] = []
		for (const item of column.tiles) {
			if (typeof item !== "object" || item === null) return null
			const tile = item as { id?: unknown; kind?: unknown; fill?: unknown }
			if (
				typeof tile.id !== "string" ||
				seenTiles.has(tile.id) ||
				typeof tile.kind !== "string" ||
				tile.kind.length === 0 ||
				typeof tile.fill !== "boolean"
			) {
				return null
			}
			seenTiles.add(tile.id)
			tiles.push({ id: tile.id, kind: tile.kind, fill: tile.fill })
		}
		return {
			id,
			alignment: column.alignment,
			collapsed: column.collapsed,
			tiles,
		}
	})
	if (columns.some((column) => column === null)) return null
	return { version: 3, columns: columns as TileColumn[] }
}

export function createTilingHistory(layout: TilingLayout): TilingHistory {
	return { past: [], present: layout, future: [] }
}

export function editTilingHistory(
	history: TilingHistory,
	next: TilingLayout,
): TilingHistory {
	if (serializeTilingLayout(history.present) === serializeTilingLayout(next)) {
		return history
	}
	return {
		past: [...history.past.slice(-49), history.present],
		present: next,
		future: [],
	}
}

export function undoTilingHistory(history: TilingHistory): TilingHistory {
	const previous = history.past.at(-1)
	if (previous === undefined) return history
	return {
		past: history.past.slice(0, -1),
		present: previous,
		future: [history.present, ...history.future],
	}
}

export function redoTilingHistory(history: TilingHistory): TilingHistory {
	const next = history.future[0]
	if (next === undefined) return history
	return {
		past: [...history.past, history.present],
		present: next,
		future: history.future.slice(1),
	}
}

function updateColumn(
	layout: TilingLayout,
	columnId: TileColumnId,
	update: (column: TileColumn) => TileColumn,
): TilingLayout {
	return {
		...layout,
		columns: layout.columns.map((column) =>
			column.id === columnId ? update(column) : column,
		),
	}
}

export function setColumnAlignment(
	layout: TilingLayout,
	columnId: TileColumnId,
	alignment: TileColumnAlignment,
): TilingLayout {
	return updateColumn(layout, columnId, (column) => ({ ...column, alignment }))
}

export function toggleColumnCollapsed(
	layout: TilingLayout,
	columnId: TileColumnId,
): TilingLayout {
	return updateColumn(layout, columnId, (column) => ({
		...column,
		collapsed: !column.collapsed,
	}))
}

export function addTile(
	layout: TilingLayout,
	kind: string,
	columnId: TileColumnId,
	beforeTileId?: string,
	fill = false,
): { readonly layout: TilingLayout; readonly tileId: string } {
	const id = tileId(kind)
	const tile: TileInstance = { id, kind, fill }
	return {
		tileId: id,
		layout: updateColumn(layout, columnId, (column) => {
			const index =
				beforeTileId === undefined
					? column.tiles.length
					: column.tiles.findIndex((item) => item.id === beforeTileId)
			const insertion = index < 0 ? column.tiles.length : index
			return {
				...column,
				tiles: [
					...column.tiles.slice(0, insertion),
					tile,
					...column.tiles.slice(insertion),
				],
			}
		}),
	}
}

export function findTile(
	layout: TilingLayout,
	tileIdValue: string,
): {
	readonly columnId: TileColumnId
	readonly index: number
	readonly tile: TileInstance
} | null {
	for (const column of layout.columns) {
		const index = column.tiles.findIndex((tile) => tile.id === tileIdValue)
		const tile = column.tiles[index]
		if (tile !== undefined) return { columnId: column.id, index, tile }
	}
	return null
}

export function moveTile(
	layout: TilingLayout,
	tileIdValue: string,
	columnId: TileColumnId,
	beforeTileId?: string,
): TilingLayout {
	const found = findTile(layout, tileIdValue)
	if (found === null || beforeTileId === tileIdValue) return layout
	const columns = layout.columns.map((column) => ({
		...column,
		tiles: column.tiles.filter((tile) => tile.id !== tileIdValue),
	}))
	const destination = columns.find((column) => column.id === columnId)
	if (destination === undefined) return layout
	const targetIndex =
		beforeTileId === undefined
			? destination.tiles.length
			: destination.tiles.findIndex((tile) => tile.id === beforeTileId)
	const insertion = targetIndex < 0 ? destination.tiles.length : targetIndex
	destination.tiles = [
		...destination.tiles.slice(0, insertion),
		found.tile,
		...destination.tiles.slice(insertion),
	]
	return { ...layout, columns }
}

export function moveTileBy(
	layout: TilingLayout,
	tileIdValue: string,
	delta: number,
): TilingLayout {
	const found = findTile(layout, tileIdValue)
	if (found === null) return layout
	const column = layout.columns.find((item) => item.id === found.columnId)
	if (column === undefined) return layout
	const nextIndex = Math.max(
		0,
		Math.min(column.tiles.length - 1, found.index + delta),
	)
	if (nextIndex === found.index) return layout
	const tiles = [...column.tiles]
	const [tile] = tiles.splice(found.index, 1)
	if (tile === undefined) return layout
	tiles.splice(nextIndex, 0, tile)
	return updateColumn(layout, found.columnId, (item) => ({ ...item, tiles }))
}

export function moveTileToEdge(
	layout: TilingLayout,
	tileIdValue: string,
	edge: TileColumnAlignment,
): TilingLayout {
	const found = findTile(layout, tileIdValue)
	if (found === null) return layout
	const column = layout.columns.find((item) => item.id === found.columnId)
	if (column === undefined) return layout
	return moveTileBy(
		layout,
		tileIdValue,
		edge === "top" ? -found.index : column.tiles.length - found.index - 1,
	)
}

export function removeTile(
	layout: TilingLayout,
	tileIdValue: string,
): TilingLayout {
	const found = findTile(layout, tileIdValue)
	if (found === null) return layout
	return updateColumn(layout, found.columnId, (column) => ({
		...column,
		tiles: column.tiles.filter((tile) => tile.id !== tileIdValue),
	}))
}

export function duplicateTile(
	layout: TilingLayout,
	tileIdValue: string,
): { readonly layout: TilingLayout; readonly tileId: string } | null {
	const found = findTile(layout, tileIdValue)
	if (found === null) return null
	const added = addTile(layout, found.tile.kind, found.columnId)
	const withFill = found.tile.fill
		? setTileFill(added.layout, added.tileId, true)
		: added.layout
	return { ...added, layout: withFill }
}

export function setTileFill(
	layout: TilingLayout,
	tileIdValue: string,
	fill: boolean,
): TilingLayout {
	const found = findTile(layout, tileIdValue)
	if (found === null) return layout
	return updateColumn(layout, found.columnId, (column) => ({
		...column,
		tiles: column.tiles.map((tile) =>
			tile.id === tileIdValue ? { ...tile, fill } : tile,
		),
	}))
}
