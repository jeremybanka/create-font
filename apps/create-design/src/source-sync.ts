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
	defaultArtboardUnitPath,
	defaultGroupUnitPath,
	defaultLayerUnitPath,
	defaultObjectUnitPath,
	sourceUnitKindForPath,
	splitDesignDocument,
	type DesignDocument,
	type DesignFontReference,
	type DesignImageResource,
	type DesignLinkedArtboardResource,
	type AssetIndexFile,
	type FontIndexFile,
} from "@create-design/source"
import type {
	DesignExternalSourceUpdate,
	DesignSourceFontResource,
	DesignSourceSession,
	DesignSourceStatus,
} from "@create-design/editor/source-session"

export type {
	DesignExternalSourceUpdate,
	DesignSourceSession,
	DesignSourceStatus,
} from "@create-design/editor/source-session"

function assemble(state: SourceSyncState): DesignExternalSourceUpdate {
	const result = assembleDesignDocument(
		Object.fromEntries(
			[...state.units].map(([path, unit]) => [path, unit.value]),
		),
	)
	if (!result.ok) {
		return {
			ok: false,
			diagnostics: result.errors,
			revision: state.revision,
		}
	}
	return {
		ok: true,
		document: result.value,
		fonts: [],
		images: [],
		imageDiagnostics: [],
		revision: state.revision,
	}
}

