import { EditorApplicationRoot } from "@create-font/editor"
import type { EditorFontSource } from "@create-font/states"
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
	createStartupTimeline,
	startupEpochMilliseconds,
	startupResourceTimings,
	startupTransitDuration,
	type StartupPhase,
} from "./startup-profile.ts"

type StartupProfileStatus = `loading` | `error` | `editor-usable`

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
let currentSource: EditorFontSource | null = null
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

function showSource(
	source: EditorFontSource,
	validation: FontValidationStatus,
): void {
	const initialRender = !renderedSource
	renderedSource = true
	currentSource = source
	const finish = initialRender
		? startupTimeline.startPhase(`editor-hydration-render`)
		: undefined
	render(
		<EditorApplicationRoot
			source={source}
			validation={validation}
			onSourceChange={saveSource}
		/>,
		applicationMount,
	)
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
	switch (event.type) {
		case `source`:
			startupTimeline.mark(`source-message-received`)
			sourceSessionStartup = event.startup
			messageTransitDuration = startupTransitDuration(
				event.sentAtEpochMilliseconds,
				performance.timeOrigin + performance.now(),
			)
			revision = event.revision
			showSource(event.source, event.validation)
			break
		case `saved`: {
			revision = event.revision
			if (currentSource !== null) showSource(currentSource, event.validation)
			const request = pending.get(event.requestId)
			pending.delete(event.requestId)
			request?.resolve()
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
		const worker = new SharedWorker("/source-session.worker.js", {
			name: `create-font-source-session`,
			type: `module`,
		})
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
