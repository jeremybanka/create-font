import {
	createRegistryDefaultLayout,
	createTileRegistry,
	type TileRegistration,
} from "@create-font/editor/shared"
import { h } from "preact"

import { DesignTileContent } from "./DesignTileContent.tsx"
import type {
	DesignDocument,
	DesignObject,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

export type DesignTileKind =
	| "pages"
	| "layers"
	| "canvas"
	| "tools"
	| "export"
	| "object"
	| "color"

export interface DesignTileContext {
	readonly addSwatch: () => void
	readonly deleteSelection: () => void
	readonly document: DesignDocument
	readonly expandSelection: () => void
	readonly expansionDisabledReason: string | null
	readonly exportDocument: () => void
	readonly focusCanvas: () => void
	readonly selectObject: (object: DesignObject) => void
	readonly selectSwatch: (swatch: DesignSwatch) => void
	readonly selectTool: (tool: DesignTool) => void
	readonly selectedObject: DesignObject | null
	readonly selectedSwatch: DesignSwatch | undefined
	readonly selectedSwatchId: string
	readonly setObjectProperty: (
		object: DesignObject,
		property: Partial<DesignObject>,
	) => void
	readonly setObjectGeometry: (
		object: DesignObject,
		geometry: DesignObject["geometry"],
	) => void
	readonly tool: DesignTool
	readonly updateSwatch: (swatch: DesignSwatch) => void
	readonly zoom: number
}

const registrations = [
	{
		kind: "pages",
		name: "Pages",
		description: "Navigate the document artboards.",
		defaultPlacement: { column: 1 },
		render: ({ context }) => h(DesignTileContent, { context, kind: "pages" }),
	},
	{
		kind: "layers",
		name: "Layers",
		description: "Select vector objects in stacking order.",
		defaultFill: true,
		defaultPlacement: { column: 1, fill: true },
		render: ({ context }) => h(DesignTileContent, { context, kind: "layers" }),
	},
	{
		kind: "canvas",
		name: "Canvas",
		description: "Focus the active artboard and inspect page dimensions.",
		defaultPlacement: { column: 2 },
		render: ({ context }) => h(DesignTileContent, { context, kind: "canvas" }),
	},
	{
		kind: "export",
		name: "Export",
		description: "Export the active artboard as an editable vector PDF.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) => h(DesignTileContent, { context, kind: "export" }),
	},
	{
		kind: "tools",
		name: "Tools",
		description: "Choose a vector drawing or transformation tool.",
		defaultFill: true,
		defaultPlacement: { column: 3, fill: true },
		render: ({ context }) => h(DesignTileContent, { context, kind: "tools" }),
	},
	{
		kind: "object",
		name: "Object",
		description: "Inspect and edit the selected vector object.",
		defaultPlacement: { column: 4 },
		render: ({ context }) => h(DesignTileContent, { context, kind: "object" }),
	},
	{
		kind: "color",
		name: "Color",
		description: "Edit RGB and CMYK document swatches and object fills.",
		defaultFill: true,
		defaultPlacement: { column: 4, fill: true },
		render: ({ context }) => h(DesignTileContent, { context, kind: "color" }),
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
export const DESIGN_TILING_STORAGE_KEY = "create-design:tiling-workspace:v2"
