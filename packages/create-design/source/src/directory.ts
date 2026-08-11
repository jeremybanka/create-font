import {
	formatSourceJson,
	type SourceJsonValue,
} from "@create-art/source-format"
import { z } from "zod/v4"

import {
	appearanceSchema,
	artboardIdSchema,
	designArtboardColorSchema,
	artboardInsetsSchema,
	CREATE_DESIGN_DOCUMENT_FORMAT,
	CREATE_DESIGN_DOCUMENT_VERSION,
	DEFAULT_ARTBOARD_ID,
	DEFAULT_LAYER_ID,
	designObjectIdSchema,
	designBlendSchema,
	finiteNumberSchema,
	guideSchema,
	legacyGuideSchema,
	migrateLegacyGuide,
	linkedArtboardGeometrySchema,
	positiveNumberSchema,
	LEGACY_DESIGN_DOCUMENT_VERSION,
	PREVIOUS_DESIGN_DOCUMENT_VERSION,
	VERSION_SIX_DESIGN_DOCUMENT_VERSION,
	VERSION_FIVE_DESIGN_DOCUMENT_VERSION,
	VERSION_FOUR_DESIGN_DOCUMENT_VERSION,
	VERSION_THREE_DESIGN_DOCUMENT_VERSION,
	VERSION_TWO_DESIGN_DOCUMENT_VERSION,
	previousContourSchema,
	previousGeometrySchema,
	stabilizeDesignObjectIdentities,
	swatchIdSchema,
	swatchSchema,
	transformSchema,
	textGeometrySchema,
	validateDesignDocument,
	versionTwoAppearanceSchema,
	versionSixGeometrySchema,
} from "./document.ts"
import { diagnostic, failure, success } from "./result.ts"
import {
	DESIGN_LAYER_UI_COLORS,
	designLayerUiColorAt,
} from "./layer-ui-color.ts"
import { DEFAULT_DESIGN_STROKE_STYLE } from "./types.ts"
import type {
	DesignDocument,
	DesignGroup,
	DesignLayer,
	DesignObject,
	DesignSceneChild,
	DesignSourceDiagnostic,
	DesignSourceResult,
} from "./types.ts"

export const CREATE_DESIGN_SOURCE_FORMAT = "create-design.source" as const
export const CREATE_DESIGN_SOURCE_VERSION = 6 as const
export const PREVIOUS_CREATE_DESIGN_SOURCE_VERSION = 5 as const
export const VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION = 4 as const
export const VERSION_THREE_CREATE_DESIGN_SOURCE_VERSION = 3 as const
export const VERSION_TWO_CREATE_DESIGN_SOURCE_VERSION = 2 as const
export const LEGACY_CREATE_DESIGN_SOURCE_VERSION = 1 as const

const layerIdSchema = z.string().regex(/^layer:.+/u)
const groupIdSchema = z.string().regex(/^group:.+/u)
const assetIdSchema = z.string().regex(/^asset:.+/u)
const fontIdSchema = z.string().regex(/^font:.+/u)
const mediaTypeSchema = z
	.string()
	.regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)

export const projectFileSchema = z
	.object({
		format: z.literal(CREATE_DESIGN_SOURCE_FORMAT),
		sourceVersion: z.union([
			z.literal(LEGACY_CREATE_DESIGN_SOURCE_VERSION),
			z.literal(VERSION_TWO_CREATE_DESIGN_SOURCE_VERSION),
			z.literal(VERSION_THREE_CREATE_DESIGN_SOURCE_VERSION),
			z.literal(VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION),
			z.literal(PREVIOUS_CREATE_DESIGN_SOURCE_VERSION),
			z.literal(CREATE_DESIGN_SOURCE_VERSION),
		]),
		documentFormat: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		documentVersion: z.union([
			z.literal(LEGACY_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_TWO_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_FOUR_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_THREE_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_FIVE_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_SIX_DESIGN_DOCUMENT_VERSION),
			z.literal(PREVIOUS_DESIGN_DOCUMENT_VERSION),
			z.literal(CREATE_DESIGN_DOCUMENT_VERSION),
		]),
	})
	.strict()
export const legacyDocumentFileSchema = z
	.object({
		format: z.literal("create-design.metadata"),
		version: z.literal(1),
		title: z.string(),
		guides: z.array(legacyGuideSchema),
		blends: z.array(designBlendSchema).optional(),
	})
	.strict()
export const documentFileSchema = z.union([
	z
		.object({
			format: z.literal("create-design.metadata"),
			version: z.literal(2),
			title: z.string(),
			guides: z.array(guideSchema),
			blends: z.array(designBlendSchema).optional(),
		})
		.strict(),
	legacyDocumentFileSchema.transform((file) => ({
		...file,
		version: 2 as const,
		guides: file.guides.map(migrateLegacyGuide),
	})),
])
export const paletteFileSchema = z
	.object({
		format: z.literal("create-design.palette"),
		version: z.literal(1),
		swatches: z.array(swatchSchema),
	})
	.strict()
const currentArtboardFileSchema = z
	.object({
		format: z.literal("create-design.artboard"),
		version: z.literal(2),
		id: artboardIdSchema,
		name: z.string(),
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
		backgroundColor: designArtboardColorSchema.optional(),
		borderColor: designArtboardColorSchema.optional(),
		bleed: artboardInsetsSchema.optional(),
		safeArea: artboardInsetsSchema.optional(),
	})
	.strict()
const offsetLegacyArtboardFileSchema = z
	.object({
		format: z.literal("create-design.artboard"),
		version: z.literal(1),
		id: artboardIdSchema,
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
	})
	.strict()
	.transform((file) => ({
		...file,
		version: 2 as const,
		name: "Artboard 1",
	}))
