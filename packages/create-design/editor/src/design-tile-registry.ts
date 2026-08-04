import {
	createRegistryDefaultLayout,
	createTileRegistry,
	parseTilingLayout,
	serializeTilingLayout,
	type TileRegistration,
	type TilingLayout,
} from "@create-art/editor"
import { createElement } from "react"

import { DesignTileContent } from "./DesignTileContent.tsx"
import type {
	AppearancePaintTarget,
	DesignAppearanceSummary,
} from "./appearance.ts"
import type {
	DesignSourceReviewChange,
	DesignSourceReviewController,
} from "./design-version-control.ts"
import type { DesignSnapCategory, DesignSnapSettings } from "./design-canvas.ts"
import type { PdfExportTarget } from "@create-design/pdf"
import type { ExportPreflightPreferences } from "@create-design/pdf"
import type { SvgExportTarget, SvgImportResult } from "@create-design/svg"
import type {
	DesignAlignment,
	DesignAlignmentTarget,
	DesignTransformOrigin,
} from "./design-arrangement.ts"
import type {
	DesignArtboard,
	DesignDocument,
	DesignObject,
	DesignStroke,
	DesignSwatch,
	DesignTool,
} from "./types.ts"

export type DesignTileKind =
	| "version-control"
	| "pages"
	| "layers"
	| "canvas"
	| "tools"
	| "export"
	| "object"
	| "transform"
	| "arrange"
	| "appearance"

export interface DesignTileContext {
	readonly activeArtboard: DesignArtboard
	readonly activateArtboard: (artboard: DesignArtboard, focus?: boolean) => void
	readonly createArtboard: () => void
	readonly deleteArtboard: () => void
	readonly duplicateArtboard: () => void
	readonly fitAllArtboards: () => void
	readonly moveArtworkWithArtboard: boolean
	readonly reorderArtboard: (direction: -1 | 1) => void
	readonly setArtboardProperty: (
		property: Partial<Omit<DesignArtboard, "id">>,
	) => void
	readonly setMoveArtworkWithArtboard: (enabled: boolean) => void
	readonly setDocumentTitle: (title: string) => void
	readonly addSwatch: () => void
	readonly appearanceDisabledReason: string | null
	readonly appearanceSummary: DesignAppearanceSummary
	readonly appearanceTarget: AppearancePaintTarget
	readonly applyAppearancePaint: (
		target: AppearancePaintTarget,
		swatchId: string | undefined,
	) => void
	readonly applyStrokeProperties: (
		properties: Partial<Omit<DesignStroke, "swatchId">>,
	) => void
	readonly alignSelection: (
		alignment: DesignAlignment,
		target: DesignAlignmentTarget,
		keyObjectId?: string,
	) => void
	readonly distributeSelection: (axis: "x" | "y") => void
	readonly selectionBounds: Readonly<{
		minX: number
		minY: number
		maxX: number
		maxY: number
	}> | null
	readonly selectionArrangementUnitCount?: number
	readonly selectionTransformDisabledReason?: string | null
	readonly transformSelection: (
		input: Readonly<{
			x?: number
			y?: number
			width?: number
			height?: number
			rotation?: number
			origin: DesignTransformOrigin
			constrainProportions?: boolean
		}>,
	) => void
	readonly canReviewSourceChange?: (change: DesignSourceReviewChange) => boolean
	readonly deleteSelection: () => void
	readonly directSelectionSummary: string
	readonly document: DesignDocument
	readonly expandSelection: () => void
	readonly expansionDisabledReason: string | null
	readonly expandStrokeSelection: () => void
	readonly exportDocument: (
		target?: PdfExportTarget,
		preferences?: ExportPreflightPreferences,
	) => void
	readonly exportSvgDocument: (target: SvgExportTarget) => void
	readonly importSvgDocument: (source: string) => SvgImportResult
	readonly focusCanvas: () => void
	readonly reviewSourceChange?: (change: DesignSourceReviewChange) => void
	readonly selectObject: (object: DesignObject, additive?: boolean) => void
	readonly selectSwatch: (swatch: DesignSwatch) => void
	readonly selectTool: (tool: DesignTool) => void
	readonly selectedObject: DesignObject | null
	readonly selectedObjectCount: number
	readonly selectedObjectIds: readonly string[]
	readonly selectedSwatch: DesignSwatch | undefined
	readonly selectedSwatchId: string
	readonly selectedGuideId: string | null
	readonly snapSettings: DesignSnapSettings
	readonly setSnapCategory: (
		category: DesignSnapCategory,
		enabled: boolean,
	) => void
	readonly setSnapThreshold: (pixels: number) => void
	readonly selectGuide: (id: string | null) => void
	readonly toggleGuideLock: (id: string) => void
	readonly deleteGuide: (id: string) => void
	readonly setObjectProperty: (
		object: DesignObject,
		property: Partial<DesignObject>,
	) => void
	readonly setObjectGeometry: (
		object: DesignObject,
		geometry: DesignObject["geometry"],
	) => void
	readonly setAppearanceTarget: (target: AppearancePaintTarget) => void
	readonly swapAppearancePaints: () => void
	readonly strokePropertiesDisabledReason: string | null
	readonly strokeExpansionDisabledReason: string | null
	readonly tool: DesignTool
	readonly updateSwatch: (swatch: DesignSwatch) => void
	readonly versionControl?: DesignSourceReviewController
	readonly zoom: number
}