function collectionPaths(
	state: SourceSyncState,
	indexPath: string,
): ReadonlyMap<string, string> {
	const value = state.units.get(indexPath)?.value
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
	const objectPaths = collectionPaths(state, `scene/objects/index.json`)
	const artboardPaths = collectionPaths(state, `artboards/index.json`)
	const layerPaths = collectionPaths(state, `scene/layers/index.json`)
	const groupPaths = collectionPaths(state, `scene/groups/index.json`)
	const assetIndex = state.units.get("assets/index.json")?.value as
		| AssetIndexFile
		| undefined
	const split = splitDesignDocument(document, {
		...(assetIndex === undefined ? {} : { assetIndex }),
		artboardPath: ({ id }) =>
			artboardPaths.get(id) ?? defaultArtboardUnitPath(id),
		layerPath: ({ id }) => layerPaths.get(id) ?? defaultLayerUnitPath(id),
		groupPath: ({ id }) => groupPaths.get(id) ?? defaultGroupUnitPath(id),
		objectPath: ({ id }) => objectPaths.get(id) ?? defaultObjectUnitPath(id),
	})
	if (!split.ok) {
		throw new Error(split.errors.map(({ message }) => message).join(`\n`))
	}
	const next = {
		...(split.value as Readonly<Record<string, JsonValue>>),
		...(state.units.get("assets/index.json")?.value === undefined
			? {}
			: { "assets/index.json": state.units.get("assets/index.json")!.value }),
		...(state.units.get("fonts/index.json")?.value === undefined
			? {}
			: { "fonts/index.json": state.units.get("fonts/index.json")!.value }),
	}
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

type DesignSourceAssetClient = Pick<
	ReturnType<typeof createSourceRpcClient>,
	"discardAssetStage" | "stageAsset" | "writeAssets"
>

type DesignSourceFontClient = Pick<
	ReturnType<typeof createSourceRpcClient>,
	"readAsset"
>

export async function loadDesignSourceFonts(
	client: DesignSourceFontClient,
	state: SourceSyncState,
): Promise<readonly DesignSourceFontResource[]> {
	const fontIndexValue = state.units.get("fonts/index.json")?.value
	const fontIndex =
		fontIndexValue !== undefined &&
		typeof fontIndexValue === "object" &&
		fontIndexValue !== null &&
		"entries" in fontIndexValue &&
		Array.isArray(fontIndexValue.entries)
			? (fontIndexValue as unknown as FontIndexFile)
			: null
	return Promise.all(
		(fontIndex?.entries ?? []).map(async (entry) => {
			const content = await client.readAsset(entry.path)
			return {
				reference: {
					id: entry.id,
					family:
						entry.family ??
						entry.id.slice("font:".length).replaceAll(/[-_]+/gu, " "),
					...(entry.faceIndex === undefined
						? {}
						: { faceIndex: entry.faceIndex }),
					revision: entry.revision ?? content.descriptor.digest,
				},
				bytes: new Uint8Array(await new Response(content.bytes).arrayBuffer()),
			}
		}),
	)
}

export async function loadDesignSourceImages(
	client: DesignSourceFontClient,
	state: SourceSyncState,
	document: DesignDocument,
): Promise<
	Readonly<{
		images: readonly DesignImageResource[]
		diagnostics: readonly string[]
	}>
> {
	const descriptors = new Map(
		[...(state.assets?.values() ?? [])].map((asset) => [asset.id, asset]),
	)
	const sources = new Map(
		document.objects.flatMap((object) =>
			object.geometry.kind === "image" &&
			object.geometry.source.kind === "embedded"
				? [[object.geometry.source.id, object.geometry] as const]
				: [],
		),
	)
	const images: DesignImageResource[] = []
	const diagnostics: string[] = []
	await Promise.all(
		[...sources].map(async ([id, geometry]) => {
			const descriptor = descriptors.get(id)
			if (descriptor === undefined) {
				diagnostics.push(`Embedded image asset ${id} is missing.`)
				return
			}
			try {
				const content = await client.readAsset(descriptor.path)
				images.push({
					id,
					mediaType: geometry.mediaType,
					bytes: new Uint8Array(
						await new Response(content.bytes).arrayBuffer(),
					),
				})
			} catch (error) {
				diagnostics.push(
					`Could not read embedded image ${id}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}),
	)
	return {
		images: images.toSorted((left, right) => left.id.localeCompare(right.id)),
		diagnostics: diagnostics.toSorted(),
	}
}

async function hydrateDesignSourceUpdate(
	client: DesignSourceFontClient,
	state: SourceSyncState,
): Promise<DesignExternalSourceUpdate> {
	const update = assemble(state)
	if (!update.ok) return update
	const [fonts, imageLoad] = await Promise.all([
		loadDesignSourceFonts(client, state),
		loadDesignSourceImages(client, state, update.document),
	])
	return {
		...update,
		fonts,
		images: imageLoad.images,
		imageDiagnostics: imageLoad.diagnostics,
	}
}

function fontMediaType(extension: string): string {
	switch (extension) {
		case "ttf":
		case "ttc":
			return "font/ttf"
		case "woff":
			return "font/woff"
		case "woff2":
			return "font/woff2"
		default:
			return "font/otf"
	}
}

export async function installDesignSourceFont(
	client: DesignSourceAssetClient,
	state: SourceSyncState,
	reference: DesignFontReference,
	bytes: Uint8Array,
	fileName: string,
): Promise<
	Readonly<{
		reference: DesignFontReference
		result: Awaited<ReturnType<DesignSourceAssetClient["writeAssets"]>>
	}>
> {
	const hash = new Uint8Array(
		await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
	)
	const sha256 = [...hash]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
	const existingValue = state.units.get("fonts/index.json")?.value
	const parsed =
		existingValue === undefined
			? null
			: (existingValue as unknown as FontIndexFile)
	const previous = parsed?.entries.find(({ id }) => id === reference.id)
	const extension =
		/\.(otf|ttf|woff2?|ttc)$/iu.exec(fileName)?.[1]?.toLowerCase() ?? "otf"
	const slug = reference.id
		.slice("font:".length)
		.toLowerCase()
		.replaceAll(/[^a-z0-9._-]+/gu, "-")
	const path = previous?.path ?? `fonts/${slug || "font"}.${extension}`
	const mediaType = fontMediaType(extension)
	const revision = `sha256:${sha256}` as const
	const nextReference = { ...reference, revision }
	const operationId = crypto.randomUUID()
	const staged = await client.stageAsset(
		operationId,
		{
			byteLength: bytes.byteLength,
			digest: revision,
			id: reference.id,
			mediaType,
			path,
		},
		bytes.slice().buffer,
	)
	const entries = [
		...(parsed?.entries.filter(({ id }) => id !== reference.id) ?? []),
		{
			byteLength: bytes.byteLength,
			id: reference.id,
			mediaType,
			path,
			sha256,
			family: reference.family,
			...(reference.faceIndex === undefined
				? {}
				: { faceIndex: reference.faceIndex }),
			revision,
		},
	].toSorted((left, right) => left.id.localeCompare(right.id))
	const currentIndex = state.units.get("fonts/index.json")
	try {
		const result = await client.writeAssets({
			idempotencyKey: operationId,
			assetWrites: [
				{
					expectedDigest: state.assets?.get(path)?.digest ?? null,
					stagingToken: staged.stagingToken,
				},
			],
			writes: [
				{
					expectedRevision: currentIndex?.revision ?? null,
					path: "fonts/index.json",
					value: {
						format: "create-design.font-index",
						version: 1,
						entries,
					} as unknown as JsonValue,
				},
			],
		})
		return { reference: nextReference, result }
	} catch (error) {
		await client.discardAssetStage(staged.stagingToken).catch(() => undefined)
		throw error
	}
}

export async function installDesignSourceImage(
	client: DesignSourceAssetClient,
	state: SourceSyncState,
	id: string,
	bytes: Uint8Array,
	fileName: string,
	mediaType: "image/jpeg" | "image/png",
): Promise<
	Readonly<{
		resource: DesignImageResource
		result: Awaited<ReturnType<DesignSourceAssetClient["writeAssets"]>>
	}>
> {
	const hash = new Uint8Array(
		await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
	)
	const sha256 = [...hash]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
	const existingValue = state.units.get("assets/index.json")?.value
	const parsed =
		existingValue === undefined
			? null
			: (existingValue as unknown as AssetIndexFile)
	const previous = parsed?.entries.find((entry) => entry.id === id)
	const extension = mediaType === "image/png" ? "png" : "jpg"
	const slug = id
		.slice("asset:".length)
		.toLowerCase()
		.replaceAll(/[^a-z0-9._-]+/gu, "-")
	const fileSlug = fileName
		.replace(/\.[^.]+$/u, "")
		.toLowerCase()
		.replaceAll(/[^a-z0-9._-]+/gu, "-")
	const path =
		previous?.path ??
		`assets/${fileSlug || slug || "image"}-${slug}.${extension}`
	const digest = `sha256:${sha256}` as const
	const operationId = crypto.randomUUID()
	const staged = await client.stageAsset(
		operationId,
		{
			byteLength: bytes.byteLength,
			digest,
			id,
			mediaType,
			path,
		},
		bytes.slice().buffer,
	)
	const entries = [
		...(parsed?.entries.filter((entry) => entry.id !== id) ?? []),
		{
			byteLength: bytes.byteLength,
			id,
			mediaType,
			path,
			sha256,
		},
	].toSorted((left, right) => left.id.localeCompare(right.id))
	const currentIndex = state.units.get("assets/index.json")
	try {
		const result = await client.writeAssets({
			idempotencyKey: operationId,
			assetWrites: [
				{
					expectedDigest: state.assets?.get(path)?.digest ?? null,
					stagingToken: staged.stagingToken,
				},
			],
			writes: [
				{
					expectedRevision: currentIndex?.revision ?? null,
					path: "assets/index.json",
					value: {
						format: "create-design.asset-index",
						version: 1,
						entries,
					} as unknown as JsonValue,
				},
			],
		})
		return { resource: { id, mediaType, bytes }, result }
	} catch (error) {
		await client.discardAssetStage(staged.stagingToken).catch(() => undefined)
		throw error
	}
}

export type DesignWorkspaceInventory = Readonly<{
	id: string
	name: string
	activeProjectId: string
	projects: readonly Readonly<{ id: string; name: string; path: string }>[]
}>

export async function readDesignWorkspace(): Promise<DesignWorkspaceInventory> {
	const response = await fetch("/api/workspace")
	if (!response.ok) throw new Error("Could not read the design workspace.")
	return (await response.json()) as DesignWorkspaceInventory
}

export function resolveDesignWorkspaceProjectId(
	workspace: DesignWorkspaceInventory,
	requestedProjectId: string | null | undefined,
): string {
	return requestedProjectId !== null &&
		requestedProjectId !== undefined &&
		workspace.projects.some(({ id }) => id === requestedProjectId)
		? requestedProjectId
		: workspace.activeProjectId
}

function projectOrigin(projectId: string): string {
	return `/projects/${encodeURIComponent(projectId)}`
}

function websocketUrl(origin = ""): string {
	const url = new URL(`${origin}/api/source/events`, window.location.href)
	url.protocol = url.protocol === `https:` ? `wss:` : `ws:`
	return url.href
}

export async function loadDesignLinkedArtboards(
	workspace: DesignWorkspaceInventory,
	activeProjectId: string,
): Promise<readonly DesignLinkedArtboardResource[]> {
	const results = await Promise.allSettled(
		workspace.projects
			.filter(({ id }) => id !== activeProjectId)
			.map(async ({ id }) => {
				const client = createSourceRpcClient(projectOrigin(id))
				const snapshot = await client.readSnapshot()
				const state = sourceSyncStateFromSnapshot(snapshot)
				const update = await hydrateDesignSourceUpdate(client, state)
				if (!update.ok)
					throw new Error(`Linked design ${id} contains invalid source.`)
				return {
					projectId: id,
					revision: update.revision,
					document: update.document,
					...(update.images === undefined ? {} : { images: update.images }),
					fonts: update.fonts,
				}
			}),
	)
	return results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	)
}

export async function connectDesignSourceSession(
	options: Readonly<{
		projectId?: string
		workspace?: DesignWorkspaceInventory
	}> = {},
): Promise<DesignSourceSession> {
	const workspace = options.workspace ?? (await readDesignWorkspace())
	const projectId = options.projectId ?? workspace.activeProjectId
	if (!workspace.projects.some(({ id }) => id === projectId))
		throw new Error(`Design ${projectId} is not available in this workspace.`)
	const origin = projectOrigin(projectId)
	const client = createSourceRpcClient(origin)
	const [snapshot, linkedArtboards] = await Promise.all([
		client.readSnapshot(),
		loadDesignLinkedArtboards(workspace, projectId),
	])
	let state = sourceSyncStateFromSnapshot(snapshot)
	const initial = await hydrateDesignSourceUpdate(client, state)
	if (!initial.ok)
		throw new Error(
			initial.diagnostics
				.map(
					({ message, path, unitPath }) =>
						`${unitPath ?? `source`} ${path}: ${message}`,
				)
				.join(`\n`),
		)
	const documentListeners = new Set<
		(update: DesignExternalSourceUpdate) => void
	>()
	const statusListeners = new Set<(status: DesignSourceStatus) => void>()
	const linkedArtboardListeners = new Set<
		(resources: readonly DesignLinkedArtboardResource[]) => void
	>()
	const sourceChangeListeners = new Set<() => void>()
	const localOperations = new Set<string>()
	let externalConflict = false
	let pendingSaves = 0
	let tail: Promise<unknown> = Promise.resolve()
	let sourceGeneration = 0
	let linkedGeneration = 0
	let disposed = false
	const sockets = new Set<WebSocket>()
	const status = (value: DesignSourceStatus): void => {
		if (!disposed) for (const listener of statusListeners) listener(value)
	}
	const recover = async (
		notify: boolean,
	): Promise<DesignExternalSourceUpdate> => {
		status(`recovering`)
		state = sourceSyncStateFromSnapshot(await client.readSnapshot())
		sourceGeneration += 1
		const generation = sourceGeneration
		const update = await hydrateDesignSourceUpdate(client, state)
		if (generation !== sourceGeneration) return recover(notify)
		if (notify && !disposed) {
			for (const listener of documentListeners) listener(update)
		}
		status(`connected`)
		return update
	}
	const socket = new WebSocket(websocketUrl(origin))
	sockets.add(socket)
	socket.addEventListener(`message`, (message) => {
		if (disposed) return
		void (async () => {
			const event = JSON.parse(String(message.data)) as SourceChangedEvent
			for (const listener of sourceChangeListeners) listener()
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
			sourceGeneration += 1
			if (result.kind === `applied` && !isLocal && pendingSaves > 0) {
				externalConflict = true
				status(`conflict`)
				return
			}
			if (result.kind === `applied` && !isLocal && pendingSaves === 0) {
				const generation = sourceGeneration
				const update = await hydrateDesignSourceUpdate(client, state)
				if (generation === sourceGeneration)
					for (const listener of documentListeners) listener(update)
			}
		})().catch(() => status(`conflict`))
	})
	socket.addEventListener(`open`, () => status(`connected`))
	socket.addEventListener(`close`, () => status(`recovering`))
	for (const project of workspace.projects) {
		if (project.id === projectId) continue
		const linkedSocket = new WebSocket(websocketUrl(projectOrigin(project.id)))
		sockets.add(linkedSocket)
		linkedSocket.addEventListener("message", () => {
			if (disposed) return
			const generation = ++linkedGeneration
			void (async () => {
				const nextLinks = await loadDesignLinkedArtboards(workspace, projectId)
				if (disposed || generation !== linkedGeneration) return
				for (const listener of linkedArtboardListeners) listener(nextLinks)
			})().catch(() => status("conflict"))
		})
	}

	const fonts = initial.fonts
	const images = initial.images ?? []

	return {
		displayName:
			workspace.projects.find(({ id }) => id === projectId)?.name ?? projectId,
		projectId,
		workspaceProjects: workspace.projects,
		workspaceId: workspace.id,
		allowLegacyRecovery: workspace.projects.length === 1,
		linkedArtboards,
		initialDocument: initial.document,
		initialRevision: initial.revision,
		...(fonts.length === 0 ? {} : { fonts }),
		...(images.length === 0 ? {} : { images }),
		dispose() {
			if (disposed) return
			disposed = true
			linkedGeneration += 1
			for (const activeSocket of sockets) activeSocket.close()
			sockets.clear()
			documentListeners.clear()
			statusListeners.clear()
			linkedArtboardListeners.clear()
			sourceChangeListeners.clear()
		},
		...((initial.imageDiagnostics?.length ?? 0) === 0
			? {}
			: { imageDiagnostics: initial.imageDiagnostics }),
		async installImage(id, bytes, fileName, mediaType) {
			const installed = await installDesignSourceImage(
				client,
				state,
				id,
				bytes,
				fileName,
				mediaType,
			)
			const { result } = installed
			const applied = applySourceSyncDelta(state, {
				type: "source.changed",
				previousRevision: result.previousRevision,
				revision: result.revision,
				removedPaths: result.removedPaths,
				removedAssetPaths: result.removedAssetPaths,
				units: result.units,
				assets: result.assets,
			})
			if (applied.kind === "gap") await recover(false)
			else {
				state = applied.state
				sourceGeneration += 1
			}
			return installed.resource
		},
		async installFont(reference, bytes, fileName, _mediaType) {
			const installed = await installDesignSourceFont(
				client,
				state,
				reference,
				bytes,
				fileName,
			)
			const { result } = installed
			const applied = applySourceSyncDelta(state, {
				type: "source.changed",
				previousRevision: result.previousRevision,
				revision: result.revision,
				removedPaths: result.removedPaths,
				removedAssetPaths: result.removedAssetPaths,
				units: result.units,
				assets: result.assets,
			})
			if (applied.kind === "gap") await recover(false)
			else {
				state = applied.state
				sourceGeneration += 1
			}
			return installed.reference
		},
		versionControl: {
			commitUnits: (input) => client.commitUnits(input),
			readComparison: (input) => client.readComparison(input),
			subscribeSourceChange(listener) {
				sourceChangeListeners.add(listener)
				return () => sourceChangeListeners.delete(listener)
			},
		},
		async reload() {
			externalConflict = false
			return recover(false)
		},
		save(document) {
			pendingSaves += 1
			const operation = async (): Promise<Readonly<{ revision: string }>> => {
				try {
					if (externalConflict) {
						status(`conflict`)
						throw new Error(`The source changed while local edits were queued.`)
					}
					const transaction = designSourceTransaction(state, document)
					if (transaction.writes.length + transaction.removals.length === 0)
						return { revision: state.revision }
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
						else {
							state = applied.state
							sourceGeneration += 1
						}
						status(`saved`)
						return { revision: state.revision }
					} catch (error) {
						localOperations.delete(idempotencyKey)
						try {
							const latest = sourceSyncStateFromSnapshot(
								await client.readSnapshot(),
							)
							externalConflict = latest.revision !== state.revision
							if (externalConflict) {
								state = latest
								sourceGeneration += 1
							}
						} catch {
							// A transport failure is retryable against the same durable revision.
						}
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
		subscribeLinkedArtboards(listener) {
			linkedArtboardListeners.add(listener)
			return () => linkedArtboardListeners.delete(listener)
		},
		subscribeStatus(listener) {
			statusListeners.add(listener)
			return () => statusListeners.delete(listener)
		},
	}
}
