import { describe, expect, it } from "vitest"

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
	normalizeTilingLayout,
	parseTilingLayout,
	redoTilingHistory,
	removeTile,
	serializeTilingLayout,
	setColumnAlignment,
	setTileFill,
	toggleColumnCollapsed,
	undoTilingHistory,
} from "../src/tiling-workspace.ts"

describe("tiling workspace", () => {
	it("allocates an odd slot to the right at every responsive threshold", () => {
		expect(columnSlotAllocation(799)).toEqual({ left: 0, right: 1 })
		expect(columnSlotAllocation(800)).toEqual({ left: 1, right: 1 })
		expect(columnSlotAllocation(999)).toEqual({ left: 1, right: 1 })
		expect(columnSlotAllocation(1_000)).toEqual({ left: 1, right: 2 })
		expect(columnSlotAllocation(1_199)).toEqual({ left: 1, right: 2 })
		expect(columnSlotAllocation(1_200)).toEqual({ left: 2, right: 2 })
	})

	it("starts with stable logical columns and the editor panes as tiles", () => {
		const layout = createDefaultTilingLayout()

		expect(layout.columns.map((column) => column.id)).toEqual([1, 2, 3, 4])
		expect(layout.columns[0]?.tiles.map((tile) => tile.kind)).toEqual([
			"font-navigation",
		])
		expect(layout.columns[2]?.tiles.map((tile) => tile.kind)).toEqual([
			"canvas-toolbar",
		])
		expect(layout.columns[3]?.tiles.map((tile) => tile.kind)).toEqual([
			"glyph-attributes",
		])
		expect(layout.columns.map((column) => column.collapsed)).toEqual([
			false,
			true,
			false,
			false,
		])
	})

	it("adds, reorders, and moves a tile while preserving its identity", () => {
		const initial = createDefaultTilingLayout()
		const added = addTile(initial, "glyph-attributes", 4)
		const atTop = moveTileToEdge(added.layout, added.tileId, "top")
		const moved = moveTile(atTop, added.tileId, 3)

		expect(atTop.columns[3]?.tiles[0]?.id).toBe(added.tileId)
		expect(findTile(moved, added.tileId)).toMatchObject({
			columnId: 3,
			index: 1,
		})
		expect(findTile(moved, added.tileId)?.tile.kind).toBe("glyph-attributes")
	})

	it("persists selection dimension tile instances in workspace layouts", () => {
		const initial = createDefaultTilingLayout()
		const added = addTile(initial, "selection-dimensions", 4)
		const restored = parseTilingLayout(serializeTilingLayout(added.layout))
		expect(findTile(restored!, added.tileId)?.tile).toMatchObject({
			kind: "selection-dimensions",
			fill: false,
		})
	})

	it("adds preview tiles with vertical fill affinity by default", () => {
		const added = addTile(createDefaultTilingLayout(), "preview", 2)
		expect(findTile(added.layout, added.tileId)?.tile).toMatchObject({
			kind: "preview",
			fill: true,
		})
		expect(parseTilingLayout(serializeTilingLayout(added.layout))).toEqual(
			added.layout,
		)
	})

	it("supports relative reorder, duplication, fill affinity, and removal", () => {
		const initial = createDefaultTilingLayout()
		const first = addTile(initial, "font-navigation", 2)
		const second = addTile(first.layout, "glyph-attributes", 2)
		const reordered = moveTileBy(second.layout, second.tileId, -1)
		const filled = setTileFill(reordered, second.tileId, true)
		const duplicated = duplicateTile(filled, second.tileId)
		if (duplicated === null) throw new Error("The tile was not duplicated.")
		const removed = removeTile(duplicated.layout, second.tileId)

		expect(reordered.columns[1]?.tiles[0]?.id).toBe(second.tileId)
		expect(findTile(duplicated.layout, duplicated.tileId)?.tile.fill).toBe(true)
		expect(findTile(removed, second.tileId)).toBeNull()
		expect(findTile(removed, duplicated.tileId)).not.toBeNull()
	})

	it("allows every tile, including defaults, to be removed", () => {
		const initial = createDefaultTilingLayout()
		const withoutNavigation = removeTile(initial, "font-navigation:default")
		const withoutToolbar = removeTile(
			withoutNavigation,
			"canvas-toolbar:default",
		)
		const empty = removeTile(withoutToolbar, "glyph-attributes:default")

		expect(empty.columns.every((column) => column.tiles.length === 0)).toBe(
			true,
		)
	})

	it("records column packing and collapse disposition", () => {
		const initial = createDefaultTilingLayout()
		const bottom = setColumnAlignment(initial, 4, "bottom")
		const collapsed = toggleColumnCollapsed(bottom, 4)

		expect(collapsed.columns[3]).toMatchObject({
			id: 4,
			alignment: "bottom",
			collapsed: true,
		})
	})

	it("undoes and redoes layout edits independently", () => {
		const initial = createDefaultTilingLayout()
		const edited = setColumnAlignment(initial, 4, "bottom")
		const history = editTilingHistory(createTilingHistory(initial), edited)
		const undone = undoTilingHistory(history)
		const redone = redoTilingHistory(undone)

		expect(undone.present.columns[3]?.alignment).toBe("top")
		expect(redone.present.columns[3]?.alignment).toBe("bottom")
	})

	it("round-trips valid recovery data and rejects duplicate tile identities", () => {
		const layout = createDefaultTilingLayout()
		expect(parseTilingLayout(serializeTilingLayout(layout))).toEqual(layout)

		const invalid = JSON.parse(serializeTilingLayout(layout)) as {
			columns: Array<{ tiles: unknown[] }>
		}
		const duplicate = invalid.columns[0]?.tiles[0]
		if (duplicate === undefined) throw new Error("The default tile is missing.")
		invalid.columns[1]?.tiles.push(duplicate)
		expect(normalizeTilingLayout(invalid)).toBeNull()
	})

	it("migrates saved version-one layouts by adding the canvas toolbar", () => {
		const current = createDefaultTilingLayout()
		const legacy = JSON.parse(serializeTilingLayout(current)) as {
			version: number
			columns: Array<{
				id: number
				collapsed: boolean
				tiles: Array<{ kind: string }>
			}>
		}
		legacy.version = 1
		const column = legacy.columns.find((item) => item.id === 3)
		if (column === undefined) throw new Error("Column 3 is missing.")
		column.collapsed = true
		column.tiles = column.tiles.filter((tile) => tile.kind !== "canvas-toolbar")

		const migrated = normalizeTilingLayout(legacy)
		expect(migrated?.version).toBe(2)
		expect(migrated?.columns[2]).toMatchObject({
			collapsed: false,
			alignment: "top",
			tiles: [{ kind: "canvas-toolbar" }],
		})
	})
})
