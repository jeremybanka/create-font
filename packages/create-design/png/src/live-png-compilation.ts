import type { DesignDocument } from "@create-design/source"

import { exportPng } from "./png.ts"
import type {
	PngDiagnostic,
	PngExportRequest,
	PngExportResult,
} from "./types.ts"

export type LivePngArtifact = Readonly<{
	generation: number
	result: PngExportResult
	revision: number
	timings: Readonly<{ queueing: number; rasterization: number; total: number }>
}>

export type LivePngCompilationState =
	| Readonly<{ status: "idle"; lastGood: null }>
	| Readonly<{
			status: "compiling"
			generation: number
			lastGood: LivePngArtifact | null
			revision: number
	  }>
	| Readonly<{
			status: "ready"
			artifact: LivePngArtifact
			generation: number
			lastGood: LivePngArtifact
			revision: number
	  }>
	| Readonly<{
			status: "failed"
			diagnostics: readonly PngDiagnostic[]
			generation: number
			lastGood: LivePngArtifact | null
			revision: number
	  }>

export const LIVE_PNG_EDIT_DEBOUNCE_MS = 240

export function createLivePngCompiler(
	options: Readonly<{
		now?: () => number
		schedule?: (work: () => void) => () => void
		compile?: typeof exportPng
	}> = {},
) {
	const now = options.now ?? (() => performance.now())
	const compile = options.compile ?? exportPng
	const schedule =
		options.schedule ??
		((work: () => void) => {
			const timeout = setTimeout(work, LIVE_PNG_EDIT_DEBOUNCE_MS)
			return () => clearTimeout(timeout)
		})
	let state: LivePngCompilationState = Object.freeze({
		status: "idle",
		lastGood: null,
	})
	let generation = 0
	let revision = 0
	let running = false
	let cancelScheduled: (() => void) | null = null
	let controller: AbortController | null = null
	const subscribers = new Set<(state: LivePngCompilationState) => void>()
	const publish = (next: LivePngCompilationState): void => {
		state = next
		for (const subscriber of subscribers) subscriber(next)
	}
	const lastGood = (): LivePngArtifact | null =>
		state.status === "idle" ? null : state.lastGood
	return {
		getState: (): LivePngCompilationState => state,
		request(document: DesignDocument, request: PngExportRequest): void {
			if (!running) return
			const currentGeneration = ++generation
			const currentRevision = ++revision
			const requestedAt = now()
			cancelScheduled?.()
			controller?.abort()
			publish(
				Object.freeze({
					status: "compiling",
					generation: currentGeneration,
					lastGood: lastGood(),
					revision: currentRevision,
				}),
			)
			cancelScheduled = schedule(() => {
				cancelScheduled = null
				controller = new AbortController()
				const startedAt = now()
				void compile(document, request, { signal: controller.signal }).then(
					(result) => {
						if (!running || currentGeneration !== generation) return
						const finishedAt = now()
						const artifact = Object.freeze({
							generation: currentGeneration,
							result,
							revision: currentRevision,
							timings: Object.freeze({
								queueing: startedAt - requestedAt,
								rasterization: finishedAt - startedAt,
								total: finishedAt - requestedAt,
							}),
						})
						publish(
							Object.freeze({
								status: "ready",
								artifact,
								generation: currentGeneration,
								lastGood: artifact,
								revision: currentRevision,
							}),
						)
					},
					(error) => {
						if (
							!running ||
							currentGeneration !== generation ||
							(error instanceof DOMException && error.name === "AbortError")
						)
							return
						publish(
							Object.freeze({
								status: "failed",
								diagnostics: Object.freeze([
									{
										code: "live-png.rasterization-failed",
										message:
											error instanceof Error ? error.message : String(error),
										severity: "error" as const,
									},
								]),
								generation: currentGeneration,
								lastGood: lastGood(),
								revision: currentRevision,
							}),
						)
					},
				)
			})
		},
		start(): void {
			running = true
		},
		stop(): void {
			if (!running) return
			running = false
			generation += 1
			cancelScheduled?.()
			cancelScheduled = null
			controller?.abort()
			controller = null
		},
		subscribe(
			subscriber: (state: LivePngCompilationState) => void,
		): () => void {
			subscribers.add(subscriber)
			subscriber(state)
			return () => subscribers.delete(subscriber)
		},
	}
}
