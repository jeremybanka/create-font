import { h } from "preact"

import { CanvasToolbar } from "./CanvasToolbar.tsx"
import { CompatibilityTile } from "./CompatibilityTile.tsx"
import type { EditorWorkspace } from "./editor-workspace.ts"
import { FontNavigator } from "./FontNavigator.tsx"
import { GlyphInspector } from "./GlyphInspector.tsx"
import { KerningTile } from "./KerningTile.tsx"
import { PreviewTile } from "./PreviewTile.tsx"
import { SelectionDimensions } from "./SelectionDimensions.tsx"
import {
	createRegistryDefaultLayout,
	createTileRegistry,
	type TileRegistration,
} from "@create-art/editor"
import { normalizeTilingLayout, type TilingLayout } from "@create-art/editor"
import type { EditorVersionControl } from "./version-control.ts"
import { VersionControlTile } from "./VersionControlTile.tsx"

export type FontTileKind =
	| "font-navigation"
	| "canvas-toolbar"
	| "kerning"
	| "preview"
	| "compatibility"
	| "version-control"
	| "glyph-attributes"
	| "selection-dimensions"

export interface FontTileContext {
	readonly diffView: boolean
	readonly onDiffViewChange: (diffView: boolean) => void
	readonly onReviewGlyph: (
		glyphId: Parameters<EditorWorkspace["actions"]["reviewGlyph"]>[0],
	) => void
	readonly versionControl?: EditorVersionControl
	readonly workspace: EditorWorkspace
}

const registrations = [
	{
		kind: "version-control",
		name: "Version Control",
		description: "Review and commit discrete working-source changes.",
		defaultFill: true,
		defaultPlacement: { column: 2, fill: true },
		render: ({ context }) =>
			h(VersionControlTile, {
				diffView: context.diffView,
				onDiffViewChange: context.onDiffViewChange,
				onReviewGlyph: context.onReviewGlyph,
				...(context.versionControl === undefined
					? {}
					: { versionControl: context.versionControl }),
			}),
	},
	{
		kind: "font-navigation",
		name: "Masters & instances",
		description: "Navigate font masters and named instances.",
		defaultPlacement: { column: 1, fill: true },
		render: ({ context }) => h(FontNavigator, { workspace: context.workspace }),
	},
	{
		kind: "canvas-toolbar",
		name: "Canvas toolbar",
		description: "Control design-space coordinates and the canvas viewport.",
		defaultPlacement: { column: 3 },
		render: ({ context }) => h(CanvasToolbar, { workspace: context.workspace }),
	},
	{
		kind: "kerning",
		name: "Kerning",
		description: "Inspect and edit the glyph pair at the text cursor.",
		render: ({ context }) => h(KerningTile, { workspace: context.workspace }),
	},
	{
		kind: "preview",
		name: "Preview",
		description: "Proof custom text, samples, and variation settings.",
		defaultFill: true,
		render: ({ context, tile }) =>
			h(PreviewTile, { workspace: context.workspace, tileId: tile.id }),
	},
	{
		kind: "compatibility",
		name: "Master compatibility",
		description: "Compare master topology, offset overlays, and reorder paths.",
		render: ({ context }) =>
			h(CompatibilityTile, { workspace: context.workspace }),
	},
	{
		kind: "glyph-attributes",
		name: "Glyph attributes",
		description: "Inspect glyph metrics, selection, and preview state.",
		defaultPlacement: { column: 4 },
		render: ({ context }) =>
			h(GlyphInspector, { workspace: context.workspace }),
	},
	{
		kind: "selection-dimensions",
		name: "Selection dimensions",
		description: "Inspect and transform a selection from nine origins.",
		render: ({ context }) =>
			h(SelectionDimensions, { workspace: context.workspace }),
	},
] as const satisfies readonly TileRegistration<FontTileKind, FontTileContext>[]

export const FONT_TILE_REGISTRY = createTileRegistry<
	FontTileKind,
	FontTileContext
>(registrations)
export const DEFAULT_FONT_TILING_LAYOUT =
	createRegistryDefaultLayout(FONT_TILE_REGISTRY)
export const FONT_TILING_STORAGE_KEY = "create-font:tiling-workspace"

export function migrateLegacyFontLayout(
	layout: TilingLayout,
	version: number,
): TilingLayout {
	let columns = [...layout.columns]
	const has = (kind: FontTileKind): boolean =>
		columns.some((column) => column.tiles.some((tile) => tile.kind === kind))
	if (version === 1 && !has("canvas-toolbar")) {
		columns = columns.map((column) =>
			column.id === 3
				? {
						...column,
						alignment: "top",
						collapsed: false,
						tiles: [
							...column.tiles,
							{
								id: "canvas-toolbar:default",
								kind: "canvas-toolbar",
								fill: false,
							},
						],
					}
				: column,
		)
	}
	if (version < 3 && !has("version-control")) {
		columns = columns.map((column) =>
			column.id === 2
				? {
						...column,
						collapsed: false,
						tiles: [
							{
								id: "version-control:default",
								kind: "version-control",
								fill: true,
							},
							...column.tiles,
						],
					}
				: column,
		)
	}
	return { version: 3, columns }
}

export function parseFontTilingLayout(
	value: string | null,
): TilingLayout | null {
	if (value === null) return null
	try {
		const parsed = JSON.parse(value) as { version?: unknown }
		const layout = normalizeTilingLayout(parsed)
		if (layout === null) return null
		return migrateLegacyFontLayout(
			layout,
			typeof parsed.version === "number" ? parsed.version : 3,
		)
	} catch {
		return null
	}
}