const registrations = [
	{
		kind: "version-control",
		name: "Version Control",
		description: "Review and commit complete semantic design changes.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "version-control" }),
	},
	{
		kind: "pages",
		name: "Pages",
		description: "Navigate the document artboards.",
		defaultPlacement: { column: 1 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "pages" }),
	},
	{
		kind: "layers",
		name: "Layers",
		description: "Select vector objects in stacking order.",
		defaultFill: true,
		defaultPlacement: { column: 1, fill: true },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "layers" }),
	},
	{
		kind: "canvas",
		name: "Canvas",
		description: "Focus the active artboard and inspect page dimensions.",
		defaultPlacement: { column: 2 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "canvas" }),
	},
	{
		kind: "export",
		name: "Export",
		description: "Export the active artboard as an editable vector PDF.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "export" }),
	},
	{
		kind: "tools",
		name: "Tools",
		description: "Choose a vector drawing or transformation tool.",
		defaultFill: true,
		defaultPlacement: { column: 3, fill: true },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "tools" }),
	},
	{
		kind: "object",
		name: "Object",
		description: "Inspect and edit the selected vector object.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "object" }),
	},
	{
		kind: "transform",
		name: "Transform",
		description: "Position, size, and rotate the current selection.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "transform" }),
	},
	{
		kind: "arrange",
		name: "Arrange",
		description: "Align and distribute the current selection.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "arrange" }),
	},
	{
		kind: "appearance",
		name: "Appearance",
		description:
			"Author independent fill and stroke paints from shared swatches.",
		defaultFill: true,
		defaultPlacement: { column: 4, fill: true },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "appearance" }),
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
export const LEGACY_DESIGN_TILING_STORAGE_KEY =
	"create-design:tiling-workspace:v2"
export const PREVIOUS_DESIGN_TILING_STORAGE_KEY =
	"create-design:tiling-workspace:v3"
export const DESIGN_TILING_STORAGE_KEY = "create-design:tiling-workspace:v4"

function splitObjectInspectorTiles(layout: TilingLayout): TilingLayout {
	const kinds = new Set(
		layout.columns.flatMap((column) => column.tiles.map((tile) => tile.kind)),
	)
	if (!kinds.has("object")) return layout
	let inserted = false
	return {
		...layout,
		columns: layout.columns.map((column) => ({
			...column,
			tiles: column.tiles.flatMap((tile) => {
				if (inserted || tile.kind !== "object") return [tile]
				inserted = true
				return [
					tile,
					...(kinds.has("transform")
						? []
						: [
								{ id: "transform:migrated-v4", kind: "transform", fill: false },
							]),
					...(kinds.has("arrange")
						? []
						: [{ id: "arrange:migrated-v4", kind: "arrange", fill: false }]),
				]
			}),
		})),
	}
}

/**
 * Preserve customized layouts while splitting controls out of a visible Object
 * tile. Workspaces that deliberately removed Object keep the new inspectors in
 * the tile pool instead of having panels injected back into their layout.
 */
export function migrateDesignTilingStorage(
	storage: Pick<Storage, "getItem" | "setItem">,
): void {
	for (const suffix of ["saved:v1", "draft:v1"] as const) {
		const destination = `${DESIGN_TILING_STORAGE_KEY}:${suffix}`
		if (storage.getItem(destination) !== null) continue
		const legacy =
			storage.getItem(`${PREVIOUS_DESIGN_TILING_STORAGE_KEY}:${suffix}`) ??
			storage.getItem(`${LEGACY_DESIGN_TILING_STORAGE_KEY}:${suffix}`)
		const layout = parseTilingLayout(legacy)
		if (layout !== null)
			storage.setItem(
				destination,
				serializeTilingLayout(splitObjectInspectorTiles(layout)),
			)
	}
}
