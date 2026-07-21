export const BASE_CANVAS_SCALE = 0.18
export const MIN_CANVAS_ZOOM = 0.25
export const MAX_CANVAS_ZOOM = 10

export interface CanvasView {
	readonly x: number
	readonly y: number
	readonly zoom: number
}

export interface CanvasViewport {
	readonly width: number
	readonly height: number
}

export function initialCanvasView(viewport: CanvasViewport): CanvasView | null {
	if (
		!Number.isFinite(viewport.width) ||
		viewport.width <= 0 ||
		!Number.isFinite(viewport.height) ||
		viewport.height <= 0
	)
		return null
	return {
		x: viewport.width / 3,
		y: viewport.height / 3,
		zoom: 1,
	}
}

export function initializeCanvasView(
	current: CanvasView,
	previousViewport: CanvasViewport,
	nextViewport: CanvasViewport,
): CanvasView {
	if (initialCanvasView(previousViewport) !== null) return current
	return initialCanvasView(nextViewport) ?? current
}

export function zoomCanvasView(
	current: CanvasView,
	nextZoom: number,
	focal: Readonly<{ x: number; y: number }>,
): CanvasView {
	const zoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, nextZoom))
	const oldScale = BASE_CANVAS_SCALE * current.zoom
	const nextScale = BASE_CANVAS_SCALE * zoom
	const worldX = (focal.x - current.x) / oldScale
	const worldY = (focal.y - current.y) / oldScale
	return {
		x: focal.x - worldX * nextScale,
		y: focal.y - worldY * nextScale,
		zoom,
	}
}