const originLegacyArtboardFileSchema = z
	.object({
		format: z.literal("create-design.artboard"),
		version: z.literal(1),
		id: artboardIdSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
	})
	.strict()
	.transform((file) => ({
		...file,
		version: 2 as const,
		name: "Artboard 1",
		x: 0,
		y: 0,
	}))
export const artboardFileSchema = z.union([
	currentArtboardFileSchema,
	offsetLegacyArtboardFileSchema,
	originLegacyArtboardFileSchema,
])
const sceneChildSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("object"), id: designObjectIdSchema }).strict(),
	z.object({ kind: z.literal("group"), id: groupIdSchema }).strict(),
])
const currentLayerFileSchema = z
	.object({
		format: z.literal("create-design.layer"),
		version: z.literal(2),
		id: layerIdSchema,
		name: z.string(),
		children: z.array(sceneChildSchema),
		uiColor: z.enum(DESIGN_LAYER_UI_COLORS).optional(),
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const legacyLayerFileSchema = z
	.object({
		format: z.literal("create-design.layer"),
		version: z.literal(1),
		id: layerIdSchema,
		children: z.array(sceneChildSchema),
	})
	.strict()
	.transform((layer) => ({ ...layer, version: 2 as const, name: "Artwork" }))
export const layerFileSchema = z.union([
	currentLayerFileSchema,
	legacyLayerFileSchema,
])
export const groupFileSchema = z
	.object({
		format: z.literal("create-design.group"),
		version: z.literal(1),
		id: groupIdSchema,
		name: z.string(),
		children: z.array(sceneChildSchema),
		clippingPathId: designObjectIdSchema.optional(),
	})
	.strict()
const inlineObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(1),
		id: designObjectIdSchema,
		name: z.string(),
		geometry: versionSixGeometrySchema,
		transform: transformSchema,
		appearance: appearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const linkedArtboardObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(3),
		id: designObjectIdSchema,
		name: z.string(),
		geometry: linkedArtboardGeometrySchema,
		transform: transformSchema,
		appearance: appearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()

/** Raw UTF-8 text units live beside their owning object JSON. */
export const textContentUnitPathSchema = z
	.string()
	.regex(
		/^scene\/objects\/(?:[A-Za-z0-9._~%-]+\/)*[A-Za-z0-9._~%-]+\.txt$/u,
		"Expected a relative TXT path below scene/objects/.",
	)
	.refine(
		(path) => hasSafePathSegments(path.slice("scene/objects/".length)),
		"Expected a safe relative TXT path below scene/objects/.",
	)

const externalTextGeometrySchema = textGeometrySchema
	.omit({ text: true })
	.extend({ contentPath: textContentUnitPathSchema })
	.strict()
const externalObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(2),
		id: designObjectIdSchema,
		name: z.string(),
		geometry: externalTextGeometrySchema,
		transform: transformSchema,
		appearance: appearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
const versionTwoObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(1),
		id: designObjectIdSchema,
		name: z.string(),
		geometry: previousGeometrySchema,
		transform: transformSchema,
		appearance: versionTwoAppearanceSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
	.transform((file) => ({
		...file,
		appearance: {
			...file.appearance,
			...(file.appearance.stroke === undefined
				? {}
				: {
						stroke: {
							...file.appearance.stroke,
							...DEFAULT_DESIGN_STROKE_STYLE,
						},
					}),
		},
	}))
const legacyObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(1),
		id: designObjectIdSchema,
		name: z.string(),
		contours: z.array(previousContourSchema),
		fillId: swatchIdSchema,
		hidden: z.boolean().optional(),
		locked: z.boolean().optional(),
	})
	.strict()
	.transform((file) => ({
		format: file.format,
		version: file.version,
		id: file.id,
		name: file.name,
		geometry: { kind: "path" as const, contours: file.contours },
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		appearance: { fill: { swatchId: file.fillId } },
		...(file.hidden === undefined ? {} : { hidden: file.hidden }),
		...(file.locked === undefined ? {} : { locked: file.locked }),
	}))
export const objectFileSchema = z
	.union([
		linkedArtboardObjectFileSchema,
		externalObjectFileSchema,
		inlineObjectFileSchema,
		versionTwoObjectFileSchema,
		legacyObjectFileSchema,
	])
	.transform((file) => ({
		format: file.format,
		version: file.version,
		id: file.id,
		name: file.name,
		geometry: file.geometry,
		transform: file.transform,
		appearance: file.appearance,
		...(file.hidden === undefined ? {} : { hidden: file.hidden }),
		...(file.locked === undefined ? {} : { locked: file.locked }),
	}))
	.superRefine((file, context) => {
		if (file.geometry.kind !== "path") return
		for (const [contourIndex, contour] of file.geometry.contours.entries()) {
			for (const [pointIndex, point] of contour.points.entries()) {
				if (point.corner === undefined) continue
				const path = [
					"geometry",
					"contours",
					contourIndex,
					"points",
					pointIndex,
					"corner",
				]
				const effectiveMode =
					point.mode ??
					(point.incoming === undefined && point.outgoing === undefined
						? "hard"
						: "soft")
				if (effectiveMode !== "hard")
					context.addIssue({
						code: "custom",
						path,
						message: "Corner profiles require a hard node.",
					})
				if (contour.points.length < 3)
					context.addIssue({
						code: "custom",
						path,
						message:
							"Corner profiles require a contour with at least three points.",
					})
				else if (
					!contour.closed &&
					(pointIndex === 0 || pointIndex === contour.points.length - 1)
				)
					context.addIssue({
						code: "custom",
						path,
						message:
							"Corner profiles cannot be applied to an open contour endpoint.",
					})
			}
		}
	})

const indexEntry = <Id extends z.ZodType>(id: Id, path: z.ZodType<string>) =>
	z.object({ id, path }).strict()

