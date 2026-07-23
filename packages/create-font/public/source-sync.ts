import type {
	JsonValue,
	SourceChangedEvent,
	SourceProjectSnapshot,
	SourceUnitSnapshot,
	SourceUnitWrite,
} from "@create-font/server"
import {
	assembleEditorFontSource,
	defaultAxisUnitPath,
	defaultCmapUnitPath,
	defaultGlyphUnitPath,
	defaultInstanceUnitPath,
	defaultMasterUnitPath,
	splitEditorFontSource,
	type AxisIndexFile,
	type CmapIndexFile,
	type FontSourceDirectoryFiles,
	type GlyphIndexFile,
	type InstanceIndexFile,
	type MasterIndexFile,
	type SplitFontSourceOptions,
} from "@create-font/source/browser"
import type { EditorFontSource } from "@create-font/states"

export type SourceSyncState = Readonly<{
	revision: string
	units: ReadonlyMap<string, SourceUnitSnapshot>
}>

export type SourceSyncDeltaResult =
	| Readonly<{ status: `applied`; state: SourceSyncState }>
	| Readonly<{ status: `duplicate`; state: SourceSyncState }>
	| Readonly<{ status: `gap`; state: SourceSyncState }>

export type AssembledSourceSyncState = Readonly<{
	featureSources: readonly string[]
	source: EditorFontSource
}>

function filesForState(state: SourceSyncState): FontSourceDirectoryFiles {
	return Object.fromEntries(
		[...state.units].map(([path, unit]) => [path, unit.value]),
	)
}

function pathsById<Entry extends { readonly id: string }>(
	entries: readonly (Entry & { readonly path: string })[],
): ReadonlyMap<string, string> {
	return new Map(entries.map((entry) => [entry.id, entry.path]))
}

function pathOptions(files: FontSourceDirectoryFiles): SplitFontSourceOptions {
	const axisPaths = pathsById(files["axes/index.json"] as AxisIndexFile)
	const masterPaths = pathsById(
		(files["masters/index.json"] as MasterIndexFile).entries,
	)
	const instancePaths = pathsById(
		files["instances/index.json"] as InstanceIndexFile,
	)
	const glyphPaths = pathsById(files["glyphs/index.json"] as GlyphIndexFile)
	const cmapPaths = new Map(
		(files["cmap/index.json"] as CmapIndexFile).map((entry) => [
			entry.codePoint,
			entry.path,
		]),
	)
	return {
		axisPath: (axis) => axisPaths.get(axis.id) ?? defaultAxisUnitPath(axis.id),
		masterPath: (master) =>
			masterPaths.get(master.id) ?? defaultMasterUnitPath(master.id),
		instancePath: (instance) =>
			instancePaths.get(instance.id) ?? defaultInstanceUnitPath(instance.id),
		glyphPath: (glyph) =>
			glyphPaths.get(glyph.id) ?? defaultGlyphUnitPath(glyph.id),
		cmapPath: (entry) =>
			cmapPaths.get(entry.codePoint) ?? defaultCmapUnitPath(entry.codePoint),
	}
}

export function sourceSyncStateFromSnapshot(
	snapshot: SourceProjectSnapshot,
): SourceSyncState {
	return Object.freeze({
		revision: snapshot.revision,
		units: new Map(snapshot.units.map((unit) => [unit.path, unit])),
	})
}

export function applySourceSyncDelta(
	state: SourceSyncState,
	event: SourceChangedEvent,
): SourceSyncDeltaResult {
	if (event.revision === state.revision) {
		return { status: `duplicate`, state }
	}
	if (event.previousRevision !== state.revision) {
		return { status: `gap`, state }
	}
	const units = new Map(state.units)
	for (const path of event.removedPaths) units.delete(path)
	for (const unit of event.units) units.set(unit.path, unit)
	return {
		status: `applied`,
		state: Object.freeze({ revision: event.revision, units }),
	}
}

export function assembleSourceSyncState(
	state: SourceSyncState,
): AssembledSourceSyncState {
	const files = filesForState(state)
	const assembled = assembleEditorFontSource(files)
	if (!assembled.ok) throw new Error(assembled.errors[0].message)
	return Object.freeze({
		featureSources: [...state.units.values()]
			.filter(
				(unit) =>
					unit.path.startsWith(`features/`) &&
					unit.path.endsWith(`.fea`) &&
					typeof unit.value === `string`,
			)
			.map((unit) => unit.value as string),
		source: assembled.value,
	})
}

export function sourceUnitWrites(
	state: SourceSyncState,
	source: EditorFontSource,
): readonly SourceUnitWrite[] {
	const files = filesForState(state)
	const split = splitEditorFontSource(source, pathOptions(files))
	if (!split.ok) throw new Error(split.errors[0].message)
	const writes: SourceUnitWrite[] = []
	for (const [path, value] of Object.entries(split.value)) {
		const current = state.units.get(path)
		if (
			current !== undefined &&
			JSON.stringify(current.value) === JSON.stringify(value)
		) {
			continue
		}
		writes.push({
			expectedRevision: current?.revision ?? null,
			path,
			value: value as JsonValue,
		})
	}
	return writes
}
