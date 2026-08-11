import type {
	EditorBrowserOptions,
	MountedEditor,
} from "@create-font/editor/browser"
import type { EditorFontSource } from "@create-font/states"
import { createFontRpcClient } from "@create-font/server/client"
import type {
	FontWorkspaceInventory,
	SourceChangedEvent,
	SourceComparison,
	WriteSourceUnitsResult,
} from "@create-font/server"
import {
	analyzeFeaProject,
	assembleEditorFontSource,
	initializeFeaParser,
} from "@create-font/source/browser"
import { createRoot, type Root } from "react-dom/client"

import { BootstrapScreen } from "./BootstrapScreen.tsx"
import {
	bootstrapDocumentTitle,
	INITIAL_BOOTSTRAP_STATE,
	nextBootstrapState,
	type BootstrapState,
} from "./bootstrap-state.ts"
import { createSourceSnapshotRefreshController } from "./source-refresh.ts"
import { sourceProjectSnapshotFromResponse } from "./source-snapshot-response.ts"
import {
	applySourceSyncDelta,
	assembleSourceSyncState,
	sourceSyncStateFromSnapshot,
	type SourceSyncState,
} from "./source-sync.ts"
import { createSourceSyncWorkerClient } from "./source-sync-worker-client.ts"
import type { FontValidationStatus } from "./source-validation.ts"
import {
	createStartupTimeline,
	startupResourceTimings,
	type StartupPhase,
} from "./startup-profile.ts"
import {
	refreshWorkingComparison,
	type VersionControlSelection,
} from "./version-control-refresh.ts"

type StartupProfileStatus = `loading` | `error` | `editor-usable`
type EditorBrowserModule = typeof import("@create-font/editor/browser")

declare const __CREATE_FONT_DEVELOPMENT__: boolean

type BrowserStartupProfile = Readonly<{
	longTasks: readonly StartupPhase[]
	navigation?: Readonly<{
		domContentLoaded: number
		loadEventEnd: number
		responseEnd: number
	}>
	paints: readonly Readonly<{ name: string; start: number }>[]
	resources: ReturnType<typeof startupResourceTimings>
	session: `direct-server`
	status: StartupProfileStatus
	summary: Readonly<{
		bootstrapRendered?: number
		editorUsable?: number
		mainThreadTotalBlockingTime: number
		sourceMessageReceived?: number
		sourceSnapshotRpc?: number
	}>
	timeline: ReturnType<ReturnType<typeof createStartupTimeline>["snapshot"]>
}>

declare global {
	interface Window {
		__CREATE_FONT_STARTUP_PROFILE__: () => BrowserStartupProfile
	}
}

const startupTimeline = createStartupTimeline(`browser-main`)
startupTimeline.mark(`module-evaluated`)
const feaParserReady = initializeFeaParser()
const editorBrowserUrl = `/editor/editor.js`
const editorStyles = document.createElement(`link`)
editorStyles.rel = `stylesheet`
editorStyles.href = `/editor/editor.css`
if (!__CREATE_FONT_DEVELOPMENT__) document.head.append(editorStyles)
const editorModulePromise = __CREATE_FONT_DEVELOPMENT__
	? import("@create-font/editor/browser")
	: (import(
			/* @vite-ignore */ editorBrowserUrl
		) as Promise<EditorBrowserModule>)
const longTasks: StartupPhase[] = []
let startupProfileStatus: StartupProfileStatus = `loading`

if (`PerformanceObserver` in globalThis) {
	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				longTasks.push({
					duration: entry.duration,
					name: entry.name,
					start: entry.startTime,
				})
			}
		})
		observer.observe({ entryTypes: [`longtask`] })
	} catch {
		// Long Task timing is optional and is not implemented by every browser.
	}
}

