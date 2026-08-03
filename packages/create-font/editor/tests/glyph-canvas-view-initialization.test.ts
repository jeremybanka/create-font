// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { EditorStateContext } from "../src/state-hooks.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
})

describe("GlyphCanvas view initialization", () => {
	it("waits for the first usable canvas size and does not reset on resize", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			function (this: HTMLCanvasElement) {
				const context = {
					canvas: this,
					createImageData: (width: number, height: number) => ({
						data: new Uint8ClampedArray(width * height * 4),
						height,
						width,
					}),
					getImageData: () => ({ data: new Uint8ClampedArray(4) }),
					measureText: () => ({ width: 0 }),
				}
				return new Proxy(context, {
					get: (target, key) =>
						key in target
							? target[key as keyof typeof target]
							: () => undefined,
				}) as unknown as CanvasRenderingContext2D
			},
		)

		let bounds = { width: 0, height: 0 }
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({
					...bounds,
					bottom: bounds.height,
					left: 0,
					right: bounds.width,
					top: 0,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect,
		)
		const resizeCallbacks: ResizeObserverCallback[] = []
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					resizeCallbacks.push(callback)
				}
				disconnect(): void {}
				observe(): void {}
				unobserve(): void {}
			},
		)

		const workspace = createEditorWorkspace()
		workspace.font.silo.setState(workspace.ui.activeTool, "pen")
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(EditorStateContext.Provider, {
					value: workspace.font.silo,
					children: h(GlyphCanvas, { workspace }),
				}),
				host,
			),
		)
		const surface = host.querySelector("canvas-surface")
		expect(surface).toBeInstanceOf(HTMLElement)
		expect((surface as HTMLElement).style.cursor).toBe("crosshair")
		expect(workspace.font.silo.getState(workspace.ui.canvasView)).toEqual({
			x: 72,
			y: 72,
			zoom: 1,
		})
		expect(workspace.font.silo.getState(workspace.ui.canvasViewport)).toEqual({
			width: 0,
			height: 0,
		})

		bounds = { width: 900, height: 600 }
		act(() => resizeCallbacks[0]?.([], {} as ResizeObserver))
		expect(workspace.font.silo.getState(workspace.ui.canvasView)).toEqual({
			x: 300,
			y: 200,
			zoom: 1,
		})
		expect(workspace.font.silo.getState(workspace.ui.canvasViewport)).toEqual({
			width: 900,
			height: 600,
		})

		const manipulated = { x: -45, y: 123, zoom: 2.5 }
		act(() =>
			workspace.font.silo.setState(workspace.ui.canvasView, manipulated),
		)
		bounds = { width: 1_440, height: 900 }
		act(() => resizeCallbacks[0]?.([], {} as ResizeObserver))
		expect(workspace.font.silo.getState(workspace.ui.canvasView)).toBe(
			manipulated,
		)
		expect(workspace.font.silo.getState(workspace.ui.canvasViewport)).toEqual({
			width: 1_440,
			height: 900,
		})
	})
})
