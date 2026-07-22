import type {
	EditorBrowserOptions,
	MountedEditor,
} from "@create-font/editor/browser"
import type { EditorFontSource } from "@create-font/states"
import { createFontRpcClient } from "@create-font/server/client"
import type { SourceComparison } from "@create-font/server"
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
import type {
	FontValidationStatus,
	SourceSessionEvent,
	SourceSessionRequest,
	SourceSessionStartupProfile,
} from "./source-session.ts"
import {
	SOURCE_SESSION_PROTOCOL_VERSION,
	SOURCE_SESSION_WORKER_NAME,
	sourceSessionProtocolError,
} from "./source-session-identity.ts"
import {
	createStartupTimeline,
	startupEpochMilliseconds,
	startupResourceTimings,
	startupTransitDuration,
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
	messageTransitDuration?: number
	navigation?: Readonly<{
		domContentLoaded: number
		loadEventEnd: number
		responseEnd: number
	}>
	paints: readonly Readonly<{ name: string; start: number }>[]
	resources: ReturnType<typeof startupResourceTimings>
	session: `cold-worker` | `warm-worker` | `unknown`
	status: StartupProfileStatus
	summary: Readonly<{
		bootstrapRendered?: number
		editorUsable?: number
		mainThreadTotalBlockingTime: number
		sourceMessageReceived?: number
		workerAssembly?: number
		workerManifestRpc?: number
		workerSnapshotRpc?: number
		workerSourceReady?: number
		workerUnitRpcFanout?: number
		workerValidationCompilation?: number
	}>
	timeline: ReturnType<ReturnType<typeof createStartupTimeline>["snapshot"]>
	worker?: SourceSessionStartupProfile
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
let sourceSessionStartup: SourceSessionStartupProfile | undefined
let messageTransitDuration: number | undefined

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
	const workerReady =
		sourceSessionStartup === undefined
			? undefined
			: startupEpochMilliseconds(sourceSessionStartup.timeline, `source-ready`)
	const phaseDuration = (name: string): number | undefined =>
		sourceSessionStartup?.timeline.phases.find((phase) => phase.name === name)
			?.duration
	return {
		longTasks: Object.freeze([...longTasks]),
		...(messageTransitDuration === undefined ? {} : { messageTransitDuration }),
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
		session:
			workerReady === undefined
				? `unknown`
				: workerReady < timeline.timeOrigin
					? `warm-worker`
					: `cold-worker`,
		status: startupProfileStatus,
		summary: {
			bootstrapRendered: timeline.milestones[`bootstrap-rendered`],
			editorUsable: timeline.milestones[`editor-usable`],
			mainThreadTotalBlockingTime: longTasks.reduce(
				(total, task) => total + Math.max(0, task.duration - 50),
				0,
			),
			sourceMessageReceived: timeline.milestones[`source-message-received`],
			workerAssembly: phaseDuration(`source-assembly`),
			workerManifestRpc: phaseDuration(`source-manifest-rpc`),
			workerSnapshotRpc: phaseDuration(`source-snapshot-rpc`),
			workerSourceReady:
				workerReady === undefined
					? undefined
					: workerReady - timeline.timeOrigin,
			workerUnitRpcFanout: phaseDuration(`source-unit-rpc-fanout`),
			workerValidationCompilation: phaseDuration(
				`source-validation-compilation`,
			),
		},
		timeline,
		...(sourceSessionStartup === undefined
			? {}
			: { worker: sourceSessionStartup }),
	}
}

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")
const applicationMount = mount
let port: MessagePort | null = null
let revision: string | null = null
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
const pending = new Map<
	string,
	Readonly<{
		reject: (reason: Error) => void
		resolve: () => void
	}>
>()

function retrySource(): void {
	bootstrapState = nextBootstrapState(bootstrapState, { type: `retry` })
	renderBootstrap()
	if (port === null) {
		connectSourceSession()
		return
	}
	const request: SourceSessionRequest = { type: `refresh` }
	port.postMessage(request)
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

function saveSource(source: EditorFontSource): Promise<void> {
	currentSource = source
	saveQueue = saveQueue
		.catch(() => undefined)
		.then(
			() =>
				new Promise<void>((resolve, reject) => {
					if (revision === null) {
						reject(new Error(`The source session has not loaded yet.`))
						return
					}
					const requestId = crypto.randomUUID()
					pending.set(requestId, { reject, resolve })
					const request: SourceSessionRequest = {
						type: `save`,
						baseRevision: revision,
						requestId,
						source,
					}
					port?.postMessage(request)
				}),
		)
	return saveQueue.catch((error: unknown) => {
		console.error(`Unable to save font source.`, error)
		throw error
	})
}

function handleSourceSessionEvent(
	message: MessageEvent<SourceSessionEvent>,
): void {
	const event = message.data
	const protocolError = sourceSessionProtocolError(event.protocolVersion)
	if (protocolError !== null) {
		showBootstrapError(protocolError)
		return
	}
	switch (event.type) {
		case `source`:
			startupTimeline.mark(`source-message-received`)
			sourceSessionStartup = event.startup
			messageTransitDuration = startupTransitDuration(
				event.sentAtEpochMilliseconds,
				performance.timeOrigin + performance.now(),
			)
			revision = event.revision
			void showSource(
				event.source,
				event.validation,
				event.featureSources,
			).catch((error: unknown) => {
				showBootstrapError(
					error instanceof Error
						? error.message
						: `The editor application did not load.`,
				)
			})
			void refreshWorkingComparison(
				versionControlSelection,
				loadComparison,
			).catch((error: unknown) => {
				console.error(`Unable to refresh version-control changes.`, error)
			})
			break
		case `saved`: {
			revision = event.revision
			if (currentSource !== null) {
				void showSource(currentSource, event.validation).catch(
					(error: unknown) => {
						console.error(`Unable to update editor validation.`, error)
					},
				)
			}
			const request = pending.get(event.requestId)
			pending.delete(event.requestId)
			request?.resolve()
			void refreshWorkingComparison(
				versionControlSelection,
				loadComparison,
			).catch((error: unknown) => {
				console.error(
					`Unable to refresh version-control changes after saving.`,
					error,
				)
			})
			break
		}
		case `error`: {
			const error = new Error(event.message)
			if (event.requestId === undefined) {
				console.error(error)
				if (!renderedSource) showBootstrapError(event.message)
				break
			}
			const request = pending.get(event.requestId)
			pending.delete(event.requestId)
			request?.reject(error)
			break
		}
	}
}

function connectSourceSession(): void {
	if (!(`SharedWorker` in globalThis)) {
		showBootstrapError(
			`This browser cannot open a shared font source session. Try a recent version of Chrome, Edge, or Firefox.`,
		)
		return
	}
	try {
		const finish = startupTimeline.startPhase(`shared-worker-construction`)
		const worker = __CREATE_FONT_DEVELOPMENT__
			? new SharedWorker(
					new URL("./source-session.worker.ts", import.meta.url),
					{
						name: SOURCE_SESSION_WORKER_NAME,
						type: "module",
					},
				)
			: new SharedWorker(
					`/source-session.worker.js?v=${SOURCE_SESSION_PROTOCOL_VERSION}`,
					{
						name: SOURCE_SESSION_WORKER_NAME,
						type: "module",
					},
				)
		finish()
		startupTimeline.mark(`shared-worker-constructed`)
		port = worker.port
		port.addEventListener(`message`, handleSourceSessionEvent)
		port.start()
	} catch (error: unknown) {
		showBootstrapError(
			error instanceof Error
				? error.message
				: `The source session did not start.`,
		)
	}
}

renderBootstrap()
connectSourceSession()