window.__CREATE_FONT_STARTUP_PROFILE__ = () => {
	const timeline = startupTimeline.snapshot()
	const navigation = performance.getEntriesByType(`navigation`)[0] as
		| PerformanceNavigationTiming
		| undefined
	const phaseDuration = (name: string): number | undefined =>
		timeline.phases.find((phase) => phase.name === name)?.duration
	const bootstrapRendered = timeline.milestones[`bootstrap-rendered`]
	const editorUsable = timeline.milestones[`editor-usable`]
	const sourceMessageReceived = timeline.milestones[`source-message-received`]
	const sourceSnapshotRpc = phaseDuration(`source-snapshot-rpc`)
	return {
		longTasks: Object.freeze([...longTasks]),
		...(navigation === undefined
			? {}
			: {
					navigation: {
						domContentLoaded: navigation.domContentLoadedEventEnd,
						loadEventEnd: navigation.loadEventEnd,
						responseEnd: navigation.responseEnd,
					},
				}),
		paints: Object.freeze(
			performance.getEntriesByType(`paint`).map((entry) => ({
				name: entry.name,
				start: entry.startTime,
			})),
		),
		resources: startupResourceTimings(performance.getEntriesByType(`resource`)),
		session: `direct-server`,
		status: startupProfileStatus,
		summary: {
			...(bootstrapRendered === undefined ? {} : { bootstrapRendered }),
			...(editorUsable === undefined ? {} : { editorUsable }),
			mainThreadTotalBlockingTime: longTasks.reduce(
				(total, task) => total + Math.max(0, task.duration - 50),
				0,
			),
			...(sourceMessageReceived === undefined ? {} : { sourceMessageReceived }),
			...(sourceSnapshotRpc === undefined ? {} : { sourceSnapshotRpc }),
		},
		timeline,
	}
}

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")
const applicationMount = mount
type BrowserFontWorkspace = FontWorkspaceInventory & Readonly<{ root: string }>

async function readFontWorkspace(): Promise<BrowserFontWorkspace | undefined> {
	const response = await fetch(`/api/workspace`).catch(() => undefined)
	if (response === undefined || !response.ok) return undefined
	const candidate = (await response.json()) as Partial<BrowserFontWorkspace>
	return typeof candidate.activeProjectId === `string` &&
		Array.isArray(candidate.projects) &&
		typeof candidate.id === `string`
		? (candidate as BrowserFontWorkspace)
		: undefined
}

const fontWorkspace = await readFontWorkspace()
const requestedProjectId = new URL(window.location.href).searchParams.get(
	`font`,
)
const requestedProjectUnavailable =
	fontWorkspace !== undefined &&
	requestedProjectId !== null &&
	!fontWorkspace.projects.some(({ id }) => id === requestedProjectId)
const activeProjectId =
	requestedProjectUnavailable || fontWorkspace === undefined
		? undefined
		: (requestedProjectId ?? fontWorkspace.activeProjectId)
if (
	fontWorkspace !== undefined &&
	requestedProjectId === null &&
	activeProjectId !== undefined
) {
	const url = new URL(window.location.href)
	url.searchParams.set(`font`, activeProjectId)
	window.history.replaceState({ font: activeProjectId }, ``, url)
}

let bootstrapRoot: Root | null = createRoot(applicationMount)
const sourceSyncWorker = createSourceSyncWorkerClient()
let sourceState: SourceSyncState | null = null
let saveQueue = Promise.resolve()
let renderedSource = false
let mountedEditor: MountedEditor | null = null
let currentSource: EditorFontSource | null = null
let currentValidation: FontValidationStatus | null = null
let currentFeatureSubstitutions: NonNullable<
	EditorBrowserOptions["featureSubstitutions"]
