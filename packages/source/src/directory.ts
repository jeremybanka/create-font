import type { EditorFontSource } from "@create-font/states"
import { z } from "zod/v4"

import { fromEditorFontFile, toEditorFontFile } from "./codec.ts"
import { inspectJsonObjectKeys } from "./json.ts"
import { failure, success } from "./result.ts"
import {
	CREATE_FONT_EDITOR_FORMAT,
	CREATE_FONT_EDITOR_VERSION,
	type SourceDiagnostic,
	type SourceResult,
} from "./types.ts"

export const CREATE_FONT_SOURCE_FORMAT = "create-font.source" as const
export const CREATE_FONT_SOURCE_VERSION = 1 as const

const finiteNumberSchema = z.number().finite()
const unicodeScalarSchema = z
	.number()
	.int()
	.min(0)
	.max(0x10ffff)
	.refine(
		(value) => value < 0xd800 || value > 0xdfff,
		"Expected a Unicode scalar value.",
	)
const canonicalBigintSchema = z
	.string()
	.regex(/^(?:0|-?[1-9][0-9]*)$/u, "Expected a canonical base-ten bigint.")

export const axisIdSchema = z.templateLiteral(["axis:", z.string()])
export const masterIdSchema = z.templateLiteral(["master:", z.string()])
export const instanceIdSchema = z.templateLiteral(["instance:", z.string()])
export const glyphIdSchema = z.templateLiteral(["glyph:", z.string()])
export const contourIdSchema = z.templateLiteral(["contour:", z.string()])
export const pointIdSchema = z.templateLiteral(["point:", z.string()])

const locationSchema = z.record(axisIdSchema, finiteNumberSchema)

export const projectFileSchema = z
	.object({
		format: z.literal(CREATE_FONT_SOURCE_FORMAT),
		sourceVersion: z.literal(CREATE_FONT_SOURCE_VERSION),
		editorFormat: z.literal(CREATE_FONT_EDITOR_FORMAT),
		editorVersion: z.union([
			z.literal(3),
			z.literal(CREATE_FONT_EDITOR_VERSION),
		]),
	})
	.strict()
	.meta({ title: "create-font project manifest" })

export const metadataFileSchema = z
	.object({
		unitsPerEm: finiteNumberSchema,
		fontRevision: finiteNumberSchema,
		vendorId: z.string(),
		lowestPpem: finiteNumberSchema,
		createdAt: canonicalBigintSchema.optional(),
		modifiedAt: canonicalBigintSchema.optional(),
	})
	.strict()
	.meta({ title: "create-font font metadata" })

export const namesFileSchema = z
	.object({
		family: z.string(),
		subfamily: z.string(),
		uniqueId: z.string(),
		fullName: z.string(),
		version: z.string(),
		postScriptName: z.string(),
		typographicFamily: z.string(),
		typographicSubfamily: z.string(),
	})
	.strict()
	.meta({ title: "create-font font names" })

export const metricsFileSchema = z
	.object({
		ascender: finiteNumberSchema,
		descender: finiteNumberSchema,
		lineGap: finiteNumberSchema,
		winAscent: finiteNumberSchema,
		winDescent: finiteNumberSchema,
		xHeight: finiteNumberSchema,
		capHeight: finiteNumberSchema,
		underlinePosition: finiteNumberSchema,
		underlineThickness: finiteNumberSchema,
		overshoots: z
			.object({
				baseline: finiteNumberSchema.int().min(0).max(16_383),
				ascender: finiteNumberSchema.int().min(0).max(16_383),
				descender: finiteNumberSchema.int().min(0).max(16_383),
				winAscent: finiteNumberSchema.int().min(0).max(16_383),
				winDescent: finiteNumberSchema.int().min(0).max(16_383),
				xHeight: finiteNumberSchema.int().min(0).max(16_383),
				capHeight: finiteNumberSchema.int().min(0).max(16_383),
				underlinePosition: finiteNumberSchema.int().min(0).max(16_383),
			})
			.strict()
			.optional(),
	})
	.strict()
	.meta({ title: "create-font font metrics" })

export const styleFileSchema = z
	.object({
		weightClass: finiteNumberSchema,
		widthClass: finiteNumberSchema,
		italic: z.boolean(),
		bold: z.boolean(),
		oblique: z.boolean(),
		italicAngle: finiteNumberSchema,
	})
	.strict()
	.meta({ title: "create-font font style" })

