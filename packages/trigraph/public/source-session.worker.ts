import {
	createTrigraphRpcClient,
	type TrigraphRpcClient,
} from "@trigraph/server/client"
import type {
	JsonValue,
	SourceManifest,
	SourceUnitSnapshot,
	SourceUnitWrite,
} from "@trigraph/server"
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
} from "@trigraph/source/browser"
import type { EditorFontSource } from "@trigraph/states"

import type {
	SourceSessionEvent,
	SourceSessionRequest,
} from "./source-session.ts"

type SharedWorkerScope = Readonly<{
	location: Location
}> & {
	onconnect: ((event: MessageEvent) => void) | null
}

const scope = globalThis as unknown as SharedWorkerScope
const client = createTrigraphRpcClient(scope.location.origin)
const ports = new Set<MessagePort>()
let sourceUnits = new Map<string, SourceUnitSnapshot>()
let source: EditorFontSource | null = null
let revision: string | null = null
let writeQueue = Promise.resolve()
let refreshQueue: Promise<void> | null = null
let pendingManifest: SourceManifest | undefined

function assertData<Value>(
	result: Readonly<{ data: Value | null; error: { status: number } | null }>,
	operation: string,
): Value {
	if (result.error !== null || result.data === null) {
		throw new Error(
			`${operation} failed with HTTP ${result.error?.status ?? 500}.`,
		)
	}
	return result.data
}

async function loadSourceUnits(
	rpc: TrigraphRpcClient,
	manifest: SourceManifest,
): Promise<readonly SourceUnitSnapshot[]> {
	return Promise.all(
		manifest.units.map(async ({ path }) => {
			const snapshot = assertData(
				await rpc.api.source.unit.get({ query: { path } }),
				`Read ${path}`,
			)
			if (`code` in snapshot) {
				throw new Error(`Source unit ${path} is unavailable.`)
			}
			return snapshot
		}),
	)
}

function pathOptions(files: FontSourceDirectoryFiles): SplitFontSourceOptions {
	const pathsById = <Entry extends { readonly id: string }>(
		entries: readonly (Entry & { readonly path: string })[],
	) => new Map(entries.map((entry) => [entry.id, entry.path]))
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

function post(port: MessagePort, event: SourceSessionEvent): void {
	port.postMessage(event)
}

function broadcast(event: SourceSessionEvent, except?: MessagePort): void {
	for (const port of ports) {
		if (port !== except) post(port, event)
	}
}

function currentSourceEvent(): SourceSessionEvent | null {
	if (source === null || revision === null) return null
	return { type: `source`, revision, source }
}

async function refresh(manifest?: SourceManifest): Promise<void> {
	if (manifest?.revision === revision) return
	if (manifest !== undefined) pendingManifest = manifest
	if (refreshQueue !== null) return refreshQueue
	refreshQueue = (async () => {
		do {
			const requested = pendingManifest
			pendingManifest = undefined
			const inventory =
				requested ??
				assertData(await client.api.source.get(), `Read source inventory`)
			if (`code` in inventory) {
				throw new Error(`Font source is not available.`)
			}
			if (inventory.revision === revision) continue
			const snapshots = await loadSourceUnits(client, inventory)
			const files = Object.fromEntries(
				snapshots.map((snapshot) => [snapshot.path, snapshot.value]),
			)
			const assembled = assembleEditorFontSource(files)
			if (!assembled.ok) throw new Error(assembled.errors[0].message)
			sourceUnits = new Map(
				snapshots.map((snapshot) => [snapshot.path, snapshot]),
			)
			source = assembled.value
			revision = inventory.revision
			const event = currentSourceEvent()
			if (event !== null) broadcast(event)
		} while (
			pendingManifest !== undefined &&
			pendingManifest.revision !== revision
		)
	})().finally(() => {
		refreshQueue = null
	})
	return refreshQueue
}

async function save(
	port: MessagePort,
	request: Extract<SourceSessionRequest, { type: "save" }>,
): Promise<void> {
	if (revision === null || source === null) await refresh()
	if (request.baseRevision !== revision) {
		const current = currentSourceEvent()
		if (current !== null) post(port, current)
		post(port, {
			type: `error`,
			requestId: request.requestId,
			message: `The font source changed before this edit could be saved.`,
		})
		return
	}
	const files = Object.fromEntries(
		[...sourceUnits].map(([path, snapshot]) => [path, snapshot.value]),
	)
	const split = splitEditorFontSource(request.source, pathOptions(files))
	if (!split.ok) throw new Error(split.errors[0].message)
	const writes: SourceUnitWrite[] = []
	for (const [path, value] of Object.entries(split.value)) {
		const current = sourceUnits.get(path)
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
	if (writes.length === 0) {
		post(port, {
			type: `saved`,
			requestId: request.requestId,
			revision: revision as string,
		})
		return
	}
	const result = assertData(
		await client.api.source.units.put({
			idempotencyKey: request.requestId,
			writes: writes as [SourceUnitWrite, ...SourceUnitWrite[]],
		}),
		`Write font source`,
	)
	if (`code` in result) throw new Error(`The font source write failed.`)
	for (const snapshot of result.units) sourceUnits.set(snapshot.path, snapshot)
	source = request.source
	revision = result.revision
	post(port, {
		type: `saved`,
		requestId: request.requestId,
		revision,
	})
	const event = currentSourceEvent()
	if (event !== null) broadcast(event, port)
}

function handleRequest(port: MessagePort, request: SourceSessionRequest): void {
	if (request.type === `refresh`) {
		void refresh().catch((error: unknown) => {
			post(port, {
				type: `error`,
				message: error instanceof Error ? error.message : String(error),
			})
		})
		return
	}
	writeQueue = writeQueue
		.then(() => save(port, request))
		.catch((error: unknown) => {
			post(port, {
				type: `error`,
				requestId: request.requestId,
				message: error instanceof Error ? error.message : String(error),
			})
		})
}

scope.onconnect = (event) => {
	const port = event.ports[0]
	if (port === undefined) return
	ports.add(port)
	port.addEventListener(
		`message`,
		(message: MessageEvent<SourceSessionRequest>) => {
			handleRequest(port, message.data)
		},
	)
	port.addEventListener(`messageerror`, () => ports.delete(port))
	port.start()
	const current = currentSourceEvent()
	if (current === null) {
		void refresh().catch((error: unknown) => {
			post(port, {
				type: `error`,
				message: error instanceof Error ? error.message : String(error),
			})
		})
	} else {
		post(port, current)
	}
}

function connectSourceEvents(): void {
	const events = client.api.source.events.subscribe()
	events.subscribe((event) => {
		void refresh(event.data.manifest).catch((error: unknown) => {
			broadcast({
				type: `error`,
				message: error instanceof Error ? error.message : String(error),
			})
		})
	})
	events.on(`close`, () => {
		setTimeout(connectSourceEvents, 250)
	})
}

connectSourceEvents()
