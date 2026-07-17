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
} from "./source-session.ts"

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
	document.title = bootstrapDocumentTitle(bootstrapState)
	render(
		<BootstrapScreen state={bootstrapState} onAction={retrySource} />,
		applicationMount,
	)
}

function showBootstrapError(message: string): void {
	bootstrapState = nextBootstrapState(bootstrapState, { type: `fail`, message })
	renderBootstrap()
}

function showSource(
	source: EditorFontSource,
	validation: FontValidationStatus,
): void {
	renderedSource = true
	currentSource = source
	render(
		<EditorApplicationRoot
			source={source}
			validation={validation}
			onSourceChange={saveSource}
		/>,
		applicationMount,
	)
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
		const worker = new SharedWorker("/source-session.worker.js", {
			name: `create-font-source-session`,
			type: `module`,
		})
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