const axisMapEntrySchema = z
	.object({ from: finiteNumberSchema, to: finiteNumberSchema })
	.strict()

export const axisFileSchema = z
	.object({
		id: axisIdSchema,
		tag: z.string(),
		name: z.string(),
		min: finiteNumberSchema,
		default: finiteNumberSchema,
		max: finiteNumberSchema,
		hidden: z.boolean().optional(),
		map: z.array(axisMapEntrySchema).optional(),
	})
	.strict()
	.meta({ title: "create-font axis" })

const masterSupportSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("non-intermediate") }).strict(),
	z
		.object({
			kind: z.literal("intermediate"),
			start: locationSchema,
			end: locationSchema,
		})
		.strict(),
])

export const masterFileSchema = z
	.discriminatedUnion("kind", [
		z
			.object({
				id: masterIdSchema,
				kind: z.literal("default"),
				name: z.string(),
			})
			.strict(),
		z
			.object({
				id: masterIdSchema,
				kind: z.literal("source"),
				name: z.string(),
				location: locationSchema,
				support: masterSupportSchema,
			})
			.strict(),
	])
	.meta({ title: "create-font master" })

export const instanceFileSchema = z
	.object({
		id: instanceIdSchema,
		name: z.string(),
		coordinates: locationSchema,
		postScriptName: z.string().optional(),
		elidable: z.boolean().optional(),
	})
	.strict()
	.meta({ title: "create-font instance" })

const pointSchema = z
	.object({
		id: pointIdSchema,
		mode: z.enum(["soft", "hard"]),
	})
	.strict()
const contourSchema = z
	.object({
		id: contourIdSchema,
		closed: z.boolean(),
		points: z.array(pointSchema),
	})
	.strict()
const handleSchema = z
	.object({ x: finiteNumberSchema, y: finiteNumberSchema })
	.strict()
const layerPointSchema = z
	.object({
		pointId: pointIdSchema,
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		incoming: handleSchema.optional(),
		outgoing: handleSchema.optional(),
	})
	.strict()
const glyphLayerSchema = z
	.object({
		masterId: masterIdSchema,
		advanceWidth: finiteNumberSchema,
		leftSideBearing: finiteNumberSchema,
		points: z.array(layerPointSchema),
	})
	.strict()

export const glyphFileSchema = z
	.object({
		id: glyphIdSchema,
		name: z.string(),
		export: z.boolean(),
		note: z.string().optional(),
		color: z.string().optional(),
		overlap: z.boolean().optional(),
		contours: z.array(contourSchema),
		layers: z.array(glyphLayerSchema),
	})
	.strict()
	.meta({ title: "create-font glyph" })

export const cmapEntryFileSchema = z
	.object({
		codePoint: unicodeScalarSchema,
		glyphId: glyphIdSchema,
	})
	.strict()
	.meta({ title: "create-font character mapping" })

function isSafeCollectionUnitPath(path: string, directory: string): boolean {
	const prefix = `${directory}/`
	if (!path.startsWith(prefix) || path === `${prefix}index.json`) return false
	for (const rawSegment of path.slice(prefix.length).split("/")) {
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
		) {
			return false
		}
	}
	return true
}

function collectionUnitPathSchema(directory: string) {
	const pattern = new RegExp(
		`^${directory}/(?!index\\.json$)(?:[A-Za-z0-9._~%-]+/)*[A-Za-z0-9._~%-]+\\.json$`,
		"u",
	)
	return z
		.string()
		.regex(pattern, `Expected a relative JSON path below ${directory}/.`)
		.refine(
			(path) => isSafeCollectionUnitPath(path, directory),
			`Expected a safe relative JSON path below ${directory}/.`,
		)
}

export const axisUnitPathSchema = collectionUnitPathSchema("axes")
export const masterUnitPathSchema = collectionUnitPathSchema("masters")
export const instanceUnitPathSchema = collectionUnitPathSchema("instances")
export const glyphUnitPathSchema = collectionUnitPathSchema("glyphs")
export const cmapUnitPathSchema = collectionUnitPathSchema("cmap")

const axisIndexEntrySchema = z
	.object({ id: axisIdSchema, path: axisUnitPathSchema })
	.strict()
