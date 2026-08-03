import type {
	LivePdfArtifact,
	LivePdfDiagnostic,
	LivePdfTimings,
} from "@create-design/pdf"

export interface BrowserPdfPreviewEnvironment {
	readonly createObjectURL: (blob: Blob) => string
	readonly now?: () => number
	readonly revokeObjectURL: (url: string) => void
}

export type BrowserPdfPreviewResource = Readonly<{
	artifact: LivePdfArtifact
	url: string
}>

export type ActivePdfPreview = BrowserPdfPreviewResource &
	Readonly<{
		timings: LivePdfTimings & Readonly<{ activation: number }>
	}>

export type BrowserPdfPreviewState =
	| Readonly<{
			active: null
			diagnostic: null
			pending: null
			status: "idle"
	  }>
	| Readonly<{
			active: ActivePdfPreview | null
			diagnostic: null
			pending: BrowserPdfPreviewResource
			status: "loading"
	  }>
	| Readonly<{
			active: ActivePdfPreview
			diagnostic: null
			pending: null
			status: "ready"
	  }>
	| Readonly<{
			active: ActivePdfPreview | null
			diagnostic: LivePdfDiagnostic
			pending: null
			status: "failed"
	  }>

export function browserPdfPreviewEnvironment(): BrowserPdfPreviewEnvironment | null {
	if (
		typeof Blob !== "function" ||
		typeof URL.createObjectURL !== "function" ||
		typeof URL.revokeObjectURL !== "function"
	) {
		return null
	}
	return {
		createObjectURL: (blob) => URL.createObjectURL(blob),
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	}
}

export function createBrowserPdfPreviewManager(
	environment: BrowserPdfPreviewEnvironment,
) {
	const now = environment.now ?? (() => performance.now())
	let state: BrowserPdfPreviewState = Object.freeze({
		active: null,
		diagnostic: null,
		pending: null,
		status: "idle",
	})
	let disposed = false
	let generation = 0
	const subscribers = new Set<(state: BrowserPdfPreviewState) => void>()

	const publish = (next: BrowserPdfPreviewState): void => {
		state = next
		for (const subscriber of subscribers) subscriber(next)
	}
	const release = (resource: BrowserPdfPreviewResource | null): void => {
		if (resource !== null) environment.revokeObjectURL(resource.url)
	}

	return {
		activate(artifact: LivePdfArtifact): BrowserPdfPreviewResource | null {
			if (disposed) return null
			generation = artifact.generation
			if (state.status === "loading") release(state.pending)
			const resource = Object.freeze({
				artifact,
				url: environment.createObjectURL(
					new Blob([new Uint8Array(artifact.bytes).buffer], {
						type: "application/pdf",
					}),
				),
			}) satisfies BrowserPdfPreviewResource
			publish(
				Object.freeze({
					active: state.active,
					diagnostic: null,
					pending: resource,
					status: "loading",
				}),
			)
			return resource
		},
		didFail(resource: BrowserPdfPreviewResource, error: unknown): void {
			if (
				disposed ||
				state.status !== "loading" ||
				state.pending !== resource
			) {
				return
			}
			release(resource)
			publish(
				Object.freeze({
					active: state.active,
					diagnostic: Object.freeze({
						code: "live-pdf.activation-failed",
						message: error instanceof Error ? error.message : String(error),
						stage: "activation",
					}),
					pending: null,
					status: "failed",
				}),
			)
		},
		didLoad(resource: BrowserPdfPreviewResource): void {
			if (
				disposed ||
				resource.artifact.generation !== generation ||
				state.status !== "loading" ||
				state.pending !== resource
			) {
				return
			}
			const previous = state.active
			const activation = now() - resource.artifact.requestedAt
			const active = Object.freeze({
				...resource,
				timings: Object.freeze({
					...resource.artifact.timings,
					activation: activation - resource.artifact.timings.total,
					total: activation,
				}),
			}) satisfies ActivePdfPreview
			publish(
				Object.freeze({
					active,
					diagnostic: null,
					pending: null,
					status: "ready",
				}),
			)
			release(previous)
		},
		dispose(): void {
			if (disposed) return
			disposed = true
			generation++
			release(state.active)
			if (state.status === "loading") release(state.pending)
			subscribers.clear()
			state = Object.freeze({
				active: null,
				diagnostic: null,
				pending: null,
				status: "idle",
			})
		},
		getState: (): BrowserPdfPreviewState => state,
		subscribe(subscriber: (state: BrowserPdfPreviewState) => void): () => void {
			subscribers.add(subscriber)
			subscriber(state)
			return () => subscribers.delete(subscriber)
		},
	}
}
