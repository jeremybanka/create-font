import {
	zoomCanvasViewWithOptions,
	type CanvasView,
	type CanvasViewport,
} from "@create-art/editor"

export const BASE_CANVAS_SCALE = 0.18
export const MIN_CANVAS_ZOOM = 0.25
export const MAX_CANVAS_ZOOM = 10

export type { CanvasView, CanvasViewport } from "@create-art/editor"

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
	return zoomCanvasViewWithOptions(current, nextZoom, focal, {
		baseScale: BASE_CANVAS_SCALE,
		minZoom: MIN_CANVAS_ZOOM,
		maxZoom: MAX_CANVAS_ZOOM,
	})
}