const masterIndexEntrySchema = z
	.object({ id: masterIdSchema, path: masterUnitPathSchema })
	.strict()
const instanceIndexEntrySchema = z
	.object({ id: instanceIdSchema, path: instanceUnitPathSchema })
	.strict()
const glyphIndexEntrySchema = z
	.object({ id: glyphIdSchema, path: glyphUnitPathSchema })
	.strict()
const cmapIndexEntrySchema = z
	.object({ codePoint: unicodeScalarSchema, path: cmapUnitPathSchema })
	.strict()

export const axisIndexFileSchema = z
	.array(axisIndexEntrySchema)
	.meta({ title: "create-font axis index" })
export const masterIndexFileSchema = z
	.object({
		defaultMasterId: masterIdSchema,
		entries: z.array(masterIndexEntrySchema),
	})
	.strict()
	.meta({ title: "create-font master index" })
export const instanceIndexFileSchema = z
	.array(instanceIndexEntrySchema)
	.meta({ title: "create-font instance index" })
export const glyphIndexFileSchema = z
	.array(glyphIndexEntrySchema)
	.meta({ title: "create-font glyph index" })
export const cmapIndexFileSchema = z
	.array(cmapIndexEntrySchema)
	.meta({ title: "create-font character-map index" })

export type ProjectFile = z.infer<typeof projectFileSchema>
export type MetadataFile = z.infer<typeof metadataFileSchema>
export type NamesFile = z.infer<typeof namesFileSchema>
export type MetricsFile = z.infer<typeof metricsFileSchema>
export type StyleFile = z.infer<typeof styleFileSchema>
export type AxisIndexFile = z.infer<typeof axisIndexFileSchema>
export type AxisFile = z.infer<typeof axisFileSchema>
export type MasterIndexFile = z.infer<typeof masterIndexFileSchema>
export type MasterFile = z.infer<typeof masterFileSchema>
export type InstanceIndexFile = z.infer<typeof instanceIndexFileSchema>
export type InstanceFile = z.infer<typeof instanceFileSchema>
export type GlyphIndexFile = z.infer<typeof glyphIndexFileSchema>
export type GlyphFile = z.infer<typeof glyphFileSchema>
export type CmapIndexFile = z.infer<typeof cmapIndexFileSchema>
export type CmapEntryFile = z.infer<typeof cmapEntryFileSchema>

export type SourceUnitKind =
	| "project"
	| "metadata"
	| "names"
	| "metrics"
	| "style"
	| "axis-index"
	| "axis"
	| "master-index"
	| "master"
	| "instance-index"
	| "instance"
	| "glyph-index"
	| "glyph"
	| "cmap-index"
	| "cmap-entry"

export interface SingletonSourceUnitDescriptor<Schema extends z.ZodType> {
	readonly cardinality: "singleton"
	readonly kind: SourceUnitKind
	readonly path: string
	readonly schema: Schema
}

export interface CollectionSourceUnitDescriptor<Schema extends z.ZodType> {
	readonly cardinality: "collection"
	readonly directory: string
	readonly inventoryPath: string
	readonly kind: SourceUnitKind
	readonly schema: Schema
}

/**
 * Public routing contract for server inventory/read/write and atom.io remote
 * loadables. Each descriptor owns its path identity and Zod validator.
 */