> = []
let versionControlState: Readonly<{
	comparison?: NonNullable<EditorBrowserOptions["versionControl"]>["comparison"]
	error?: string
	loading: boolean
}> = { loading: false }
const rpcClient = createFontRpcClient(
	activeProjectId === undefined
		? window.location.origin
		: new URL(
				`/projects/${encodeURIComponent(activeProjectId)}`,
				window.location.origin,
			).href,
)
let comparisonRequestSequence = 0
let versionControlSelection: VersionControlSelection = { baseRef: `HEAD` }
let bootstrapState: BootstrapState = INITIAL_BOOTSTRAP_STATE
let dirtySequence = 0
let sourceDirty = false
const bufferedSourceEvents: SourceChangedEvent[] = []
let sourceEventQueue = Promise.resolve()
let sourceEventReconnectDelay = 250
let sourceEventsHaveConnected = false
let sourceEventsDisposed = false
let activeSourceEvents: { close?: () => void } | null = null
let sourceEventReconnectTimer: ReturnType<typeof setTimeout> | undefined
let recoveryDraftLoaded = false
let projectSwitchPending = false

function recoveryStorageKey(): string | undefined {
	return fontWorkspace === undefined || activeProjectId === undefined
		? undefined
		: `create-font:recovery-draft:v1:${encodeURIComponent(fontWorkspace.id)}:${encodeURIComponent(activeProjectId)}`
}

function writeRecoveryDraft(source: EditorFontSource): void {
	const key = recoveryStorageKey()
	if (key === undefined) return
	try {
		localStorage.setItem(key, JSON.stringify(source))
	} catch {
		// Recovery is best-effort in restricted browsing contexts.
	}
}

function readRecoveryDraft(): EditorFontSource | undefined {
	const key = recoveryStorageKey()
	if (key === undefined) return undefined
	try {
		const value = localStorage.getItem(key)
		return value === null ? undefined : (JSON.parse(value) as EditorFontSource)
	} catch {
		return undefined
	}
}

function clearRecoveryDraft(): void {
	const key = recoveryStorageKey()
	if (key === undefined) return
	try {
		localStorage.removeItem(key)
	} catch {
		// Recovery is best-effort in restricted browsing contexts.
	}
}

function retrySource(): void {
	if (requestedProjectUnavailable && fontWorkspace !== undefined) {
		const url = new URL(window.location.href)
		url.searchParams.set(`font`, fontWorkspace.activeProjectId)
		window.location.assign(url)
		return
	}
	bootstrapState = nextBootstrapState(bootstrapState, { type: `retry` })
	renderBootstrap()
	void refreshSource(true)
		.then(queueSourceEventDrain)
		.catch((error: unknown) => {
			showBootstrapError(
				error instanceof Error
					? error.message
					: `The font source did not load.`,
			)
		})
}

function renderBootstrap(): void {
	const finish = startupTimeline.startPhase(`bootstrap-render`)
	document.title = bootstrapDocumentTitle(bootstrapState)
	bootstrapRoot?.render(
		<BootstrapScreen state={bootstrapState} onAction={retrySource} />,
	)
	finish()
	startupTimeline.mark(`bootstrap-rendered`)
}

function showBootstrapError(message: string): void {
	startupProfileStatus = `error`
	bootstrapState = nextBootstrapState(bootstrapState, { type: `fail`, message })
	renderBootstrap()
}

function sourceFromSnapshot(
	snapshot: SourceComparison["base"]["snapshot"],
): EditorFontSource {
	const assembled = assembleEditorFontSource(
		Object.fromEntries(snapshot.units.map((unit) => [unit.path, unit.value])),
	)
	if (!assembled.ok) throw new Error(assembled.errors[0].message)
	return assembled.value
}

function responseErrorMessage(error: unknown, fallback: string): string {
	if (typeof error !== `object` || error === null) return fallback
	const value = (error as { value?: unknown }).value
	if (typeof value !== `object` || value === null) return fallback
	const message = (value as { message?: unknown }).message
	return typeof message === `string` && message.length > 0 ? message : fallback
}

