import { createFontRpcClient } from "@create-font/server/client"
import type {
	JsonValue,
	SourceManifest,
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
import {
	createFontEditorState,
	type EditorFontSource,
} from "@create-font/states"

import type {
	FontValidationStatus,
	SourceSessionEvent,
	SourceSessionRequest,
	SourceSessionStartupProfile,
} from "./source-session.ts"
import { createSourceSnapshotRefreshController } from "./source-session-refresh.ts"
import { sourceProjectSnapshotFromResponse } from "./source-session-snapshot.ts"
import {
	createStartupTimeline,
	startupResourceTimings,
} from "./startup-profile.ts"

type SharedWorkerScope = Readonly<{
	location: Location
}> & {
	onconnect: ((event: MessageEvent) => void) | null
}

const scope = globalThis as unknown as SharedWorkerScope
const startupTimeline = createStartupTimeline(`shared-worker`)
startupTimeline.mark(`module-evaluated`)
const client = createFontRpcClient(scope.location.origin)
const ports = new Set<MessagePort>()
let sourceUnits = new Map<string, SourceUnitSnapshot>()
let source: EditorFontSource | null = null
let revision: string | null = null
let validation: FontValidationStatus | null = null
let writeQueue = Promise.resolve()
let startupProfile: SourceSessionStartupProfile | null = null

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
	if (
		source === null ||
		revision === null ||
		validation === null ||
		startupProfile === null
	)
		return null
	return {
		type: `source`,
		sentAtEpochMilliseconds: performance.timeOrigin + performance.now(),
		revision,
		source,
		startup: startupProfile,
		validation,
	}
}

const validationState = createFontEditorState({
	key: `create-font/source-validation`,
	isProduction: true,
})
function compileValidation(
	sourceValue: EditorFontSource,
): FontValidationStatus {
	validationState.actions.load(sourceValue)
	const compilation = validationState.read.compilation()
	const issueCount = compilation.ok
		? compilation.projectionWarnings.length +
			compilation.ingestionWarnings.length
		: compilation.stage === `projection-failed`
			? compilation.projectionErrors.length +
				compilation.projectionWarnings.length
			: compilation.projectionWarnings.length +
				compilation.ingestionErrors.length +
				compilation.ingestionWarnings.length
	return { ok: compilation.ok, issueCount }
}

const refreshController = createSourceSnapshotRefreshController({
	applySnapshot(project, initialLoad) {
		const snapshots = project.units
		const files = Object.fromEntries(
			snapshots.map((snapshot) => [snapshot.path, snapshot.value]),
		)
		const finishAssembly = initialLoad
			? startupTimeline.startPhase(`source-assembly`)
			: undefined
		const assembled = assembleEditorFontSource(files)
		finishAssembly?.()
		if (!assembled.ok) throw new Error(assembled.errors[0].message)
		sourceUnits = new Map(
			snapshots.map((snapshot) => [snapshot.path, snapshot]),
		)
		source = assembled.value
		revision = project.revision
		const finishValidation = initialLoad
			? startupTimeline.startPhase(`source-validation-compilation`)
			: undefined
		validation = compileValidation(source)
		finishValidation?.()
		if (initialLoad) {
			startupTimeline.mark(`source-ready`)
			const resources = startupResourceTimings(
				performance
					.getEntriesByType(`resource`)
					.filter((entry) => entry.name.includes(`/api/source`)),
			)
			startupProfile = Object.freeze({
				resources,
				sourceRequestCount: resources.filter((entry) =>
					entry.name.includes(`/api/source/snapshot`),
				).length,
				sourceUnitCount: snapshots.length,
				timeline: startupTimeline.snapshot(),
				unitRequests: Object.freeze([]),
			})
		}
		const event = currentSourceEvent()
		if (event !== null) broadcast(event)
	},
	currentRevision: () => revision,
	async readSnapshot(initialLoad) {
		if (initialLoad) startupTimeline.mark(`refresh-start`)
		const finishSnapshot = initialLoad
			? startupTimeline.startPhase(`source-snapshot-rpc`)
			: undefined
		const project = sourceProjectSnapshotFromResponse(
			await client.api.source.snapshot.get(),
		)
		finishSnapshot?.()
		return project
	},
})

function refresh(manifest?: SourceManifest): Promise<void> {
	return refreshController.refresh(manifest?.revision)
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
		validation = compileValidation(request.source)
		post(port, {
			type: `saved`,
			requestId: request.requestId,
			revision: revision as string,
			validation,
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
	validation = compileValidation(source)
	post(port, {
		type: `saved`,
		requestId: request.requestId,
		revision,
		validation,
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
	startupTimeline.mark(`port-connected`)
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