function isSafeCollectionUnitPath(path: string, directory: string): boolean {
	const prefix = `${directory}/`
	if (
		!path.startsWith(prefix) ||
		path === `${prefix}index.json` ||
		!path.endsWith(".json")
	)
		return false
	return hasSafePathSegments(path.slice(prefix.length))
}

function hasSafePathSegments(relativePath: string): boolean {
	for (const rawSegment of relativePath.split("/")) {
		if (rawSegment.length === 0) return false
		let segment = rawSegment
		for (let pass = 0; /%[0-9A-Fa-f]{2}/u.test(segment); pass += 1) {
			if (pass > rawSegment.length) return false
			try {
				segment = decodeURIComponent(segment)
			} catch {
				return false
			}
		}
		if (
			segment === "." ||
			segment === ".." ||
			segment.includes("/") ||
			segment.includes("\\")
		)
			return false
	}
	return true
}

function collectionUnitPathSchema(directory: string) {
	return z
		.string()
		.regex(
			new RegExp(
				`^${directory}/(?!index\\.json$)(?:[A-Za-z0-9._~%-]+/)*[A-Za-z0-9._~%-]+\\.json$`,
				"u",
			),
			`Expected a relative JSON path below ${directory}/.`,
		)
		.refine(
			(path) => isSafeCollectionUnitPath(path, directory),
			`Expected a safe relative JSON path below ${directory}/.`,
		)
}

export const artboardUnitPathSchema = collectionUnitPathSchema("artboards")
export const layerUnitPathSchema = collectionUnitPathSchema("scene/layers")
export const groupUnitPathSchema = collectionUnitPathSchema("scene/groups")
export const objectUnitPathSchema = collectionUnitPathSchema("scene/objects")
export const textContentUnitPathForObjectPath = (objectPath: string): string =>
	`${objectPath.slice(0, -".json".length)}.txt`
export const assetUnitPathSchema = z
	.string()
	.refine(
		(path) =>
			path.startsWith("assets/") &&
			path !== "assets/index.json" &&
			hasSafePathSegments(path.slice("assets/".length)),
		"Expected a safe relative path below assets/.",
	)
export const fontUnitPathSchema = z
	.string()
	.refine(
		(path) =>
			path.startsWith("fonts/") &&
			path !== "fonts/index.json" &&
			hasSafePathSegments(path.slice("fonts/".length)),
		"Expected a safe relative path below fonts/.",
	)

function collectionIndexSchema<Format extends string, Id extends z.ZodType>(
	format: Format,
	id: Id,
	path: z.ZodType<string>,
) {
	return z
		.object({
			format: z.literal(format),
			version: z.literal(1),
			entries: z.array(indexEntry(id, path)),
		})
		.strict()
}

export const artboardIndexFileSchema = collectionIndexSchema(
	"create-design.artboard-index",
	artboardIdSchema,
	artboardUnitPathSchema,
)
export const layerIndexFileSchema = collectionIndexSchema(
	"create-design.layer-index",
	layerIdSchema,
	layerUnitPathSchema,
)
export const groupIndexFileSchema = collectionIndexSchema(
	"create-design.group-index",
	groupIdSchema,
	groupUnitPathSchema,
)
export const objectIndexFileSchema = collectionIndexSchema(
	"create-design.object-index",
	designObjectIdSchema,
	objectUnitPathSchema,
)
export const assetIndexFileSchema = z
	.object({
		format: z.literal("create-design.asset-index"),
		version: z.literal(1),
		entries: z.array(
			z
				.object({
					id: assetIdSchema,
					path: assetUnitPathSchema,
					mediaType: mediaTypeSchema,
					byteLength: z.number().int().nonnegative(),
					sha256: z.string().regex(/^[0-9a-f]{64}$/u),
				})
				.strict(),
		),
	})
	.strict()
export const fontIndexFileSchema = z
	.object({
		format: z.literal("create-design.font-index"),
		version: z.literal(1),
		entries: z.array(
			z
				.object({
					byteLength: z.number().int().nonnegative(),
					id: fontIdSchema,
					mediaType: mediaTypeSchema,
					path: fontUnitPathSchema,
					sha256: z.string().regex(/^[0-9a-f]{64}$/u),
					family: z.string().min(1).optional(),
					faceIndex: z.number().int().nonnegative().optional(),
					revision: z.union([z.string(), finiteNumberSchema]).optional(),
				})
				.strict(),
		),
	})
	.strict()

export type ProjectFile = z.infer<typeof projectFileSchema>
export type DocumentFile = z.infer<typeof documentFileSchema>
export type PaletteFile = z.infer<typeof paletteFileSchema>
export type ArtboardFile = z.infer<typeof artboardFileSchema>
export type LayerFile = z.infer<typeof layerFileSchema>
export type GroupFile = z.infer<typeof groupFileSchema>
export type ObjectFile = z.infer<typeof objectFileSchema>
export type ArtboardIndexFile = z.infer<typeof artboardIndexFileSchema>
export type LayerIndexFile = z.infer<typeof layerIndexFileSchema>
export type GroupIndexFile = z.infer<typeof groupIndexFileSchema>
export type ObjectIndexFile = z.infer<typeof objectIndexFileSchema>
export type AssetIndexFile = z.infer<typeof assetIndexFileSchema>
export type FontIndexFile = z.infer<typeof fontIndexFileSchema>
export type DesignSourceDirectoryFiles = Readonly<Record<string, unknown>>

export const designSourcePaths = {
	project: "create-design.json",
	document: "document.json",
	palette: "palette.json",
	artboardIndex: "artboards/index.json",
	layerIndex: "scene/layers/index.json",
	groupIndex: "scene/groups/index.json",
	objectIndex: "scene/objects/index.json",
	assetIndex: "assets/index.json",
	fontIndex: "fonts/index.json",
} as const

