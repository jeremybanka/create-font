import { EditorApplicationRoot } from "@create-font/editor"
import type { EditorFontSource } from "@create-font/states"
import { render } from "preact"

import type {
	SourceSessionEvent,
	SourceSessionRequest,
} from "./source-session.ts"

const mount = document.querySelector<HTMLElement>("#app")
if (mount === null) throw new Error("Missing #app mount element.")
const applicationMount = mount
if (!(`SharedWorker` in globalThis)) {
	throw new Error(`create-font requires SharedWorker support.`)
}

const worker = new SharedWorker("/source-session.worker.js", {
	name: `create-font-source-session`,
	type: `module`,
})
const port = worker.port
let revision: string | null = null
let saveQueue = Promise.resolve()
let rendered = false
const pending = new Map<
	string,
	Readonly<{
		reject: (reason: Error) => void
		resolve: () => void
	}>
>()

function showSource(source: EditorFontSource): void {
	const familyName =
		source.names.typographicFamily || source.names.family || `Untitled font`
	document.title = `create-font — ${familyName}`
	if (!rendered) {
		applicationMount.replaceChildren()
		rendered = true
	}
	render(
		<EditorApplicationRoot source={source} onSourceChange={saveSource} />,
		applicationMount,
	)
}

function saveSource(source: EditorFontSource): Promise<void> {
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
					port.postMessage(request)
				}),
		)
	return saveQueue.catch((error: unknown) => {
		console.error(`Unable to save font source.`, error)
		throw error
	})
}

port.addEventListener(
	`message`,
	(message: MessageEvent<SourceSessionEvent>) => {
		const event = message.data
		switch (event.type) {
			case `source`:
				revision = event.revision
				showSource(event.source)
				break
			case `saved`: {
				revision = event.revision
				const request = pending.get(event.requestId)
				pending.delete(event.requestId)
				request?.resolve()
				break
			}
			case `error`: {
				const error = new Error(event.message)
				if (event.requestId === undefined) {
					console.error(error)
					if (!rendered) applicationMount.textContent = event.message
					break
				}
				const request = pending.get(event.requestId)
				pending.delete(event.requestId)
				request?.reject(error)
				break
			}
		}
	},
)
port.start()
applicationMount.textContent = `Loading font source…`
