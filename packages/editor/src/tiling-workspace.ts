export const COLUMN_IDS = [1, 2, 3, 4] as const

export type TileColumnId = (typeof COLUMN_IDS)[number]
export type TileColumnAlignment = "top" | "bottom"
export type TileKind =
	| "font-navigation"
	| "canvas-toolbar"
	| "glyph-attributes"
	| "selection-dimensions"

export interface TileInstance {
	readonly id: string
	readonly kind: TileKind
	readonly fill: boolean
}

export interface TileColumn {
	readonly id: TileColumnId
	readonly alignment: TileColumnAlignment
	readonly collapsed: boolean
	readonly tiles: readonly TileInstance[]
}

export interface TilingLayout {
	readonly version: 2
	readonly columns: readonly TileColumn[]
}

export interface ColumnSlotAllocation {
	readonly left: 0 | 1 | 2
	readonly right: 1 | 2
}

export interface TilingHistory {
	readonly past: readonly TilingLayout[]
	readonly present: TilingLayout
	readonly future: readonly TilingLayout[]
}

export const TILING_SAVED_STORAGE_KEY = "create-font:tiling-workspace:saved:v1"
export const TILING_DRAFT_STORAGE_KEY = "create-font:tiling-workspace:draft:v1"

const TILE_KINDS = new Set<TileKind>([
	"font-navigation",
	"canvas-toolbar",
	"glyph-attributes",
	"selection-dimensions",
])

let nextTileId = 0

function tileId(kind: TileKind): string {
	nextTileId += 1
	return `${kind}:${Date.now().toString(36)}:${nextTileId.toString(36)}`
}

export function createDefaultTilingLayout(): TilingLayout {
	return {
		version: 2,
		columns: [
			{
				id: 1,
				alignment: "top",
				collapsed: false,
				tiles: [
					{
						id: "font-navigation:default",
						kind: "font-navigation",
						fill: true,
					},
				],
			},
			{ id: 2, alignment: "top", collapsed: true, tiles: [] },
			{
				id: 3,
				alignment: "top",
				collapsed: false,
				tiles: [
					{ id: "canvas-toolbar:default", kind: "canvas-toolbar", fill: false },
				],
			},
			{
				id: 4,
				alignment: "top",
				collapsed: false,
				tiles: [
					{
						id: "glyph-attributes:default",
						kind: "glyph-attributes",
						fill: false,
					},
				],
			},
		],
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
		(candidate.version !== 1 && candidate.version !== 2) ||
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
				!TILE_KINDS.has(tile.kind as TileKind) ||
				typeof tile.fill !== "boolean"
			) {
				return null
			}
			seenTiles.add(tile.id)
			tiles.push({ id: tile.id, kind: tile.kind as TileKind, fill: tile.fill })
		}
		return {
			id,
			alignment: column.alignment,
			collapsed: column.collapsed,
			tiles,
		}
	})
	if (columns.some((column) => column === null)) return null
	const normalized = columns as TileColumn[]
	if (
		candidate.version === 1 &&
		!normalized.some((column) =>
			column.tiles.some((tile) => tile.kind === "canvas-toolbar"),
		)
	) {
		const column = normalized.find((item) => item.id === 3)
		if (column === undefined) return null
		const index = normalized.indexOf(column)
		normalized[index] = {
			...column,
			alignment: "top",
			collapsed: false,
			tiles: [
				...column.tiles,
				{
					id: "canvas-toolbar:default",
					kind: "canvas-toolbar",
					fill: false,
				},
			],
		}
	}
	return { version: 2, columns: normalized }
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
	kind: TileKind,
	columnId: TileColumnId,
	beforeTileId?: string,
): { readonly layout: TilingLayout; readonly tileId: string } {
	const id = tileId(kind)
	const tile: TileInstance = { id, kind, fill: false }
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
