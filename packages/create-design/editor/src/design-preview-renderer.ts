import type { DesignPreviewScene } from "./design-preview-scene.ts"

export type DesignPreviewFrame = Readonly<{
	scene: DesignPreviewScene
	viewport: Readonly<{
		width: number
		height: number
		pixelRatio: number
	}>
	view: Readonly<{
		x: number
		y: number
		scale: number
	}>
}>

export interface DesignPreviewRendererBackend {
	mount(canvas: HTMLCanvasElement): Promise<void> | void
	render(frame: DesignPreviewFrame): void
	dispose(): void
}

export type DesignPreviewRendererFactory =
	() => Promise<DesignPreviewRendererBackend>

export type DesignPreviewRendererStatus =
	| Readonly<{ state: "inactive" }>
	| Readonly<{ state: "loading" }>
	| Readonly<{ state: "ready" }>
	| Readonly<{ state: "fallback"; reason: string }>

export type DesignPreviewRendererController = Readonly<{
	update(frame: DesignPreviewFrame): void
	dispose(): void
}>

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "The renderer could not start."
}

export function startDesignPreviewRenderer(
	canvas: HTMLCanvasElement,
	factory: DesignPreviewRendererFactory,
	onStatus: (status: DesignPreviewRendererStatus) => void,
): DesignPreviewRendererController {
	let backend: DesignPreviewRendererBackend | null = null
	let disposed = false
	let latestFrame: DesignPreviewFrame | null = null
	let failed = false
	const fail = (error: unknown): void => {
		if (disposed || failed) return
		failed = true
		backend?.dispose()
		backend = null
		onStatus({ state: "fallback", reason: errorMessage(error) })
	}
	onStatus({ state: "loading" })
	void factory()
		.then(async (created) => {
			if (disposed) {
				created.dispose()
				return
			}
			backend = created
			await created.mount(canvas)
			if (disposed) {
				if (backend === created) {
					created.dispose()
					backend = null
				}
				return
			}
			onStatus({ state: "ready" })
			if (latestFrame !== null) created.render(latestFrame)
		})
		.catch(fail)
	return {
		update(frame) {
			latestFrame = frame
			if (backend === null || failed) return
			try {
				backend.render(frame)
			} catch (error) {
				fail(error)
			}
		},
		dispose() {
			disposed = true
			backend?.dispose()
			backend = null
		},
	}
}
