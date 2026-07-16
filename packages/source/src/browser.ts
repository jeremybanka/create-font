import type { EditorFontSource } from "@trigraph/states"

import { fromEditorFontFile, toEditorFontFile } from "./codec.ts"
import { failure, success } from "./result.ts"
import {
	TRIGRAPH_EDITOR_FORMAT,
	TRIGRAPH_EDITOR_VERSION,
	type EditorFontFile,
	type SourceDiagnostic,
	type SourceResult,
} from "./types.ts"

export const TRIGRAPH_SOURCE_FORMAT = "trigraph.source" as const
export const TRIGRAPH_SOURCE_VERSION = 1 as const

export type ProjectFile = Readonly<{
	format: typeof TRIGRAPH_SOURCE_FORMAT
	sourceVersion: typeof TRIGRAPH_SOURCE_VERSION
	editorFormat: typeof TRIGRAPH_EDITOR_FORMAT
	editorVersion: typeof TRIGRAPH_EDITOR_VERSION
}>
export type MetadataFile = EditorFontFile["metadata"]
export type NamesFile = EditorFontFile["names"]
export type MetricsFile = EditorFontFile["metrics"]
export type StyleFile = EditorFontFile["style"]
export type AxisFile = EditorFontFile["axes"][number]
export type MasterFile = EditorFontFile["masters"][number]
export type InstanceFile = EditorFontFile["instances"][number]
export type GlyphFile = EditorFontFile["glyphs"][number]
export type CmapEntryFile = EditorFontFile["cmap"][number]
export type AxisIndexFile = readonly Readonly<{
	id: AxisFile["id"]
	path: string
}>[]
export type MasterIndexFile = Readonly<{
	defaultMasterId: EditorFontFile["defaultMasterId"]
	entries: readonly Readonly<{ id: MasterFile["id"]; path: string }>[]
}>
export type InstanceIndexFile = readonly Readonly<{
	id: InstanceFile["id"]
	path: string
}>[]
export type GlyphIndexFile = readonly Readonly<{
	id: GlyphFile["id"]
	path: string
}>[]
export type CmapIndexFile = readonly Readonly<{
	codePoint: number
	path: string
}>[]

export type FontSourceDirectoryFiles = Readonly<Record<string, unknown>>

const paths = {
	project: "trigraph.json",
	metadata: "metadata.json",
	names: "names.json",
	metrics: "metrics.json",
	style: "style.json",
	axisIndex: "axes/index.json",
	masterIndex: "masters/index.json",
	instanceIndex: "instances/index.json",
	glyphIndex: "glyphs/index.json",
	cmapIndex: "cmap/index.json",
} as const

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