function editorComparison(
	comparison: SourceComparison,
): NonNullable<EditorBrowserOptions["versionControl"]>["comparison"] {
	return {
		base: {
			identity: comparison.base.identity,
			kind: comparison.base.kind,
			label: comparison.base.label,
			...(comparison.base.ref === undefined
				? {}
				: { ref: comparison.base.ref }),
			source: sourceFromSnapshot(comparison.base.snapshot),
		},
		changes: comparison.changes,
		identity: comparison.identity,
		target: {
			identity: comparison.target.identity,
			kind: comparison.target.kind,
			label: comparison.target.label,
			...(comparison.target.ref === undefined
				? {}
				: { ref: comparison.target.ref }),
			source: sourceFromSnapshot(comparison.target.snapshot),
		},
	}
}

function versionControlOptions(): NonNullable<
	EditorBrowserOptions["versionControl"]
> {
	const { comparison, error, loading } = versionControlState
	return {
		...(comparison === undefined ? {} : { comparison }),
		...(error === undefined ? {} : { error }),
		loading,
		onCompare: loadComparison,
		onCommit: commitSourceUnits,
	}
}

async function updateMountedEditor(): Promise<void> {
	if (
		sourceEventsDisposed ||
		currentSource === null ||
		currentValidation === null
	)
		return
	await showSource(currentSource, currentValidation)
}

async function loadComparison(
	baseRef: string,
	targetRef?: string,
): Promise<void> {
	versionControlSelection = {
		baseRef,
		...(targetRef === undefined ? {} : { targetRef }),
	}
	const requestSequence = ++comparisonRequestSequence
	versionControlState = {
		...versionControlState,
		loading: true,
		...(versionControlState.comparison === undefined
			? {}
			: { comparison: versionControlState.comparison }),
	}
	await updateMountedEditor()
	const response = await rpcClient.api.source.comparison.get({
		query: { baseRef, ...(targetRef === undefined ? {} : { targetRef }) },
	})
	if (sourceEventsDisposed || requestSequence !== comparisonRequestSequence)
		return
	if (response.error !== null || response.data === null) {
		const message = responseErrorMessage(
			response.error,
			`Unable to load the version-control comparison (HTTP ${response.error?.status ?? 500}).`,
		)
		versionControlState = {
			...versionControlState,
			error: message,
			loading: false,
		}
		await updateMountedEditor()
		throw new Error(message)
	}
	const data = response.data as SourceComparison
	versionControlState = {
		comparison: editorComparison(data),
		loading: false,
	}
	await updateMountedEditor()
}

async function commitSourceUnits(
	request: Parameters<
		NonNullable<EditorBrowserOptions["versionControl"]>["onCommit"]
	>[0],
): Promise<void> {
	comparisonRequestSequence += 1
	if (request.paths.length === 0)
		throw new Error(`Select at least one source unit.`)
	const response = await rpcClient.api.source.commit.post({
		expectedComparisonIdentity: request.expectedComparisonIdentity,
		message: request.message,
		paths: request.paths as [string, ...string[]],
	})
	if (sourceEventsDisposed) return
	if (response.error !== null || response.data === null) {
		throw new Error(
			responseErrorMessage(
				response.error,
				`The selected source units could not be committed (HTTP ${response.error?.status ?? 500}).`,
			),
		)
	}
	const result = response.data as { comparison: SourceComparison }
	versionControlState = {
		comparison: editorComparison(result.comparison),
		loading: false,
	}
	await updateMountedEditor()
}

