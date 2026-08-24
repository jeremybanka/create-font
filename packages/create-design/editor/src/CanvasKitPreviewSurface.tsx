import { useEffect, useRef } from "react"

import { createCanvasKitPreviewBackend } from "./canvaskit-preview-backend.ts"
import {
	startDesignPreviewRenderer,
	type DesignPreviewFrame,
	type DesignPreviewRendererController,
	type DesignPreviewRendererFactory,
	type DesignPreviewRendererStatus,
} from "./design-preview-renderer.ts"
import type { DesignPreviewScene } from "./design-preview-scene.ts"

export function CanvasKitPreviewSurface({
	enabled,
	scene,
	width,
	height,
	view,
	onStatus,
	createBackend = createCanvasKitPreviewBackend,
}: Readonly<{
	enabled: boolean
	scene: DesignPreviewScene
	width: number
	height: number
	view: Readonly<{ x: number; y: number; scale: number }>
	onStatus(status: DesignPreviewRendererStatus): void
	createBackend?: DesignPreviewRendererFactory
}>) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const controllerRef = useRef<DesignPreviewRendererController | null>(null)
	const measured = width > 0 && height > 0
	const frame: DesignPreviewFrame = {
		scene,
		viewport: {
			width,
			height,
			pixelRatio:
				typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
		},
		view,
	}

	useEffect(() => {
		const canvas = canvasRef.current
		if (!enabled) {
			onStatus({ state: "inactive" })
			return
		}
		if (!scene.supported) {
			onStatus({
				state: "fallback",
				reason:
					scene.diagnostics[0]?.message ??
					"This document contains a feature the Skia preview does not support.",
			})
			return
		}
		if (canvas === null || !measured) return
		const controller = startDesignPreviewRenderer(
			canvas,
			createBackend,
			onStatus,
		)
		controllerRef.current = controller
		controller.update(frame)
		return () => {
			controller.dispose()
			if (controllerRef.current === controller) controllerRef.current = null
		}
	}, [createBackend, enabled, measured, onStatus, scene.supported])

	useEffect(() => {
		controllerRef.current?.update(frame)
	}, [frame])

	return (
		<canvas-kit-preview-surface aria-hidden="true">
			<canvas ref={canvasRef} data-design-canvaskit-surface />
		</canvas-kit-preview-surface>
	)
}
