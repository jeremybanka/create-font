import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_TILING_LAYOUT,
	DESIGN_TILING_STORAGE_KEY,
	DESIGN_TILE_REGISTRY,
	LEGACY_DESIGN_TILING_STORAGE_KEY,
	migrateDesignTilingStorage,
	PRE_CURVATURE_DESIGN_TILING_STORAGE_KEY,
	PREVIOUS_DESIGN_TILING_STORAGE_KEY,
	RECENT_DESIGN_TILING_STORAGE_KEY,
} from "../src/design-tile-registry.ts"

describe("create-design tile registry", () => {
	it("registers useful design panels including create-design typography", () => {
		expect(DESIGN_TILE_REGISTRY.registrations.map(({ kind }) => kind)).toEqual([
			"version-control",
			"pages",
			"layers",
			"canvas",
			"export",
			"tools",
			"curvature-comb",
			"object",
			"blend",
			"transform",
			"arrange",
			"typography",
			"appearance",
		])
		expect(
			DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toEqual([
			["pages", "layers"],
			["version-control", "canvas", "export"],
			["tools", "curvature-comb"],
			["object", "blend", "transform", "arrange", "typography", "appearance"],
		])
		const tools = DEFAULT_DESIGN_TILING_LAYOUT.columns
			.flatMap(({ tiles }) => tiles)
			.find(({ kind }) => kind === "tools")
		expect(tools?.fill).toBe(false)
		expect(DESIGN_TILE_REGISTRY.byKind.get("tools")?.defaultFill).not.toBe(true)
	})

	it("removes explicit fill affinity from persisted v5 Tools tiles", () => {
		const previous = JSON.stringify({
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.map((tile) =>
					tile.kind === "tools" ? { ...tile, fill: true } : tile,
				),
			})),
		})
		const values = new Map<string, string>([
			[`${RECENT_DESIGN_TILING_STORAGE_KEY}:saved:v1`, previous],
		])
		migrateDesignTilingStorage({
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		})
		const migrated = JSON.parse(
			values.get(`${DESIGN_TILING_STORAGE_KEY}:saved:v1`) ?? "null",
		) as typeof DEFAULT_DESIGN_TILING_LAYOUT
		expect(
			migrated.columns
				.flatMap(({ tiles }) => tiles)
				.find(({ kind }) => kind === "tools")?.fill,
		).toBe(false)
	})

	it("preserves customized v6 layouts without inserting the new tile", () => {
		const previous = JSON.stringify({
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter((tile) => tile.kind !== "curvature-comb"),
			})),
		})
		const values = new Map<string, string>([
			[`${PRE_CURVATURE_DESIGN_TILING_STORAGE_KEY}:saved:v1`, previous],
			[`${PRE_CURVATURE_DESIGN_TILING_STORAGE_KEY}:draft:v1`, previous],
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
			).not.toContain("curvature-comb")
		}
	})

	it("adds Blend, Transform, and Arrange beside customized v4 Object tiles", () => {
		const previousLayout = {
			...DEFAULT_DESIGN_TILING_LAYOUT,
			columns: DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter(
					(tile) =>
						tile.kind !== "version-control" &&
						tile.kind !== "curvature-comb" &&
						tile.kind !== "blend" &&
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
				"blend",
				"transform",
				"arrange",
				"typography",
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
						tile.kind !== "blend" &&
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
		expect(
			migrated.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).not.toContain("blend")
	})
})