export type DesignSourceUnitKind =
	| "project"
	| "document"
	| "palette"
	| "artboard-index"
	| "artboard"
	| "layer-index"
	| "layer"
	| "group-index"
	| "group"
	| "object-index"
	| "object"
	| "text-content"
	| "asset-index"
	| "font-index"

const schemas = {
	project: projectFileSchema,
	document: documentFileSchema,
	palette: paletteFileSchema,
	"artboard-index": artboardIndexFileSchema,
	artboard: artboardFileSchema,
	"layer-index": layerIndexFileSchema,
	layer: layerFileSchema,
	"group-index": groupIndexFileSchema,
	group: groupFileSchema,
	"object-index": objectIndexFileSchema,
	object: objectFileSchema,
	"text-content": z
		.string()
		.refine(
			(value) => value.isWellFormed(),
			"Raw text must contain well-formed Unicode scalar values.",
		),
	"asset-index": assetIndexFileSchema,
	"font-index": fontIndexFileSchema,
} as const satisfies Record<DesignSourceUnitKind, z.ZodType>

export const sourceUnitDescriptors = {
	project: { path: designSourcePaths.project, schema: projectFileSchema },
	document: { path: designSourcePaths.document, schema: documentFileSchema },
	palette: { path: designSourcePaths.palette, schema: paletteFileSchema },
	artboard: {
		inventoryPath: designSourcePaths.artboardIndex,
		inventorySchema: artboardIndexFileSchema,
		unitSchema: artboardFileSchema,
	},
	layer: {
		inventoryPath: designSourcePaths.layerIndex,
		inventorySchema: layerIndexFileSchema,
		unitSchema: layerFileSchema,
	},
	group: {
		inventoryPath: designSourcePaths.groupIndex,
		inventorySchema: groupIndexFileSchema,
		unitSchema: groupFileSchema,
	},
	object: {
		inventoryPath: designSourcePaths.objectIndex,
		inventorySchema: objectIndexFileSchema,
		unitSchema: objectFileSchema,
	},
	asset: {
		inventoryPath: designSourcePaths.assetIndex,
		inventorySchema: assetIndexFileSchema,
	},
	font: {
		inventoryPath: designSourcePaths.fontIndex,
		inventorySchema: fontIndexFileSchema,
	},
} as const

