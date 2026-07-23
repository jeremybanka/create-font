import type {
	EditorBrowserOptions,
	MountedEditor,
} from "@create-font/editor/browser"
import {
	createFontEditorState,
	type EditorFontSource,
} from "@create-font/states"
import { createFontRpcClient } from "@create-font/server/client"
import type {
	SourceChangedEvent,
	SourceComparison,
	WriteSourceUnitsResult,
} from "@create-font/server"
import {
	assembleEditorFontSource,
	lowerFeaSubstitutions,
	parseFea,
} from "@create-font/source/browser"
import { render } from "preact"

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
	sourceUnitWrites,
	type SourceSyncState,
} from "./source-sync.ts"
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
type FontValidationStatus = Readonly<{
	ok: boolean
	issueCount: number
}>

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
const editorBrowserUrl = `/editor/editor.js`
const editorStyles = document.createElement(`link`)
editorStyles.rel = `stylesheet`
editorStyles.href = `/editor/editor.css`
if (!__CREATE_FONT_DEVELOPMENT__) document.head.append(editorStyles)
const editorModulePromise = __CREATE_FONT_DEVELOPMENT__
	? import("@create-font/editor/browser")
	: (import(editorBrowserUrl) as Promise<EditorBrowserModule>)
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
			bootstrapRendered: timeline.milestones[`bootstrap-rendered`],
			editorUsable: timeline.milestones[`editor-usable`],
			mainThreadTotalBlockingTime: longTasks.reduce(
				(total, task) => total + Math.max(0, task.duration - 50),
				0,
			),
			sourceMessageReceived: timeline.milestones[`source-message-received`],
			sourceSnapshotRpc: phaseDuration(`source-snapshot-rpc`),
		},
		timeline,
	}
}

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")
const applicationMount = mount
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
}> = { loading: true }
const rpcClient = createFontRpcClient(window.location.origin)
let comparisonRequestSequence = 0
let versionControlSelection: VersionControlSelection = { baseRef: `HEAD` }
let bootstrapState: BootstrapState = INITIAL_BOOTSTRAP_STATE
let dirtySequence = 0
let sourceDirty = false
const bufferedSourceEvents: SourceChangedEvent[] = []
let sourceEventQueue = Promise.resolve()
let sourceEventReconnectDelay = 250
let sourceEventsHaveConnected = false

function retrySource(): void {
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
	render(
		<BootstrapScreen state={bootstrapState} onAction={retrySource} />,
		applicationMount,
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
	return {
		...versionControlState,
		onCompare: loadComparison,
		onCommit: commitSourceUnits,
	}
}

async function updateMountedEditor(): Promise<void> {
	if (currentSource === null || currentValidation === null) return
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
	if (requestSequence !== comparisonRequestSequence) return
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
	featureSources?: readonly string[],
): Promise<void> {
	const editorModule = await editorModulePromise
	const initialRender = !renderedSource
	renderedSource = true
	currentSource = source
	currentValidation = validation
	const glyphIndices = new Map(
		source.glyphs.map((glyph, index) => [glyph.name, index]),
	)
	if (featureSources !== undefined)
		currentFeatureSubstitutions = featureSources.flatMap((featureSource) => {
			const parsed = parseFea(featureSource)
			if (!parsed.ok) throw new Error(parsed.errors[0]?.message)
			const lowered = lowerFeaSubstitutions(parsed.value, glyphIndices)
			if (lowered.errors.length > 0) throw new Error(lowered.errors[0]?.message)
			return lowered.ir.map((rule) => ({
				feature: rule.feature,
				from: rule.from.map((index) => source.glyphs[index]?.id ?? ""),
				to: source.glyphs[rule.to]?.id ?? "",
				...(rule.contextIndex === undefined
					? {}
					: { contextIndex: rule.contextIndex }),
			}))
		})
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
	}
	if (mountedEditor === null) {
		// The bootstrap and editor artifacts intentionally own separate Preact
		// renderers. Fully unmount bootstrap before handing the host over.
		render(null, applicationMount)
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

const validationState = createFontEditorState({
	key: `create-font/source-validation`,
	isProduction: true,
})

function compileValidation(source: EditorFontSource): FontValidationStatus {
	validationState.actions.load(source)
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

async function showSourceState(state: SourceSyncState): Promise<void> {
	const assembled = assembleSourceSyncState(state)
	await showSource(
		assembled.source,
		compileValidation(assembled.source),
		assembled.featureSources,
	)
}

const refreshController = createSourceSnapshotRefreshController({
	async applySnapshot(snapshot, initialLoad) {
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

function markSourceDirty(): void {
	dirtySequence += 1
	sourceDirty = true
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
		throw new Error(response.data.message)
	}
	return response.data as WriteSourceUnitsResult
}

function saveSource(source: EditorFontSource): Promise<void> {
	currentSource = source
	const saveSequence = dirtySequence
	saveQueue = saveQueue
		.catch(() => undefined)
		.then(async () => {
			const base = sourceState
			let renderCanonical = false
			if (base === null) {
				throw new Error(`The source session has not loaded yet.`)
			}
			const writes = sourceUnitWrites(base, source)
			if (writes.length === 0) {
				currentValidation = compileValidation(source)
			} else {
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
				currentValidation = compileValidation(source)
			}
			if (dirtySequence !== saveSequence) return
			sourceDirty = false
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
			void refreshWorkingComparison(
				versionControlSelection,
				loadComparison,
			).catch((error: unknown) => {
				console.error(
					`Unable to refresh version-control changes after saving.`,
					error,
				)
			})
		})
	return saveQueue.catch((error: unknown) => {
		console.error(`Unable to save font source.`, error)
		throw error
	})
}

async function drainSourceEvents(): Promise<void> {
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
			console.error(`Unable to refresh version-control changes.`, error)
		})
	}
}

function enqueueSourceEvent(event: SourceChangedEvent): void {
	bufferedSourceEvents.push(event)
	queueSourceEventDrain()
}

function queueSourceEventDrain(): void {
	sourceEventQueue = sourceEventQueue
		.then(drainSourceEvents)
		.catch((error: unknown) => {
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
	const events = rpcClient.api.source.events.subscribe()
	events.subscribe((event) => enqueueSourceEvent(event.data))
	events.on(`open`, () => {
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
		const delay = sourceEventReconnectDelay
		sourceEventReconnectDelay = Math.min(sourceEventReconnectDelay * 2, 5_000)
		setTimeout(connectSourceEvents, delay)
	})
}

renderBootstrap()
connectSourceEvents()
void refreshSource(true)
	.then(queueSourceEventDrain)
	.catch((error: unknown) => {
		showBootstrapError(
			error instanceof Error ? error.message : `The font source did not load.`,
		)
	})
