// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesignApplication } from "../src/DesignApplication.tsx"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../preact-konva/package.json`,
)
const { default: Konva } = await import(
	requireFromRenderer.resolve("konva/lib/Core")
)

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function mountDesign() {
	const storage = new Map<string, string>()
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	})
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
					key in target ? target[key as keyof typeof target] : () => undefined,
			}) as unknown as CanvasRenderingContext2D
		},
	)
	vi.stubGlobal(
		"ResizeObserver",
		class {
			readonly callback: ResizeObserverCallback
			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
			}
			observe() {
				this.callback(
					[
						{
							contentRect: {
								width: 960,
								height: 720,
							},
						} as ResizeObserverEntry,
					],
					this as unknown as ResizeObserver,
				)
			}
			disconnect() {}
			unobserve() {}
		},
	)
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	act(() => render(h(DesignApplication, {}), host))
	const stage = Konva.stages.at(-1)
	if (stage === undefined) throw new Error("Design stage did not mount.")
	return stage
}

describe("create-design shared vector scene", () => {
	it("renders authored geometry through the shared contour component", () => {
		const stage = mountDesign()
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		expect(stage.findOne(".design-object")).toBeDefined()
		const layer = document.querySelector<HTMLButtonElement>(
			".layer-list button:last-child",
		)
		const transform = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Transform"]',
		)
		if (layer === null || transform === null)
			throw new Error("Design selection controls were not found.")
		act(() => {
			layer.click()
			transform.click()
		})
		const paper = stage.findOne(".design-paper")
		const contour = stage.findOne(".vector-contour-path")
		const selection = stage.findOne(".vector-selection-bounds")
		expect(paper.zIndex()).toBeLessThan(contour.zIndex())
		expect(contour.zIndex()).toBeLessThan(selection.zIndex())
	})

	it("cancels a native pointer gesture before a later pointer-up", async () => {
		const stage = mountDesign()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			false,
		)
		const rectangle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Rectangle"]',
		)
		if (rectangle === null) throw new Error("Rectangle tool was not found.")
		act(() => rectangle.click())
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
		const fire = (type: string, x: number, y: number): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 7,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 320, 260)
			fire("pointermove", 440, 380)
			fire("pointercancel", 440, 380)
			fire("pointerup", 440, 380)
			await Promise.resolve()
		})
		const saved = localStorage.getItem("create-design:document:v1")
		if (saved === null) throw new Error("Design document was not persisted.")
		expect(JSON.parse(saved).objects).toHaveLength(2)
	})

	it("commits a shared Pen draft with cubic handles and discards canceled drafts synchronously", async () => {
		const stage = mountDesign()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			false,
		)
		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (pen === null || canvas === null)
			throw new Error("Pen controls were not found.")
		act(() => pen.click())
		const fire = (type: string, x: number, y: number, pointerId = 7): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 360, 280)
			fire("pointerup", 360, 280)
			fire("pointerdown", 460, 340)
			fire("pointermove", 485, 360)
			await Promise.resolve()
		})
		expect(stage.find(".vector-handle").length).toBeGreaterThanOrEqual(2)
		await act(async () => {
			fire("pointerup", 485, 360)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		let saved = localStorage.getItem("create-design:document:v1")
		if (saved === null) throw new Error("Design document was not persisted.")
		let parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
		const contour = parsed.objects.at(-1).contours[0]
		expect(contour.closed).toBe(false)
		expect(contour.points).toHaveLength(2)
		expect("incoming" in contour.points[0]).toBe(false)
		expect("outgoing" in contour.points[0]).toBe(false)
		expect(contour.points[1]).toMatchObject({
			incoming: expect.any(Object),
			outgoing: expect.any(Object),
		})
		expect(
			document.querySelector(".layer-list button.selected")?.textContent,
		).toContain("Pen path")

		await act(async () => {
			fire("pointerdown", 520, 420, 8)
			fire("pointermove", 550, 450, 8)
			fire("pointercancel", 550, 450, 8)
			fire("pointerup", 550, 450, 8)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		saved = localStorage.getItem("create-design:document:v1")
		if (saved === null) throw new Error("Design document was not persisted.")
		parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
	})
})
