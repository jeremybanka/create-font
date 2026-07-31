import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_TILING_LAYOUT,
	DESIGN_TILING_STORAGE_KEY,
	DESIGN_TILE_REGISTRY,
	LEGACY_DESIGN_TILING_STORAGE_KEY,
	migrateDesignTilingStorage,
} from "../src/design-tile-registry.ts"

describe("create-design tile registry", () => {
	it("registers useful design panels without importing font tile kinds", () => {
		expect(DESIGN_TILE_REGISTRY.registrations.map(({ kind }) => kind)).toEqual([
			"version-control",
			"pages",
			"layers",
			"canvas",
			"export",
			"tools",
			"object",
			"appearance",
		])
		expect(
			DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toEqual([
			["pages", "layers"],
			["version-control", "canvas", "export"],
			["tools"],
			["object", "appearance"],
		])
	})

	it("preserves customized v2 layouts in the v3 namespace", () => {
		const legacy = JSON.stringify({
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter((tile) => tile.kind !== "version-control"),
			})),
		})
		const values = new Map<string, string>([
			[`${LEGACY_DESIGN_TILING_STORAGE_KEY}:saved:v1`, legacy],
			[`${LEGACY_DESIGN_TILING_STORAGE_KEY}:draft:v1`, legacy],
		])
		migrateDesignTilingStorage({
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		})
		expect(values.get(`${DESIGN_TILING_STORAGE_KEY}:saved:v1`)).toBe(legacy)
		expect(values.get(`${DESIGN_TILING_STORAGE_KEY}:draft:v1`)).toBe(legacy)
	})
})
