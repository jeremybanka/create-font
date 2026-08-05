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
import type { PngExportRequest } from "@create-design/png"
import type { SvgExportTarget, SvgImportResult } from "@create-design/svg"
import type { DesignTextService } from "@create-design/text"
import type {
	DesignAlignment,
	DesignAlignmentTarget,
	DesignTransformOrigin,
} from "./design-arrangement.ts"
import type {
	DesignArtboard,
	DesignBlend,
	DesignDocument,
	DesignFontReference,
	DesignObject,
	DesignStroke,
	DesignSwatch,
	DesignTextGeometry,
	DesignTextTypography,
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
	| "blend"
	| "transform"
	| "arrange"
	| "typography"
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
	readonly blendCreationDisabledReason: string | null
	readonly makeBlend: () => void
	readonly selectedBlend: DesignBlend | null
	readonly selectBlend: (blend: DesignBlend) => void
	readonly setBlendProperty: (
		blend: DesignBlend,
		property: Partial<Pick<DesignBlend, "name" | "steps">>,
	) => void
	readonly reverseBlendEndpoint: (endpoint: "start" | "end") => void
	readonly setBlendFirstPoint: (
		endpoint: "start" | "end",
		contourId: string,
		pointId: string,
	) => void
	readonly expandBlend: () => void
	readonly blendDiagnosticMessages: readonly string[]
	readonly directSelectionSummary: string
	readonly document: DesignDocument
	readonly activeLayerId: string
	readonly activeGroupScope: readonly string[]
	readonly selectedGroupId: string | null
	readonly selectLayer: (layerId: string) => void
	readonly selectHierarchyGroup: (
		groupId: string,
		layerId: string,
		parentScope: readonly string[],
	) => void
	readonly selectHierarchyObject: (
		object: DesignObject,
		layerId: string,
		parentScope: readonly string[],
		additive?: boolean,
	) => void
	readonly setHierarchyScope: (groupScope: readonly string[]) => void
	readonly expandSelection: () => void
	readonly expansionDisabledReason: string | null
	readonly expandStrokeSelection: () => void
	readonly expandTextSelection: () => void
	readonly textExpansionDisabledReason: string | null
	readonly exportDocument: (
		target?: PdfExportTarget,
		preferences?: ExportPreflightPreferences,
	) => void
	readonly exportSvgDocument: (target: SvgExportTarget) => void
	readonly exportPngDocument: (request: PngExportRequest) => void
	readonly importSvgDocument: (source: string) => SvgImportResult
	readonly focusCanvas: () => void
	readonly reviewSourceChange?: (change: DesignSourceReviewChange) => void
	readonly selectObject: (object: DesignObject, additive?: boolean) => void
	readonly selectSwatch: (swatch: DesignSwatch) => void
	readonly selectTool: (tool: DesignTool) => void
	readonly selectedObject: DesignObject | null
	readonly selectedObjectBounds?: Readonly<{
		minX: number
		minY: number
		maxX: number
		maxY: number
	}> | null
	readonly selectedObjectCount: number
	readonly selectedObjectIds: readonly string[]
	readonly textSelectionRange: Readonly<{ start: number; end: number }> | null
	readonly textOverset: boolean
	readonly availableTextFonts: readonly DesignFontReference[]
	readonly activeTextFontId: string | null
	readonly textToolsDisabledReason: string | null
	readonly textService?: DesignTextService
	readonly textFontRevision?: number
	readonly beginTextEditing: (object: DesignObject) => void
	readonly applyTextTypography: (
		properties: Partial<DesignTextTypography>,
	) => void
	readonly selectTextFont: (fontId: string) => void
	readonly registerTextFont: (file: File) => Promise<void>
	readonly applyAreaTextFrame: (
		properties: Partial<NonNullable<DesignTextGeometry["frame"]>>,
	) => void
	readonly convertSelectionToAreaText: () => void
	readonly areaTextConversionDisabledReason: string | null
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
		kind: "blend",
		name: "Blend",
		description: "Create, inspect, edit, and expand live contour blends.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "blend" }),
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
		kind: "typography",
		name: "Typography",
		description: "Edit live point and area text typography and frame flow.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			createElement(DesignTileContent, { context, kind: "typography" }),
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
export const OLDEST_DESIGN_TILING_STORAGE_KEY =
	"create-design:tiling-workspace:v2"
export const LEGACY_DESIGN_TILING_STORAGE_KEY =
	"create-design:tiling-workspace:v3"
export const PREVIOUS_DESIGN_TILING_STORAGE_KEY =
	"create-design:tiling-workspace:v4"
export const DESIGN_TILING_STORAGE_KEY = "create-design:tiling-workspace:v5"

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
					...(kinds.has("blend")
						? []
						: [{ id: "blend:migrated-v5", kind: "blend", fill: false }]),
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
			storage.getItem(`${LEGACY_DESIGN_TILING_STORAGE_KEY}:${suffix}`) ??
			storage.getItem(`${OLDEST_DESIGN_TILING_STORAGE_KEY}:${suffix}`)
		const layout = parseTilingLayout(legacy)
		if (layout !== null)
			storage.setItem(
				destination,
				serializeTilingLayout(splitObjectInspectorTiles(layout)),
			)
	}
}
