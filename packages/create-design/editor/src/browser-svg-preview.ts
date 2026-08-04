import type {
	LiveSvgArtifact,
	LiveSvgTimings,
	SvgDiagnostic,
} from "@create-design/svg"

export interface BrowserSvgPreviewEnvironment {
	readonly createObjectURL: (blob: Blob) => string
	readonly now?: () => number
	readonly revokeObjectURL: (url: string) => void
}

export type BrowserSvgPreviewResource = Readonly<{
	artifact: LiveSvgArtifact
	url: string
}>

export type ActiveSvgPreview = BrowserSvgPreviewResource &
	Readonly<{
		timings: LiveSvgTimings & Readonly<{ activation: number }>
	}>

export type BrowserSvgPreviewState =
	| Readonly<{ active: null; diagnostic: null; pending: null; status: "idle" }>
	| Readonly<{
			active: ActiveSvgPreview | null
			diagnostic: null
			pending: BrowserSvgPreviewResource
			status: "loading"
	  }>
	| Readonly<{
			active: ActiveSvgPreview
			diagnostic: null
			pending: null
			status: "ready"
	  }>
	| Readonly<{
			active: ActiveSvgPreview | null
			diagnostic: SvgDiagnostic
			pending: null
			status: "failed"
	  }>

export function browserSvgPreviewEnvironment(): BrowserSvgPreviewEnvironment | null {
	if (
		typeof Blob !== "function" ||
		typeof URL.createObjectURL !== "function" ||
		typeof URL.revokeObjectURL !== "function"
	)
		return null
	return {
		createObjectURL: (blob) => URL.createObjectURL(blob),
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	}
}

export function createBrowserSvgPreviewManager(
	environment: BrowserSvgPreviewEnvironment,
) {
	const now = environment.now ?? (() => performance.now())
	let state: BrowserSvgPreviewState = Object.freeze({
		active: null,
		diagnostic: null,
		pending: null,
		status: "idle",
	})
	let disposed = false
	let generation = 0
	const subscribers = new Set<(state: BrowserSvgPreviewState) => void>()
	const publish = (next: BrowserSvgPreviewState): void => {
		state = next
		for (const subscriber of subscribers) subscriber(next)
	}
	const release = (resource: BrowserSvgPreviewResource | null): void => {
		if (resource !== null) environment.revokeObjectURL(resource.url)
	}
	return {
		activate(artifact: LiveSvgArtifact): BrowserSvgPreviewResource | null {
			if (disposed) return null
			generation = artifact.generation
			if (state.status === "loading") release(state.pending)
			const resource = Object.freeze({
				artifact,
				url: environment.createObjectURL(
					new Blob([new Uint8Array(artifact.bytes).buffer], {
						type: "image/svg+xml",
					}),
				),
			})
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
		didFail(resource: BrowserSvgPreviewResource, error: unknown): void {
			if (disposed || state.status !== "loading" || state.pending !== resource)
				return
			release(resource)
			publish(
				Object.freeze({
					active: state.active,
					diagnostic: Object.freeze({
						code: "live-svg.activation-failed",
						message: error instanceof Error ? error.message : String(error),
						severity: "error",
						stage: "activation",
					}),
					pending: null,
					status: "failed",
				}),
			)
		},
		didLoad(resource: BrowserSvgPreviewResource): void {
			if (
				disposed ||
				resource.artifact.generation !== generation ||
				state.status !== "loading" ||
				state.pending !== resource
			)
				return
			const previous = state.active
			const total = now() - resource.artifact.requestedAt
			const active = Object.freeze({
				...resource,
				timings: Object.freeze({
					...resource.artifact.timings,
					activation: total - resource.artifact.timings.total,
					total,
				}),
			})
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
		getState: (): BrowserSvgPreviewState => state,
		subscribe(subscriber: (state: BrowserSvgPreviewState) => void): () => void {
			subscribers.add(subscriber)
			subscriber(state)
			return () => subscribers.delete(subscriber)
		},
	}
}