async function showSource(
	source: EditorFontSource,
	validation: FontValidationStatus,
	features?: Readonly<{
		entries: readonly string[]
		sources: ReadonlyMap<string, string>
	}>,
): Promise<void> {
	if (sourceEventsDisposed) return
	const editorModule = await editorModulePromise
	if (sourceEventsDisposed) return
	const initialRender = !renderedSource
	renderedSource = true
	currentSource = source
	currentValidation = validation
	if (features !== undefined) {
		const analysis = analyzeFeaProject({
			entries: features.entries,
			glyphs: source.glyphs.map((glyph, id) => ({
				export: glyph.export,
				id,
				name: glyph.name,
			})),
			sources: features.sources,
		})
		if (!analysis.ok)
			throw new Error(
				analysis.diagnostics[0]?.message ?? `Feature analysis failed.`,
			)
		currentFeatureSubstitutions = analysis.ir.map((rule) => ({
			feature: rule.feature,
			from: rule.from.map((index) => source.glyphs[index]?.id ?? ""),
			to: source.glyphs[rule.to]?.id ?? "",
			...(rule.contextIndex === undefined
				? {}
				: { contextIndex: rule.contextIndex }),
		}))
	}
	const finish = initialRender
		? startupTimeline.startPhase(`editor-hydration-render`)
		: undefined
	const options: EditorBrowserOptions = {
		featureSubstitutions: currentFeatureSubstitutions,
		onSourceChange: saveSource,
		onSourceDirty: markSourceDirty,
		source,
		validation,
		versionControl: versionControlOptions(),
		...(fontWorkspace === undefined || activeProjectId === undefined
			? {}
			: {
					workspaceProject: {
						id: activeProjectId,
						onChange: switchWorkspaceProject,
						projects: fontWorkspace.projects,
					},
				}),
	}
	if (mountedEditor === null) {
		// The bootstrap and editor artifacts intentionally own separate React
		// renderers. Fully unmount bootstrap before handing the host over.
		bootstrapRoot?.unmount()
		bootstrapRoot = null
		mountedEditor = editorModule.mountEditor(applicationMount, options)
	} else {
		mountedEditor.update(options)
	}
	finish?.()
	if (initialRender) {
		startupTimeline.mark(`editor-rendered`)
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				startupTimeline.mark(`editor-usable`)
				startupProfileStatus = `editor-usable`
			})
		})
	}
}

async function showSourceState(state: SourceSyncState): Promise<void> {
	if (sourceEventsDisposed) return
	const assembled = assembleSourceSyncState(state)
	const recovery = recoveryDraftLoaded ? undefined : readRecoveryDraft()
	recoveryDraftLoaded = true
	const rendered = recovery ?? assembled.source
	if (recovery !== undefined) {
		sourceDirty = true
		currentSource = recovery
	}
	const processing = sourceSyncWorker.process(state, rendered)
	const [, validation] = await Promise.all([
		processing.writes,
		processing.validation,
	])
	if (sourceEventsDisposed) return
	await showSource(rendered, validation, {
		entries: assembled.featureEntries,
		sources: assembled.featureSources,
	})
}

const refreshController = createSourceSnapshotRefreshController({
	async applySnapshot(snapshot, initialLoad) {
		if (sourceEventsDisposed) return
		sourceState = sourceSyncStateFromSnapshot(snapshot)
		startupTimeline.mark(`source-message-received`)
		await showSourceState(sourceState)
		if (initialLoad) startupTimeline.mark(`source-ready`)
	},
	currentRevision: () => sourceState?.revision ?? null,
	async readSnapshot(initialLoad) {
		const finish = initialLoad
			? startupTimeline.startPhase(`source-snapshot-rpc`)
			: undefined
		const snapshot = sourceProjectSnapshotFromResponse(
			await rpcClient.api.source.snapshot.get(),
		)
		finish?.()
		return snapshot
	},
})

async function refreshSource(renderSnapshot: boolean): Promise<void> {
	if (renderSnapshot) {
		await refreshController.refresh()
		return
	}
	const snapshot = sourceProjectSnapshotFromResponse(
		await rpcClient.api.source.snapshot.get(),
	)
	sourceState = sourceSyncStateFromSnapshot(snapshot)
}

function markSourceDirty(source: EditorFontSource): void {
	if (sourceEventsDisposed) return
	dirtySequence += 1
	sourceDirty = true
	writeRecoveryDraft(source)
}