export const sourceUnitDescriptors = {
	project: {
		cardinality: "singleton",
		kind: "project",
		path: "create-font.json",
		schema: projectFileSchema,
	},
	metadata: {
		cardinality: "singleton",
		kind: "metadata",
		path: "metadata.json",
		schema: metadataFileSchema,
	},
	names: {
		cardinality: "singleton",
		kind: "names",
		path: "names.json",
		schema: namesFileSchema,
	},
	metrics: {
		cardinality: "singleton",
		kind: "metrics",
		path: "metrics.json",
		schema: metricsFileSchema,
	},
	style: {
		cardinality: "singleton",
		kind: "style",
		path: "style.json",
		schema: styleFileSchema,
	},
	axisIndex: {
		cardinality: "singleton",
		kind: "axis-index",
		path: "axes/index.json",
		schema: axisIndexFileSchema,
	},
	axis: {
		cardinality: "collection",
		directory: "axes",
		inventoryPath: "axes/index.json",
		kind: "axis",
		schema: axisFileSchema,
	},
	masterIndex: {
		cardinality: "singleton",
		kind: "master-index",
		path: "masters/index.json",
		schema: masterIndexFileSchema,
	},
	master: {
		cardinality: "collection",
		directory: "masters",
		inventoryPath: "masters/index.json",
		kind: "master",
		schema: masterFileSchema,
	},
	instanceIndex: {
		cardinality: "singleton",
		kind: "instance-index",
		path: "instances/index.json",
		schema: instanceIndexFileSchema,
	},
	instance: {
		cardinality: "collection",
		directory: "instances",
		inventoryPath: "instances/index.json",
		kind: "instance",
		schema: instanceFileSchema,
	},
	glyphIndex: {
		cardinality: "singleton",
		kind: "glyph-index",
		path: "glyphs/index.json",
		schema: glyphIndexFileSchema,
	},
	glyph: {
		cardinality: "collection",
		directory: "glyphs",
		inventoryPath: "glyphs/index.json",
		kind: "glyph",
		schema: glyphFileSchema,
	},
	cmapIndex: {
		cardinality: "singleton",
		kind: "cmap-index",
		path: "cmap/index.json",
		schema: cmapIndexFileSchema,
	},
	cmapEntry: {
		cardinality: "collection",
		directory: "cmap",
		inventoryPath: "cmap/index.json",
		kind: "cmap-entry",
		schema: cmapEntryFileSchema,
	},
} as const satisfies Record<
	string,
	| SingletonSourceUnitDescriptor<z.ZodType>
	| CollectionSourceUnitDescriptor<z.ZodType>
>

type SourceUnitValueByKind = {
	readonly project: ProjectFile
	readonly metadata: MetadataFile
	readonly names: NamesFile
	readonly metrics: MetricsFile
	readonly style: StyleFile
	readonly "axis-index": AxisIndexFile
	readonly axis: AxisFile
	readonly "master-index": MasterIndexFile
	readonly master: MasterFile
	readonly "instance-index": InstanceIndexFile
	readonly instance: InstanceFile
	readonly "glyph-index": GlyphIndexFile
	readonly glyph: GlyphFile
	readonly "cmap-index": CmapIndexFile
	readonly "cmap-entry": CmapEntryFile
}

const descriptorByKind: {
	readonly [Kind in SourceUnitKind]: { readonly schema: z.ZodType }
} = {
	project: sourceUnitDescriptors.project,
	metadata: sourceUnitDescriptors.metadata,
	names: sourceUnitDescriptors.names,
	metrics: sourceUnitDescriptors.metrics,
	style: sourceUnitDescriptors.style,
	"axis-index": sourceUnitDescriptors.axisIndex,
	axis: sourceUnitDescriptors.axis,
	"master-index": sourceUnitDescriptors.masterIndex,
	master: sourceUnitDescriptors.master,
	"instance-index": sourceUnitDescriptors.instanceIndex,
	instance: sourceUnitDescriptors.instance,
	"glyph-index": sourceUnitDescriptors.glyphIndex,
	glyph: sourceUnitDescriptors.glyph,
	"cmap-index": sourceUnitDescriptors.cmapIndex,
	"cmap-entry": sourceUnitDescriptors.cmapEntry,
}

function issuePath(segments: readonly PropertyKey[]): string {
	let path = "$"
	for (const segment of segments) {
		if (typeof segment === "number") path += `[${segment}]`
		else {
			const key = String(segment)
			path += /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
				? `.${key}`
				: `[${JSON.stringify(key)}]`
		}
	}
	return path
}

function schemaDiagnostics(
	unitPath: string,
	error: z.ZodError,
): readonly SourceDiagnostic[] {
	return error.issues.map((issue) => ({
		severity: "error",
		code: "source.schema",
		unitPath,
		path: issuePath(issue.path),
		message: issue.message,
	}))
}

export function validateSourceUnit<Kind extends SourceUnitKind>(
	kind: Kind,
	value: unknown,
	unitPath: string = kind,
): SourceResult<SourceUnitValueByKind[Kind]> {
	const result = descriptorByKind[kind].schema.safeParse(value)
	return result.success
		? success(result.data as SourceUnitValueByKind[Kind])
		: failure(schemaDiagnostics(unitPath, result.error))
}

