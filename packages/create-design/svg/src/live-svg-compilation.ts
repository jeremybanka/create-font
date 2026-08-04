import type { DesignDocument } from "@create-design/source"

import {
	createSvgProjectionGraph,
	preflightSvgExport,
	serializeSvg,
	svgPreflightAllowsOutput,
} from "./svg.ts"
import type {
	SvgDiagnostic,
	SvgDocumentProjection,
	SvgExportTarget,
	SvgPreflightResult,
	SvgProjectionGraph,
} from "./types.ts"

export type LiveSvgTimings = Readonly<{
	projection: number
	queueing: number
	serialization: number
	total: number
}>

export type LiveSvgArtifact = Readonly<{
	bytes: Uint8Array
	generation: number
	preflight: SvgPreflightResult
	requestedAt: number
	revision: number
	timings: LiveSvgTimings
}>

export type LiveSvgCompilationState =
	| Readonly<{ status: "idle"; lastGood: null }>
	| Readonly<{
			status: "compiling"
			generation: number
			lastGood: LiveSvgArtifact | null
			revision: number
	  }>
	| Readonly<{
			status: "ready"
			artifact: LiveSvgArtifact
			generation: number
			lastGood: LiveSvgArtifact
			revision: number
	  }>
	| Readonly<{
			status: "failed"
			diagnostics: readonly SvgDiagnostic[]
			generation: number
			lastGood: LiveSvgArtifact | null
			preflight?: SvgPreflightResult
			revision: number
	  }>

export interface LiveSvgCompilerOptions {
	readonly graph?: SvgProjectionGraph
	readonly now?: () => number
	readonly schedule?: (work: () => void) => () => void
	readonly serialize?: (
		projection: SvgDocumentProjection,
	) => Promise<string | Uint8Array> | string | Uint8Array
}

export const LIVE_SVG_EDIT_DEBOUNCE_MS = 180

const defaultSchedule = (work: () => void): (() => void) => {
	const timeout = setTimeout(work, LIVE_SVG_EDIT_DEBOUNCE_MS)
	return () => clearTimeout(timeout)
}

const failure = (
	error: unknown,
	stage: "projection" | "serialization",
): SvgDiagnostic =>
	Object.freeze({
		code: `live-svg.${stage}-failed`,
		message: error instanceof Error ? error.message : String(error),
		severity: "error",
		stage,
	})

export function createLiveSvgCompiler(options: LiveSvgCompilerOptions = {}) {
	const graph = options.graph ?? createSvgProjectionGraph()
	const now = options.now ?? (() => performance.now())
	const schedule = options.schedule ?? defaultSchedule
	const serialize = options.serialize ?? serializeSvg
	let state: LiveSvgCompilationState = Object.freeze({
		status: "idle",
		lastGood: null,
	})
	let generation = 0
	let revision = 0
	let running = false
	let cancelScheduled: (() => void) | null = null
	let lastProjection: SvgDocumentProjection | null = null
	const subscribers = new Set<(state: LiveSvgCompilationState) => void>()
	const publish = (next: LiveSvgCompilationState): void => {
		state = next
		for (const subscriber of subscribers) subscriber(next)
	}
	const lastGood = (): LiveSvgArtifact | null =>
		state.status === "idle" ? null : state.lastGood
	const publishFailure = (
		currentGeneration: number,
		currentRevision: number,
		diagnostic: SvgDiagnostic,
		preflight?: SvgPreflightResult,
	): void => {
		if (!running || currentGeneration !== generation) return
		publish(
			Object.freeze({
				status: "failed",
				diagnostics: Object.freeze([diagnostic]),
				generation: currentGeneration,
				lastGood: lastGood(),
				...(preflight === undefined ? {} : { preflight }),
				revision: currentRevision,
			}),
		)
	}
	const compile = (
		document: DesignDocument,
		target: SvgExportTarget | undefined,
		currentGeneration: number,
		currentRevision: number,
		requestedAt: number,
	): void => {
		cancelScheduled = null
		if (!running || currentGeneration !== generation) return
		const preflight = preflightSvgExport(document, target)
		if (!svgPreflightAllowsOutput(preflight)) {
			publish(
				Object.freeze({
					status: "failed",
					diagnostics: preflight.diagnostics,
					generation: currentGeneration,
					lastGood: lastGood(),
					preflight,
					revision: currentRevision,
				}),
			)
			return
		}
		const startedAt = now()
		let projection: SvgDocumentProjection
		try {
			projection = graph.project(document, target)
		} catch (error) {
			publishFailure(
				currentGeneration,
				currentRevision,
				failure(error, "projection"),
				preflight,
			)
			return
		}
		const projectedAt = now()
		const previous = lastGood()
		if (
			projection === lastProjection &&
			previous !== null &&
			JSON.stringify(preflight.diagnostics) ===
				JSON.stringify(previous.preflight.diagnostics)
		) {
			publish(
				Object.freeze({
					status: "ready",
					artifact: previous,
					generation: previous.generation,
					lastGood: previous,
					revision: previous.revision,
				}),
			)
			return
		}
		Promise.resolve()
			.then(() => serialize(projection))
			.then(
				(output) => {
					if (!running || currentGeneration !== generation) return
					const serializedAt = now()
					const bytes =
						typeof output === "string"
							? new TextEncoder().encode(output)
							: output
					const artifact = Object.freeze({
						bytes,
						generation: currentGeneration,
						preflight,
						requestedAt,
						revision: currentRevision,
						timings: Object.freeze({
							projection: projectedAt - startedAt,
							queueing: startedAt - requestedAt,
							serialization: serializedAt - projectedAt,
							total: serializedAt - requestedAt,
						}),
					}) satisfies LiveSvgArtifact
					lastProjection = projection
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
				(error) =>
					publishFailure(
						currentGeneration,
						currentRevision,
						failure(error, "serialization"),
						preflight,
					),
			)
	}
	return {
		getState: (): LiveSvgCompilationState => state,
		request(document: DesignDocument, target?: SvgExportTarget): void {
			if (!running) return
			const currentGeneration = ++generation
			const currentRevision = ++revision
			const requestedAt = now()
			cancelScheduled?.()
			publish(
				Object.freeze({
					status: "compiling",
					generation: currentGeneration,
					lastGood: lastGood(),
					revision: currentRevision,
				}),
			)
			cancelScheduled = schedule(() =>
				compile(
					document,
					target,
					currentGeneration,
					currentRevision,
					requestedAt,
				),
			)
		},
		start(): void {
			running = true
		},
		stop(): void {
			if (!running) return
			running = false
			generation++
			cancelScheduled?.()
			cancelScheduled = null
		},
		subscribe(
			subscriber: (state: LiveSvgCompilationState) => void,
		): () => void {
			subscribers.add(subscriber)
			subscriber(state)
			return () => subscribers.delete(subscriber)
		},
	}
}