function writeResultFromResponse(
	response: Awaited<ReturnType<typeof rpcClient.api.source.units.put>>,
): WriteSourceUnitsResult {
	if (response.error !== null || response.data === null) {
		throw new Error(
			responseErrorMessage(
				response.error,
				`Write font source failed with HTTP ${response.error?.status ?? 500}.`,
			),
		)
	}
	if (`code` in response.data) {
		throw new Error(
			responseErrorMessage(response.data, `Write font source failed.`),
		)
	}
	return response.data as WriteSourceUnitsResult
}

function saveSource(source: EditorFontSource): Promise<void> {
	if (sourceEventsDisposed) return Promise.resolve()
	currentSource = source
	const saveSequence = dirtySequence
	saveQueue = saveQueue
		.catch(() => undefined)
		.then(async () => {
			if (sourceEventsDisposed) return
			const base = sourceState
			let renderCanonical = false
			if (base === null) {
				throw new Error(`The source session has not loaded yet.`)
			}
			const processing = sourceSyncWorker.process(base, source)
			const validationPromise = processing.validation.then(
				(validation) => ({ ok: true as const, validation }),
				(error: unknown) => ({ error, ok: false as const }),
			)
			const writes = await processing.writes
			if (sourceEventsDisposed) return
			if (writes.length !== 0) {
				const operationId = crypto.randomUUID()
				const result = writeResultFromResponse(
					await rpcClient.api.source.units.put({
						idempotencyKey: operationId,
						writes: writes as [
							(typeof writes)[number],
							...(typeof writes)[number][],
						],
					}),
				)
				if (sourceEventsDisposed) return
				if (
					sourceState !== null &&
					sourceState.revision === result.previousRevision
				) {
					const applied = applySourceSyncDelta(sourceState, {
						type: `source.changed`,
						operationId,
						previousRevision: result.previousRevision,
						removedPaths: [],
						revision: result.revision,
						units: result.units,
					})
					if (applied.status === `applied`) sourceState = applied.state
				} else {
					// A non-overlapping remote write committed before this one. Refresh
					// the canonical unit map without replacing the still-dirty editor.
					await refreshSource(false)
					renderCanonical = true
				}
			}
			const validationResult = await validationPromise
			if (sourceEventsDisposed) return
			if (!validationResult.ok) throw validationResult.error
			currentValidation = validationResult.validation
			if (dirtySequence !== saveSequence) return
			sourceDirty = false
			clearRecoveryDraft()
			const hadBufferedSourceEvents = bufferedSourceEvents.length > 0
			await drainSourceEvents()
			if (renderCanonical && sourceState !== null) {
				await showSourceState(sourceState)
			} else if (
				!hadBufferedSourceEvents &&
				currentSource !== null &&
				currentValidation !== null &&
				bufferedSourceEvents.length === 0
			) {
				await showSource(currentSource, currentValidation)
			}
			if (!projectSwitchPending)
				void refreshWorkingComparison(
					versionControlSelection,
					loadComparison,
				).catch((error: unknown) => {
					if (sourceEventsDisposed) return
					console.error(
						`Unable to refresh version-control changes after saving.`,
						error,
					)
				})
		})
	return saveQueue.catch((error: unknown) => {
		if (sourceEventsDisposed) return
		console.error(`Unable to save font source.`, error)
		throw error
	})
}

async function drainSourceEvents(): Promise<void> {
	if (sourceEventsDisposed) return
	await feaParserReady
	if (sourceEventsDisposed) return
	if (sourceDirty || sourceState === null || bufferedSourceEvents.length === 0)
		return
	let changed = false
	while (bufferedSourceEvents.length > 0) {
		const event = bufferedSourceEvents.shift()
		if (event === undefined) break
		const result = applySourceSyncDelta(sourceState, event)
		if (result.status === `gap`) {
			bufferedSourceEvents.length = 0
			await refreshSource(true)
			changed = false
			break
		}
		sourceState = result.state
		changed ||= result.status === `applied`
	}
	if (changed) {
		await showSourceState(sourceState)
		void refreshWorkingComparison(
			versionControlSelection,
			loadComparison,
		).catch((error: unknown) => {
			if (sourceEventsDisposed) return
			console.error(`Unable to refresh version-control changes.`, error)
		})
	}
}

