// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
	DesignApplication,
	type DesignApplicationProps,
} from "../src/DesignApplication.tsx"
import { createInitialDocument, DESIGN_STORAGE_KEY } from "../src/document.ts"
import { objectBounds } from "../src/geometry.ts"
import {
	DESIGN_RECOVERY_STORAGE_KEY,
	type DesignRecoveryDraft,
} from "../src/persistence.ts"
import type {
	DesignExternalSourceUpdate,
	DesignSourceSession,
} from "../src/source-sync.ts"
import type { DesignDocument } from "../src/types.ts"

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

function mountDesign(
	props: DesignApplicationProps = {},
	storage = new Map<string, string>(),
) {
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
	act(() => render(h(DesignApplication, props), host))
	const stage = Konva.stages.at(-1)
	if (stage === undefined) throw new Error("Design stage did not mount.")
	return stage
}

describe("create-design shared vector scene", () => {
	function sourceSession(
		overrides: Partial<DesignSourceSession> = {},
	): DesignSourceSession {
		const initialDocument = createInitialDocument()
		return {
			initialDocument,
			initialRevision: "source:one",
			reload: vi.fn(async () => ({
				ok: true as const,
				document: initialDocument,
				revision: "source:one",
			})),
			save: vi.fn(async () => ({ revision: "source:two" })),
			subscribeDocument: vi.fn(() => () => undefined),
			subscribeStatus: vi.fn(() => () => undefined),
			...overrides,
		}
	}

	it("leaves invalid persisted input untouched until the user edits", () => {
		const invalid = JSON.stringify({
			...createInitialDocument(),
			version: 999,
		})
		const storage = new Map([[DESIGN_STORAGE_KEY, invalid]])
		mountDesign({}, storage)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(invalid)
	})

	it("offers a recovery draft without labeling it saved, then saves an explicit recovery", async () => {
		const storage = new Map<string, string>()
		const recovered = { ...createInitialDocument(), title: "Recovered design" }
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: recovered,
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		const session = sourceSession()
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			"has not been saved",
		)
		const recover = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Recover draft",
		)
		if (recover === undefined)
			throw new Error("Recover draft action was not found.")
		await act(async () => {
			recover.click()
			await Promise.resolve()
			await Promise.resolve()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(session.save).toHaveBeenCalledWith(recovered)
		expect(
			document.querySelector<HTMLInputElement>("header input")?.value,
		).toBe("Recovered design")
		await vi.waitFor(() => {
			expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
			expect(document.querySelector('[role="status"]')?.textContent).toContain(
				"source:two",
			)
		})
	})

	it("clears an identical stale recovery draft without prompting or warning", () => {
		const storage = new Map<string, string>()
		const session = sourceSession()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: session.initialDocument,
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		expect(document.querySelector("persistence-alert")).toBeNull()
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			"source:one",
		)
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(session.save).not.toHaveBeenCalled()
		const event = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(false)
	})

	it("discards only the recovery draft and reloads newer durable source", async () => {
		const storage = new Map<string, string>()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:old",
			document: { ...createInitialDocument(), title: "Old draft" },
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		const session = sourceSession()
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const discard = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Discard draft",
		)
		if (discard === undefined)
			throw new Error("Discard draft action was not found.")
		await act(async () => {
			discard.click()
			await Promise.resolve()
		})
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(session.save).not.toHaveBeenCalled()
		expect(session.reload).toHaveBeenCalledOnce()
		expect(
			document.querySelector<HTMLInputElement>("header input")?.value,
		).toBe("Untitled design")
	})

	it("keeps the last valid canvas and locates invalid external source errors", () => {
		let listener: ((update: DesignExternalSourceUpdate) => void) | undefined
		const session = sourceSession({
			subscribeDocument: (next) => {
				listener = next
				return () => undefined
			},
		})
		const stage = mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		act(() =>
			listener?.({
				ok: false,
				revision: "source:invalid",
				diagnostics: [
					{
						severity: "error",
						code: "source.schema",
						unitPath: "document.json",
						path: "$.title",
						message: "Expected string.",
					},
				],
			}),
		)
		expect(document.querySelector("persistence-alert")?.textContent).toContain(
			"document.json $.title",
		)
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		for (const label of ["Reload external source", "Save local copy"])
			expect(
				[...document.querySelectorAll("button")].some(
					(button) => button.textContent?.trim() === label,
				),
			).toBe(true)
	})

	it("warns before navigation and persists a recovery draft while a save is pending", () => {
		const storage = new Map<string, string>()
		const session = sourceSession({
			save: vi.fn(
				() => new Promise<Readonly<{ revision: string }>>(() => undefined),
			),
		})
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const title = document.querySelector<HTMLInputElement>("header input")
		if (title === null) throw new Error("Document title was not found.")
		act(() => {
			title.value = "Pending title"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		const event = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
		expect(
			JSON.parse(storage.get(DESIGN_RECOVERY_STORAGE_KEY) ?? "{}").document
				.title,
		).toBe("Pending title")
	})

	it("retains failed work and retries only after a keyboard-reachable action", async () => {
		const save = vi
			.fn()
			.mockRejectedValueOnce(new Error("Source write failed."))
			.mockResolvedValueOnce({ revision: "source:two" })
		const session = sourceSession({ save })
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		const title = document.querySelector<HTMLInputElement>("header input")
		if (title === null) throw new Error("Document title was not found.")
		act(() => {
			title.value = "Retained title"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		await vi.waitFor(() =>
			expect(
				document.querySelector("persistence-alert")?.textContent,
			).toContain("Source write failed."),
		)
		const retry = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Retry save",
		)
		if (retry === undefined) throw new Error("Retry save action was not found.")
		expect(retry.tabIndex).toBeGreaterThanOrEqual(0)
		act(() => retry.click())
		await vi.waitFor(() =>
			expect(document.querySelector('[role="status"]')?.textContent).toContain(
				"source:two",
			),
		)
		expect(save).toHaveBeenCalledTimes(2)
		expect(save).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: "Retained title" }),
		)
	})

	it("hosts every design control in registry tiles without fixed navigation or asides", () => {
		mountDesign()
		expect(document.querySelector("nav")).toBeNull()
		expect(document.querySelector("aside")).toBeNull()
		expect(document.querySelector("design-pages-tile")).not.toBeNull()
		expect(document.querySelector("design-layers-tile")).not.toBeNull()
		expect(document.querySelector("design-tools-tile")).not.toBeNull()
		expect(document.querySelector("design-object-tile")).not.toBeNull()
		expect(document.querySelector("design-color-tile")).not.toBeNull()
	})

	it("renders authored geometry through the shared contour component", () => {
		const stage = mountDesign()
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		expect(stage.findOne(".design-object")).toBeDefined()
		const layer = document.querySelector<HTMLButtonElement>(
			"design-layers-tile > button:last-child",
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

	it("edits exact live parameters and expands a selected shape in one undo step", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-layers-tile > button",
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		if (layer === undefined) throw new Error("Rectangle layer was not found.")
		act(() => layer.click())

		const field = (label: string): HTMLInputElement => {
			const input = [...document.querySelectorAll("label")]
				.find(
					(candidate) => candidate.querySelector("span")?.textContent === label,
				)
				?.querySelector("input")
			if (!(input instanceof HTMLInputElement))
				throw new Error(`${label} field was not found.`)
			return input
		}
		expect(field("Local X").valueAsNumber).toBe(82)
		expect(field("Bounds X").readOnly).toBe(true)
		expect(field("Bounds width").valueAsNumber).toBe(280)

		const width = field("Width")
		await act(async () => {
			width.value = "320"
			width.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toMatchObject({
			kind: "rectangle",
			width: 320,
		})
		expect(field("Bounds width").valueAsNumber).toBe(320)

		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-shape]",
		)
		if (expand === null) throw new Error("Expand Shape action was not found.")
		expect(expand.disabled).toBe(false)
		expect(expand.getAttribute("aria-describedby")).toBe(
			"expand-shape-eligibility",
		)
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const expanded = saved.objects[0]
		expect(expanded?.geometry.kind).toBe("path")
		if (expanded?.geometry.kind !== "path") return
		expect(expanded.geometry.contours[0]?.id).toMatch(/^contour:/u)
		expect(
			expanded.geometry.contours[0]?.points.every((point) =>
				point.id?.startsWith("point:"),
			),
		).toBe(true)
		expect(expanded.appearance).toEqual(
			createInitialDocument().objects[0]?.appearance,
		)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Path geometry",
		)
		expect(expand.disabled).toBe(true)
		expect(
			document.getElementById("expand-shape-eligibility")?.textContent,
		).toContain("already ordinary path")

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toMatchObject({
			kind: "rectangle",
			width: 320,
		})
		expect(expand.disabled).toBe(false)
	})

	it.each([
		["nw", { x: -40, y: -30 }, { x: "maxX", y: "maxY" }],
		["ne", { x: 40, y: -30 }, { x: "minX", y: "maxY" }],
		["se", { x: 40, y: 30 }, { x: "minX", y: "minY" }],
		["sw", { x: -40, y: 30 }, { x: "maxX", y: "minY" }],
	] as const)(
		"keeps the opposite design corner fixed when dragging %s",
		async (handleName, delta, fixed) => {
			const stage = mountDesign()
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"setPointerCapture",
			).mockImplementation(() => undefined)
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"releasePointerCapture",
			).mockImplementation(() => undefined)
			vi.spyOn(
				HTMLCanvasElement.prototype,
				"hasPointerCapture",
			).mockReturnValue(false)
			const layer = [
				...document.querySelectorAll<HTMLButtonElement>(
					"design-layers-tile > button",
				),
			].find((button) => button.textContent?.includes("Coral rectangle"))
			const transform = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Transform"]',
			)
			if (layer === undefined || transform === null)
				throw new Error("Design transform controls were not found.")
			act(() => {
				layer.click()
				transform.click()
			})
			const handle = stage.findOne(`.transform-handle-${handleName}`)
			const canvas = stage.container().querySelector("canvas")
			if (handle === undefined || canvas === null)
				throw new Error(`${handleName} design transform handle was not found.`)
			let pointer = handle.getAbsolutePosition()
			vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
			await act(async () => {
				handle.fire("pointerdown", {
					evt: {
						altKey: false,
						button: 0,
						ctrlKey: false,
						currentTarget: canvas,
						metaKey: false,
						pointerId: 7,
						shiftKey: false,
					},
				})
				pointer = {
					x: pointer.x + delta.x,
					y: pointer.y + delta.y,
				}
				for (const type of ["pointermove", "pointerup"]) {
					canvas.dispatchEvent(
						new PointerEvent(type, {
							bubbles: true,
							button: 0,
							buttons: type === "pointerup" ? 0 : 1,
							clientX: pointer.x,
							clientY: pointer.y,
							isPrimary: true,
							pointerId: 7,
							pointerType: "mouse",
						}),
					)
				}
				await Promise.resolve()
			})
			const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
			if (saved === null) throw new Error("Design document was not persisted.")
			const next = JSON.parse(saved) as DesignDocument
			const bounds = objectBounds(
				next.objects.find((object) => object.id === "object:coral")!,
			)
			if (bounds === null) throw new Error("Transformed object has no bounds.")
			const original = { minX: 82, minY: 102, maxX: 362, maxY: 342 }
			expect(bounds[fixed.x]).toBe(original[fixed.x])
			expect(bounds[fixed.y]).toBe(original[fixed.y])
		},
	)

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
		const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
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
		const penPreview = stage.findOne(".vector-pen-preview")
		expect(penPreview).toBeDefined()
		expect(penPreview.find(".vector-node-selection")).toHaveLength(0)
		expect(stage.find(".vector-handle").length).toBeGreaterThanOrEqual(2)
		await act(async () => {
			fire("pointerup", 485, 360)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		let saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		let parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
		const contour = parsed.objects.at(-1).geometry.contours[0]
		expect(contour.closed).toBe(false)
		expect(contour.points).toHaveLength(2)
		expect("incoming" in contour.points[0]).toBe(false)
		expect("outgoing" in contour.points[0]).toBe(false)
		expect(contour.points[1]).toMatchObject({
			incoming: expect.any(Object),
			outgoing: expect.any(Object),
		})
		expect(
			document.querySelector('design-layers-tile > button[aria-pressed="true"]')
				?.textContent,
		).toContain("Pen path")

		await act(async () => {
			fire("pointerdown", 520, 420, 8)
			fire("pointermove", 550, 450, 8)
			fire("pointercancel", 550, 450, 8)
			fire("pointerup", 550, 450, 8)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		parsed = JSON.parse(saved)
		expect(parsed.objects).toHaveLength(3)
	})
})