function isSafeCollectionUnitPath(path: string, directory: string): boolean {
	const prefix = `${directory}/`
	if (
		!path.startsWith(prefix) ||
		path === `${prefix}index.json` ||
		!path.endsWith(".json")
	) {
		return false
	}
	for (const rawSegment of path.slice(prefix.length).split("/")) {
		if (!/^[A-Za-z0-9._~%-]+$/u.test(rawSegment)) return false
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

function directoryDiagnostic(
	code: SourceDiagnostic["code"],
	unitPath: string,
	path: string,
	message: string,
): SourceDiagnostic {
	return { severity: "error", code, unitPath, path, message }
}

function duplicatePathDiagnostic(
	path: string,
	indexPath: string,
	index: number,
) {
	return directoryDiagnostic(
		"directory.duplicate_path",
		indexPath,
		`$[${index}].path`,
		`Source unit path ${JSON.stringify(path)} is used more than once.`,
	)
}

/**
 * Split a validated editor snapshot into the source units previously loaded by
 * the browser. Per-unit schema validation remains a server responsibility.
 */
export function splitEditorFontSource(
	source: EditorFontSource,
	options: SplitFontSourceOptions = {},
): SourceResult<FontSourceDirectoryFiles> {
	const fileResult = toEditorFontFile(source)
	if (!fileResult.ok) return failure(fileResult.errors)
	const file = fileResult.value
	const files: Record<string, unknown> = {
		[paths.project]: {
			format: TRIGRAPH_SOURCE_FORMAT,
			sourceVersion: TRIGRAPH_SOURCE_VERSION,
			editorFormat: TRIGRAPH_EDITOR_FORMAT,
			editorVersion: TRIGRAPH_EDITOR_VERSION,
		},
		[paths.metadata]: file.metadata,
		[paths.names]: file.names,
		[paths.metrics]: file.metrics,
		[paths.style]: file.style,
	}

	const addUnit = (
		path: string,
		directory: string,
		indexPath: string,
		index: number,
		value: unknown,
	): SourceResult<null> => {
		if (!isSafeCollectionUnitPath(path, directory)) {
			return failure([
				directoryDiagnostic(
					"source.schema",
					indexPath,
					`$[${index}].path`,
					`Expected a safe relative JSON path below ${directory}/.`,
				),
			])
		}
		if (Object.hasOwn(files, path)) {
			return failure([duplicatePathDiagnostic(path, indexPath, index)])
		}
		files[path] = value
		return success(null)
	}

	const axisIndex: { readonly id: AxisFile["id"]; readonly path: string }[] = []
	for (let index = 0; index < file.axes.length; index += 1) {
		const axis = file.axes[index]
		if (axis === undefined) continue
		const path = (options.axisPath ?? ((item) => defaultAxisUnitPath(item.id)))(
			axis,
			index,
		)
		const added = addUnit(path, "axes", paths.axisIndex, index, axis)
		if (!added.ok) return failure(added.errors)
		axisIndex.push({ id: axis.id, path })
	}
	files[paths.axisIndex] = axisIndex

	const masterEntries: {
		readonly id: MasterFile["id"]
		readonly path: string
	}[] = []
	for (let index = 0; index < file.masters.length; index += 1) {
		const master = file.masters[index]
		if (master === undefined) continue
		const path = (
			options.masterPath ?? ((item) => defaultMasterUnitPath(item.id))
		)(master, index)
		const added = addUnit(path, "masters", paths.masterIndex, index, master)
		if (!added.ok) return failure(added.errors)
		masterEntries.push({ id: master.id, path })
	}
	files[paths.masterIndex] = {
		defaultMasterId: file.defaultMasterId,
		entries: masterEntries,
	}

	const instanceIndex: {
		readonly id: InstanceFile["id"]
		readonly path: string
	}[] = []
	for (let index = 0; index < file.instances.length; index += 1) {
		const instance = file.instances[index]
		if (instance === undefined) continue
		const path = (
			options.instancePath ?? ((item) => defaultInstanceUnitPath(item.id))
		)(instance, index)
		const added = addUnit(
			path,
			"instances",
			paths.instanceIndex,
			index,
			instance,
		)
		if (!added.ok) return failure(added.errors)
		instanceIndex.push({ id: instance.id, path })
	}
	files[paths.instanceIndex] = instanceIndex

	const glyphIndex: { readonly id: GlyphFile["id"]; readonly path: string }[] =
		[]
	for (let index = 0; index < file.glyphs.length; index += 1) {
		const glyph = file.glyphs[index]
		if (glyph === undefined) continue
		const path = (
			options.glyphPath ?? ((item) => defaultGlyphUnitPath(item.id))
		)(glyph, index)
		const added = addUnit(path, "glyphs", paths.glyphIndex, index, glyph)
		if (!added.ok) return failure(added.errors)
		glyphIndex.push({ id: glyph.id, path })
	}
	files[paths.glyphIndex] = glyphIndex

	const cmapIndex: { readonly codePoint: number; readonly path: string }[] = []
	for (let index = 0; index < file.cmap.length; index += 1) {
		const entry = file.cmap[index]
		if (entry === undefined) continue
		const path = (
			options.cmapPath ?? ((item) => defaultCmapUnitPath(item.codePoint))
		)(entry, index)
		const added = addUnit(path, "cmap", paths.cmapIndex, index, entry)
		if (!added.ok) return failure(added.errors)
		cmapIndex.push({ codePoint: entry.codePoint, path })
	}
	files[paths.cmapIndex] = cmapIndex
	return success(files)
}

function requiredDirectoryFile<Value>(
	files: FontSourceDirectoryFiles,
	path: string,
): SourceResult<Value> {
	return Object.hasOwn(files, path)
		? success(files[path] as Value)
		: failure([
				directoryDiagnostic(
					"directory.missing_file",
					path,
					"$",
					`Missing required source unit ${JSON.stringify(path)}.`,
				),
			])
}

function recordValue(
	value: unknown,
	unitPath: string,
): SourceResult<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? success(value as Record<string, unknown>)
		: failure([
				directoryDiagnostic(
					"source.object",
					unitPath,
					"$",
					"Expected an object.",
				),
			])
}

function arrayValue<Value>(
	value: unknown,
	unitPath: string,
): SourceResult<readonly Value[]> {
	return Array.isArray(value)
		? success(value as readonly Value[])
		: failure([
				directoryDiagnostic(
					"source.array",
					unitPath,
					"$",
					"Expected an array.",
				),
			])
}

function duplicateIdentityDiagnostic(
	indexPath: string,
	index: number,
	identity: string | number,
	field: "codePoint" | "id",
): SourceDiagnostic {
	return directoryDiagnostic(
		"directory.duplicate_id",
		indexPath,
		`$[${index}].${field}`,
		`Identity ${JSON.stringify(identity)} is indexed more than once.`,
	)
}

function duplicateIndexedPathDiagnostic(
	indexPath: string,
	index: number,
	path: string,
): SourceDiagnostic {
	return directoryDiagnostic(
		"directory.duplicate_path",
		indexPath,
		`$[${index}].path`,
		`Source unit path ${JSON.stringify(path)} is indexed more than once.`,
	)
}

/**
 * Reassemble source units already validated by the workspace server. This
 * still checks index relationships and runs the browser-safe whole-document
 * validator before returning editor state.
 */
export function assembleEditorFontSource(
	files: FontSourceDirectoryFiles,
): SourceResult<EditorFontSource> {
	const projectResult = requiredDirectoryFile<ProjectFile>(files, paths.project)
	if (!projectResult.ok) return failure(projectResult.errors)
	const projectRecord = recordValue(projectResult.value, paths.project)
	if (!projectRecord.ok) return failure(projectRecord.errors)
	if (
		projectRecord.value.format !== TRIGRAPH_SOURCE_FORMAT ||
		projectRecord.value.sourceVersion !== TRIGRAPH_SOURCE_VERSION ||
		projectRecord.value.editorFormat !== TRIGRAPH_EDITOR_FORMAT ||
		projectRecord.value.editorVersion !== TRIGRAPH_EDITOR_VERSION
	) {
		return failure([
			directoryDiagnostic(
				"source.version",
				paths.project,
				"$",
				"The source manifest version is not supported by this editor.",
			),
		])
	}

	const metadata = requiredDirectoryFile<MetadataFile>(files, paths.metadata)
	if (!metadata.ok) return failure(metadata.errors)
	const names = requiredDirectoryFile<NamesFile>(files, paths.names)
	if (!names.ok) return failure(names.errors)
	const metrics = requiredDirectoryFile<MetricsFile>(files, paths.metrics)
	if (!metrics.ok) return failure(metrics.errors)
	const style = requiredDirectoryFile<StyleFile>(files, paths.style)
	if (!style.ok) return failure(style.errors)

	const axisIndexFile = requiredDirectoryFile<unknown>(files, paths.axisIndex)
	if (!axisIndexFile.ok) return failure(axisIndexFile.errors)
	const axisIndex = arrayValue<AxisIndexFile[number]>(
		axisIndexFile.value,
		paths.axisIndex,
	)
	if (!axisIndex.ok) return failure(axisIndex.errors)

	const masterIndexFile = requiredDirectoryFile<unknown>(
		files,
		paths.masterIndex,
	)
	if (!masterIndexFile.ok) return failure(masterIndexFile.errors)
	const masterIndexRecord = recordValue(
		masterIndexFile.value,
		paths.masterIndex,
	)
	if (!masterIndexRecord.ok) return failure(masterIndexRecord.errors)
	if (
		typeof masterIndexRecord.value.defaultMasterId !== "string" ||
		!Array.isArray(masterIndexRecord.value.entries)
	) {
		return failure([
			directoryDiagnostic(
				"source.object",
				paths.masterIndex,
				"$",
				"Expected a master index.",
			),
		])
	}
	const masterIndex = masterIndexRecord.value as unknown as MasterIndexFile

	const instanceIndexFile = requiredDirectoryFile<unknown>(
		files,
		paths.instanceIndex,
	)
	if (!instanceIndexFile.ok) return failure(instanceIndexFile.errors)
	const instanceIndex = arrayValue<InstanceIndexFile[number]>(
		instanceIndexFile.value,
		paths.instanceIndex,
	)
	if (!instanceIndex.ok) return failure(instanceIndex.errors)

	const glyphIndexFile = requiredDirectoryFile<unknown>(files, paths.glyphIndex)
	if (!glyphIndexFile.ok) return failure(glyphIndexFile.errors)
	const glyphIndex = arrayValue<GlyphIndexFile[number]>(
		glyphIndexFile.value,
		paths.glyphIndex,
	)
	if (!glyphIndex.ok) return failure(glyphIndex.errors)

	const cmapIndexFile = requiredDirectoryFile<unknown>(files, paths.cmapIndex)
	if (!cmapIndexFile.ok) return failure(cmapIndexFile.errors)
	const cmapIndex = arrayValue<CmapIndexFile[number]>(
		cmapIndexFile.value,
		paths.cmapIndex,
	)
	if (!cmapIndex.ok) return failure(cmapIndex.errors)

	const knownPaths = new Set<string>(Object.values(paths))
	const loadIdentifiedUnits = <
		Identity extends string,
		Value extends { readonly id: Identity },
	>(
		indexPath: string,
		entries: readonly { readonly id: Identity; readonly path: string }[],
	): SourceResult<readonly Value[]> => {
		const identities = new Set<string>()
		const indexedPaths = new Set<string>()
		const values: Value[] = []
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]
			if (
				entry === undefined ||
				typeof entry.id !== "string" ||
				typeof entry.path !== "string"
			) {
				return failure([
					directoryDiagnostic(
						"source.object",
						indexPath,
						`$[${index}]`,
						"Expected an index entry.",
					),
				])
			}
			if (identities.has(entry.id)) {
				return failure([
					duplicateIdentityDiagnostic(indexPath, index, entry.id, "id"),
				])
			}
			if (indexedPaths.has(entry.path)) {
				return failure([
					duplicateIndexedPathDiagnostic(indexPath, index, entry.path),
				])
			}
			identities.add(entry.id)
			indexedPaths.add(entry.path)
			knownPaths.add(entry.path)
			const value = requiredDirectoryFile<Value>(files, entry.path)
			if (!value.ok) return failure(value.errors)
			if (
				typeof value.value !== "object" ||
				value.value === null ||
				value.value.id !== entry.id
			) {
				return failure([
					directoryDiagnostic(
						"directory.entity_id",
						entry.path,
						"$.id",
						`Unit ID does not match index ID ${JSON.stringify(entry.id)}.`,
					),
				])
			}
			values.push(value.value)
		}
		return success(values)
	}

	const axes = loadIdentifiedUnits<AxisFile["id"], AxisFile>(
		paths.axisIndex,
		axisIndex.value,
	)
	if (!axes.ok) return failure(axes.errors)
	const masters = loadIdentifiedUnits<MasterFile["id"], MasterFile>(
		paths.masterIndex,
		masterIndex.entries,
	)
	if (!masters.ok) return failure(masters.errors)
	const instances = loadIdentifiedUnits<InstanceFile["id"], InstanceFile>(
		paths.instanceIndex,
		instanceIndex.value,
	)
	if (!instances.ok) return failure(instances.errors)
	const glyphs = loadIdentifiedUnits<GlyphFile["id"], GlyphFile>(
		paths.glyphIndex,
		glyphIndex.value,
	)
	if (!glyphs.ok) return failure(glyphs.errors)

	const cmapCodePoints = new Set<number>()
	const cmapPaths = new Set<string>()
	const cmap: CmapEntryFile[] = []
	for (let index = 0; index < cmapIndex.value.length; index += 1) {
		const entry = cmapIndex.value[index]
		if (
			entry === undefined ||
			typeof entry.codePoint !== "number" ||
			typeof entry.path !== "string"
		) {
			return failure([
				directoryDiagnostic(
					"source.object",
					paths.cmapIndex,
					`$[${index}]`,
					"Expected a character-map index entry.",
				),
			])
		}
		if (cmapCodePoints.has(entry.codePoint)) {
			return failure([
				duplicateIdentityDiagnostic(
					paths.cmapIndex,
					index,
					entry.codePoint,
					"codePoint",
				),
			])
		}
		if (cmapPaths.has(entry.path)) {
			return failure([
				duplicateIndexedPathDiagnostic(paths.cmapIndex, index, entry.path),
			])
		}
		cmapCodePoints.add(entry.codePoint)
		cmapPaths.add(entry.path)
		knownPaths.add(entry.path)
		const value = requiredDirectoryFile<CmapEntryFile>(files, entry.path)
		if (!value.ok) return failure(value.errors)
		if (
			typeof value.value !== "object" ||
			value.value === null ||
			value.value.codePoint !== entry.codePoint
		) {
			return failure([
				directoryDiagnostic(
					"directory.cmap_code_point",
					entry.path,
					"$.codePoint",
					`Mapping code point does not match index code point ${entry.codePoint}.`,
				),
			])
		}
		cmap.push(value.value)
	}

	for (const path of Object.keys(files)) {
		if (!knownPaths.has(path)) {
			return failure([
				directoryDiagnostic(
					"directory.unknown_file",
					path,
					"$",
					`Source unit ${JSON.stringify(path)} is not indexed by this project.`,
				),
			])
		}
	}

	const assembled: EditorFontFile = {
		format: TRIGRAPH_EDITOR_FORMAT,
		editorVersion: TRIGRAPH_EDITOR_VERSION,
		metadata: metadata.value,
		names: names.value,
		metrics: metrics.value,
		style: style.value,
		axes: axes.value,
		masters: masters.value,
		defaultMasterId: masterIndex.defaultMasterId,
		instances: instances.value,
		glyphs: glyphs.value,
		cmap,
	}
	return fromEditorFontFile(assembled)
}