function enqueueSourceEvent(event: SourceChangedEvent): void {
	if (sourceEventsDisposed) return
	bufferedSourceEvents.push(event)
	queueSourceEventDrain()
}

function queueSourceEventDrain(): void {
	sourceEventQueue = sourceEventQueue
		.then(drainSourceEvents)
		.catch((error: unknown) => {
			if (sourceEventsDisposed) return
			console.error(`Unable to apply a source update.`, error)
			if (!renderedSource) {
				showBootstrapError(
					error instanceof Error
						? error.message
						: `The font source did not load.`,
				)
			}
		})
}

function connectSourceEvents(): void {
	if (sourceEventsDisposed) return
	const events = rpcClient.api.source.events.subscribe()
	activeSourceEvents = events as { close?: () => void }
	events.subscribe((event) => enqueueSourceEvent(event.data))
	events.on(`open`, () => {
		if (sourceEventsDisposed) return
		sourceEventReconnectDelay = 250
		if (sourceEventsHaveConnected && !sourceDirty) {
			sourceEventQueue = sourceEventQueue
				.then(() => refreshSource(true))
				.then(drainSourceEvents)
				.catch((error: unknown) => {
					console.error(`Unable to recover the source event stream.`, error)
				})
		}
		sourceEventsHaveConnected = true
	})
	events.on(`close`, () => {
		if (sourceEventsDisposed) return
		const delay = sourceEventReconnectDelay
		sourceEventReconnectDelay = Math.min(sourceEventReconnectDelay * 2, 5_000)
		sourceEventReconnectTimer = setTimeout(connectSourceEvents, delay)
	})
}

async function switchWorkspaceProject(
	projectId: string,
	source: EditorFontSource,
): Promise<boolean> {
	if (
		fontWorkspace === undefined ||
		projectId === activeProjectId ||
		!fontWorkspace.projects.some(({ id }) => id === projectId)
	)
		return false
	if (
		sourceDirty &&
		!window.confirm(
			`This font still has unsaved work. Save it before switching fonts?`,
		)
	)
		return false
	if (sourceDirty) {
		projectSwitchPending = true
		try {
			await saveSource(source)
			await saveQueue
		} catch (error) {
			projectSwitchPending = false
			window.alert(
				error instanceof Error
					? `Could not switch fonts because saving failed: ${error.message}`
					: `Could not switch fonts because saving failed.`,
			)
			return false
		}
	}
	const url = new URL(window.location.href)
	url.searchParams.set(`font`, projectId)
	window.location.assign(url)
	return true
}

window.addEventListener(`beforeunload`, (event) => {
	if (!sourceDirty) return
	event.preventDefault()
	event.returnValue = ``
})

window.addEventListener(`pagehide`, (event) => {
	if (event.persisted) return
	sourceEventsDisposed = true
	if (sourceEventReconnectTimer !== undefined)
		clearTimeout(sourceEventReconnectTimer)
	activeSourceEvents?.close?.()
	sourceSyncWorker.dispose()
	mountedEditor?.unmount()
})

renderBootstrap()
if (requestedProjectUnavailable) {
	showBootstrapError(
		`Font ${JSON.stringify(requestedProjectId)} is not available. Try again to open ${fontWorkspace?.activeProjectId ?? `the active font`}.`,
	)
} else {
	connectSourceEvents()
	void feaParserReady
		.then(() => refreshSource(true))
		.then(queueSourceEventDrain)
		.catch((error: unknown) => {
			showBootstrapError(
				error instanceof Error
					? error.message
					: `The font source did not load.`,
			)
		})
}
