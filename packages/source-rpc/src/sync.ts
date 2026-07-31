import type {
	SourceChangedEvent,
	SourceProjectSnapshot,
	SourceUnitSnapshot,
} from "./contracts.ts"
import type { SourceAssetDescriptor } from "./assets.ts"

export type SourceSyncState = Readonly<{
	assets?: ReadonlyMap<string, SourceAssetDescriptor>
	revision: string
	units: ReadonlyMap<string, SourceUnitSnapshot>
}>

export type ApplySourceDeltaResult =
	| Readonly<{ kind: `applied`; state: SourceSyncState }>
	| Readonly<{ kind: `duplicate`; state: SourceSyncState }>
	| Readonly<{ kind: `gap`; state: SourceSyncState }>

export function sourceSyncStateFromSnapshot(
	snapshot: SourceProjectSnapshot,
): SourceSyncState {
	return {
		...(snapshot.assets === undefined
			? {}
			: {
					assets: new Map(snapshot.assets.map((asset) => [asset.path, asset])),
				}),
		revision: snapshot.revision,
		units: new Map(snapshot.units.map((unit) => [unit.path, unit])),
	}
}

export function applySourceSyncDelta(
	state: SourceSyncState,
	event: SourceChangedEvent,
): ApplySourceDeltaResult {
	if (event.revision === state.revision) return { kind: `duplicate`, state }
	if (event.previousRevision !== state.revision) return { kind: `gap`, state }
	const units = new Map(state.units)
	const assets = new Map(state.assets ?? [])
	for (const path of event.removedPaths) units.delete(path)
	for (const unit of event.units) units.set(unit.path, unit)
	for (const path of event.removedAssetPaths ?? []) assets.delete(path)
	for (const asset of event.assets ?? []) assets.set(asset.path, asset)
	return {
		kind: `applied`,
		state: {
			...(state.assets === undefined &&
			event.assets === undefined &&
			event.removedAssetPaths === undefined
				? {}
				: { assets }),
			revision: event.revision,
			units,
		},
	}
}
