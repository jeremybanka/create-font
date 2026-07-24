import {
	createRegistryDefaultLayout,
	createTileRegistry,
	type TileRegistration,
} from "@create-font/editor/shared"

import { swatchCss } from "./color.ts"
import type { DesignDocument, DesignObject, DesignSwatch } from "./types.ts"

export type DesignTileKind = "canvas" | "objects" | "swatches" | "export"

export interface DesignTileContext {
	readonly document: DesignDocument
	readonly exportDocument: () => void
	readonly focusCanvas: () => void
	readonly selectObject: (object: DesignObject) => void
	readonly selectSwatch: (swatch: DesignSwatch) => void
	readonly selectedObjectId: string | null
	readonly selectedSwatchId: string
}

const registrations = [
	{
		kind: "objects",
		name: "Objects",
		description: "Select and inspect vector objects in stacking order.",
		defaultFill: true,
		defaultPlacement: { column: 1, fill: true },
		render: ({ context }) => (
			<design-objects-tile>
				<strong>{context.document.objects.length} objects</strong>
				{[...context.document.objects].reverse().map((object) => (
					<button
						key={object.id}
						type="button"
						aria-pressed={context.selectedObjectId === object.id}
						onClick={() => context.selectObject(object)}
					>
						<span>{object.name}</span>
						<small>
							{object.hidden ? "Hidden" : object.locked ? "Locked" : "Visible"}
						</small>
					</button>
				))}
			</design-objects-tile>
		),
	},
	{
		kind: "canvas",
		name: "Canvas",
		description: "Focus the active artboard and inspect page dimensions.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) => (
			<design-canvas-tile>
				<strong>{context.document.title}</strong>
				<span>
					{context.document.page.width} × {context.document.page.height} pt
				</span>
				<button type="button" onClick={context.focusCanvas}>
					Focus artboard
				</button>
			</design-canvas-tile>
		),
	},
	{
		kind: "export",
		name: "Export",
		description: "Export the active artboard as an editable vector PDF.",
		defaultPlacement: { column: 3 },
		render: ({ context }) => (
			<design-export-tile>
				<strong>Portable Document Format</strong>
				<span>
					RGB and CMYK vector fills are preserved through mondrian.pdf.
				</span>
				<button type="button" onClick={context.exportDocument}>
					Export PDF
				</button>
			</design-export-tile>
		),
	},
	{
		kind: "swatches",
		name: "Swatches",
		description: "Choose document colors with RGB and CMYK definitions.",
		defaultFill: true,
		defaultPlacement: { column: 4, fill: true },
		render: ({ context }) => (
			<design-swatches-tile>
				<strong>{context.document.swatches.length} swatches</strong>
				{context.document.swatches.map((swatch) => (
					<button
						key={swatch.id}
						type="button"
						aria-pressed={context.selectedSwatchId === swatch.id}
						onClick={() => context.selectSwatch(swatch)}
					>
						<i style={{ background: swatchCss(swatch) }} />
						<span>{swatch.name}</span>
						<small>{swatch.source.space.toUpperCase()}</small>
					</button>
				))}
			</design-swatches-tile>
		),
	},
] as const satisfies readonly TileRegistration<
	DesignTileKind,
	DesignTileContext
>[]

export const DESIGN_TILE_REGISTRY = createTileRegistry<
	DesignTileKind,
	DesignTileContext
>(registrations)
export const DEFAULT_DESIGN_TILING_LAYOUT =
	createRegistryDefaultLayout(DESIGN_TILE_REGISTRY)
export const DESIGN_TILING_STORAGE_KEY = "create-design:tiling-workspace"
