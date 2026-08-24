import { describe, expect, it, vi } from "vitest"

import {
	startDesignPreviewRenderer,
	type DesignPreviewFrame,
	type DesignPreviewRendererBackend,
	type DesignPreviewRendererStatus,
} from "../src/design-preview-renderer.ts"

const frame: DesignPreviewFrame = {
	scene: {
		revision: "scene:1",
		artboards: [],
		paths: [],
		diagnostics: [],
		supported: true,
	},
	viewport: { width: 640, height: 480, pixelRatio: 2 },
	view: { x: 12, y: 18, scale: 0.5 },
}

describe("design preview renderer lifecycle", () => {
	it("retains the latest frame while an async backend initializes", async () => {
		const calls: string[] = []
		const rendered: DesignPreviewFrame[] = []
		const backend: DesignPreviewRendererBackend = {
			mount: () => {
				calls.push("mount")
			},
			render: (next) => rendered.push(next),
			dispose: () => calls.push("dispose"),
		}
		const statuses: DesignPreviewRendererStatus[] = []
		const controller = startDesignPreviewRenderer(
			{} as HTMLCanvasElement,
			async () => backend,
			(status) => statuses.push(status),
		)
		controller.update(frame)
		await Promise.resolve()
		await Promise.resolve()

		expect(statuses).toEqual([{ state: "loading" }, { state: "ready" }])
		expect(calls).toEqual(["mount"])
		expect(rendered).toEqual([frame])
		controller.dispose()
		expect(calls).toEqual(["mount", "dispose"])
	})

	it("falls back once when initialization or rendering fails", async () => {
		const statuses: DesignPreviewRendererStatus[] = []
		const controller = startDesignPreviewRenderer(
			{} as HTMLCanvasElement,
			async () => {
				throw new Error("WebGL unavailable")
			},
			(status) => statuses.push(status),
		)
		controller.update(frame)
		await vi.waitFor(() =>
			expect(statuses.at(-1)).toEqual({
				state: "fallback",
				reason: "WebGL unavailable",
			}),
		)
		controller.update(frame)
		expect(statuses).toHaveLength(2)
	})
})
