import type {
	CanvasView,
	CanvasViewport,
} from "../../../packages/create-art/editor/src/canvas-foundations.ts"
import type { VectorBounds } from "../../../packages/create-art/editor/src/vector-scene.ts"

export function fitCanvas(
	bounds: VectorBounds,
	size: CanvasViewport,
	yDirection: 1 | -1,
): CanvasView {
	const padding = 48
	const zoom = Math.max(
		0.01,
		Math.min(
			Math.max(1, size.width - padding * 2) /
				Math.max(1, bounds.maxX - bounds.minX),
			Math.max(1, size.height - padding * 2) /
				Math.max(1, bounds.maxY - bounds.minY),
		),
	)
	return {
		zoom,
		x: size.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
		y: size.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom * yDirection,
	}
}
