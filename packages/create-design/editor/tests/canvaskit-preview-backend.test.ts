import { describe, expect, it } from "vitest"

import {
	CANVASKIT_MINIMUM_STROKE_DEVICE_PIXELS,
	canvasKitPictureRevision,
	canvasKitPreviewStrokeWidth,
} from "../src/canvaskit-preview-backend.ts"
import type { DesignPreviewFrame } from "../src/design-preview-renderer.ts"

function frame(
	strokeWidth: number,
	view: Readonly<{ x: number; y: number; scale: number }>,
	pixelRatio = 2,
): DesignPreviewFrame {
	return {
		scene: {
			revision: `scene:stroke:${strokeWidth}`,
			artboards: [],
			paths: [
				{
					id: "object:hairline",
					pathData: "M 0 0 L 10 0",
					fillRule: "nonzero",
					stroke: {
						color: "#000",
						width: strokeWidth,
						cap: "butt",
						join: "miter",
						miterLimit: 4,
						dashArray: [],
						dashOffset: 0,
					},
				},
			],
			diagnostics: [],
			supported: true,
		},
		viewport: { width: 640, height: 480, pixelRatio },
		view,
	}
}

describe("CanvasKit preview stroke coverage", () => {
	it("raises a thin authored stroke to exactly one physical device pixel", () => {
		const viewScale = 0.1
		const pixelRatio = 2
		const width = canvasKitPreviewStrokeWidth(0.25, viewScale, pixelRatio)

		expect(width).toBe(5)
		expect(width * viewScale * pixelRatio).toBe(
			CANVASKIT_MINIMUM_STROKE_DEVICE_PIXELS,
		)
	})

	it("preserves authored widths once they already exceed the floor", () => {
		expect(canvasKitPreviewStrokeWidth(0.25, 4, 2)).toBe(0.25)
		expect(canvasKitPreviewStrokeWidth(3, 0.5, 2)).toBe(3)
	})

	it("keeps pan out of the picture cache key", () => {
		const first = frame(0.25, { x: 0, y: 0, scale: 0.1 })
		const panned = frame(0.25, { x: 180, y: -90, scale: 0.1 })

		expect(canvasKitPictureRevision(panned)).toBe(
			canvasKitPictureRevision(first),
		)
	})

	it("recompiles for zoom or DPR only when the effective floor changes", () => {
		const thin = frame(0.25, { x: 0, y: 0, scale: 0.1 })
		const thinZoomed = frame(0.25, { x: 0, y: 0, scale: 0.2 })
		const thinHigherDpr = frame(0.25, { x: 0, y: 0, scale: 0.1 }, 3)
		expect(canvasKitPictureRevision(thinZoomed)).not.toBe(
			canvasKitPictureRevision(thin),
		)
		expect(canvasKitPictureRevision(thinHigherDpr)).not.toBe(
			canvasKitPictureRevision(thin),
		)

		const authored = frame(4, { x: 0, y: 0, scale: 1 })
		const authoredZoomed = frame(4, { x: 0, y: 0, scale: 2 })
		expect(canvasKitPictureRevision(authoredZoomed)).toBe(
			canvasKitPictureRevision(authored),
		)
	})

	it("does not mutate the renderer-neutral authored scene width", () => {
		const input = frame(0.25, { x: 0, y: 0, scale: 0.1 })
		canvasKitPictureRevision(input)

		expect(input.scene.paths[0]?.stroke?.width).toBe(0.25)
	})
})
