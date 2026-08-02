import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_TILING_LAYOUT,
	DESIGN_TILING_STORAGE_KEY,
	DESIGN_TILE_REGISTRY,
	LEGACY_DESIGN_TILING_STORAGE_KEY,
	migrateDesignTilingStorage,
	PREVIOUS_DESIGN_TILING_STORAGE_KEY,
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
			"transform",
			"arrange",
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
			["object", "transform", "arrange", "appearance"],
		])
	})

	it("splits Transform and Arrange out of customized v3 Object tiles", () => {
		const previousLayout = {
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter(
					(tile) =>
						tile.kind !== "version-control" &&
						tile.kind !== "transform" &&
						tile.kind !== "arrange",
				),
			})),
		}
		const previous = JSON.stringify(previousLayout)
		const values = new Map<string, string>([
			[`${PREVIOUS_DESIGN_TILING_STORAGE_KEY}:saved:v1`, previous],
			[`${PREVIOUS_DESIGN_TILING_STORAGE_KEY}:draft:v1`, previous],
		])
		migrateDesignTilingStorage({
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		})
		for (const suffix of ["saved:v1", "draft:v1"]) {
			const migrated = JSON.parse(
				values.get(`${DESIGN_TILING_STORAGE_KEY}:${suffix}`) ?? "null",
			) as typeof DEFAULT_DESIGN_TILING_LAYOUT
			expect(
				migrated.columns.flatMap((column) =>
					column.tiles.map((tile) => tile.kind),
				),
			).toEqual([
				"pages",
				"layers",
				"canvas",
				"export",
				"tools",
				"object",
				"transform",
				"arrange",
				"appearance",
			])
		}
	})

	it("keeps new inspectors in the tile pool when Object was removed", () => {
		const previous = JSON.stringify({
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter(
					(tile) =>
						tile.kind !== "object" &&
						tile.kind !== "transform" &&
						tile.kind !== "arrange",
				),
			})),
		})
		const values = new Map<string, string>([
			[`${LEGACY_DESIGN_TILING_STORAGE_KEY}:saved:v1`, previous],
		])
		migrateDesignTilingStorage({
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		})
		const migrated = JSON.parse(
			values.get(`${DESIGN_TILING_STORAGE_KEY}:saved:v1`) ?? "null",
		) as typeof DEFAULT_DESIGN_TILING_LAYOUT
		expect(
			migrated.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).not.toContain("transform")
		expect(
			migrated.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).not.toContain("arrange")
	})
})
