import type {
	JsonValue,
	SourceChangedEvent,
	SourceProjectSnapshot,
	SourceUnitWrite,
} from "@create-font/server"
import {
	applySourceSyncDelta as applySharedSourceSyncDelta,
	sourceSyncStateFromSnapshot as sharedSourceSyncStateFromSnapshot,
	type SourceSyncState,
} from "@create-art/source-rpc"
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
	type FeatureIndexFile,
	type GlyphIndexFile,
	type InstanceIndexFile,
	type MasterIndexFile,
	type SplitFontSourceOptions,
} from "@create-font/source/browser"
import type { EditorFontSource } from "@create-font/states"

export type { SourceSyncState }

export type SourceSyncDeltaResult =
	| Readonly<{ status: `applied`; state: SourceSyncState }>
	| Readonly<{ status: `duplicate`; state: SourceSyncState }>
	| Readonly<{ status: `gap`; state: SourceSyncState }>

export type AssembledSourceSyncState = Readonly<{
	featureEntries: readonly string[]
	featureSources: ReadonlyMap<string, string>
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
	return sharedSourceSyncStateFromSnapshot(snapshot)
}

export function applySourceSyncDelta(
	state: SourceSyncState,
	event: SourceChangedEvent,
): SourceSyncDeltaResult {
	const result = applySharedSourceSyncDelta(state, event)
	return {
		status: result.kind,
		state: result.state,
	}
}

export function assembleSourceSyncState(
	state: SourceSyncState,
): AssembledSourceSyncState {
	const files = filesForState(state)
	const assembled = assembleEditorFontSource(files)
	if (!assembled.ok) throw new Error(assembled.errors[0].message)
	const featureEntries = (files[`features/index.json`] as FeatureIndexFile).map(
		(entry) => entry.path,
	)
	return Object.freeze({
		featureEntries,
		featureSources: new Map(
			[...state.units.values()].flatMap((unit) =>
				unit.path.startsWith(`features/`) &&
				unit.path.endsWith(`.fea`) &&
				typeof unit.value === `string`
					? [[unit.path, unit.value] as const]
					: [],
			),
		),
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
