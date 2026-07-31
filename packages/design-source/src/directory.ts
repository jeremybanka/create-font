import {
	formatSourceJson,
	type SourceJsonValue,
} from "@create-art/source-format"
import { z } from "zod/v4"

import {
	appearanceSchema,
	CREATE_DESIGN_DOCUMENT_FORMAT,
	CREATE_DESIGN_DOCUMENT_VERSION,
	designObjectIdSchema,
	finiteNumberSchema,
	guideSchema,
	positiveNumberSchema,
	LEGACY_DESIGN_DOCUMENT_VERSION,
	PREVIOUS_DESIGN_DOCUMENT_VERSION,
	VERSION_TWO_DESIGN_DOCUMENT_VERSION,
	previousContourSchema,
	previousGeometrySchema,
	stabilizeDesignObjectIdentities,
	swatchIdSchema,
	swatchSchema,
	transformSchema,
	validateDesignDocument,
	versionTwoAppearanceSchema,
} from "./document.ts"
import { diagnostic, failure, success } from "./result.ts"
import { DEFAULT_DESIGN_STROKE_STYLE } from "./types.ts"
import type {
	DesignDocument,
	DesignObject,
	DesignSourceDiagnostic,
	DesignSourceResult,
} from "./types.ts"

export const CREATE_DESIGN_SOURCE_FORMAT = "create-design.source" as const
export const CREATE_DESIGN_SOURCE_VERSION = 1 as const
export const DEFAULT_ARTBOARD_ID = "artboard:page" as const
export const DEFAULT_LAYER_ID = "layer:artwork" as const

const artboardIdSchema = z.string().regex(/^artboard:.+/u)
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
		sourceVersion: z.literal(CREATE_DESIGN_SOURCE_VERSION),
		documentFormat: z.literal(CREATE_DESIGN_DOCUMENT_FORMAT),
		documentVersion: z.union([
			z.literal(LEGACY_DESIGN_DOCUMENT_VERSION),
			z.literal(VERSION_TWO_DESIGN_DOCUMENT_VERSION),
			z.literal(PREVIOUS_DESIGN_DOCUMENT_VERSION),
			z.literal(CREATE_DESIGN_DOCUMENT_VERSION),
		]),
	})
	.strict()
export const documentFileSchema = z
	.object({
		format: z.literal("create-design.metadata"),
		version: z.literal(1),
		title: z.string(),
		guides: z.array(guideSchema),
	})
	.strict()
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
		version: z.literal(1),
		id: artboardIdSchema,
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
	})
	.strict()
const legacyArtboardFileSchema = z
	.object({
		format: z.literal("create-design.artboard"),
		version: z.literal(1),
		id: artboardIdSchema,
		width: positiveNumberSchema,
		height: positiveNumberSchema,
	})
	.strict()
	.transform((file) => ({ ...file, x: 0, y: 0 }))
export const artboardFileSchema = z.union([
	currentArtboardFileSchema,
	legacyArtboardFileSchema,
])
const sceneChildSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("object"), id: designObjectIdSchema }).strict(),
	z.object({ kind: z.literal("group"), id: groupIdSchema }).strict(),
])
export const layerFileSchema = z
	.object({
		format: z.literal("create-design.layer"),
		version: z.literal(1),
		id: layerIdSchema,
		children: z.array(sceneChildSchema),
	})
	.strict()
export const groupFileSchema = z
	.object({
		format: z.literal("create-design.group"),
		version: z.literal(1),
		id: groupIdSchema,
		name: z.string(),
		children: z.array(sceneChildSchema),
	})
	.strict()
