import { PdfValidationError, serializePdf } from "mondrian.pdf"

import {
	exportPreflightAllowsOutput,
	type ExportPreflightPreferences,
	type ExportPreflightResult,
} from "./export-preflight.ts"
import {
	createPdfProjectionGraph,
	type PdfDocumentProjection,
	type PdfExportTarget,
	type PdfProjectionGraph,
} from "./pdf.ts"
import { preflightPdfExport } from "./pdf-preflight.ts"
import type { DesignDocument } from "@create-design/source"
import type { DesignTextService } from "@create-design/text"

export type LivePdfDiagnostic = Readonly<{
	code: string
	message: string
	stage:
		| "preflight"
		| "projection"
		| "validation"
		| "serialization"
		| "activation"
}>

export type LivePdfTimings = Readonly<{
	projection: number
	queueing: number
	total: number
	validationAndSerialization: number
}>

export type LivePdfArtifact = Readonly<{
	bytes: Uint8Array
	generation: number
	preflight: ExportPreflightResult
	requestedAt: number
	revision: number
	timings: LivePdfTimings
}>

export type LivePdfCompilationState =
	| Readonly<{ status: "idle"; lastGood: null }>
	| Readonly<{
			status: "compiling"
			generation: number
			lastGood: LivePdfArtifact | null
			revision: number
	  }>
	| Readonly<{
			status: "ready"
			artifact: LivePdfArtifact
			generation: number
			lastGood: LivePdfArtifact
			revision: number
	  }>
	| Readonly<{
			status: "failed"
			diagnostics: readonly LivePdfDiagnostic[]
			generation: number
			lastGood: LivePdfArtifact | null
			preflight?: ExportPreflightResult
			revision: number
	  }>

export interface LivePdfCompilerOptions {
	readonly graph?: PdfProjectionGraph
	readonly now?: () => number
	readonly schedule?: (work: () => void) => () => void
	readonly serialize?: (
		projection: PdfDocumentProjection,
	) => Promise<Uint8Array> | Uint8Array
	readonly textService?: DesignTextService
}

export const LIVE_PDF_EDIT_DEBOUNCE_MS = 180

const defaultSchedule = (work: () => void): (() => void) => {
	const timeout = setTimeout(work, LIVE_PDF_EDIT_DEBOUNCE_MS)
	return () => clearTimeout(timeout)
}

function errorDiagnostic(
	error: unknown,
	fallbackStage: "projection" | "serialization",
) {
	if (error instanceof PdfValidationError) {
		return Object.freeze({
			code: "live-pdf.validation-failed",
			message: error.message,
			stage: "validation" as const,
		})
	}
	return Object.freeze({
		code: `live-pdf.${fallbackStage}-failed`,
		message: error instanceof Error ? error.message : String(error),
		stage: fallbackStage,
	})
}

export function createLivePdfCompiler(options: LivePdfCompilerOptions = {}) {
	const graph = options.graph ?? createPdfProjectionGraph()
	const now = options.now ?? (() => performance.now())
	const schedule = options.schedule ?? defaultSchedule
	const serialize =
		options.serialize ??
		((projection: PdfDocumentProjection) => serializePdf(projection.document))
	let state: LivePdfCompilationState = Object.freeze({
		status: "idle",
		lastGood: null,
	})
	let generation = 0
	let revision = 0
	let running = false
	let cancelScheduled: (() => void) | null = null
	let lastProjection: PdfDocumentProjection | null = null
	const subscribers = new Set<(state: LivePdfCompilationState) => void>()

	const publish = (next: LivePdfCompilationState): void => {
		state = next
		for (const subscriber of subscribers) subscriber(next)
	}
	const lastGood = (): LivePdfArtifact | null =>
		state.status === "idle" ? null : state.lastGood
	const publishFailure = (
		currentGeneration: number,
		currentRevision: number,
		diagnostic: LivePdfDiagnostic,
	): void => {
		if (!running || currentGeneration !== generation) return
		publish(
			Object.freeze({
				status: "failed",
				diagnostics: Object.freeze([diagnostic]),
				generation: currentGeneration,
				lastGood: lastGood(),
				revision: currentRevision,
			}),
		)
	}
	const compile = (
		document: DesignDocument,
		target: PdfExportTarget | undefined,
		preferences: ExportPreflightPreferences,
		currentGeneration: number,
		currentRevision: number,
		requestedAt: number,
	): void => {
		cancelScheduled = null
		if (!running || currentGeneration !== generation) return
		const effectiveTarget = target ?? document.artboards[0]
		if (effectiveTarget === undefined) return
		const preflight = preflightPdfExport(
			document,
			effectiveTarget,
			preferences,
			options.textService,
		)
		if (!exportPreflightAllowsOutput(preflight)) {
			publish(
				Object.freeze({
					status: "failed",
					diagnostics: Object.freeze(
						preflight.diagnostics.map(({ code, message }) =>
							Object.freeze({ code, message, stage: "preflight" as const }),
						),
					),
					generation: currentGeneration,
					lastGood: lastGood(),
					preflight,
					revision: currentRevision,
				}),
			)
			return
		}
		const startedAt = now()
		let projection: PdfDocumentProjection
		try {
			projection = graph.project(document, target)
		} catch (error) {
			publishFailure(
				currentGeneration,
				currentRevision,
				errorDiagnostic(error, "projection"),
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
				(bytes) => {
					if (!running || currentGeneration !== generation) return
					const serializedAt = now()
					const artifact = Object.freeze({
						bytes,
						generation: currentGeneration,
						preflight,
						requestedAt,
						revision: currentRevision,
						timings: Object.freeze({
							projection: projectedAt - startedAt,
							queueing: startedAt - requestedAt,
							total: serializedAt - requestedAt,
							validationAndSerialization: serializedAt - projectedAt,
						}),
					}) satisfies LivePdfArtifact
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
				(error) => {
					publishFailure(
						currentGeneration,
						currentRevision,
						errorDiagnostic(error, "serialization"),
					)
				},
			)
	}

	return {
		getState: (): LivePdfCompilationState => state,
		request(
			document: DesignDocument,
			target?: PdfExportTarget,
			preferences: ExportPreflightPreferences = {},
		): void {
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
					preferences,
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
			subscriber: (state: LivePdfCompilationState) => void,
		): () => void {
			subscribers.add(subscriber)
			subscriber(state)
			return () => subscribers.delete(subscriber)
		},
	}
}