function encodePathSegment(value: string): string {
	const encoded = encodeURIComponent(value).replace(
		/[!'()*]/gu,
		(character) =>
			`%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	)
	let hash = 0x811c9dc5
	for (const byte of new TextEncoder().encode(value))
		hash = Math.imul(hash ^ byte, 0x01000193)
	return `${encoded}~${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function defaultObjectUnitPath(id: string): string {
	return `scene/objects/${encodePathSegment(id)}.json`
}

export function defaultTextContentUnitPath(id: string): string {
	return textContentUnitPathForObjectPath(defaultObjectUnitPath(id))
}

export function defaultGroupUnitPath(id: string): string {
	return `scene/groups/${encodePathSegment(id)}.json`
}

export function defaultLayerUnitPath(id: string): string {
	return id === DEFAULT_LAYER_ID
		? "scene/layers/artwork.json"
		: `scene/layers/${encodePathSegment(id)}.json`
}

export function defaultArtboardUnitPath(id: string): string {
	return id === DEFAULT_ARTBOARD_ID
		? "artboards/page.json"
		: `artboards/${encodePathSegment(id)}.json`
}

export function sourceUnitKindForPath(
	path: string,
): DesignSourceUnitKind | null {
	if (path === designSourcePaths.project) return "project"
	if (path === designSourcePaths.document) return "document"
	if (path === designSourcePaths.palette) return "palette"
	if (path === designSourcePaths.artboardIndex) return "artboard-index"
	if (path === designSourcePaths.layerIndex) return "layer-index"
	if (path === designSourcePaths.groupIndex) return "group-index"
	if (path === designSourcePaths.objectIndex) return "object-index"
	if (path === designSourcePaths.assetIndex) return "asset-index"
	if (path === designSourcePaths.fontIndex) return "font-index"
	if (artboardUnitPathSchema.safeParse(path).success) return "artboard"
	if (layerUnitPathSchema.safeParse(path).success) return "layer"
	if (groupUnitPathSchema.safeParse(path).success) return "group"
	if (objectUnitPathSchema.safeParse(path).success) return "object"
	if (textContentUnitPathSchema.safeParse(path).success) return "text-content"
	return null
}

function zodDiagnostics(
	error: z.ZodError,
	unitPath?: string,
): readonly DesignSourceDiagnostic[] {
	return error.issues.map((issue) =>
		diagnostic(
			"source.schema",
			issue.path.length === 0
				? "$"
				: `$${issue.path
						.map((part) =>
							typeof part === "number" ? `[${part}]` : `.${String(part)}`,
						)
						.join("")}`,
			issue.message,
			unitPath,
		),
	)
}

export function validateSourceUnit(
	kind: DesignSourceUnitKind,
	value: unknown,
	unitPath?: string,
): DesignSourceResult<unknown> {
	const parsed = schemas[kind].safeParse(value)
	return parsed.success
		? success(parsed.data)
		: failure(zodDiagnostics(parsed.error, unitPath))
}

export function parseSourceUnitText(
	kind: DesignSourceUnitKind,
	text: string,
	unitPath?: string,
): DesignSourceResult<unknown> {
	if (kind === "text-content") return validateSourceUnit(kind, text, unitPath)
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return failure([
			diagnostic("json.syntax", "$", "Invalid JSON syntax.", unitPath),
		])
	}
	return validateSourceUnit(kind, value, unitPath)
}

export function formatSourceUnit(
	kind: DesignSourceUnitKind,
	value: unknown,
): DesignSourceResult<string> {
	const validated = validateSourceUnit(kind, value)
	if (kind === "text-content" && validated.ok)
		return success(validated.value as string)
	return validated.ok
		? success(formatSourceJson(validated.value as unknown as SourceJsonValue))
		: failure(validated.errors)
}

export interface SplitDesignDocumentOptions {
	readonly assetIndex?: AssetIndexFile
	readonly artboardPath?: (
		artboard: DesignDocument["artboards"][number],
		index: number,
	) => string
	readonly objectPath?: (object: DesignObject, index: number) => string
	readonly groupPath?: (group: DesignGroup, index: number) => string
	readonly layerPath?: (layer: DesignLayer, index: number) => string
}

function objectFile(object: DesignObject, objectPath: string): ObjectFile {
	const geometry = (() => {
		if (object.geometry.kind !== "text") return object.geometry
		const { text: _text, ...external } = object.geometry
		return {
			...external,
			contentPath: textContentUnitPathForObjectPath(objectPath),
		}
	})()
	return {
		format: "create-design.object",
		version:
			object.geometry.kind === "text"
				? 2
				: object.geometry.kind === "artboard-link"
					? 3
					: 1,
		id: object.id,
		name: object.name,
		geometry,
		transform: object.transform,
		appearance: object.appearance,
		...(object.hidden === undefined ? {} : { hidden: object.hidden }),
		...(object.locked === undefined ? {} : { locked: object.locked }),
	}
}

export function splitDesignDocument(
	document: DesignDocument,
	options: SplitDesignDocumentOptions = {},
): DesignSourceResult<DesignSourceDirectoryFiles> {
	const validated = validateDesignDocument(document)
	if (!validated.ok) return failure(validated.errors)
	const objectEntries = validated.value.objects.map((object, index) => ({
		id: object.id,
		path:
			options.objectPath?.(object, index) ?? defaultObjectUnitPath(object.id),
	}))
	const groups = validated.value.groups
	const layerEntries = validated.value.layers.map((layer, index) => ({
		id: layer.id,
		path: options.layerPath?.(layer, index) ?? defaultLayerUnitPath(layer.id),
	}))
	const groupEntries = groups.map((group, index) => ({
		id: group.id,
		path: options.groupPath?.(group, index) ?? defaultGroupUnitPath(group.id),
	}))
	const artboardEntries = validated.value.artboards.map((artboard, index) => ({
		id: artboard.id,
		path:
			options.artboardPath?.(artboard, index) ??
			defaultArtboardUnitPath(artboard.id),
	}))
	const errors: DesignSourceDiagnostic[] = []
	const paths = new Set<string>()
	for (const [index, entry] of artboardEntries.entries()) {
		if (!artboardUnitPathSchema.safeParse(entry.path).success)
			errors.push(
				diagnostic(
					"directory.unsafe_path",
					`$.artboards[${index}].path`,
					`Artboard ${entry.id} has unsafe source path ${entry.path}.`,
				),
			)
		if (paths.has(entry.path))
			errors.push(
				diagnostic(
					"directory.duplicate_path",
					`$.artboards[${index}].path`,
					`Duplicate artboard source path ${entry.path}.`,
				),
			)
		paths.add(entry.path)
	}
	paths.clear()
	for (const [index, entry] of layerEntries.entries()) {
		if (!layerUnitPathSchema.safeParse(entry.path).success)
			errors.push(
				diagnostic(
					"directory.unsafe_path",
					`$.layers[${index}].path`,
					`Layer ${entry.id} has unsafe source path ${entry.path}.`,
				),
			)
		if (paths.has(entry.path))
			errors.push(
				diagnostic(
					"directory.duplicate_path",
					`$.layers[${index}].path`,
					`Duplicate layer source path ${entry.path}.`,
				),
			)
		paths.add(entry.path)
	}
	paths.clear()
	for (const [index, entry] of groupEntries.entries()) {
		if (!groupUnitPathSchema.safeParse(entry.path).success)
			errors.push(
				diagnostic(
					"directory.unsafe_path",
					`$.groups[${index}].path`,
					`Group ${entry.id} has unsafe source path ${entry.path}.`,
				),
			)
		if (paths.has(entry.path))
			errors.push(
				diagnostic(
					"directory.duplicate_path",
					`$.groups[${index}].path`,
					`Duplicate group source path ${entry.path}.`,
				),
			)
		paths.add(entry.path)
	}
	paths.clear()
	for (const [index, entry] of objectEntries.entries()) {
		if (!objectUnitPathSchema.safeParse(entry.path).success)
			errors.push(
				diagnostic(
					"directory.unsafe_path",
					`$.objects[${index}].path`,
					`Object ${entry.id} has unsafe source path ${entry.path}.`,
				),
			)
		if (paths.has(entry.path))
			errors.push(
				diagnostic(
					"directory.duplicate_path",
					`$.objects[${index}].path`,
					`Duplicate object source path ${entry.path}.`,
				),
			)
		paths.add(entry.path)
	}
	if (errors.length > 0) return failure(errors)

	const files: Record<string, unknown> = {
		[designSourcePaths.project]: {
			format: CREATE_DESIGN_SOURCE_FORMAT,
			sourceVersion: CREATE_DESIGN_SOURCE_VERSION,
			documentFormat: CREATE_DESIGN_DOCUMENT_FORMAT,
			documentVersion: CREATE_DESIGN_DOCUMENT_VERSION,
		} satisfies ProjectFile,
		[designSourcePaths.document]: {
			format: "create-design.metadata",
			version: 2,
			title: validated.value.title,
			guides: validated.value.guides.map((guide) => ({ ...guide })),
			...(validated.value.blends === undefined
				? {}
				: { blends: validated.value.blends }),
		} satisfies DocumentFile,
		[designSourcePaths.palette]: {
			format: "create-design.palette",
			version: 1,
			swatches: validated.value.swatches.map((swatch) => ({
				id: swatch.id,
				name: swatch.name,
				source: { ...swatch.source },
				...(swatch.alternate === undefined
					? {}
					: { alternate: { ...swatch.alternate } }),
			})),
		} satisfies PaletteFile,
		[designSourcePaths.artboardIndex]: {
			format: "create-design.artboard-index",
			version: 1,
			entries: artboardEntries,
		} satisfies ArtboardIndexFile,
		[designSourcePaths.layerIndex]: {
			format: "create-design.layer-index",
			version: 1,
			entries: layerEntries,
		} satisfies LayerIndexFile,
		[designSourcePaths.groupIndex]: {
			format: "create-design.group-index",
			version: 1,
			entries: groupEntries.toSorted((left, right) =>
				left.id.localeCompare(right.id),
			),
		} satisfies GroupIndexFile,
		[designSourcePaths.objectIndex]: {
			format: "create-design.object-index",
			version: 1,
			entries: objectEntries.toSorted((left, right) =>
				left.id.localeCompare(right.id),
			),
		} satisfies ObjectIndexFile,
		[designSourcePaths.assetIndex]:
			options.assetIndex ??
			({
				format: "create-design.asset-index",
				version: 1,
				entries: [],
			} satisfies AssetIndexFile),
		[designSourcePaths.fontIndex]: {
			format: "create-design.font-index",
			version: 1,
			entries: [],
		} satisfies FontIndexFile,
	}
	for (const [index, artboard] of validated.value.artboards.entries()) {
		const entry = artboardEntries[index]
		if (entry === undefined) continue
		files[entry.path] = {
			format: "create-design.artboard",
			version: 2,
			...artboard,
		} satisfies ArtboardFile
	}
	for (const [index, layer] of validated.value.layers.entries()) {
		const entry = layerEntries[index]
		if (entry === undefined) continue
		files[entry.path] = {
			format: "create-design.layer",
			version: 2,
			...layer,
		} satisfies LayerFile
	}
	for (const [index, object] of validated.value.objects.entries()) {
		const entry = objectEntries[index]
		if (entry === undefined) continue
		files[entry.path] = objectFile(object, entry.path)
		if (object.geometry.kind === "text")
			files[textContentUnitPathForObjectPath(entry.path)] = object.geometry.text
	}
	for (const [index, group] of groups.entries()) {
		const entry = groupEntries[index]
		if (entry !== undefined)
			files[entry.path] = {
				format: "create-design.group",
				version: 1,
				...group,
			} satisfies GroupFile
	}
	return success(files)
}

function indexedErrors(
	entries: readonly Readonly<{ id: string; path: string }>[],
	unitPath: string,
): readonly DesignSourceDiagnostic[] {
	const errors: DesignSourceDiagnostic[] = []
	const ids = new Set<string>()
	const paths = new Set<string>()
	for (const [index, entry] of entries.entries()) {
		if (ids.has(entry.id))
			errors.push(
				diagnostic(
					"directory.duplicate_id",
					`$.entries[${index}].id`,
					`Duplicate indexed ID ${entry.id}.`,
					unitPath,
				),
			)
		if (paths.has(entry.path))
			errors.push(
				diagnostic(
					"directory.duplicate_path",
					`$.entries[${index}].path`,
					`Duplicate indexed path ${entry.path}.`,
					unitPath,
				),
			)
		ids.add(entry.id)
		paths.add(entry.path)
	}
	return errors
}

function requiredUnit<Schema extends z.ZodType>(
	files: DesignSourceDirectoryFiles,
	path: string,
	schema: Schema,
	errors: DesignSourceDiagnostic[],
): z.infer<Schema> | null {
	if (!Object.hasOwn(files, path)) {
		errors.push(
			diagnostic(
				"directory.missing_file",
				"$",
				`Missing required source unit ${path}.`,
				path,
			),
		)
		return null
	}
	const parsed = schema.safeParse(files[path])
	if (!parsed.success) {
		errors.push(...zodDiagnostics(parsed.error, path))
		return null
	}
	return parsed.data
}

export function assembleDesignDocument(
	files: DesignSourceDirectoryFiles,
): DesignSourceResult<DesignDocument> {
	const errors: DesignSourceDiagnostic[] = []
	const project = requiredUnit(
		files,
		designSourcePaths.project,
		projectFileSchema,
		errors,
	)
	const metadata = requiredUnit(
		files,
		designSourcePaths.document,
		documentFileSchema,
		errors,
	)
	const palette = requiredUnit(
		files,
		designSourcePaths.palette,
		paletteFileSchema,
		errors,
	)
	const artboardIndex = requiredUnit(
		files,
		designSourcePaths.artboardIndex,
		artboardIndexFileSchema,
		errors,
	)
	const layerIndex = requiredUnit(
		files,
		designSourcePaths.layerIndex,
		layerIndexFileSchema,
		errors,
	)
	const groupIndex = requiredUnit(
		files,
		designSourcePaths.groupIndex,
		groupIndexFileSchema,
		errors,
	)
	const objectIndex = requiredUnit(
		files,
		designSourcePaths.objectIndex,
		objectIndexFileSchema,
		errors,
	)
	const assetIndex = requiredUnit(
		files,
		designSourcePaths.assetIndex,
		assetIndexFileSchema,
		errors,
	)
	const fontIndex = requiredUnit(
		files,
		designSourcePaths.fontIndex,
		fontIndexFileSchema,
		errors,
	)

	const expected = new Set<string>(Object.values(designSourcePaths))
	if (assetIndex !== null) {
		errors.push(
			...indexedErrors(assetIndex.entries, designSourcePaths.assetIndex),
		)
	}
	for (const [index, entries] of [
		[designSourcePaths.artboardIndex, artboardIndex?.entries],
		[designSourcePaths.layerIndex, layerIndex?.entries],
		[designSourcePaths.groupIndex, groupIndex?.entries],
		[designSourcePaths.objectIndex, objectIndex?.entries],
	] as const) {
		if (entries === undefined) continue
		errors.push(...indexedErrors(entries, index))
		for (const entry of entries) expected.add(entry.path)
	}
	if (artboardIndex !== null && artboardIndex.entries.length === 0)
		errors.push(
			diagnostic(
				"directory.hierarchy",
				"$.entries",
				"A design source requires at least one artboard.",
				designSourcePaths.artboardIndex,
			),
		)
	if (
		project?.sourceVersion === LEGACY_CREATE_DESIGN_SOURCE_VERSION &&
		(artboardIndex?.entries.length !== 1 ||
			artboardIndex.entries[0]?.id !== DEFAULT_ARTBOARD_ID)
	)
		errors.push(
			diagnostic(
				"directory.unsupported",
				"$.entries",
				`Source version ${LEGACY_CREATE_DESIGN_SOURCE_VERSION} requires the singleton ${DEFAULT_ARTBOARD_ID} artboard.`,
				designSourcePaths.artboardIndex,
			),
		)
	if (layerIndex !== null && layerIndex.entries.length === 0)
		errors.push(
			diagnostic(
				"directory.hierarchy",
				"$.entries",
				"A design source requires at least one layer.",
				designSourcePaths.layerIndex,
			),
		)
	if (
		project !== null &&
		project.sourceVersion < VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION &&
		layerIndex !== null &&
		(layerIndex.entries.length !== 1 ||
			layerIndex.entries[0]?.id !== DEFAULT_LAYER_ID)
	)
		errors.push(
			diagnostic(
				"directory.unsupported",
				"$.entries",
				`Source versions before ${VERSION_FOUR_CREATE_DESIGN_SOURCE_VERSION} require the singleton ${DEFAULT_LAYER_ID} layer.`,
				designSourcePaths.layerIndex,
			),
		)
	if (
		project?.sourceVersion === LEGACY_CREATE_DESIGN_SOURCE_VERSION &&
		groupIndex !== null &&
		groupIndex.entries.length > 0
	)
		errors.push(
			diagnostic(
				"directory.unsupported",
				"$.entries",
				"Source version 1 reserves groups but requires an empty inventory.",
				designSourcePaths.groupIndex,
			),
		)
	if (fontIndex !== null)
		errors.push(
			...indexedErrors(fontIndex.entries, designSourcePaths.fontIndex),
		)

	const artboards = [] as ArtboardFile[]
	for (const entry of artboardIndex?.entries ?? []) {
		const artboard = requiredUnit(files, entry.path, artboardFileSchema, errors)
		if (artboard === null) continue
		if (artboard.id !== entry.id)
			errors.push(
				diagnostic(
					"directory.entity_id",
					"$.id",
					`Artboard unit ID ${artboard.id} does not match indexed ID ${entry.id}.`,
					entry.path,
				),
			)
		artboards.push(artboard)
	}
	const layers: DesignLayer[] = []
	for (const entry of layerIndex?.entries ?? []) {
		const layer = requiredUnit(files, entry.path, layerFileSchema, errors)
		if (layer === null) continue
		if (layer.id !== entry.id)
			errors.push(
				diagnostic(
					"directory.entity_id",
					"$.id",
					`Layer unit ID ${layer.id} does not match indexed ID ${entry.id}.`,
					entry.path,
				),
			)
		layers.push({
			id: layer.id,
			name: layer.name,
			children: layer.children,
			uiColor: layer.uiColor ?? designLayerUiColorAt(layers.length),
			...(layer.hidden === undefined ? {} : { hidden: layer.hidden }),
			...(layer.locked === undefined ? {} : { locked: layer.locked }),
		})
	}

	const objects = new Map<string, DesignObject>()
	for (const entry of objectIndex?.entries ?? []) {
		const file = requiredUnit(files, entry.path, objectFileSchema, errors)
		if (file === null) continue
		if (file.id !== entry.id)
			errors.push(
				diagnostic(
					"directory.entity_id",
					"$.id",
					`Object unit ID ${file.id} does not match indexed ID ${entry.id}.`,
					entry.path,
				),
			)
		if (
			file.geometry.kind === "artboard-link" &&
			project !== null &&
			project.sourceVersion < PREVIOUS_CREATE_DESIGN_SOURCE_VERSION
		)
			errors.push(
				diagnostic(
					"directory.unsupported",
					"$.geometry.kind",
					`Source version ${project.sourceVersion} does not support linked artboards.`,
					entry.path,
				),
			)
		let geometry: DesignObject["geometry"]
		if (file.geometry.kind === "text" && "contentPath" in file.geometry) {
			const canonicalContentPath = textContentUnitPathForObjectPath(entry.path)
			if (file.geometry.contentPath !== canonicalContentPath)
				errors.push(
					diagnostic(
						"directory.reference",
						"$.geometry.contentPath",
						`Text content path must be ${canonicalContentPath}.`,
						entry.path,
					),
				)
			expected.add(file.geometry.contentPath)
			const content = files[file.geometry.contentPath]
			if (typeof content !== "string") {
				errors.push(
					diagnostic(
						"directory.missing_file",
						"$",
						`Missing required raw text source unit ${file.geometry.contentPath}.`,
						file.geometry.contentPath,
					),
				)
				continue
			}
			const { contentPath: _contentPath, ...storedGeometry } = file.geometry
			geometry = { ...storedGeometry, text: content }
		} else {
			if (
				project?.sourceVersion !== LEGACY_CREATE_DESIGN_SOURCE_VERSION &&
				project?.sourceVersion !== VERSION_TWO_CREATE_DESIGN_SOURCE_VERSION &&
				file.geometry.kind === "text"
			) {
				errors.push(
					diagnostic(
						"directory.unsupported",
						"$.geometry.text",
						`Source version ${project.sourceVersion} stores text content in an adjacent raw .txt unit.`,
						entry.path,
					),
				)
			}
			geometry = file.geometry
		}
		objects.set(
			entry.id,
			stabilizeDesignObjectIdentities({
				id: file.id,
				name: file.name,
				geometry,
				transform: file.transform,
				appearance: file.appearance,
				...(file.hidden === undefined ? {} : { hidden: file.hidden }),
				...(file.locked === undefined ? {} : { locked: file.locked }),
			}),
		)
	}
	for (const path of Object.keys(files)) {
		if (expected.has(path)) continue
		errors.push(
			diagnostic(
				sourceUnitKindForPath(path) === null
					? "directory.unknown_file"
					: "directory.orphan_file",
				"$",
				sourceUnitKindForPath(path) === null
					? `Unknown canonical source unit ${path}.`
					: `Source unit ${path} is not present in its inventory.`,
				path,
			),
		)
	}
	const groups = new Map<string, DesignGroup>()
	for (const entry of groupIndex?.entries ?? []) {
		const file = requiredUnit(files, entry.path, groupFileSchema, errors)
		if (file === null) continue
		if (file.id !== entry.id)
			errors.push(
				diagnostic(
					"directory.entity_id",
					"$.id",
					`Group unit ID ${file.id} does not match indexed ID ${entry.id}.`,
					entry.path,
				),
			)
		groups.set(entry.id, {
			id: file.id,
			name: file.name,
			children: file.children,
			...(file.clippingPathId === undefined
				? {}
				: { clippingPathId: file.clippingPathId }),
		})
	}
	const embeddedAssets = new Set(
		(assetIndex?.entries ?? []).map(({ id }) => id),
	)
	for (const [objectId, object] of objects) {
		if (
			object.geometry.kind === "image" &&
			object.geometry.source.kind === "embedded" &&
			!embeddedAssets.has(object.geometry.source.id)
		)
			errors.push(
				diagnostic(
					"directory.reference",
					"$.geometry.source.id",
					`Placed image ${objectId} references missing embedded asset ${object.geometry.source.id}.`,
					objectIndex?.entries.find(({ id }) => id === objectId)?.path,
				),
			)
	}

	const orderedObjects: DesignObject[] = []
	const structural = new Set<string>()
	const structuralGroups = new Set<string>()
	const activeGroups = new Set<string>()
	const visit = (
		children: readonly DesignSceneChild[],
		unitPath: string | undefined,
	) => {
		for (const [index, child] of children.entries()) {
			if (child.kind === "group") {
				const group = groups.get(child.id)
				if (group === undefined) {
					errors.push(
						diagnostic(
							"directory.reference",
							`$.children[${index}].id`,
							`Scene references missing group ${child.id}.`,
							unitPath,
						),
					)
					continue
				}
				if (structuralGroups.has(child.id) || activeGroups.has(child.id)) {
					errors.push(
						diagnostic(
							"directory.hierarchy",
							`$.children[${index}].id`,
							`Group ${child.id} appears more than once or creates a cycle.`,
							unitPath,
						),
					)
					continue
				}
				structuralGroups.add(child.id)
				activeGroups.add(child.id)
				const groupPath = groupIndex?.entries.find(
					(entry) => entry.id === child.id,
				)?.path
				visit(group.children, groupPath)
				activeGroups.delete(child.id)
				continue
			}
			if (structural.has(child.id))
				errors.push(
					diagnostic(
						"directory.hierarchy",
						`$.children[${index}].id`,
						`Object ${child.id} appears more than once in the scene hierarchy.`,
						unitPath,
					),
				)
			structural.add(child.id)
			const object = objects.get(child.id)
			if (object === undefined)
				errors.push(
					diagnostic(
						"directory.reference",
						`$.children[${index}].id`,
						`Layer references missing object ${child.id}.`,
						unitPath,
					),
				)
			else orderedObjects.push(object)
		}
	}
	for (const [index, layer] of layers.entries())
		visit(layer.children, layerIndex?.entries[index]?.path)
	for (const id of objects.keys()) {
		if (!structural.has(id))
			errors.push(
				diagnostic(
					"directory.hierarchy",
					"$.entries",
					`Object ${id} has no structural parent.`,
					designSourcePaths.objectIndex,
				),
			)
	}
	for (const id of groups.keys()) {
		if (!structuralGroups.has(id))
			errors.push(
				diagnostic(
					"directory.hierarchy",
					"$.entries",
					`Group ${id} has no structural parent.`,
					designSourcePaths.groupIndex,
				),
			)
	}
	if (
		errors.length > 0 ||
		metadata === null ||
		palette === null ||
		artboards.length === 0 ||
		layers.length === 0
	)
		return failure(
			errors.length > 0
				? errors
				: [
						diagnostic(
							"source.schema",
							"$",
							"Directory assembly could not resolve required source units.",
						),
					],
		)
	return validateDesignDocument({
		format: CREATE_DESIGN_DOCUMENT_FORMAT,
		version: CREATE_DESIGN_DOCUMENT_VERSION,
		title: metadata.title,
		...(metadata.blends === undefined ? {} : { blends: metadata.blends }),
		artboards: artboards.map((artboard) => ({
			id: artboard.id,
			name: artboard.name,
			x: artboard.x,
			y: artboard.y,
			width: artboard.width,
			height: artboard.height,
			...(artboard.backgroundColor === undefined
				? {}
				: { backgroundColor: artboard.backgroundColor }),
			...(artboard.borderColor === undefined
				? {}
				: { borderColor: artboard.borderColor }),
			...(artboard.bleed === undefined ? {} : { bleed: artboard.bleed }),
			...(artboard.safeArea === undefined
				? {}
				: { safeArea: artboard.safeArea }),
		})),
		swatches: palette.swatches,
		objects: orderedObjects,
		layers,
		groups: [...groups.values()],
		guides: metadata.guides,
	})
}