const canonicalObjectFileSchema = z
	.object({
		format: z.literal("create-design.object"),
		version: z.literal(1),
		id: designObjectIdSchema,
		name: z.string(),
		geometry: previousGeometrySchema,
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
		canonicalObjectFileSchema,
		versionTwoObjectFileSchema,
		legacyObjectFileSchema,
	])
	.transform((file) => ({
		format: file.format,
		version: file.version,
		...stabilizeDesignObjectIdentities({
			id: file.id,
			name: file.name,
			geometry: file.geometry,
			transform: file.transform,
			appearance: file.appearance,
			...(file.hidden === undefined ? {} : { hidden: file.hidden }),
			...(file.locked === undefined ? {} : { locked: file.locked }),
		}),
	}))

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
export const assetUnitPathSchema = z
	.string()
	.refine(
		(path) =>
			path.startsWith("assets/") &&
			path !== "assets/index.json" &&
			hasSafePathSegments(path.slice("assets/".length)),
		"Expected a safe relative path below assets/.",
	)
const fontUnitPathSchema = z
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
					id: fontIdSchema,
					path: fontUnitPathSchema,
					sha256: z.string().regex(/^[0-9a-f]{64}$/u),
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
	return validated.ok
		? success(formatSourceJson(validated.value as unknown as SourceJsonValue))
		: failure(validated.errors)
}

export interface SplitDesignDocumentOptions {
	readonly objectPath?: (object: DesignObject, index: number) => string
}