export function sourceUnitKindForPath(path: string): SourceUnitKind | null {
	for (const descriptor of Object.values(sourceUnitDescriptors)) {
		if (descriptor.cardinality === "singleton") {
			if (descriptor.path === path) return descriptor.kind
			continue
		}
		if (
			path !== descriptor.inventoryPath &&
			path.startsWith(`${descriptor.directory}/`)
		) {
			return descriptor.kind
		}
	}
	return null
}

export function parseSourceUnitText(
	kind: SourceUnitKind,
	text: string,
	unitPath: string,
): SourceResult<unknown> {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return failure([
			{
				severity: "error",
				code: "json.syntax",
				unitPath,
				path: "$",
				message: "Invalid JSON syntax.",
			},
		])
	}
	const lexicalDiagnostics = inspectJsonObjectKeys(text).map((diagnostic) => ({
		...diagnostic,
		unitPath,
	}))
	if (lexicalDiagnostics.length > 0) return failure(lexicalDiagnostics)
	return validateSourceUnit(kind, value, unitPath)
}

export function formatSourceUnit(
	kind: SourceUnitKind,
	value: unknown,
	unitPath: string = kind,
): SourceResult<string> {
	const validated = validateSourceUnit(kind, value, unitPath)
	return validated.ok
		? success(`${JSON.stringify(validated.value, null, "\t")}\n`)
		: failure(validated.errors)
}

export function jsonSchemaForSourceUnit(kind: SourceUnitKind): unknown {
	return z.toJSONSchema(descriptorByKind[kind].schema, {
		target: "draft-2020-12",
	})
}

export type FontSourceDirectoryFiles = Readonly<Record<string, unknown>>

