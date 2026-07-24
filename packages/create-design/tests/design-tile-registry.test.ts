import { describe, expect, it } from "vitest"

import {
	DEFAULT_DESIGN_TILING_LAYOUT,
	DESIGN_TILE_REGISTRY,
} from "../src/design-tile-registry.tsx"

describe("create-design tile registry", () => {
	it("registers useful design panels without importing font tile kinds", () => {
		expect(DESIGN_TILE_REGISTRY.registrations.map(({ kind }) => kind)).toEqual([
			"objects",
			"canvas",
			"export",
			"swatches",
		])
		expect(
			DEFAULT_DESIGN_TILING_LAYOUT.columns.map((column) =>
				column.tiles.map((tile) => tile.kind),
			),
		).toEqual([["objects"], ["canvas"], ["export"], ["swatches"]])
	})
})