function objectFile(object: DesignObject): ObjectFile {
	return {
		format: "create-design.object",
		version: 1,
		id: object.id,
		name: object.name,
		geometry: object.geometry,
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
	const errors: DesignSourceDiagnostic[] = []
	const paths = new Set<string>()
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

	const artboardPath = "artboards/page.json"
	const layerPath = "scene/layers/artwork.json"
	const files: Record<string, unknown> = {
		[designSourcePaths.project]: {
			format: CREATE_DESIGN_SOURCE_FORMAT,
			sourceVersion: CREATE_DESIGN_SOURCE_VERSION,
			documentFormat: CREATE_DESIGN_DOCUMENT_FORMAT,
			documentVersion: CREATE_DESIGN_DOCUMENT_VERSION,
		} satisfies ProjectFile,
		[designSourcePaths.document]: {
			format: "create-design.metadata",
			version: 1,
			title: validated.value.title,
			guides: validated.value.guides.map((guide) => ({ ...guide })),
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
			entries: [{ id: DEFAULT_ARTBOARD_ID, path: artboardPath }],
		} satisfies ArtboardIndexFile,
		[artboardPath]: {
			format: "create-design.artboard",
			version: 1,
			id: DEFAULT_ARTBOARD_ID,
			...validated.value.page,
		} satisfies ArtboardFile,
		[designSourcePaths.layerIndex]: {
			format: "create-design.layer-index",
			version: 1,
			entries: [{ id: DEFAULT_LAYER_ID, path: layerPath }],
		} satisfies LayerIndexFile,
		[layerPath]: {
			format: "create-design.layer",
			version: 1,
			id: DEFAULT_LAYER_ID,
			children: validated.value.objects.map(({ id }) => ({
				kind: "object",
				id,
			})),
		} satisfies LayerFile,
		[designSourcePaths.groupIndex]: {
			format: "create-design.group-index",
			version: 1,
			entries: [],
		} satisfies GroupIndexFile,
		[designSourcePaths.objectIndex]: {
			format: "create-design.object-index",
			version: 1,
			entries: objectEntries.toSorted((left, right) =>
				left.id.localeCompare(right.id),
			),
		} satisfies ObjectIndexFile,
		[designSourcePaths.assetIndex]: {
			format: "create-design.asset-index",
			version: 1,
			entries: [],
		} satisfies AssetIndexFile,
		[designSourcePaths.fontIndex]: {
			format: "create-design.font-index",
			version: 1,
			entries: [],
		} satisfies FontIndexFile,
	}
	for (const [index, object] of validated.value.objects.entries()) {
		const entry = objectEntries[index]
		if (entry !== undefined) files[entry.path] = objectFile(object)
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
	requiredUnit(files, designSourcePaths.project, projectFileSchema, errors)
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

	if (artboardIndex !== null && artboardIndex.entries.length !== 1)
		errors.push(
			diagnostic(
				"directory.unsupported",
				"$.entries",
				"Source version 1 requires exactly one artboard.",
				designSourcePaths.artboardIndex,
			),
		)
	if (
		artboardIndex !== null &&
		artboardIndex.entries[0]?.id !== DEFAULT_ARTBOARD_ID
	)
		errors.push(
			diagnostic(
				"directory.entity_id",
				"$.entries[0].id",
				`Source version 1 requires artboard ID ${DEFAULT_ARTBOARD_ID}.`,
				designSourcePaths.artboardIndex,
			),
		)
	if (layerIndex !== null && layerIndex.entries.length !== 1)
		errors.push(
			diagnostic(
				"directory.unsupported",
				"$.entries",
				"Source version 1 requires exactly one layer.",
				designSourcePaths.layerIndex,
			),
		)
	if (layerIndex !== null && layerIndex.entries[0]?.id !== DEFAULT_LAYER_ID)
		errors.push(
			diagnostic(
				"directory.entity_id",
				"$.entries[0].id",
				`Source version 1 requires layer ID ${DEFAULT_LAYER_ID}.`,
				designSourcePaths.layerIndex,
			),
		)
	for (const [path, entries, name] of [
		[designSourcePaths.groupIndex, groupIndex?.entries, "groups"],
		[designSourcePaths.fontIndex, fontIndex?.entries, "fonts"],
	] as const) {
		if (entries !== undefined && entries.length > 0)
			errors.push(
				diagnostic(
					"directory.unsupported",
					"$.entries",
					`Source version 1 reserves ${name} but requires an empty inventory.`,
					path,
				),
			)
	}

	const artboardEntry = artboardIndex?.entries[0]
	const layerEntry = layerIndex?.entries[0]
	const artboard =
		artboardEntry === undefined
			? null
			: requiredUnit(files, artboardEntry.path, artboardFileSchema, errors)
	const layer =
		layerEntry === undefined
			? null
			: requiredUnit(files, layerEntry.path, layerFileSchema, errors)
	if (artboard !== null && artboard.id !== artboardEntry?.id)
		errors.push(
			diagnostic(
				"directory.entity_id",
				"$.id",
				`Artboard unit ID ${artboard.id} does not match indexed ID ${artboardEntry?.id}.`,
				artboardEntry?.path,
			),
		)
	if (layer !== null && layer.id !== layerEntry?.id)
		errors.push(
			diagnostic(
				"directory.entity_id",
				"$.id",
				`Layer unit ID ${layer.id} does not match indexed ID ${layerEntry?.id}.`,
				layerEntry?.path,
			),
		)

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
		objects.set(entry.id, {
			id: file.id,
			name: file.name,
			geometry: file.geometry,
			transform: file.transform,
			appearance: file.appearance,
			...(file.hidden === undefined ? {} : { hidden: file.hidden }),
			...(file.locked === undefined ? {} : { locked: file.locked }),
		})
	}

	const orderedObjects: DesignObject[] = []
	const structural = new Set<string>()
	for (const [index, child] of layer?.children.entries() ?? []) {
		if (child.kind === "group") {
			errors.push(
				diagnostic(
					"directory.unsupported",
					`$.children[${index}]`,
					"Source version 1 reserves groups but cannot assemble grouped objects.",
					layerEntry?.path,
				),
			)
			continue
		}
		if (structural.has(child.id))
			errors.push(
				diagnostic(
					"directory.hierarchy",
					`$.children[${index}].id`,
					`Object ${child.id} appears more than once in the scene hierarchy.`,
					layerEntry?.path,
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
					layerEntry?.path,
				),
			)
		else orderedObjects.push(object)
	}
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

	if (
		errors.length > 0 ||
		metadata === null ||
		palette === null ||
		artboard === null ||
		layer === null
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
		page: {
			x: artboard.x,
			y: artboard.y,
			width: artboard.width,
			height: artboard.height,
		},
		swatches: palette.swatches,
		objects: orderedObjects,
		guides: metadata.guides,
	})
}
