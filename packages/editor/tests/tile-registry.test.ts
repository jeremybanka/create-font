import { h } from "preact"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_FONT_TILING_LAYOUT,
	FONT_TILE_REGISTRY,
	migrateLegacyFontLayout,
} from "../src/font-tile-registry.ts"
import {
	availableTileRegistrations,
	createRegistryDefaultLayout,
	createTileRegistry,
	tileRegistryCommands,
	type TileRegistration,
} from "../src/tile-registry.ts"

interface Context {
	readonly enabled: boolean
}

const registrations = [
	{
		kind: "alpha",
		name: "Alpha",
		description: "The alpha tile.",
		defaultPlacement: { column: 1, fill: true },
		render: () => h("span", {}, "Alpha"),
	},
	{
		kind: "beta",
		name: "Beta",
		description: "The conditional beta tile.",
		available: (context) => context.enabled,
		command: { category: "Panels" },
		render: () => h("span", {}, "Beta"),
	},
] as const satisfies readonly TileRegistration<"alpha" | "beta", Context>[]

describe("tile registry", () => {
	it("builds defaults and command metadata from one typed registration source", () => {
		const registry = createTileRegistry<"alpha" | "beta", Context>(
			registrations,
		)
		const layout = createRegistryDefaultLayout(registry)

		expect(layout.columns[0]?.tiles).toEqual([
			{ id: "alpha:default", kind: "alpha", fill: true },
		])
		expect(tileRegistryCommands(registry, { enabled: true })).toMatchObject([
			{ id: "workspace-tile-alpha", kind: "alpha", category: "Workspace" },
			{ id: "workspace-tile-beta", kind: "beta", category: "Panels" },
		])
		expect(
			availableTileRegistrations(registry, { enabled: false }).map(
				(registration) => registration.kind,
			),
		).toEqual(["alpha"])
	})

	it("rejects duplicate kinds instead of silently shadowing a registration", () => {
		expect(() =>
			createTileRegistry<"duplicate", Context>([
				{
					kind: "duplicate",
					name: "First",
					description: "First.",
					render: () => null,
				},
				{
					kind: "duplicate",
					name: "Second",
					description: "Second.",
					render: () => null,
				},
			]),
		).toThrow(/unique/)
	})

	it("defines the complete create-font tile catalog and default layout", () => {
		expect(FONT_TILE_REGISTRY.registrations.map(({ kind }) => kind)).toEqual([
			"version-control",
			"font-navigation",
			"canvas-toolbar",
			"kerning",
			"preview",
			"compatibility",
			"glyph-attributes",
			"selection-dimensions",
		])
		expect(
			DEFAULT_FONT_TILING_LAYOUT.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toEqual([
			"font-navigation",
			"version-control",
			"canvas-toolbar",
			"glyph-attributes",
		])
	})

	it("keeps font-only legacy migration outside the reusable layout parser", () => {
		const legacy = {
			version: 3 as const,
			columns: DEFAULT_FONT_TILING_LAYOUT.columns.map((column) => ({
				...column,
				tiles: column.tiles.filter(
					(tile) =>
						tile.kind !== "canvas-toolbar" && tile.kind !== "version-control",
				),
			})),
		}
		const migrated = migrateLegacyFontLayout(legacy, 1)
		expect(
			migrated.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toContain("canvas-toolbar")
		expect(
			migrated.columns.flatMap((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toContain("version-control")
	})
})
