import {
	applySourceSyncDelta,
	sourceSyncStateFromSnapshot,
	type JsonValue,
	type SourceChangedEvent,
	type SourceSyncState,
	type SourceUnitRemoval,
	type SourceUnitWrite,
} from "@create-art/source-rpc"
import { createSourceRpcClient } from "@create-art/source-rpc/client"
import {
	assembleDesignDocument,
	defaultObjectUnitPath,
	sourceUnitKindForPath,
	splitDesignDocument,
	type DesignDocument,
} from "@create-design/source"

export type DesignSourceStatus =
	| `connected`
	| `saving`
	| `saved`
	| `recovering`
	| `conflict`

export interface DesignSourceSession {
	readonly initialDocument: DesignDocument
	save(document: DesignDocument): Promise<void>
	subscribeDocument(listener: (document: DesignDocument) => void): () => void
	subscribeStatus(listener: (status: DesignSourceStatus) => void): () => void
}

function assemble(state: SourceSyncState): DesignDocument {
	const result = assembleDesignDocument(
		Object.fromEntries(
			[...state.units].map(([path, unit]) => [path, unit.value]),
		),
	)
	if (!result.ok) {
		throw new Error(result.errors.map(({ message }) => message).join(`\n`))
	}
	return result.value
}

function objectPaths(state: SourceSyncState): ReadonlyMap<string, string> {
	const value = state.units.get(`scene/objects/index.json`)?.value
	if (
		value === null ||
		typeof value !== `object` ||
		Array.isArray(value) ||
		!(`entries` in value) ||
		!Array.isArray(value.entries)
	) {
		return new Map()
	}
	return new Map(
		value.entries.flatMap((entry) =>
			entry !== null &&
			typeof entry === `object` &&
			!Array.isArray(entry) &&
			`id` in entry &&
			typeof entry.id === `string` &&
			`path` in entry &&
			typeof entry.path === `string`
				? [[entry.id, entry.path] as const]
				: [],
		),
	)
}

function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item)).join(`,`)}]`
	const record = value as Readonly<Record<string, JsonValue>>
	return `{${Object.keys(record)
		.toSorted()
		.map(
			(key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`,
		)
		.join(`,`)}}`
}

export function designSourceTransaction(
	state: SourceSyncState,
	document: DesignDocument,
): Readonly<{
	removals: readonly SourceUnitRemoval[]
	writes: readonly SourceUnitWrite[]
}> {
	const paths = objectPaths(state)
	const split = splitDesignDocument(document, {
		objectPath: ({ id }) => paths.get(id) ?? defaultObjectUnitPath(id),
	})
	if (!split.ok) {
		throw new Error(split.errors.map(({ message }) => message).join(`\n`))
	}
	const next = split.value as Readonly<Record<string, JsonValue>>
	const writes: SourceUnitWrite[] = []
	for (const [path, value] of Object.entries(next)) {
		if (sourceUnitKindForPath(path) === null) continue
		const current = state.units.get(path)
		if (
			current !== undefined &&
			canonicalJson(current.value) === canonicalJson(value)
		)
			continue
		writes.push({
			expectedRevision: current?.revision ?? null,
			path,
			value,
		})
	}
	const removals = [...state.units.values()]
		.filter(({ path }) => !(path in next))
		.map(({ path, revision }) => ({ expectedRevision: revision, path }))
	return { removals, writes }
}

function websocketUrl(): string {
	const url = new URL(`/api/source/events`, window.location.href)
	url.protocol = url.protocol === `https:` ? `wss:` : `ws:`
	return url.href
}

export async function connectDesignSourceSession(): Promise<DesignSourceSession> {
	const client = createSourceRpcClient()
	let state = sourceSyncStateFromSnapshot(await client.readSnapshot())
	const documentListeners = new Set<(document: DesignDocument) => void>()
	const statusListeners = new Set<(status: DesignSourceStatus) => void>()
	const localOperations = new Set<string>()
	let externalConflict = false
	let pendingSaves = 0
	let tail: Promise<void> = Promise.resolve()
	const status = (value: DesignSourceStatus): void => {
		for (const listener of statusListeners) listener(value)
	}
	const recover = async (notify: boolean): Promise<void> => {
		status(`recovering`)
		state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		if (notify) {
			const document = assemble(state)
			for (const listener of documentListeners) listener(document)
		}
		status(`connected`)
	}
	const socket = new WebSocket(websocketUrl())
	socket.addEventListener(`message`, (message) => {
		void (async () => {
			const event = JSON.parse(String(message.data)) as SourceChangedEvent
			const isLocal =
				event.operationId !== undefined &&
				localOperations.delete(event.operationId)
			const result = applySourceSyncDelta(state, event)
			if (result.kind === `gap`) {
				if (pendingSaves > 0) externalConflict = true
				await recover(pendingSaves === 0)
				if (externalConflict) status(`conflict`)
				return
			}
			state = result.state
			if (result.kind === `applied` && !isLocal && pendingSaves > 0) {
				externalConflict = true
				status(`conflict`)
				return
			}
			if (result.kind === `applied` && !isLocal && pendingSaves === 0) {
				const document = assemble(state)
				for (const listener of documentListeners) listener(document)
			}
		})().catch(() => status(`conflict`))
	})
	socket.addEventListener(`open`, () => status(`connected`))
	socket.addEventListener(`close`, () => status(`recovering`))

	return {
		initialDocument: assemble(state),
		save(document) {
			pendingSaves += 1
			const operation = async (): Promise<void> => {
				try {
					if (externalConflict) {
						status(`conflict`)
						throw new Error(`The source changed while local edits were queued.`)
					}
					const transaction = designSourceTransaction(state, document)
					if (transaction.writes.length + transaction.removals.length === 0)
						return
					const idempotencyKey = crypto.randomUUID()
					localOperations.add(idempotencyKey)
					status(`saving`)
					try {
						const result = await client.writeUnits({
							idempotencyKey,
							...transaction,
						})
						const applied = applySourceSyncDelta(state, {
							type: `source.changed`,
							operationId: idempotencyKey,
							previousRevision: result.previousRevision,
							removedPaths: result.removedPaths,
							revision: result.revision,
							units: result.units,
						})
						if (applied.kind === `gap`) await recover(false)
						else state = applied.state
						status(`saved`)
					} catch (error) {
						localOperations.delete(idempotencyKey)
						externalConflict = true
						status(`conflict`)
						throw error
					}
				} finally {
					pendingSaves -= 1
				}
			}
			const result = tail.then(operation, operation)
			tail = result.catch(() => undefined)
			return result
		},
		subscribeDocument(listener) {
			documentListeners.add(listener)
			return () => documentListeners.delete(listener)
		},
		subscribeStatus(listener) {
			statusListeners.add(listener)
			return () => statusListeners.delete(listener)
		},
	}
}
