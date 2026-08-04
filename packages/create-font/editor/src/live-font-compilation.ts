import type { FontCompilation } from "@create-font/states"
import { serializeVariableFont } from "@create-font/target"
import type { AtomToken, Silo } from "atom.io"

export type LiveFontDiagnostic = Readonly<{
	code: string
	message: string
	stage: "projection" | "ingestion" | "serialization" | "activation"
}>

export type LiveFontTimings = Readonly<{
	queueing: number
	projectionAndIngestion: number
	serialization: number
	total: number
}>

export type LiveFontArtifact = Readonly<{
	bytes: Uint8Array
	generation: number
	revision: number
	timings: LiveFontTimings
}>

export type LiveFontCompilationState =
	| Readonly<{ status: "idle"; lastGood: null }>
	| Readonly<{
			status: "compiling"
			generation: number
			revision: number
			lastGood: LiveFontArtifact | null
	  }>
	| Readonly<{
			status: "ready"
			generation: number
			revision: number
			artifact: LiveFontArtifact
			diagnostics: readonly LiveFontDiagnostic[]
			lastGood: LiveFontArtifact
	  }>
	| Readonly<{
			status: "failed"
			generation: number
			revision: number
			diagnostics: readonly LiveFontDiagnostic[]
			lastGood: LiveFontArtifact | null
	  }>

export type ActiveLiveFontState =
	| Readonly<{ status: "idle"; family: null; generation: null }>
	| Readonly<{
			status: "loading"
			family: string | null
			generation: number
	  }>
	| Readonly<{
			status: "ready"
			family: string
			generation: number
			activation: number
	  }>
	| Readonly<{
			status: "failed"
			family: string | null
			generation: number
			diagnostic: LiveFontDiagnostic
	  }>

export interface LiveFontStateOwner {
	readonly silo: Silo
	readonly documentRevision: AtomToken<number>
	readonly compilation: () => FontCompilation
}

export interface LiveFontCompilerOptions {
	readonly now?: () => number
	readonly schedule?:
		| ((work: () => void) => void)
		| ((work: () => void) => () => void)
	readonly serialize?: (
		compilation: Extract<FontCompilation, { ok: true }>,
	) => Promise<Uint8Array> | Uint8Array
}

/**
 * Keep live compilation out of the input event turn and collapse a burst of
 * key-driven edits before doing the synchronous projection work.
 */
export const LIVE_FONT_EDIT_DEBOUNCE_MS = 250

export function createLiveFontCompiler(
	owner: LiveFontStateOwner,
	options: LiveFontCompilerOptions = {},
) {
	const now = options.now ?? (() => performance.now())
	const schedule =
		options.schedule ??
		((work: () => void) => {
			const timeout = setTimeout(work, LIVE_FONT_EDIT_DEBOUNCE_MS)
			return () => clearTimeout(timeout)
		})
	const serialize =
		options.serialize ??
		((compilation: Extract<FontCompilation, { ok: true }>) =>
			serializeVariableFont(compilation.font))
	const compilationAtom = owner.silo.atom<LiveFontCompilationState>({
		key: "compilation",
		default: Object.freeze({ status: "idle", lastGood: null }),
	})
	const activeFontAtom = owner.silo.atom<ActiveLiveFontState>({
		key: "activeFont",
		default: Object.freeze({ status: "idle", family: null, generation: null }),
	})
	let generation = 0
	let unsubscribe: (() => void) | null = null
	let cancelScheduled: (() => void) | null = null
	let running = false
	let retainCount = 0
	let disposed = false

	const lastGood = (): LiveFontArtifact | null => {
		const current = owner.silo.getState(compilationAtom)
		return current.status === "idle" ? null : current.lastGood
	}
	const publishFailure = (
		currentGeneration: number,
		revision: number,
		diagnostics: readonly LiveFontDiagnostic[],
	): void => {
		if (!running || currentGeneration !== generation) return
		owner.silo.setState(
			compilationAtom,
			Object.freeze({
				status: "failed",
				generation: currentGeneration,
				revision,
				diagnostics: Object.freeze(diagnostics),
				lastGood: lastGood(),
			}),
		)
	}
	const compile = (
		currentGeneration: number,
		revision: number,
		requestedAt: number,
	): void => {
		if (!running || currentGeneration !== generation) return
		const started = now()
		let compilation: FontCompilation
		try {
			compilation = owner.compilation()
		} catch (error) {
			publishFailure(currentGeneration, revision, [
				{
					code: "live-font.projection-failed",
					message: error instanceof Error ? error.message : String(error),
					stage: "projection",
				},
			])
			return
		}
		const projected = now()
		if (!compilation.ok) {
			const issues =
				compilation.stage === "projection-failed"
					? compilation.projectionErrors.map((issue) => ({
							code: issue.code,
							message: issue.message,
							stage: "projection" as const,
						}))
					: compilation.ingestionErrors.map((issue) => ({
							code: issue.code,
							message: issue.message,
							stage: "ingestion" as const,
						}))
			publishFailure(currentGeneration, revision, issues)
			return
		}
		Promise.resolve(serialize(compilation)).then(
			(bytes) => {
				if (!running || currentGeneration !== generation) return
				const serialized = now()
				const artifact: LiveFontArtifact = Object.freeze({
					bytes,
					generation: currentGeneration,
					revision,
					timings: Object.freeze({
						queueing: started - requestedAt,
						projectionAndIngestion: projected - started,
						serialization: serialized - projected,
						total: serialized - requestedAt,
					}),
				})
				owner.silo.setState(
					compilationAtom,
					Object.freeze({
						status: "ready",
						generation: currentGeneration,
						revision,
						artifact,
						diagnostics: Object.freeze(
							compilation.projectionWarnings
								.filter((issue) => issue.code.startsWith("compatibility."))
								.map((issue) => ({
									code: issue.code,
									message: issue.message,
									stage: "projection" as const,
								})),
						),
						lastGood: artifact,
					}),
				)
			},
			(error) => {
				publishFailure(currentGeneration, revision, [
					{
						code: "live-font.serialization-failed",
						message: error instanceof Error ? error.message : String(error),
						stage: "serialization",
					},
				])
			},
		)
	}
	const request = (): void => {
		if (!running || disposed) return
		cancelScheduled?.()
		cancelScheduled = null
		const currentGeneration = ++generation
		const revision = owner.silo.getState(owner.documentRevision)
		const requestedAt = now()
		owner.silo.setState(
			compilationAtom,
			Object.freeze({
				status: "compiling",
				generation: currentGeneration,
				revision,
				lastGood: lastGood(),
			}),
		)
		const cancel = schedule(() => {
			cancelScheduled = null
			compile(currentGeneration, revision, requestedAt)
		})
		cancelScheduled = typeof cancel === "function" ? cancel : null
	}
	const start = (): void => {
		if (running || disposed) return
		running = true
		unsubscribe = owner.silo.subscribe(owner.documentRevision, request)
		request()
	}
	const stop = (): void => {
		cancelScheduled?.()
		cancelScheduled = null
		if (!running) return
		running = false
		generation++
		unsubscribe?.()
		unsubscribe = null
	}

	return {
		state: compilationAtom,
		active: activeFontAtom,
		start,
		stop,
		retain(): () => void {
			if (disposed) return () => {}
			retainCount++
			if (retainCount === 1) start()
			let released = false
			return () => {
				if (released || disposed) return
				released = true
				retainCount--
				if (retainCount === 0) stop()
			}
		},
		request,
		dispose(): void {
			if (disposed) return
			disposed = true
			stop()
			retainCount = 0
		},
	}
}