function encodePathSegment(value: string): string {
	const encoded = encodeURIComponent(value).replace(
		/[!'()*]/gu,
		(character) =>
			`%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	)
	let hash = 0x811c9dc5
	for (const byte of new TextEncoder().encode(value)) {
		hash = Math.imul(hash ^ byte, 0x01000193)
	}
	return `${encoded}~${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function defaultAxisUnitPath(id: string): string {
	return `axes/${encodePathSegment(id)}.json`
}
export function defaultMasterUnitPath(id: string): string {
	return `masters/${encodePathSegment(id)}.json`
}
export function defaultInstanceUnitPath(id: string): string {
	return `instances/${encodePathSegment(id)}.json`
}
export function defaultGlyphUnitPath(id: string): string {
	return `glyphs/${encodePathSegment(id)}.json`
}
export function defaultCmapUnitPath(codePoint: number): string {
	return `cmap/${codePoint.toString(16).toUpperCase().padStart(4, "0")}.json`
}

export interface SplitFontSourceOptions {
	readonly axisPath?: (axis: AxisFile, index: number) => string
	readonly masterPath?: (master: MasterFile, index: number) => string
	readonly instancePath?: (instance: InstanceFile, index: number) => string
	readonly glyphPath?: (glyph: GlyphFile, index: number) => string
	readonly cmapPath?: (entry: CmapEntryFile, index: number) => string
}

function duplicatePathDiagnostic(
	path: string,
	indexPath: string,
	index: number,
) {
	return {
		severity: "error",
		code: "directory.duplicate_path",
		unitPath: indexPath,
		path: `$[${index}].path`,
		message: `Source unit path ${JSON.stringify(path)} is used more than once.`,
	} as const
}

/**
 * Split one validated state snapshot into useful atom/loadable persistence
 * units while retaining every collection's author order in an index.
 */
export function splitEditorFontSource(
	source: EditorFontSource,
	options: SplitFontSourceOptions = {},
): SourceResult<FontSourceDirectoryFiles> {
	const fileResult = toEditorFontFile(source)
	if (!fileResult.ok) return failure(fileResult.errors)
	const file = fileResult.value
	const files: Record<string, unknown> = {
		[sourceUnitDescriptors.project.path]: {
			format: CREATE_FONT_SOURCE_FORMAT,
			sourceVersion: CREATE_FONT_SOURCE_VERSION,
			editorFormat: CREATE_FONT_EDITOR_FORMAT,
			editorVersion: CREATE_FONT_EDITOR_VERSION,
		},
		[sourceUnitDescriptors.metadata.path]: file.metadata,
		[sourceUnitDescriptors.names.path]: file.names,
		[sourceUnitDescriptors.metrics.path]: file.metrics,
		[sourceUnitDescriptors.style.path]: file.style,
	}

	const addUnit = (
		path: string,
		pathSchema: z.ZodType<string>,
		indexPath: string,
		index: number,
		value: unknown,
	): SourceResult<null> => {
		const pathResult = pathSchema.safeParse(path)
		if (!pathResult.success) {
			return failure(schemaDiagnostics(indexPath, pathResult.error))
		}
		if (Object.hasOwn(files, path)) {
			return failure([duplicatePathDiagnostic(path, indexPath, index)])
		}
		files[path] = value
		return success(null)
	}

	const axisIndex: { readonly id: string; readonly path: string }[] = []
	for (let index = 0; index < file.axes.length; index += 1) {
		const axis = file.axes[index]
		if (axis === undefined) continue
		const path = (options.axisPath ?? ((item) => defaultAxisUnitPath(item.id)))(
			axis,
			index,
		)
		const added = addUnit(
			path,
			axisUnitPathSchema,
			sourceUnitDescriptors.axisIndex.path,
			index,
			axis,
		)
		if (!added.ok) return failure(added.errors)
		axisIndex.push({ id: axis.id, path })
	}
	files[sourceUnitDescriptors.axisIndex.path] = axisIndex

	const masterEntries: { readonly id: string; readonly path: string }[] = []
	for (let index = 0; index < file.masters.length; index += 1) {
		const master = file.masters[index]
		if (master === undefined) continue
		const path = (
			options.masterPath ?? ((item) => defaultMasterUnitPath(item.id))
		)(master, index)
		const added = addUnit(
			path,
			masterUnitPathSchema,
			sourceUnitDescriptors.masterIndex.path,
			index,
			master,
		)
		if (!added.ok) return failure(added.errors)
		masterEntries.push({ id: master.id, path })
	}
	files[sourceUnitDescriptors.masterIndex.path] = {
		defaultMasterId: file.defaultMasterId,
		entries: masterEntries,
	}

	const instanceIndex: { readonly id: string; readonly path: string }[] = []
	for (let index = 0; index < file.instances.length; index += 1) {
		const instance = file.instances[index]
		if (instance === undefined) continue
		const path = (
			options.instancePath ?? ((item) => defaultInstanceUnitPath(item.id))
		)(instance, index)
		const added = addUnit(
			path,
			instanceUnitPathSchema,
			sourceUnitDescriptors.instanceIndex.path,
			index,
			instance,
		)
		if (!added.ok) return failure(added.errors)
		instanceIndex.push({ id: instance.id, path })
	}
	files[sourceUnitDescriptors.instanceIndex.path] = instanceIndex

	const glyphIndex: { readonly id: string; readonly path: string }[] = []
	for (let index = 0; index < file.glyphs.length; index += 1) {
		const glyph = file.glyphs[index]
		if (glyph === undefined) continue
		const path = (
			options.glyphPath ?? ((item) => defaultGlyphUnitPath(item.id))
		)(glyph, index)
		const added = addUnit(
			path,
			glyphUnitPathSchema,
			sourceUnitDescriptors.glyphIndex.path,
			index,
			glyph,
		)
		if (!added.ok) return failure(added.errors)
		glyphIndex.push({ id: glyph.id, path })
	}
	files[sourceUnitDescriptors.glyphIndex.path] = glyphIndex

	const cmapIndex: { readonly codePoint: number; readonly path: string }[] = []
	for (let index = 0; index < file.cmap.length; index += 1) {
		const entry = file.cmap[index]
		if (entry === undefined) continue
		const path = (
			options.cmapPath ?? ((item) => defaultCmapUnitPath(item.codePoint))
		)(entry, index)
		const added = addUnit(
			path,
			cmapUnitPathSchema,
			sourceUnitDescriptors.cmapIndex.path,
			index,
			entry,
		)
		if (!added.ok) return failure(added.errors)
		cmapIndex.push({ codePoint: entry.codePoint, path })
	}
	files[sourceUnitDescriptors.cmapIndex.path] = cmapIndex
	return success(files)
}

function requiredDirectoryFile(
	files: FontSourceDirectoryFiles,
	path: string,
): SourceResult<unknown> {
	if (Object.hasOwn(files, path)) return success(files[path])
	return failure([
		{
			severity: "error",
			code: "directory.missing_file",
			unitPath: path,
			path: "$",
			message: `Missing required source unit ${JSON.stringify(path)}.`,
		},
	])
}

function validateRequiredUnit<Kind extends SourceUnitKind>(
	files: FontSourceDirectoryFiles,
	path: string,
	kind: Kind,
): SourceResult<SourceUnitValueByKind[Kind]> {
	const file = requiredDirectoryFile(files, path)
	return file.ok
		? validateSourceUnit(kind, file.value, path)
		: failure(file.errors)
}

function duplicateIdentityDiagnostic(
	indexPath: string,
	index: number,
	identity: string | number,
	field: "codePoint" | "id",
): SourceDiagnostic {
	return {
		severity: "error",
		code: "directory.duplicate_id",
		unitPath: indexPath,
		path: `$[${index}].${field}`,
		message: `Identity ${JSON.stringify(identity)} is indexed more than once.`,
	}
}

function duplicateIndexedPathDiagnostic(
	indexPath: string,
	index: number,
	path: string,
): SourceDiagnostic {
	return {
		severity: "error",
		code: "directory.duplicate_path",
		unitPath: indexPath,
		path: `$[${index}].path`,
		message: `Source unit path ${JSON.stringify(path)} is indexed more than once.`,
	}
}

/**
 * Validate every unit, restore collection order from indexes, and then run the
 * existing whole-document structural and relational validation.
 */
export function assembleEditorFontSource(
	files: FontSourceDirectoryFiles,
): SourceResult<EditorFontSource> {
	const project = validateRequiredUnit(
		files,
		sourceUnitDescriptors.project.path,
		"project",
	)
	if (!project.ok) return failure(project.errors)
	const metadata = validateRequiredUnit(
		files,
		sourceUnitDescriptors.metadata.path,
		"metadata",
	)
	if (!metadata.ok) return failure(metadata.errors)
	const names = validateRequiredUnit(
		files,
		sourceUnitDescriptors.names.path,
		"names",
	)
	if (!names.ok) return failure(names.errors)
	const metrics = validateRequiredUnit(
		files,
		sourceUnitDescriptors.metrics.path,
		"metrics",
	)
	if (!metrics.ok) return failure(metrics.errors)
	const style = validateRequiredUnit(
		files,
		sourceUnitDescriptors.style.path,
		"style",
	)
	if (!style.ok) return failure(style.errors)
	const axisIndex = validateRequiredUnit(
		files,
		sourceUnitDescriptors.axisIndex.path,
		"axis-index",
	)
	if (!axisIndex.ok) return failure(axisIndex.errors)
	const masterIndex = validateRequiredUnit(
		files,
		sourceUnitDescriptors.masterIndex.path,
		"master-index",
	)
	if (!masterIndex.ok) return failure(masterIndex.errors)
	const instanceIndex = validateRequiredUnit(
		files,
		sourceUnitDescriptors.instanceIndex.path,
		"instance-index",
	)
	if (!instanceIndex.ok) return failure(instanceIndex.errors)
	const glyphIndex = validateRequiredUnit(
		files,
		sourceUnitDescriptors.glyphIndex.path,
		"glyph-index",
	)
	if (!glyphIndex.ok) return failure(glyphIndex.errors)
	const cmapIndex = validateRequiredUnit(
		files,
		sourceUnitDescriptors.cmapIndex.path,
		"cmap-index",
	)
	if (!cmapIndex.ok) return failure(cmapIndex.errors)

	const knownPaths = new Set([
		sourceUnitDescriptors.project.path,
		sourceUnitDescriptors.metadata.path,
		sourceUnitDescriptors.names.path,
		sourceUnitDescriptors.metrics.path,
		sourceUnitDescriptors.style.path,
		sourceUnitDescriptors.axisIndex.path,
		sourceUnitDescriptors.masterIndex.path,
		sourceUnitDescriptors.instanceIndex.path,
		sourceUnitDescriptors.glyphIndex.path,
		sourceUnitDescriptors.cmapIndex.path,
	])

	const loadIdentifiedUnits = <
		Identity extends string,
		Value extends { readonly id: Identity },
	>(
		indexPath: string,
		entries: readonly { readonly id: Identity; readonly path: string }[],
		kind: "axis" | "master" | "instance" | "glyph",
	): SourceResult<readonly Value[]> => {
		const identities = new Set<string>()
		const paths = new Set<string>()
		const values: Value[] = []
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]
			if (entry === undefined) continue
			if (identities.has(entry.id)) {
				return failure([
					duplicateIdentityDiagnostic(indexPath, index, entry.id, "id"),
				])
			}
			if (paths.has(entry.path)) {
				return failure([
					duplicateIndexedPathDiagnostic(indexPath, index, entry.path),
				])
			}
			identities.add(entry.id)
			paths.add(entry.path)
			knownPaths.add(entry.path)
			const value = validateRequiredUnit(files, entry.path, kind)
			if (!value.ok) return failure(value.errors)
			if (value.value.id !== entry.id) {
				return failure([
					{
						severity: "error",
						code: "directory.entity_id",
						unitPath: entry.path,
						path: "$.id",
						message: `Unit ID ${JSON.stringify(value.value.id)} does not match index ID ${JSON.stringify(entry.id)}.`,
					},
				])
			}
			values.push(value.value as Value)
		}
		return success(values)
	}

	const axes = loadIdentifiedUnits<AxisFile["id"], AxisFile>(
		sourceUnitDescriptors.axisIndex.path,
		axisIndex.value,
		"axis",
	)
	if (!axes.ok) return failure(axes.errors)
	const masters = loadIdentifiedUnits<MasterFile["id"], MasterFile>(
		sourceUnitDescriptors.masterIndex.path,
		masterIndex.value.entries,
		"master",
	)
	if (!masters.ok) return failure(masters.errors)
	const instances = loadIdentifiedUnits<InstanceFile["id"], InstanceFile>(
		sourceUnitDescriptors.instanceIndex.path,
		instanceIndex.value,
		"instance",
	)
	if (!instances.ok) return failure(instances.errors)
	const glyphs = loadIdentifiedUnits<GlyphFile["id"], GlyphFile>(
		sourceUnitDescriptors.glyphIndex.path,
		glyphIndex.value,
		"glyph",
	)
	if (!glyphs.ok) return failure(glyphs.errors)

	const cmapCodePoints = new Set<number>()
	const cmapPaths = new Set<string>()
	const cmap: CmapEntryFile[] = []
	for (let index = 0; index < cmapIndex.value.length; index += 1) {
		const entry = cmapIndex.value[index]
		if (entry === undefined) continue
		if (cmapCodePoints.has(entry.codePoint)) {
			return failure([
				duplicateIdentityDiagnostic(
					sourceUnitDescriptors.cmapIndex.path,
					index,
					entry.codePoint,
					"codePoint",
				),
			])
		}
		if (cmapPaths.has(entry.path)) {
			return failure([
				duplicateIndexedPathDiagnostic(
					sourceUnitDescriptors.cmapIndex.path,
					index,
					entry.path,
				),
			])
		}
		cmapCodePoints.add(entry.codePoint)
		cmapPaths.add(entry.path)
		knownPaths.add(entry.path)
		const value = validateRequiredUnit(files, entry.path, "cmap-entry")
		if (!value.ok) return failure(value.errors)
		if (value.value.codePoint !== entry.codePoint) {
			return failure([
				{
					severity: "error",
					code: "directory.cmap_code_point",
					unitPath: entry.path,
					path: "$.codePoint",
					message: `Mapping code point ${value.value.codePoint} does not match index code point ${entry.codePoint}.`,
				},
			])
		}
		cmap.push(value.value)
	}

	for (const path of Object.keys(files)) {
		if (!knownPaths.has(path)) {
			return failure([
				{
					severity: "error",
					code: "directory.unknown_file",
					unitPath: path,
					path: "$",
					message: `Source unit ${JSON.stringify(path)} is not indexed by this project.`,
				},
			])
		}
	}

	const assembled = {
		format: project.value.editorFormat,
		editorVersion: project.value.editorVersion,
		metadata: metadata.value,
		names: names.value,
		metrics: metrics.value,
		style: style.value,
		axes: axes.value,
		masters: masters.value,
		defaultMasterId: masterIndex.value.defaultMasterId,
		instances: instances.value,
		glyphs: glyphs.value,
		cmap,
	}
	return fromEditorFontFile(assembled)
}
