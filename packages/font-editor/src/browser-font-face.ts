import type { Silo } from "atom.io"

import type {
	ActiveLiveFontState,
	LiveFontArtifact,
	LiveFontCompilationState,
} from "./live-font-compilation.ts"

interface FontFaceLike {
	load(): Promise<FontFaceLike>
}

interface FontFaceSetLike {
	add(face: FontFaceLike): unknown
	delete(face: FontFaceLike): boolean
}

export interface BrowserFontFaceEnvironment {
	readonly createFontFace: (family: string, source: string) => FontFaceLike
	readonly createObjectURL: (blob: Blob) => string
	readonly fonts: FontFaceSetLike
	readonly now?: () => number
	readonly revokeObjectURL: (url: string) => void
}

export type BrowserFontActivation = Readonly<{
	duration: number
	family: string
}>

export function browserFontFaceEnvironment(): BrowserFontFaceEnvironment | null {
	if (
		typeof FontFace !== "function" ||
		typeof document === "undefined" ||
		typeof URL.createObjectURL !== "function"
	)
		return null
	return {
		createFontFace: (family, source) => new FontFace(family, `url(${source})`),
		createObjectURL: (blob) => URL.createObjectURL(blob),
		fonts: document.fonts,
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	}
}

export function createBrowserFontFaceManager(
	family: string,
	environment: BrowserFontFaceEnvironment,
) {
	const now = environment.now ?? (() => performance.now())
	let generation = 0
	let active: { face: FontFaceLike; url: string } | null = null
	let disposed = false

	return {
		async activate(
			artifact: LiveFontArtifact,
		): Promise<BrowserFontActivation | null> {
			const request = ++generation
			const started = now()
			const artifactFamily = `${family} ${artifact.generation}`
			const blob = new Blob([new Uint8Array(artifact.bytes).buffer], {
				type: "font/ttf",
			})
			const url = environment.createObjectURL(blob)
			const face = environment.createFontFace(artifactFamily, url)
			try {
				await face.load()
				if (disposed || request !== generation) {
					environment.revokeObjectURL(url)
					return null
				}
				environment.fonts.add(face)
				const previous = active
				active = { face, url }
				if (previous !== null) {
					environment.fonts.delete(previous.face)
					environment.revokeObjectURL(previous.url)
				}
				return { duration: now() - started, family: artifactFamily }
			} catch (error) {
				environment.revokeObjectURL(url)
				throw error
			}
		},
		dispose(): void {
			if (disposed) return
			disposed = true
			generation++
			if (active !== null) {
				environment.fonts.delete(active.face)
				environment.revokeObjectURL(active.url)
				active = null
			}
		},
	}
}

export function startBrowserLiveFont(
	silo: Silo,
	compilationAtom: { readonly key: string; readonly type: "atom" },
	activeAtom: { readonly key: string; readonly type: "atom" },
	family: string,
	environment: BrowserFontFaceEnvironment | null = browserFontFaceEnvironment(),
): () => void {
	if (environment === null) return () => {}
	const manager = createBrowserFontFaceManager(family, environment)
	let latestGeneration = 0
	const activate = (state: LiveFontCompilationState): void => {
		if (state.status !== "ready" || state.generation <= latestGeneration) return
		latestGeneration = state.generation
		const previous = silo.getState(activeAtom) as ActiveLiveFontState
		silo.setState(activeAtom, {
			status: "loading",
			family: previous.family,
			generation: state.generation,
		})
		void manager.activate(state.artifact).then(
			(activation) => {
				if (activation === null || state.generation !== latestGeneration) return
				silo.setState(activeAtom, {
					status: "ready",
					family: activation.family,
					generation: state.generation,
					activation: activation.duration,
				})
			},
			(error) => {
				if (state.generation !== latestGeneration) return
				const current = silo.getState(activeAtom) as ActiveLiveFontState
				silo.setState(activeAtom, {
					status: "failed",
					family: current.family,
					generation: state.generation,
					diagnostic: {
						code: "live-font.activation-failed",
						message: error instanceof Error ? error.message : String(error),
						stage: "activation",
					},
				})
			},
		)
	}
	const unsubscribe = silo.subscribe(compilationAtom, ({ newValue }) => {
		activate(newValue as LiveFontCompilationState)
	})
	activate(silo.getState(compilationAtom) as LiveFontCompilationState)
	return () => {
		unsubscribe()
		manager.dispose()
	}
}
