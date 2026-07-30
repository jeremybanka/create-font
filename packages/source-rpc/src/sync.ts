import type {
	SourceChangedEvent,
	SourceProjectSnapshot,
	SourceUnitSnapshot,
} from "./contracts.ts"

export type SourceSyncState = Readonly<{
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
	for (const path of event.removedPaths) units.delete(path)
	for (const unit of event.units) units.set(unit.path, unit)
	return {
		kind: `applied`,
		state: { revision: event.revision, units },
	}
}
