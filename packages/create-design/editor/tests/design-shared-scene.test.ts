// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"

import {
	DesignApplication,
	type DesignApplicationProps,
} from "../src/DesignApplication.tsx"
import { mountDesignEditor } from "../src/browser.ts"
import { readDesignCanvasTheme } from "../src/design-canvas-theme.ts"
import { DESIGN_CANVAS_DIMMER_STORAGE_KEY } from "../src/canvas-dimmer.ts"
import { designLayerUiColorCss } from "../src/design-layer-ui-color.ts"
import { DESIGN_TOOLS } from "../src/design-tools.ts"
import { createInitialDocument, DESIGN_STORAGE_KEY } from "../src/document.ts"
import { DESIGN_GUIDES_VISIBLE_STORAGE_KEY } from "../src/design-guides.ts"
import {
	groupDesignSelection,
	makeDesignClippingMask,
} from "../src/design-hierarchy.ts"
import {
	createDesignTextObject,
	designTextBrowserFontFamily,
	designTextCssFontFamily,
} from "../src/design-text.ts"
import {
	objectBounds,
	projectDesignObjectContours,
	swatchCss,
	translateObject,
	visibleObjectBounds,
} from "@create-design/model"
import type {
	PathfinderWorkerClient,
	PathfinderWorkerOutcome,
} from "../src/pathfinder-worker-client.ts"
import type {
	PathfinderWorkerProgress,
	PathfinderWorkerRequest,
} from "../src/pathfinder-worker-protocol.ts"
import {
	DESIGN_RECOVERY_STORAGE_KEY,
	type DesignRecoveryDraft,
} from "../src/persistence.ts"
import { expandDesignShape } from "../src/shape-expansion.ts"
import type {
	DesignExternalSourceUpdate,
	DesignSourceSession,
} from "../src/source-session.ts"
import type { DesignDocument, DesignObject } from "../src/types.ts"
import type { DesignTextLayout } from "@create-design/text"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/editor/package.json`,
)
const { default: Konva } = await import(
	requireFromRenderer.resolve("konva/lib/Core")
)

const hosts: HTMLElement[] = []

function loadedTextLayout(object: DesignObject): DesignTextLayout | null {
	if (object.geometry.kind !== "text") return null
	const bounds =
		object.geometry.mode === "area" && object.geometry.frame !== undefined
			? {
					x: object.geometry.x,
					y: object.geometry.y,
					width: object.geometry.frame.width,
					height: object.geometry.frame.height,
				}
			: {
					x: object.geometry.x,
					y: object.geometry.y - object.geometry.typography.size,
					width: Math.max(1, object.geometry.text.length * 12),
					height: object.geometry.typography.leading,
				}
	return {
		objectId: object.id,
		font: {
			binaryHash: "fixture",
			faceIndex: 0,
			family: object.geometry.typography.font.family,
			key: `fixture:${object.geometry.typography.font.id}`,
			revision: object.geometry.typography.font.revision ?? 1,
			source: object.geometry.typography.font.id,
		},
		glyphs: [],
		lines: [],
		diagnostics: [],
		visibleTextEnd: object.geometry.text.length,
		overset: false,
		logicalBounds: bounds,
		inkBounds: null,
		bounds,
	}
}

type DeferredPathfinderRun = {
	readonly cancel: ReturnType<typeof vi.fn>
	readonly input: Omit<PathfinderWorkerRequest, "id">
	readonly onProgress: (progress: PathfinderWorkerProgress) => void
	readonly resolve: (outcome: PathfinderWorkerOutcome) => void
}

class DeferredPathfinderWorkerClient implements PathfinderWorkerClient {
	readonly runs: DeferredPathfinderRun[] = []

	run(
		input: Omit<PathfinderWorkerRequest, "id">,
		onProgress: (progress: PathfinderWorkerProgress) => void,
	) {
		let settled = false
		let resolveOutcome!: (outcome: PathfinderWorkerOutcome) => void
		const result = new Promise<PathfinderWorkerOutcome>((resolve) => {
			resolveOutcome = resolve
		})
		const resolve = (outcome: PathfinderWorkerOutcome): void => {
			if (settled) return
			settled = true
			resolveOutcome(outcome)
		}
		const cancel = vi.fn(() => resolve({ status: "cancelled" }))
		this.runs.push({ cancel, input, onProgress, resolve })
		return { cancel, result }
	}
}

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	Reflect.deleteProperty(document, "fonts")
	Reflect.deleteProperty(window, "FontFace")
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function prepareDesignDom(
	storage = new Map<string, string>(),
	resize?: {
		readonly deferred: true
		readonly capture: (callback: ResizeObserverCallback) => void
	},
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
			observe(element: Element) {
				if (resize !== undefined && element.localName === "artboard-wrap") {
					resize.capture(this.callback)
					return
				}
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
	return host
}

function mountDesign(
	props: DesignApplicationProps = {},
	storage = new Map<string, string>(),
	resize?: {
		readonly deferred: true
		readonly capture: (callback: ResizeObserverCallback) => void
	},
) {
	const host = prepareDesignDom(storage, resize)
	act(() => render(h(DesignApplication, props), host))
	for (;;) {
		const disclosures = [
			...host.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [role="treeitem"][aria-expanded="false"] > button[data-disclosure]',
			),
		]
		if (disclosures.length === 0) break
		act(() => disclosures.forEach((disclosure) => disclosure.click()))
	}
	const stage = Konva.stages.at(-1)
	if (resize !== undefined) return stage
	if (stage === undefined) throw new Error("Design stage did not mount.")
	return stage
}

function clipboardEvent(
	type: "copy" | "cut" | "paste",
	clipboard: Pick<DataTransfer, "getData" | "setData"> | null,
): ClipboardEvent {
	const event = new Event(type, {
		bubbles: true,
		cancelable: true,
	}) as ClipboardEvent
	Object.defineProperty(event, "clipboardData", { value: clipboard })
	return event
}

function directControlFixture(): Readonly<{
	document: DesignDocument
	object: DesignObject
	hardPointId: string
	softPointId: string
}> {
	const initial = createInitialDocument()
	let identity = 0
	const expanded = expandDesignShape(initial.objects[0]!, () =>
		(identity += 1).toString(),
	)
	if (expanded.geometry.kind !== "path") throw new Error("Expected a path.")
	const firstContour = expanded.geometry.contours[0]
	const hardPointId = firstContour?.points[0]?.id
	const softPointId = firstContour?.points[1]?.id
	if (hardPointId === undefined || softPointId === undefined)
		throw new Error("Expected two path points.")
	const object: DesignObject = {
		...expanded,
		geometry: {
			...expanded.geometry,
			contours: expanded.geometry.contours.map((contour, contourIndex) => ({
				...contour,
				points: contour.points.map((point, pointIndex) => {
					if (contourIndex !== 0) return point
					if (pointIndex === 0)
						return {
							...point,
							mode: "hard" as const,
							incoming: { x: -18, y: 4 },
							outgoing: { x: 22, y: -6 },
						}
					if (pointIndex === 1)
						return {
							...point,
							mode: "soft" as const,
							incoming: { x: -16, y: 0 },
							outgoing: { x: 24, y: 0 },
						}
					return { ...point, mode: "hard" as const }
				}),
			})),
		},
	}
	return {
		document: { ...initial, objects: [object] },
		object,
		hardPointId,
		softPointId,
	}
}

describe("create-design shared vector scene", () => {
	it("follows the system canvas scheme until the Dimmer is adjusted", async () => {
		let prefersLight = true
		const listeners = new Set<EventListenerOrEventListenerObject>()
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				({
					get matches() {
						return query === "(prefers-color-scheme: light)" && prefersLight
					},
					media: query,
					onchange: null,
					addEventListener: (
						type: string,
						listener: EventListenerOrEventListenerObject,
					) => {
						if (type === "change" && query === "(prefers-color-scheme: light)")
							listeners.add(listener)
					},
					removeEventListener: (
						_type: string,
						listener: EventListenerOrEventListenerObject,
					) => {
						listeners.delete(listener)
					},
					addListener: () => undefined,
					removeListener: () => undefined,
					dispatchEvent: () => true,
				}) satisfies MediaQueryList,
		)
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const slider = document.querySelector<HTMLInputElement>(
			"#design-canvas-dimmer",
		)
		const application =
			document.querySelector<HTMLElement>("design-application")
		if (slider === null || application === null)
			throw new Error("Dimmer control was not found.")
		expect(slider.value).toBe("217")
		expect(application.dataset.canvasDimmerSource).toBe("system")
		expect(storage.has(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe(false)

		const publishScheme = async (light: boolean): Promise<void> => {
			prefersLight = light
			await act(async () => {
				for (const listener of listeners) {
					const event = new MediaQueryListEvent("change", { matches: light })
					if (typeof listener === "function") listener(event)
					else listener.handleEvent(event)
				}
				await Promise.resolve()
			})
		}
		await publishScheme(false)
		expect(slider.value).toBe("17")
		expect(storage.has(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe(false)

		await act(async () => {
			slider.value = "128"
			slider.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		expect(application.dataset.canvasDimmerSource).toBe("explicit")
		expect(storage.get(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe("128")

		await publishScheme(true)
		expect(slider.value).toBe("128")
		expect(storage.get(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe("128")
	})

	it("renders and effect-persists the canvas Dimmer without an Export header shortcut", async () => {
		const storage = new Map([[DESIGN_CANVAS_DIMMER_STORAGE_KEY, "128"]])
		mountDesign({}, storage)
		const application =
			document.querySelector<HTMLElement>("design-application")
		const slider = document.querySelector<HTMLInputElement>(
			"#design-canvas-dimmer",
		)
		if (application === null || slider === null)
			throw new Error("Dimmer control was not found.")
		expect(document.querySelector("[data-export]")).toBeNull()
		expect(document.querySelector("design-export-tile")).not.toBeNull()
		expect(
			document.querySelector("header > header-actions ui-layout-control"),
		).toBeNull()
		const hudControl = document.querySelector(
			"management-hud > hud-actions > ui-layout-control",
		)
		expect(hudControl).not.toBeNull()
		expect(
			hudControl?.closest("management-hud")?.getAttribute("aria-hidden"),
		).toBe("true")
		expect(slider.type).toBe("range")
		expect(slider.min).toBe("0")
		expect(slider.max).toBe("255")
		expect(slider.value).toBe("128")
		expect(slider.getAttribute("aria-valuetext")).toBe("50%, #808080")
		expect(application.style.getPropertyValue("--design-canvas-surface")).toBe(
			"#808080",
		)

		await act(async () => {
			slider.value = "255"
			slider.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		expect(application.style.getPropertyValue("--design-canvas-surface")).toBe(
			"#ffffff",
		)
		expect(storage.get(DESIGN_CANVAS_DIMMER_STORAGE_KEY)).toBe("255")
	})

	it("inherits layer visibility and locking across canvas interaction and creation", async () => {
		const initial = createInitialDocument()
		const hiddenObject = initial.objects[0]!
		const lockedObject = initial.objects[1]!
		const editableObject = {
			...hiddenObject,
			id: "object:editable-layer",
			name: "Editable layer object",
			transform: { ...hiddenObject.transform, e: 320 },
		}
		const layered: DesignDocument = {
			...initial,
			objects: [hiddenObject, editableObject, lockedObject],
			layers: [
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object", id: hiddenObject.id }],
				},
				{
					id: "layer:editable",
					name: "Editable",
					children: [{ kind: "object", id: editableObject.id }],
				},
				{
					id: "layer:locked",
					name: "Locked",
					locked: true,
					children: [{ kind: "object", id: lockedObject.id }],
				},
			],
		}
		const stage = mountDesign({ initialDocument: layered })
		expect(stage.find(".design-object")).toHaveLength(2)
		const lockedCanvasObject = stage
			.find(".design-object")
			.find((node: { name(): string }) => node.name().includes(lockedObject.id))
		const editableCanvasObject = stage
			.find(".design-object")
			.find((node: { name(): string }) =>
				node.name().includes(editableObject.id),
			)
		expect(lockedCanvasObject?.listening()).toBe(false)
		expect(editableCanvasObject?.listening()).toBe(true)
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		const lockedButton = buttons.find((button) =>
			button.textContent?.includes(lockedObject.name),
		)
		const editableButton = buttons.find((button) =>
			button.textContent?.includes(editableObject.name),
		)
		const rectangle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Rectangle"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (
			lockedCanvasObject === undefined ||
			editableCanvasObject === undefined ||
			lockedButton === undefined ||
			editableButton === undefined ||
			rectangle === null ||
			canvas === null
		)
			throw new Error("Layer policy controls were not found.")
		const lockedBounds = lockedCanvasObject.getClientRect()
		const marqueeStart = {
			x: lockedBounds.x + lockedBounds.width / 2,
			y: lockedBounds.y + lockedBounds.height / 2,
		}
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: marqueeStart.x,
					clientY: marqueeStart.y,
					pointerId: 87,
					pointerType: "mouse",
				}),
			)
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: marqueeStart.x + 24,
					clientY: marqueeStart.y + 24,
					pointerId: 87,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		expect(stage.find(".vector-selection-bounds")).toHaveLength(1)
		expect(stage.findOne(".transform-selection-box").stroke()).toBe(
			readDesignCanvasTheme(document.querySelector("design-application"))
				.marquee,
		)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).not.toContain("Unlock Locked layer")
		act(() =>
			canvas.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					clientX: marqueeStart.x + 24,
					clientY: marqueeStart.y + 24,
					pointerId: 87,
					pointerType: "mouse",
				}),
			),
		)
		act(() => rectangle.click())
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: 320,
					clientY: 240,
					pointerId: 88,
					pointerType: "mouse",
				}),
			)
			canvas.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					clientX: 420,
					clientY: 340,
					pointerId: 88,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		expect(stage.find(".design-object")).toHaveLength(2)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Unlock Locked layer")

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "a", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(editableButton.getAttribute("aria-selected")).toBe("true")
		expect(lockedButton.getAttribute("aria-selected")).toBe("false")
		act(() => lockedButton.click())
		expect(lockedButton.getAttribute("aria-selected")).toBe("false")
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Unlock Locked layer")
		expect(hiddenObject.hidden).toBeUndefined()
		expect(lockedObject.locked).toBeUndefined()
	})

	it("colors object selections by their owning layers while keeping cross-layer bounds neutral", () => {
		const initial = createInitialDocument()
		const back = initial.objects[0]!
		const front = initial.objects[1]!
		const layered: DesignDocument = {
			...initial,
			layers: [
				{
					id: "layer:back",
					name: "Back",
					uiColor: "purple",
					children: [{ kind: "object", id: back.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					uiColor: "teal",
					children: [{ kind: "object", id: front.id }],
				},
			],
		}
		const stage = mountDesign({ initialDocument: layered })
		const rows = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		if (rows.length !== 2) throw new Error("Expected two object rows.")

		act(() => rows[0]!.click())
		let boxes = stage.find(".transform-selection-box")
		expect(boxes).toHaveLength(1)
		expect(boxes[0]!.stroke()).toBe(designLayerUiColorCss("teal"))
		expect(boxes[0]!.fill()).toBe(designLayerUiColorCss("teal"))
		expect(boxes[0]!.opacity()).toBe(0.06)

		act(() =>
			rows[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			),
		)
		boxes = stage.find(".transform-selection-box")
		const coloredBoxes = boxes.filter(
			(box: { opacity(): number }) => box.opacity() > 0,
		)
		expect(
			coloredBoxes.map((box: { stroke(): string }) => box.stroke()),
		).toEqual(
			expect.arrayContaining([
				designLayerUiColorCss("purple"),
				designLayerUiColorCss("teal"),
			]),
		)
		const aggregate = boxes.find(
			(box: { opacity(): number }) => box.opacity() === 0,
		)
		expect(aggregate?.stroke()).toBe(
			readDesignCanvasTheme(document.querySelector("design-application"))
				.marquee,
		)

		act(() => rows[0]!.click())
		boxes = stage.find(".transform-selection-box")
		const keyBoxes = boxes.filter(
			(box: { strokeWidth(): number; getAbsoluteScale(): { x: number } }) =>
				Math.abs(box.strokeWidth() * box.getAbsoluteScale().x - 3) < 0.01,
		)
		expect(keyBoxes).toHaveLength(1)
		expect(keyBoxes[0]!.stroke()).toBe(designLayerUiColorCss("teal"))
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain(`${front.name} is the key object`)
	})

	it("hits and drags a clipping contour only along its padded edge", async () => {
		const initial = createInitialDocument()
		const source = {
			...initial,
			objects: [
				initial.objects[0]!,
				{ ...initial.objects[1]!, appearance: {} },
			],
		}
		const masked = makeDesignClippingMask(
			source,
			source.objects.map(({ id }) => id),
			() => "selection-outline",
		)
		if (masked === null) throw new Error("Expected clipping mask to succeed.")
		const group = masked.document.groups.find(
			({ id }) => id === "group:selection-outline",
		)
		if (group?.clippingPathId === undefined)
			throw new Error("Expected a clipping contour.")
		const stage = mountDesign({ initialDocument: masked.document })
		const contourRow = document.querySelector<HTMLElement>(
			`design-layers-tile [data-tree-key="object:${group.clippingPathId}"]`,
		)
		if (contourRow === null)
			throw new Error("Clipping contour row did not render.")

		act(() => contourRow.click())
		expect(contourRow.getAttribute("aria-selected")).toBe("true")
		const contours = stage.find(".design-clipping-selection")
		expect(contours).toHaveLength(1)
		expect(contours[0]!.fillEnabled()).toBe(false)
		expect(contours[0]!.listening()).toBe(true)
		expect(contours[0]!.stroke()).toBeUndefined()
		const contourSelection = stage.findOne(".vector-contour-selection")
		expect(contourSelection.stroke()).toBe(
			designLayerUiColorCss(initial.layers[0]!.uiColor),
		)
		expect(contourSelection.listening()).toBe(false)
		expect(stage.find(".design-object")).toHaveLength(1)
		const contentRow = document.querySelector<HTMLElement>(
			`design-layers-tile [data-tree-key="object:${source.objects[0]!.id}"]`,
		)
		if (contentRow === null)
			throw new Error("Masked content row did not render.")
		act(() => contentRow.click())
		const hit = stage.findOne(".design-clipping-hit")
		expect(hit).toBeDefined()
		expect(hit.fillEnabled()).toBe(false)
		expect(hit.stroke()).toBe("rgb(0 0 0 / 0.001)")
		expect(hit.hitStrokeWidth()).toBeGreaterThan(hit.strokeWidth())
		let pointer = { x: 300, y: 240 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const before = hit.getClientRect()
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			next: { x: number; y: number },
		) => {
			pointer = next
			hit.fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: next.x,
						clientY: next.y,
						isPrimary: true,
						pointerId: 91,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		await act(async () => {
			fire("pointerdown", pointer)
			fire("pointermove", { x: 337, y: 269 })
			fire("pointerup", { x: 337, y: 269 })
			await Promise.resolve()
		})
		const after = stage.findOne(".design-clipping-selection").getClientRect()
		expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y })
	})

	it("uses clipping contour bounds for a clipping mask transform box", () => {
		const initial = createInitialDocument()
		const content = translateObject(initial.objects[0]!, 500, 300)
		const clippingPath = initial.objects[1]!
		const source = { ...initial, objects: [content, clippingPath] }
		const masked = makeDesignClippingMask(
			source,
			source.objects.map(({ id }) => id),
			() => "transform-bounds",
		)
		if (masked === null) throw new Error("Expected clipping mask to succeed.")
		const stage = mountDesign({ initialDocument: masked.document })
		const groupRow = document.querySelector<HTMLElement>(
			'design-layers-tile [data-tree-key="group:group:transform-bounds"]',
		)
		const clippingBounds = visibleObjectBounds(clippingPath)
		if (groupRow === null || clippingBounds === null)
			throw new Error("Clipping-mask transform fixture did not render.")

		act(() => groupRow.click())
		const aggregate = stage
			.find(".transform-selection-box")
			.find((box: { opacity(): number }) => box.opacity() === 0)
		expect(aggregate).toBeDefined()
		expect({
			minX: aggregate!.x(),
			minY: aggregate!.y(),
			maxX: aggregate!.x() + aggregate!.width(),
			maxY: aggregate!.y() + aggregate!.height(),
		}).toEqual(clippingBounds)
	})

	it("cancels an in-flight object gesture when its layer becomes locked", async () => {
		const initial = createInitialDocument()
		let listener: ((update: DesignExternalSourceUpdate) => void) | undefined
		const session = sourceSession({
			initialDocument: initial,
			subscribeDocument: (next) => {
				listener = next
				return () => undefined
			},
		})
		const stage = mountDesign({
			initialDocument: initial,
			sourceSession: session,
		})
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
		const source = initial.objects[0]!
		const node = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(source.id),
			)
		if (node === undefined || listener === undefined)
			throw new Error("Object gesture or source listener was not available.")
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (type: "pointerdown" | "pointermove" | "pointerup"): void => {
			node.fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: pointer.x,
						clientY: pointer.y,
						isPrimary: true,
						pointerId: 89,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		await act(async () => {
			fire("pointerdown")
			pointer = { x: 360, y: 300 }
			fire("pointermove")
			await Promise.resolve()
		})
		const lockedDocument = {
			...initial,
			layers: initial.layers.map((layer) => ({ ...layer, locked: true })),
		}
		await act(async () => {
			listener?.({
				ok: true,
				document: lockedDocument,
				fonts: [],
				revision: "source:locked",
			})
			await Promise.resolve()
		})
		await act(async () => {
			fire("pointerup")
			await Promise.resolve()
		})
		expect(session.save).not.toHaveBeenCalled()
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Unlock Artwork layer")
		expect(
			document.querySelector(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		).toBeNull()
		expect(lockedDocument.objects[0]?.locked).toBeUndefined()
	})

	it("authors layers through visible controls and restores deletion atomically", async () => {
		mountDesign()
		const layerRows = () => [
			...document.querySelectorAll<HTMLElement>(
				'design-layers-tile [data-layer-kind="layer"]',
			),
		]
		const control = (label: string): HTMLButtonElement => {
			const match = [
				...document.querySelectorAll<HTMLButtonElement>(
					"design-layers-tile button",
				),
			].find((button) => button.textContent?.trim() === label)
			if (match === undefined)
				throw new Error(`${label} control was not found.`)
			return match
		}

		expect(control("Delete").disabled).toBe(true)
		await act(async () => {
			control("New layer").click()
			await Promise.resolve()
		})
		expect(layerRows()).toHaveLength(2)
		expect(
			document.querySelector('[data-layer-kind="layer"][aria-current="true"]')
				?.textContent,
		).toContain("Layer 2")

		const name = document.querySelector<HTMLInputElement>(
			"layer-management input",
		)
		if (name === null) throw new Error("Layer name control was not found.")
		act(() => {
			name.value = "Studio"
			name.dispatchEvent(new Event("input", { bubbles: true }))
		})
		await act(async () => {
			name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
			await Promise.resolve()
		})
		expect(
			document.querySelector('[data-layer-kind="layer"][aria-current="true"]')
				?.textContent,
		).toContain("Studio")

		act(() =>
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Hide Studio"]')
				?.click(),
		)
		expect(
			document.querySelector('button[aria-label="Show Studio"]'),
		).not.toBeNull()
		act(() =>
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Lock Studio"]')
				?.click(),
		)
		expect(
			document.querySelector('button[aria-label="Unlock Studio"]'),
		).not.toBeNull()

		await act(async () => {
			control("Duplicate").click()
			await Promise.resolve()
		})
		expect(layerRows()).toHaveLength(3)
		expect(
			document.querySelector('[data-layer-kind="layer"][aria-current="true"]')
				?.textContent,
		).toContain("Studio copy")
		await act(async () => {
			control("Delete").click()
			await Promise.resolve()
		})
		expect(layerRows()).toHaveLength(2)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(layerRows()).toHaveLength(3)
		expect(
			document.querySelector('[data-layer-kind="layer"][aria-current="true"]')
				?.textContent,
		).toContain("Studio copy")
	})

	it("reparents a selected object across layers and restores its exact hierarchy", async () => {
		const initial = createInitialDocument()
		const back = initial.objects[0]!
		const front = initial.objects[1]!
		const layered: DesignDocument = {
			...initial,
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "object", id: back.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					children: [{ kind: "object", id: front.id }],
				},
			],
		}
		const storage = new Map<string, string>()
		mountDesign({ initialDocument: layered }, storage)
		const backRow = document.querySelector<HTMLElement>(
			`[data-tree-key="object:${back.id}"]`,
		)
		if (backRow === null) throw new Error("Back object row was not found.")
		act(() => backRow.click())
		const parent = document.querySelector<HTMLSelectElement>(
			`select[aria-label="Parent for ${back.name}"]`,
		)
		if (parent === null)
			throw new Error("Hierarchy parent control was not found.")
		await act(async () => {
			parent.value = "layer:layer:front"
			parent.dispatchEvent(new Event("change", { bubbles: true }))
			await Promise.resolve()
		})
		const move = [
			...document.querySelectorAll<HTMLButtonElement>(
				`layer-management[aria-label="Move ${back.name}"] button`,
			),
		].find((button) => button.textContent?.trim() === "Move to top")
		if (move === undefined)
			throw new Error("Move to top control was not found.")
		await act(async () => {
			move.click()
			await Promise.resolve()
		})
		const moved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(moved.layers[0]?.children).toEqual([])
		expect(moved.layers[1]?.children).toEqual([
			{ kind: "object", id: front.id },
			{ kind: "object", id: back.id },
		])
		expect(moved.objects.map(({ id }) => id)).toEqual([front.id, back.id])
		expect(moved.objects.find(({ id }) => id === back.id)).toEqual(back)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain(`${back.name} moved into Front`)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		const restored = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(restored.layers).toEqual(layered.layers)
		expect(restored.objects).toEqual(layered.objects)
	})

	it("targets an object's layer and pastes into the subsequently chosen target", async () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const existing = initial.objects[1]!
		const layered: DesignDocument = {
			...initial,
			layers: [
				{
					id: "layer:source",
					name: "Source",
					children: [{ kind: "object", id: source.id }],
				},
				{
					id: "layer:target",
					name: "Target",
					children: [{ kind: "object", id: existing.id }],
				},
				{
					id: "layer:locked-target",
					name: "Locked target",
					locked: true,
					children: [],
				},
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: layered }, storage)
		const layerRow = (name: string): HTMLElement => {
			const row = [
				...document.querySelectorAll<HTMLElement>(
					'design-layers-tile [data-layer-kind="layer"]',
				),
			].find((candidate) => candidate.querySelector("b")?.textContent === name)
			if (row === undefined) throw new Error(`${name} layer row was not found.`)
			return row
		}
		const sourceNode = stage
			.find(".design-object")
			.find((node: { name(): string }) => node.name().includes(source.id))
		const artboard = document.querySelector<HTMLElement>("artboard-wrap")
		if (sourceNode === undefined || artboard === null)
			throw new Error("Source canvas object or artboard was not found.")
		const down = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 407,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(down)
			sourceNode.fire("pointerdown", { evt: down }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 407,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(layerRow("Source").getAttribute("aria-current")).toBe("true")

		const entries = new Map<string, string>()
		const clipboard = {
			getData: (format: string) => entries.get(format) ?? "",
			setData: (format: string, value: string) => entries.set(format, value),
		}
		await act(async () => {
			artboard.dispatchEvent(clipboardEvent("cut", clipboard))
			await Promise.resolve()
		})
		act(() => layerRow("Target").click())
		expect(layerRow("Target").getAttribute("aria-current")).toBe("true")
		const paste = clipboardEvent("paste", clipboard)
		await act(async () => {
			artboard.dispatchEvent(paste)
			await Promise.resolve()
		})
		expect(paste.defaultPrevented).toBe(true)
		const pasted = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(pasted.layers[0]?.children).toEqual([])
		expect(pasted.layers[1]?.children[0]).toEqual({
			kind: "object",
			id: existing.id,
		})
		expect(pasted.layers[1]?.children).toHaveLength(2)

		act(() => layerRow("Locked target").click())
		const beforeRejectedPaste = storage.get(DESIGN_STORAGE_KEY)
		const rejected = clipboardEvent("paste", clipboard)
		act(() => artboard.dispatchEvent(rejected))
		expect(rejected.defaultPrevented).toBe(false)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(beforeRejectedPaste)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Unlock Locked target layer before pasting into it")
	})

	it("creates in the selected object's layer and restores scoped selection through history", async () => {
		const initial = createInitialDocument()
		const backObject = initial.objects[0]!
		const frontObject = initial.objects[1]!
		const layered: DesignDocument = {
			...initial,
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "object", id: backObject.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					children: [{ kind: "object", id: frontObject.id }],
				},
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: layered }, storage)
		const backButton = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(backObject.name))
		const rectangle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Rectangle"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (backButton === undefined || rectangle === null || canvas === null)
			throw new Error("Layer selection or rectangle controls were not found.")
		await act(async () => {
			backButton.click()
			await Promise.resolve()
		})
		act(() => rectangle.click())
		const fire = (type: string, x: number, y: number): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 73,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 360, 280)
			fire("pointermove", 440, 350)
			fire("pointerup", 440, 350)
			await Promise.resolve()
		})
		const saved = storage.get(DESIGN_STORAGE_KEY)
		if (saved === undefined)
			throw new Error("Design document was not persisted.")
		const created = JSON.parse(saved) as DesignDocument
		const createdId = created.objects.find(
			(object) => !initial.objects.some((source) => source.id === object.id),
		)?.id
		if (createdId === undefined) throw new Error("Rectangle was not created.")
		expect(created.layers[0]?.children).toEqual([
			{ kind: "object", id: backObject.id },
			{ kind: "object", id: createdId },
		])
		expect(created.layers[1]?.children).toEqual([
			{ kind: "object", id: frontObject.id },
		])

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(backButton.getAttribute("aria-selected")).toBe("true")
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		const recreatedButton = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Rectangle"))
		expect(recreatedButton?.getAttribute("aria-selected")).toBe("true")
	})

	it("creates, selects, edits, and undoes a live blend through visible controls", () => {
		const initial = createInitialDocument()
		const stage = mountDesign({ initialDocument: initial })
		const layers = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		expect(layers.length).toBeGreaterThanOrEqual(2)
		act(() => {
			layers[0]!.click()
			layers[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
		})
		const make = [
			...document.querySelectorAll<HTMLButtonElement>(
				"design-blend-tile button",
			),
		].find((button) => button.textContent === "Make Blend")
		if (make === undefined) throw new Error("Make Blend was not found.")
		expect(make.disabled).toBe(false)
		act(() => make.click())
		expect(
			document.querySelector(
				'design-layers-tile button[data-layer-kind="blend"][aria-pressed="true"]',
			),
		).not.toBeNull()
		expect(stage.find(".design-object")).toHaveLength(
			initial.objects.length + 5,
		)
		const steps = document.querySelector<HTMLInputElement>(
			'design-blend-tile input[aria-label="Specified steps"]',
		)!
		act(() => {
			steps.focus()
			steps.value = "2"
			steps.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		act(() => {
			steps.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
		})
		expect(stage.find(".design-object")).toHaveLength(
			initial.objects.length + 2,
		)
		act(() =>
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					ctrlKey: true,
					key: "z",
				}),
			),
		)
		expect(stage.find(".design-object")).toHaveLength(
			initial.objects.length + 5,
		)
		expect(
			document.querySelector<HTMLInputElement>(
				'design-blend-tile input[aria-label="Specified steps"]',
			)?.value,
		).toBe("5")
		expect(
			document.querySelector(
				'design-layers-tile button[data-layer-kind="blend"][aria-pressed="true"]',
			),
		).not.toBeNull()
	})

	it("passes the authored fill rule to the canvas path", () => {
		const document = createInitialDocument()
		const first = document.objects[0]!
		const initialDocument: DesignDocument = {
			...document,
			objects: document.objects.map((object) =>
				object.id === first.id
					? {
							...object,
							geometry: {
								kind: "path",
								fillRule: "nonzero",
								contours: [
									{
										id: "contour:fill-rule",
										closed: true,
										points: [
											{ id: "point:fill-rule:0", x: 0, y: 0 },
											{ id: "point:fill-rule:1", x: 20, y: 0 },
											{ id: "point:fill-rule:2", x: 20, y: 20 },
										],
									},
								],
							},
						}
					: object,
			),
		}
		const stage = mountDesign({ initialDocument })
		expect(stage.findOne(".design-object").fillRule()).toBe("nonzero")
	})

	it("waits for a positive viewport before rendering the existing scene", () => {
		const stageCount = Konva.stages.length
		const stage = mountDesign({}, new Map(), {
			deferred: true,
			capture: (callback) => {
				expect(Konva.stages).toHaveLength(stageCount)
				callback(
					[
						{
							contentRect: { width: 960, height: 720 },
						} as ResizeObserverEntry,
					],
					{} as ResizeObserver,
				)
			},
		})
		if (stage === undefined) throw new Error("Design stage did not mount.")
		expect(stage.width()).toBe(960)
		expect(stage.height()).toBe(720)
		expect(stage.find(".design-paper")).toHaveLength(1)
		expect(stage.find(".design-object").length).toBeGreaterThan(0)
	})

	it("composes source identity, commands, contextual Help, and one live status path", async () => {
		const session = sourceSession({ displayName: "campaign-poster" })
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		const identity = document.querySelector("project-identity")
		expect(identity?.textContent).toContain("campaign-poster")
		expect(identity?.textContent).not.toContain("proof of concept")
		expect(document.querySelector("canvas-meta")).toBeNull()
		expect(document.querySelector("canvas-hint")).toBeNull()

		const selectionStatus = document.getElementById("design-selection-status")
		expect(selectionStatus?.hasAttribute("data-screen-reader")).toBe(true)
		expect(selectionStatus?.hasAttribute("aria-live")).toBe(false)
		expect(
			document.querySelector("artboard-wrap")?.getAttribute("aria-describedby"),
		).toBe("design-selection-status")
		expect(document.querySelectorAll('footer [role="status"]')).toHaveLength(1)
		expect(
			document.querySelectorAll(
				'action-hotbar[data-hotbar-kind="primary"] > hotbar-slot',
			),
		).toHaveLength(12)
		const firstLayer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		if (firstLayer === null) throw new Error("A design layer was not found.")
		act(() => firstLayer.click())
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("1 object selected")
		act(() =>
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					code: "Digit2",
					key: "2",
				}),
			),
		)
		expect(
			document
				.querySelector('action-hotbar button[aria-label="Direct Selection"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")
		act(() =>
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					code: "Digit1",
					key: "1",
				}),
			),
		)

		const command = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (command === null) throw new Error("Command center was not found.")
		expect(command.getAttribute("aria-keyshortcuts")).toBe(
			"Meta+Shift+P Control+Shift+P",
		)
		act(() => command.click())
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		await act(async () => {
			search.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
		})
		expect(document.activeElement).toBe(command)

		const help = document.querySelector<HTMLButtonElement>(
			'button[aria-controls="design-contextual-help"]',
		)
		if (help === null) throw new Error("Canvas Help was not found.")
		expect(help.textContent).toContain("Select help")
		act(() => help.click())
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"Drag objects to move",
		)
		const close = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Close Help"]',
		)
		if (close === null) throw new Error("Close Help was not found.")
		await act(async () => {
			close.click()
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
		})
		expect(document.querySelector("canvas-help")).toBeNull()
		expect(document.activeElement).toBe(help)
	})

	it("exposes the complete workspace action audit through the command palette", async () => {
		const storage = new Map<string, string>()
		const initialDocument = createInitialDocument()
		mountDesign({ initialDocument }, storage)
		const openPalette = (): void => {
			const opener = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Open Command Palette"]',
			)
			if (opener === null) throw new Error("Command center was not found.")
			act(() => opener.click())
		}
		const command = (id: string): HTMLButtonElement => {
			const element = document.getElementById(`command-${id}`)
			if (!(element instanceof HTMLButtonElement))
				throw new Error(`Command ${id} was not found.`)
			return element
		}

		openPalette()
		for (const id of [
			"artboard-create",
			"artboard-duplicate",
			"artboard-delete",
			"artboard-move-up",
			"artboard-move-down",
			"canvas-focus-active-artboard",
			"canvas-fit-all-artboards",
			"layer-create",
			"layer-duplicate",
			"layer-move-up",
			"layer-move-down",
			"layer-delete",
			"export-png",
			"appearance-target-fill",
			"appearance-target-stroke",
			"appearance-swap-fill-stroke",
			"guide-toggle-lock",
			"guide-delete",
			"deselect-all",
			"pen-finish-open",
			"pen-finish-closed",
			"pathfinder-cancel",
		])
			expect(command(id)).toBeDefined()
		expect(command("artboard-delete").getAttribute("aria-disabled")).toBe(
			"true",
		)
		expect(command("guide-delete").textContent).toContain(
			"Select a guide first.",
		)

		await act(async () => {
			command("artboard-create").click()
			await Promise.resolve()
		})
		expect(
			(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}") as DesignDocument)
				.artboards,
		).toHaveLength(initialDocument.artboards.length + 1)

		openPalette()
		await act(async () => {
			command("layer-create").click()
			await Promise.resolve()
		})
		expect(
			(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}") as DesignDocument)
				.layers,
		).toHaveLength(initialDocument.layers.length + 1)

		openPalette()
		act(() => command("appearance-target-stroke").click())
		openPalette()
		expect(
			command("appearance-target-stroke").getAttribute("aria-checked"),
		).toBe("true")
	})

	it("renders eight screen-stable transform handles with axis cursors and discoverable help", async () => {
		const stage = mountDesign()
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
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

		const handleNames = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
		expect(
			stage.find(".transform-handle").map((handle: { name: () => string }) =>
				handle
					.name()
					.split(" ")
					.find((name: string) => name.startsWith("transform-handle-"))
					?.replace("transform-handle-", ""),
			),
		).toEqual(handleNames)
		const positions = Object.fromEntries(
			handleNames.map((name) => [
				name,
				stage.findOne(`.transform-handle-${name}`).position(),
			]),
		)
		expect(positions).toEqual({
			nw: { x: 82, y: 102 },
			n: { x: 222, y: 102 },
			ne: { x: 362, y: 102 },
			e: { x: 362, y: 222 },
			se: { x: 362, y: 342 },
			s: { x: 222, y: 342 },
			sw: { x: 82, y: 342 },
			w: { x: 82, y: 222 },
		})

		const screenWidth = (name: string) => {
			const handle = stage.findOne(`.transform-handle-${name}`)
			return handle.width() * handle.getAbsoluteScale().x
		}
		const screenStrokeWidth = (name: string) => {
			const node = stage.findOne(name)
			return node.strokeWidth() * node.getAbsoluteScale().x
		}
		for (const name of handleNames) expect(screenWidth(name)).toBeCloseTo(10)
		const objectPath = stage.findOne(".design-object")
		const selectionPath = stage.findOne(".vector-contour-selection")
		expect(selectionPath).not.toBe(objectPath)
		expect(selectionPath.listening()).toBe(false)
		expect(selectionPath.getZIndex()).toBeGreaterThan(objectPath.getZIndex())
		expect(screenStrokeWidth(".transform-selection-box")).toBeCloseTo(1)
		expect(screenStrokeWidth(".vector-contour-selection")).toBeCloseTo(1)
		expect(screenStrokeWidth(".design-artboard-border")).toBeCloseTo(1)

		const cursorByHandle = {
			nw: "nwse-resize",
			n: "ns-resize",
			ne: "nesw-resize",
			e: "ew-resize",
			se: "nwse-resize",
			s: "ns-resize",
			sw: "nesw-resize",
			w: "ew-resize",
		} as const
		for (const [name, cursor] of Object.entries(cursorByHandle)) {
			act(() => stage.findOne(`.transform-handle-${name}`).fire("mouseenter"))
			expect(stage.container().style.cursor).toBe(cursor)
			act(() => stage.findOne(`.transform-handle-${name}`).fire("mouseleave"))
		}
		act(() => stage.findOne(".transform-rotation").fire("mouseenter"))
		expect(stage.container().style.cursor).toBe("grab")

		vi.spyOn(stage, "getPointerPosition").mockReturnValue({ x: 480, y: 360 })
		await act(async () => {
			stage.fire("wheel", {
				evt: {
					altKey: false,
					ctrlKey: true,
					deltaX: 0,
					deltaY: -300,
					metaKey: false,
					preventDefault: vi.fn(),
					shiftKey: false,
				},
			})
			await Promise.resolve()
		})
		for (const name of handleNames) expect(screenWidth(name)).toBeCloseTo(10)
		expect(screenStrokeWidth(".transform-selection-box")).toBeCloseTo(1)
		expect(screenStrokeWidth(".vector-contour-selection")).toBeCloseTo(1)
		expect(screenStrokeWidth(".design-artboard-border")).toBeCloseTo(1)

		const help = document.querySelector<HTMLButtonElement>(
			'button[aria-controls="design-contextual-help"]',
		)
		if (help === null) throw new Error("Canvas Help was not found.")
		act(() => help.click())
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"side handles to resize one axis",
		)
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"numeric Transform controls for keyboard access",
		)
	})

	it("activates Perspective without a selection and reuses click-toggle selection before showing its cage", async () => {
		const stage = mountDesign()
		const perspective = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Perspective Transform"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (perspective === null || canvas === null)
			throw new Error("Perspective selection controls were not found.")
		expect(perspective.disabled).toBe(false)
		act(() => perspective.click())
		expect(perspective.getAttribute("aria-pressed")).toBe("true")
		expect(stage.find(".perspective-handle")).toHaveLength(0)

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
		const object = (id: string) => {
			const node = stage
				.find(".design-object")
				.find((candidate: { name(): string }) => candidate.name().includes(id))
			if (node === undefined) throw new Error(`${id} was not rendered.`)
			return node
		}
		const clickObject = async (
			id: string,
			pointerId: number,
			shiftKey = false,
		): Promise<void> => {
			const node = object(id)
			const rect = node.getClientRect()
			const point = {
				x: rect.x + rect.width / 2,
				y: rect.y + rect.height / 2,
			}
			const down = new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX: point.x,
				clientY: point.y,
				isPrimary: true,
				pointerId,
				pointerType: "mouse",
				shiftKey,
			})
			Object.defineProperty(down, "currentTarget", { value: canvas })
			await act(async () => {
				stage.setPointersPositions(down)
				node.fire("pointerdown", { evt: down }, true)
				stage.fire(
					"pointerup",
					{
						evt: new PointerEvent("pointerup", {
							bubbles: true,
							button: 0,
							clientX: point.x,
							clientY: point.y,
							pointerId,
							pointerType: "mouse",
							shiftKey,
						}),
					},
					true,
				)
				await Promise.resolve()
			})
		}
		const selectedNames = () =>
			[
				...document.querySelectorAll<HTMLButtonElement>(
					'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
				),
			].map((button) => button.textContent)

		await clickObject("object:coral", 301)
		expect(selectedNames()).toHaveLength(1)
		expect(selectedNames()[0]).toContain("Coral rectangle")
		expect(stage.find(".perspective-handle")).toHaveLength(8)

		await clickObject("object:cyan", 302, true)
		expect(selectedNames()).toHaveLength(2)
		expect(stage.find(".perspective-handle")).toHaveLength(8)

		await clickObject("object:coral", 303, true)
		expect(selectedNames()).toHaveLength(1)
		expect(selectedNames()[0]).toContain("Cyan ellipse")
		expect(stage.find(".perspective-handle")).toHaveLength(8)

		const cursorByHandle = {
			nw: "nwse-resize",
			n: "ew-resize",
			ne: "nesw-resize",
			e: "ns-resize",
			se: "nwse-resize",
			s: "ew-resize",
			sw: "nesw-resize",
			w: "ns-resize",
		} as const
		for (const [name, cursor] of Object.entries(cursorByHandle)) {
			act(() => stage.findOne(`.perspective-handle-${name}`).fire("mouseenter"))
			expect(stage.container().style.cursor).toBe(cursor)
			act(() => stage.findOne(`.perspective-handle-${name}`).fire("mouseleave"))
		}
	})

	it("marquee-selects artwork with Perspective and reveals the eligible cage", async () => {
		const stage = mountDesign()
		const perspective = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Perspective Transform"]',
		)
		const canvas = stage.container().querySelector("canvas")
		const objects = stage.find(".design-object")
		if (perspective === null || canvas === null || objects.length < 2)
			throw new Error("Perspective marquee controls were not found.")
		act(() => perspective.click())
		const rects = objects.map((object: { getClientRect(): DOMRect }) =>
			object.getClientRect(),
		)
		const start = {
			x: Math.min(...rects.map(({ x }) => x)) - 20,
			y: Math.min(...rects.map(({ y }) => y)) - 20,
		}
		const end = {
			x: Math.max(...rects.map(({ x, width }) => x + width)) + 20,
			y: Math.max(...rects.map(({ y, height }) => y + height)) + 20,
		}
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: start.x,
					clientY: start.y,
					pointerId: 304,
					pointerType: "mouse",
				}),
			)
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: end.x,
					clientY: end.y,
					pointerId: 304,
					pointerType: "mouse",
				}),
			)
			canvas.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					clientX: end.x,
					clientY: end.y,
					pointerId: 304,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		expect(
			document.querySelectorAll(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		).toHaveLength(2)
		expect(stage.find(".perspective-handle")).toHaveLength(8)
	})

	it("latches live Perspective corner acquisition across Shift boundary crossings", async () => {
		const stage = mountDesign()
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		const perspective = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Perspective Transform"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (layer === undefined || perspective === null || canvas === null)
			throw new Error("Perspective corner controls were not found.")
		act(() => {
			layer.click()
			perspective.click()
		})
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
		let pointer = { x: 0, y: 0 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const corners = ["nw", "ne", "se", "sw"] as const
		const horizontalNeighbor = { nw: "ne", ne: "nw", se: "sw", sw: "se" }
		const verticalNeighbor = { nw: "sw", ne: "se", se: "ne", sw: "nw" }
		const cornerPosition = (name: (typeof corners)[number]) =>
			stage.findOne(`.perspective-handle-${name}`).position()
		const startGesture = (
			handleName: (typeof corners)[number],
			pointerId: number,
			shiftKey: boolean,
		) => {
			const handle = stage.findOne(`.perspective-handle-${handleName}`)
			pointer = handle.getAbsolutePosition()
			const down = new PointerEvent("pointerdown", {
				altKey: true,
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX: pointer.x,
				clientY: pointer.y,
				isPrimary: true,
				pointerId,
				pointerType: "mouse",
				shiftKey,
			})
			Object.defineProperty(down, "currentTarget", { value: canvas })
			handle.fire("pointerdown", { evt: down }, true)
			return { ...pointer }
		}
		const moveGesture = (
			origin: { x: number; y: number },
			delta: { x: number; y: number },
			pointerId: number,
			shiftKey: boolean,
		) => {
			pointer = { x: origin.x + delta.x, y: origin.y + delta.y }
			stage.fire(
				"pointermove",
				{
					evt: new PointerEvent("pointermove", {
						altKey: true,
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: pointer.x,
						clientY: pointer.y,
						isPrimary: true,
						pointerId,
						pointerType: "mouse",
						shiftKey,
					}),
				},
				true,
			)
		}
		const pressShift = (shiftKey: boolean) =>
			window.dispatchEvent(
				new KeyboardEvent(shiftKey ? "keydown" : "keyup", {
					altKey: true,
					bubbles: true,
					key: "Shift",
					shiftKey,
				}),
			)
		const cancelGesture = () =>
			window.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)

		let pointerId = 400
		for (const handleName of corners) {
			for (const initialChoice of ["horizontal", "vertical"] as const) {
				const source = Object.fromEntries(
					corners.map((name) => [name, { ...cornerPosition(name) }]),
				) as Record<(typeof corners)[number], { x: number; y: number }>
				const chosen = (
					initialChoice === "horizontal" ? horizontalNeighbor : verticalNeighbor
				)[handleName]
				const reacquired = (
					initialChoice === "horizontal" ? verticalNeighbor : horizontalNeighbor
				)[handleName]
				const initial =
					initialChoice === "horizontal" ? { x: 80, y: 10 } : { x: 10, y: 80 }
				const crossed =
					initialChoice === "horizontal" ? { x: 30, y: 100 } : { x: 100, y: 30 }
				let origin = { x: 0, y: 0 }
				await act(async () => {
					origin = startGesture(handleName, pointerId, false)
					moveGesture(origin, initial, pointerId, false)
					pressShift(true)
					moveGesture(origin, crossed, pointerId, true)
					await Promise.resolve()
				})
				const latched = cornerPosition(chosen)
				const untouched = cornerPosition(reacquired)
				if (initialChoice === "horizontal") {
					expect(latched.x).not.toBeCloseTo(source[chosen].x)
					expect(latched.y).toBeCloseTo(source[chosen].y)
				} else {
					expect(latched.x).toBeCloseTo(source[chosen].x)
					expect(latched.y).not.toBeCloseTo(source[chosen].y)
				}
				expect(untouched).toEqual(source[reacquired])

				await act(async () => {
					pressShift(false)
					await Promise.resolve()
				})
				expect(cornerPosition(chosen)).toEqual(source[chosen])
				const resumed = cornerPosition(reacquired)
				expect(resumed).not.toEqual(source[reacquired])
				await act(async () => {
					cancelGesture()
					await Promise.resolve()
				})
				pointerId += 1
			}
		}

		const source = Object.fromEntries(
			corners.map((name) => [name, { ...cornerPosition(name) }]),
		) as Record<(typeof corners)[number], { x: number; y: number }>
		let origin = { x: 0, y: 0 }
		await act(async () => {
			origin = startGesture("nw", pointerId, true)
			moveGesture(origin, { x: 10, y: 80 }, pointerId, true)
			moveGesture(origin, { x: 100, y: 30 }, pointerId, true)
			await Promise.resolve()
		})
		expect(cornerPosition("sw").x).toBeCloseTo(source.sw.x)
		expect(cornerPosition("sw").y).not.toBeCloseTo(source.sw.y)
		expect(cornerPosition("ne")).toEqual(source.ne)
		await act(async () => {
			pressShift(false)
			await Promise.resolve()
		})
		expect(cornerPosition("sw")).toEqual(source.sw)
		expect(cornerPosition("ne")).not.toEqual(source.ne)
		act(() => {
			cancelGesture()
		})
	})

	it("runs large partition Pathfinder commands off-thread with progress, cancellation, and stale-result protection", async () => {
		const base = createInitialDocument()
		const template = base.objects[0]!
		const initialDocument: DesignDocument = {
			...base,
			objects: Array.from({ length: 24 }, (_, index) => ({
				...template,
				id: `object:large:${index}`,
				name: `Large piece ${index + 1}`,
				transform: {
					...template.transform,
					e: (index % 6) * 12,
					f: Math.floor(index / 6) * 12,
				},
			})),
			layers: base.layers.map((layer) => ({
				...layer,
				children: Array.from({ length: 24 }, (_, index) => ({
					kind: "object" as const,
					id: `object:large:${index}`,
				})),
			})),
		}
		const worker = new DeferredPathfinderWorkerClient()
		mountDesign({ initialDocument, pathfinderWorkerClient: worker })

		const selectAll = async (): Promise<void> => {
			await act(async () => {
				window.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						ctrlKey: true,
						key: "a",
					}),
				)
				await Promise.resolve()
			})
		}
		const openDivide = async (): Promise<void> => {
			const opener = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Open Command Palette"]',
			)
			if (opener === null) throw new Error("Command center was not found.")
			act(() => opener.click())
			const search = document.querySelector<HTMLInputElement>(
				'input[aria-label="Search commands"]',
			)
			if (search === null) throw new Error("Command search was not found.")
			await act(async () => {
				search.value = "Pathfinder: Divide"
				search.dispatchEvent(new InputEvent("input", { bubbles: true }))
				await Promise.resolve()
			})
		}
		const executeDivide = async (): Promise<void> => {
			await openDivide()
			const option = document.getElementById("command-pathfinder-divide")
			if (!(option instanceof HTMLButtonElement))
				throw new Error("Divide command was not found.")
			await act(async () => {
				option.click()
				await Promise.resolve()
			})
		}

		await selectAll()
		await executeDivide()
		expect(worker.runs).toHaveLength(1)
		expect(worker.runs[0]?.input.context.scopeGroupId).toBeNull()
		await act(async () => {
			worker.runs[0]?.onProgress({
				completedRegions: 8,
				phase: "partitioning",
				pieceCount: 31,
				totalRegions: 24,
			})
			await Promise.resolve()
		})
		const progress = document.querySelector<HTMLElement>(
			"footer [data-pathfinder-progress]",
		)
		expect(progress?.textContent).toContain("Divide: partitioning")
		expect(progress?.querySelector("progress")?.value).toBe(8)

		await openDivide()
		expect(
			document
				.getElementById("command-pathfinder-divide")
				?.getAttribute("aria-disabled"),
		).toBe("true")
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		act(() => {
			search.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
		})
		const cancel = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Cancel Divide"]',
		)
		if (cancel === null) throw new Error("Pathfinder cancel was not found.")
		await act(async () => {
			cancel.click()
			await Promise.resolve()
		})
		expect(worker.runs[0]?.cancel).toHaveBeenCalledOnce()
		expect(
			document.querySelector("[data-footer-counts]")?.textContent,
		).toContain("24 objects")
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("document was not changed")

		await executeDivide()
		expect(worker.runs).toHaveLength(2)
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		await act(async () => {
			title.value = "Edited while Pathfinder runs"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const staleDocument = {
			...worker.runs[1]!.input.context.document,
			objects: [],
			title: "Stale worker result",
		}
		await act(async () => {
			worker.runs[1]?.resolve({
				result: {
					directSelection: [],
					document: staleDocument,
					message: "Divided stale paths.",
					objectSelection: [],
					ok: true,
				},
				status: "completed",
			})
			await Promise.resolve()
		})
		expect(title.value).toBe("Edited while Pathfinder runs")
		expect(
			document.querySelector("[data-footer-counts]")?.textContent,
		).toContain("24 objects")
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("result was discarded")
	})

	it("enters nested groups on the mounted double-click sequence without moving them", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const third = {
			...first,
			id: "object:third",
			name: "Third object",
			transform: { ...first.transform, e: first.transform.e + 360 },
		}
		const expanded = {
			...base,
			objects: [...base.objects, third],
			layers: base.layers.map((layer) => ({
				...layer,
				children: [...base.objects, third].map(({ id }) => ({
					kind: "object" as const,
					id,
				})),
			})),
		}
		const inner = groupDesignSelection(
			expanded,
			base.objects.map(({ id }) => id),
			() => "inner",
		)
		if (inner === null) throw new Error("Inner fixture group was not created.")
		const outer = groupDesignSelection(
			inner.document,
			[...inner.selection, third.id],
			() => "outer",
		)
		if (outer === null) throw new Error("Outer fixture group was not created.")
		const source = outer.document
		const storage = new Map<string, string>()
		const worker = new DeferredPathfinderWorkerClient()
		const stage = mountDesign(
			{ initialDocument: source, pathfinderWorkerClient: worker },
			storage,
		)
		const persistedSource = storage.get(DESIGN_STORAGE_KEY)
		if (persistedSource === undefined)
			throw new Error("Initial grouped document was not persisted.")
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
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
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const objectNode = (id: string) => {
			const node = stage
				.find(".design-object")
				.find((candidate: { name(): string }) => candidate.name().includes(id))
			if (node === undefined) throw new Error(`${id} was not rendered.`)
			return node
		}
		const firePointer = (
			id: string,
			type: "pointerdown" | "pointermove" | "pointerup",
			next: { x: number; y: number },
		) => {
			pointer = next
			objectNode(id).fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: next.x,
						clientY: next.y,
						isPrimary: true,
						pointerId: 17,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		const click = async (id: string, at = pointer) => {
			await act(async () => {
				firePointer(id, "pointerdown", at)
				firePointer(id, "pointerup", at)
				objectNode(id).fire(
					"click",
					{ evt: new MouseEvent("click", { bubbles: true, detail: 1 }) },
					true,
				)
				await Promise.resolve()
			})
		}
		const finishDoubleClick = async (id: string, at = pointer) => {
			await act(async () => {
				firePointer(id, "pointerdown", { x: at.x + 1, y: at.y + 1 })
				firePointer(id, "pointermove", { x: at.x + 3, y: at.y + 2 })
				firePointer(id, "pointerup", { x: at.x + 3, y: at.y + 2 })
				objectNode(id).fire(
					"click",
					{ evt: new MouseEvent("click", { bubbles: true, detail: 2 }) },
					true,
				)
				objectNode(id).fire(
					"dblclick",
					{ evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }) },
					true,
				)
				await Promise.resolve()
			})
		}
		const doubleClick = async (id: string, at = pointer) => {
			await click(id, at)
			await finishDoubleClick(id, at)
		}
		const groupLabel = () =>
			stage.findOne(".design-group-selection-label")?.text() ?? null

		await doubleClick(first.id)
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"Editing inside Group 2",
		)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)

		await click(third.id, { x: 620, y: 220 })
		expect(groupLabel()).toBe(null)
		await click(first.id, { x: 260, y: 220 })
		expect(groupLabel()).toBe("Group 1 · 2 objects")

		await finishDoubleClick(first.id, { x: 260, y: 220 })
		expect(groupLabel()).toBe(null)
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"Editing inside Group 1",
		)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					ctrlKey: true,
					key: "a",
				}),
			)
			await Promise.resolve()
		})

		const commandCenter = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (commandCenter === null) throw new Error("Command center was not found.")
		act(() => commandCenter.click())
		const commandSearch = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (commandSearch === null) throw new Error("Command search was not found.")
		await act(async () => {
			commandSearch.value = "Pathfinder: Divide"
			commandSearch.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const divide = document.getElementById("command-pathfinder-divide")
		if (!(divide instanceof HTMLButtonElement))
			throw new Error("Divide command was not found.")
		await act(async () => {
			divide.click()
			await Promise.resolve()
		})
		expect(worker.runs[0]?.input.context.scopeGroupId).toBe("group:inner")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		await act(async () => {
			worker.runs[0]?.resolve({
				result: {
					directSelection: [],
					document: { ...source, objects: [] },
					message: "Divided stale scope.",
					objectSelection: [],
					ok: true,
				},
				status: "completed",
			})
			await Promise.resolve()
		})
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("editing scope changed")
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)
		await doubleClick(first.id)
		expect(groupLabel()).toBe(null)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(persistedSource)

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 1 · 2 objects")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(groupLabel()).toBe("Group 2 · 3 objects")

		const before = source.objects.map(({ transform }) => ({
			x: transform.e,
			y: transform.f,
		}))
		await act(async () => {
			firePointer(first.id, "pointerdown", { x: 260, y: 220 })
			firePointer(first.id, "pointermove", { x: 300, y: 245 })
			firePointer(first.id, "pointerup", { x: 300, y: 245 })
			await Promise.resolve()
		})
		const moved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const deltas = moved.objects.map(({ transform }, index) => ({
			x: transform.e - before[index]!.x,
			y: transform.f - before[index]!.y,
		}))
		expect(deltas[0]?.x).not.toBe(0)
		expect(deltas.every((delta) => delta.x === deltas[0]!.x)).toBe(true)
		expect(deltas.every((delta) => delta.y === deltas[0]!.y)).toBe(true)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
	})

	it("previews Alt/Option copy-drag live and commits it as one history entry", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
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
		const sourceObject = source.objects[0]!
		const node = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(sourceObject.id),
			)
		if (node === undefined)
			throw new Error("Source design object was not found.")
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: { x: number; y: number },
			altKey: boolean,
		): void => {
			pointer = at
			node.fire(
				type,
				{
					evt: new PointerEvent(type, {
						altKey,
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: at.x,
						clientY: at.y,
						isPrimary: true,
						pointerId: 41,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}

		await act(async () => {
			fire("pointerdown", pointer, false)
			fire("pointermove", { x: 330, y: 275 }, false)
			await Promise.resolve()
		})
		expect(stage.find(".design-object")).toHaveLength(source.objects.length)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { altKey: true, key: "Alt" }),
			)
			await Promise.resolve()
		})
		expect(stage.find(".design-object")).toHaveLength(source.objects.length + 1)
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
			await Promise.resolve()
		})
		expect(stage.find(".design-object")).toHaveLength(source.objects.length)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { altKey: true, key: "Alt" }),
			)
			fire("pointerup", pointer, true)
			await Promise.resolve()
		})

		const copied = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(copied.objects).toHaveLength(source.objects.length + 1)
		expect(copied.objects[0]).toEqual(source.objects[0])
		expect(copied.objects.at(-1)).toEqual(source.objects.at(-1))
		const duplicate = copied.objects.find(
			(object) => !source.objects.some(({ id }) => id === object.id),
		)
		expect(duplicate).toBeDefined()
		expect(duplicate?.transform.e).not.toBe(sourceObject.transform.e)
		expect(duplicate?.transform.f).not.toBe(sourceObject.transform.f)
		expect(
			document.querySelector(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			)?.textContent,
		).toContain(sourceObject.name)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Alt/Option-drag")

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					ctrlKey: true,
					key: "z",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(
			(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}") as DesignDocument)
				.objects,
		).toHaveLength(source.objects.length + 1)

		const help = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Help for the Select tool"]',
		)
		if (help === null) throw new Error("Select help was not found.")
		act(() => help.click())
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"Alt/Option-drag to copy",
		)
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"Ctrl+D duplicates with offset",
		)
	})

	it("does not copy on Alt-click, Escape, or pointer cancellation and preserves ordinary drag", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
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
		const sourceObject = source.objects[0]!
		const node = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(sourceObject.id),
			)
		const canvas = stage.container().querySelector("canvas")
		if (node === undefined || canvas === null)
			throw new Error("Design object gesture target was not found.")
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: { x: number; y: number },
			altKey: boolean,
			pointerId: number,
		): void => {
			pointer = at
			node.fire(
				type,
				{
					evt: new PointerEvent(type, {
						altKey,
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: at.x,
						clientY: at.y,
						isPrimary: true,
						pointerId,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}

		await act(async () => {
			fire("pointerdown", pointer, true, 51)
			fire("pointerup", pointer, true, 51)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)

		await act(async () => {
			fire("pointerdown", pointer, true, 52)
			fire("pointermove", { x: 330, y: 270 }, true, 52)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			fire("pointerup", pointer, true, 52)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		expect(stage.find(".design-object")).toHaveLength(source.objects.length)
		expect(
			document.querySelector(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		).not.toBeNull()

		await act(async () => {
			fire("pointerdown", pointer, true, 53)
			fire("pointermove", { x: 350, y: 300 }, true, 53)
			canvas.dispatchEvent(
				new PointerEvent("pointercancel", {
					bubbles: true,
					pointerId: 53,
					pointerType: "mouse",
				}),
			)
			fire("pointerup", pointer, true, 53)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)

		await act(async () => {
			fire("pointerdown", pointer, false, 54)
			fire("pointermove", { x: 390, y: 315 }, false, 54)
			fire("pointerup", pointer, false, 54)
			await Promise.resolve()
		})
		const moved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(moved.objects).toHaveLength(source.objects.length)
		expect(moved.objects[0]?.transform).not.toEqual(sourceObject.transform)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
	})

	it("Alt/Option-drags a complete selected group with cloned hierarchy", async () => {
		const base = createInitialDocument()
		const grouped = groupDesignSelection(
			base,
			base.objects.map(({ id }) => id),
			() => "source-group",
		)
		if (grouped === null) throw new Error("Group fixture was not created.")
		const source = grouped.document
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
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
		const first = source.objects[0]!
		const node = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(first.id),
			)
		if (node === undefined) throw new Error("Grouped object was not rendered.")
		let pointer = { x: 260, y: 220 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: { x: number; y: number },
		): void => {
			pointer = at
			node.fire(
				type,
				{
					evt: new PointerEvent(type, {
						altKey: true,
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: at.x,
						clientY: at.y,
						isPrimary: true,
						pointerId: 61,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		await act(async () => {
			fire("pointerdown", pointer)
			fire("pointermove", { x: 340, y: 280 })
			fire("pointerup", pointer)
			await Promise.resolve()
		})

		const copied = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(copied.objects).toHaveLength(source.objects.length * 2)
		expect(copied.objects.slice(0, source.objects.length)).toEqual(
			source.objects,
		)
		expect(copied.groups).toHaveLength(2)
		expect(copied.groups?.[1]?.id).not.toBe(source.groups?.[0]?.id)
		expect(copied.groups?.[1]?.children).toHaveLength(
			source.groups?.[0]?.children.length ?? 0,
		)
		expect(stage.findOne(".design-group-selection-label")?.text()).toContain(
			"2 objects",
		)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
	})

	function sourceSession(
		overrides: Partial<DesignSourceSession> = {},
	): DesignSourceSession {
		const initialDocument = createInitialDocument()
		const fonts = overrides.fonts ?? []
		return {
			initialDocument,
			initialRevision: "source:one",
			fonts,
			reload: vi.fn(async () => ({
				ok: true as const,
				document: initialDocument,
				fonts,
				revision: "source:one",
			})),
			save: vi.fn(async () => ({ revision: "source:two" })),
			subscribeDocument: vi.fn(() => () => undefined),
			subscribeStatus: vi.fn(() => () => undefined),
			...overrides,
		}
	}

	it("refreshes linked artboards without replacing selection or authored history", async () => {
		let publishLinks:
			| ((
					resources: readonly import("@create-design/source").DesignLinkedArtboardResource[],
			  ) => void)
			| undefined
		const source = createInitialDocument()
		const session = sourceSession({
			linkedArtboards: [
				{ projectId: "source", revision: "one", document: source },
			],
			subscribeLinkedArtboards(listener) {
				publishLinks = listener
				return () => undefined
			},
		})
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
		})
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "a",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toContain("2 objects selected")
		await act(async () => {
			publishLinks?.([
				{
					projectId: "source",
					revision: "two",
					document: {
						...source,
						title: "Externally updated source",
					},
				},
			])
			await Promise.resolve()
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toContain("2 objects selected")
	})

	it("keeps every Type entry point inert when the workspace has no fonts", async () => {
		const storage = new Map<string, string>()
		const session = sourceSession({ fonts: [] })
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const pointType = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Type"]',
		)
		const areaType = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Area Type"]',
		)
		if (pointType === null || areaType === null)
			throw new Error("Type tools were not found.")
		expect(pointType.disabled).toBe(true)
		expect(areaType.disabled).toBe(true)
		expect(pointType.title).toContain("Add an OpenType font")
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "t" }),
			)
			await Promise.resolve()
		})
		expect(session.save).not.toHaveBeenCalled()
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(document.querySelector("persistence-alert")).toBeNull()
		expect(
			document.querySelector("textarea[data-design-text-editor]"),
		).toBeNull()
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("Add an OpenType font")

		act(() =>
			document
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Open Command Palette"]',
				)
				?.click(),
		)
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		act(() => {
			search.value = "Type"
			search.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		expect(
			document
				.getElementById("command-tool-text")
				?.getAttribute("aria-disabled"),
		).toBe("true")
	})

	it("reports a workspace font promotion failure without enabling Type", async () => {
		const installFont = vi.fn(async () => {
			throw new Error("Asset inventory metadata does not match the font.")
		})
		const session = sourceSession({ fonts: [], installFont })
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(() => null),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 0, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
			textService,
		})
		const upload = document.querySelector<HTMLInputElement>(
			'input[aria-label="Add OpenType font to workspace"]',
		)
		if (upload === null) throw new Error("Font upload input was not found.")
		const file = new File([new Uint8Array([79, 84, 84, 79])], "Broken.otf", {
			type: "font/otf",
		})
		Object.defineProperty(upload, "files", {
			configurable: true,
			value: [file],
		})
		await act(async () => {
			upload.dispatchEvent(new Event("change", { bubbles: true }))
			await vi.waitFor(() => expect(installFont).toHaveBeenCalledOnce())
		})

		expect(textService.unregisterFont).toHaveBeenCalledWith("font:broken")
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain(
			"Could not add Broken.otf to the workspace: Asset inventory metadata does not match the font.",
		)
		expect(
			document.querySelector<HTMLButtonElement>('button[aria-label="Type"]')
				?.disabled,
		).toBe(true)
		expect(session.save).not.toHaveBeenCalled()
		expect(document.querySelector("persistence-alert")).toBeNull()
	})

	it("loads a promoted workspace font into the browser and permanent combobox", async () => {
		const faces: Array<{
			descriptors: FontFaceDescriptors | undefined
			family: string
			load: ReturnType<typeof vi.fn>
			source: ArrayBuffer
		}> = []
		const TestFontFace = class {
			readonly descriptors: FontFaceDescriptors | undefined
			readonly family: string
			readonly source: ArrayBuffer
			readonly load = vi.fn(async () => this)
			constructor(
				family: string,
				source: ArrayBuffer,
				descriptors?: FontFaceDescriptors,
			) {
				this.descriptors = descriptors
				this.family = family
				this.source = source
				faces.push(this)
			}
		}
		vi.stubGlobal("FontFace", TestFontFace)
		Object.defineProperty(window, "FontFace", {
			configurable: true,
			value: TestFontFace,
		})
		const fontSet = {
			add: vi.fn(),
			check: vi.fn((declaration: string, text: string) => {
				const face = faces.at(-1)
				return (
					fontSet.add.mock.calls.some(([candidate]) => candidate === face) &&
					declaration ===
						`1px ${designTextCssFontFamily(face?.family ?? "missing")}` &&
					text === "Hamburgefontsiv"
				)
			}),
			delete: vi.fn(() => true),
		}
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: fontSet,
		})
		expect(typeof FontFace).toBe("function")
		expect(document.fonts).toBe(fontSet)
		const installed = {
			id: "font:workspace-browser",
			family: "Workspace Browser",
			revision: "sha256:persisted",
		}
		const session = sourceSession({
			fonts: [],
			installFont: vi.fn(async () => installed),
		})
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const stage = mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
			textService,
		})
		const upload = document.querySelector<HTMLInputElement>(
			'input[aria-label="Add OpenType font to workspace"]',
		)
		if (upload === null) throw new Error("Font upload input was not found.")
		const bytes = new Uint8Array([79, 84, 84, 79, 1, 2, 3])
		Object.defineProperty(upload, "files", {
			configurable: true,
			value: [new File([bytes], "Workspace Browser.otf", { type: "font/otf" })],
		})
		await act(async () => {
			upload.dispatchEvent(new Event("change", { bubbles: true }))
			await vi.waitFor(() => expect(fontSet.add).toHaveBeenCalledOnce())
		})

		expect(typeof FontFace).toBe("function")
		expect(document.fonts).toBe(fontSet)
		expect(faces).toHaveLength(1)
		expect(fontSet.add).toHaveBeenCalledOnce()
		const expectedFamily = designTextBrowserFontFamily(installed)
		expect(faces[0]?.family).toBe(expectedFamily)
		expect(faces[0]?.descriptors).toMatchObject({
			style: "normal",
			weight: "1 1000",
		})
		expect(new Uint8Array(faces[0]!.source)).toEqual(bytes)
		expect(faces[0]?.load).toHaveBeenCalledOnce()
		expect(fontSet.check).toHaveBeenCalledWith(
			`1px ${designTextCssFontFamily(expectedFamily)}`,
			"Hamburgefontsiv",
		)
		expect(
			document.querySelector<HTMLInputElement>('input[role="combobox"]')?.value,
		).toBe("Workspace Browser")
		expect(
			document.querySelector<HTMLButtonElement>('button[aria-label="Type"]')
				?.disabled,
		).toBe(false)
		act(() =>
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Type"]')
				?.click(),
		)
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: 360,
					clientY: 280,
					isPrimary: true,
					pointerId: 88,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const textarea = document.querySelector<HTMLTextAreaElement>(
			"textarea[data-design-text-editor]",
		)
		if (textarea === null) throw new Error("Native text editor was not opened.")
		expect(textarea.style.fontFamily).toBe(expectedFamily)
		expect(getComputedStyle(textarea).fontFamily).toBe(expectedFamily)
		expect(document.querySelector("persistence-alert")).toBeNull()
		const host = hosts.at(-1)
		if (host !== undefined) act(() => render(null, host))
		expect(fontSet.delete).toHaveBeenCalledOnce()
		Reflect.deleteProperty(document, "fonts")
		Reflect.deleteProperty(window, "FontFace")
	})

	it("rejects stale FontFace hydration when a newer source generation wins", async () => {
		const pending: Array<{
			face: FontFace
			resolve: () => void
		}> = []
		const TestFontFace = class {
			readonly family: string
			readonly load: () => Promise<FontFace>
			constructor(family: string) {
				this.family = family
				this.load = vi.fn(
					() =>
						new Promise<FontFace>((resolve) => {
							pending.push({
								face: this as unknown as FontFace,
								resolve: () => resolve(this as unknown as FontFace),
							})
						}),
				)
			}
		}
		vi.stubGlobal("FontFace", TestFontFace)
		Object.defineProperty(window, "FontFace", {
			configurable: true,
			value: TestFontFace,
		})
		const fontSet = {
			add: vi.fn(),
			check: vi.fn(() => true),
			delete: vi.fn(() => true),
		}
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: fontSet,
		})
		const first = {
			id: "font:generation",
			family: "Generation One",
			revision: "revision:one",
		}
		const second = {
			...first,
			family: "Generation Two",
			revision: "revision:two",
		}
		const initial = createInitialDocument()
		const point = createDesignTextObject({
			id: "text:generation",
			name: "Generation text",
			mode: "point",
			x: 100,
			y: 120,
			appearance: initial.objects[0]?.appearance ?? {},
			text: "A",
			typography: {
				font: first,
				size: 24,
				leading: 28,
				tracking: 0,
				kerning: "auto",
				alignment: "start",
				direction: "auto",
			},
		})
		const source = {
			...initial,
			objects: [...initial.objects, point],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: "object" as const, id: point.id },
				],
			})),
		}
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const firstSession = sourceSession({
			initialDocument: source,
			fonts: [{ reference: first, bytes: new Uint8Array([1]) }],
		})
		mountDesign({
			initialDocument: source,
			sourceSession: firstSession,
			textService,
		})
		expect(textService.registerFont).toHaveBeenCalledWith(
			first,
			new Uint8Array([1]),
		)
		expect(document.body.textContent).not.toContain("is not loaded")
		await vi.waitFor(() => expect(pending).toHaveLength(1))
		const host = hosts.at(-1)
		if (host === undefined) throw new Error("Design host was not mounted.")
		const secondSession = sourceSession({
			initialDocument: source,
			fonts: [{ reference: second, bytes: new Uint8Array([2]) }],
		})
		await act(async () => {
			render(
				h(DesignApplication, {
					initialDocument: source,
					sourceSession: secondSession,
					textService,
				}),
				host,
			)
			await Promise.resolve()
		})
		await vi.waitFor(() => expect(pending).toHaveLength(2))
		await act(async () => {
			pending[1]!.resolve()
			await vi.waitFor(() => expect(fontSet.add).toHaveBeenCalledOnce())
		})
		await act(async () => {
			pending[0]!.resolve()
			await Promise.resolve()
		})
		expect(fontSet.add).toHaveBeenCalledOnce()
		expect(fontSet.add).toHaveBeenCalledWith(pending[1]!.face)
		expect(
			document.querySelector<HTMLInputElement>('input[role="combobox"]')?.value,
		).toBe("Generation Two")
	})

	it("selects and drags Point and Area text through their whitespace bounds", async () => {
		const initial = createInitialDocument()
		const reference = {
			id: "font:interaction-fixture",
			family: "Interaction Fixture",
			revision: 1,
		}
		const appearance = initial.objects[0]?.appearance ?? {}
		const typography = {
			font: reference,
			size: 24,
			leading: 32,
			tracking: 0,
			kerning: "auto" as const,
			alignment: "start" as const,
			direction: "auto" as const,
		}
		const point = createDesignTextObject({
			id: "text:point-whitespace",
			name: "Point whitespace",
			mode: "point",
			x: 120,
			y: 180,
			appearance,
			text: "A ",
			typography,
		})
		const area = createDesignTextObject({
			id: "text:area-whitespace",
			name: "Area whitespace",
			mode: "area",
			x: 280,
			y: 140,
			width: 160,
			height: 96,
			appearance,
			text: "A",
			typography,
		})
		const source = {
			...initial,
			objects: [...initial.objects, point, area],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: "object" as const, id: point.id },
					{ kind: "object" as const, id: area.id },
				],
			})),
		}
		const storage = new Map<string, string>()
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const stage = mountDesign({ initialDocument: source, textService }, storage)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		let pointer = { x: 200, y: 180 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (
			id: string,
			type: "pointerdown" | "pointermove" | "pointerup",
			next: { x: number; y: number },
		) => {
			pointer = next
			const node = stage
				.find(".design-text-hit")
				.find((candidate: { name(): string }) => candidate.name().includes(id))
			if (node === undefined)
				throw new Error(`${id} text hit bounds were not rendered.`)
			node.fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: next.x,
						clientY: next.y,
						isPrimary: true,
						pointerId: 42,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		for (const id of [point.id, area.id]) {
			await act(async () => {
				fire(id, "pointerdown", { x: 200, y: 180 })
				fire(id, "pointermove", { x: 240, y: 205 })
				fire(id, "pointerup", { x: 240, y: 205 })
				await Promise.resolve()
			})
			const moved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			const movedText = moved.objects.find((object) => object.id === id)
			expect(movedText?.transform.e).not.toBe(0)
			expect(movedText?.transform.f).not.toBe(0)
			await act(async () => {
				window.dispatchEvent(
					new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
				)
				await Promise.resolve()
			})
			expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(
				source,
			)
		}
	})

	it("edits Point and Area text from non-ink bbox space without adding history", async () => {
		const initial = createInitialDocument()
		const reference = {
			id: "font:bbox-edit",
			family: "BBox Edit",
			revision: 1,
		}
		const typography = {
			font: reference,
			size: 24,
			leading: 32,
			tracking: 0,
			kerning: "auto" as const,
			alignment: "start" as const,
			direction: "auto" as const,
		}
		const appearance = initial.objects[0]?.appearance ?? {}
		const point = createDesignTextObject({
			id: "text:bbox-point",
			name: "BBox point",
			mode: "point",
			x: 120,
			y: 180,
			appearance,
			text: "A ",
			typography,
		})
		const area = createDesignTextObject({
			id: "text:bbox-area",
			name: "BBox area",
			mode: "area",
			x: 280,
			y: 140,
			width: 180,
			height: 100,
			appearance,
			text: "A",
			typography,
		})
		const locked = {
			...point,
			id: "text:bbox-locked",
			name: "Locked bbox text",
			locked: true,
		}
		const source = {
			...initial,
			objects: [...initial.objects, point, area, locked],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: "object" as const, id: point.id },
					{ kind: "object" as const, id: area.id },
					{ kind: "object" as const, id: locked.id },
				],
			})),
		}
		const session = sourceSession({
			initialDocument: source,
			fonts: [{ reference, bytes: new Uint8Array([1, 2, 3]) }],
		})
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const stage = mountDesign({
			initialDocument: source,
			sourceSession: session,
			textService,
		})
		const hit = (id: string) => {
			const node = stage
				.find(".design-text-hit")
				.find((candidate: { name(): string }) => candidate.name().includes(id))
			if (node === undefined) throw new Error(`${id} bbox was not rendered.`)
			return node
		}
		for (const [id, eventName] of [
			[point.id, "dblclick"],
			[area.id, "dbltap"],
		] as const) {
			await act(async () => {
				hit(id).fire(
					eventName,
					{
						evt:
							eventName === "dblclick"
								? new MouseEvent("dblclick", {
										bubbles: true,
										detail: 2,
									})
								: new TouchEvent("touchend", { bubbles: true }),
					},
					true,
				)
				await Promise.resolve()
			})
			const textarea = document.querySelector<HTMLTextAreaElement>(
				"textarea[data-design-text-editor]",
			)
			if (textarea === null)
				throw new Error(`${id} did not enter text editing.`)
			expect(document.activeElement).toBe(textarea)
			expect(
				stage
					.find(".design-text-hit")
					.some((candidate: { name(): string }) =>
						candidate.name().includes(id),
					),
			).toBe(true)
			expect(
				stage
					.find(".design-object")
					.some((candidate: { name(): string }) =>
						candidate.name().includes(id),
					),
			).toBe(true)
			expect(textarea.selectionStart).toBe(textarea.value.length)
			expect(textarea.selectionEnd).toBe(textarea.value.length)
			await act(async () => {
				textarea.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						key: "Escape",
					}),
				)
				await Promise.resolve()
			})
		}
		await act(async () => {
			hit(locked.id).fire(
				"dblclick",
				{
					evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.querySelector("textarea[data-design-text-editor]"),
		).toBeNull()
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Unlock Locked bbox text")
		expect(session.save).not.toHaveBeenCalled()
	})

	it("enters a text group before bbox double-click editing its child", async () => {
		const initial = createInitialDocument()
		const reference = { id: "font:grouped-text", family: "Grouped Text" }
		const point = createDesignTextObject({
			id: "text:grouped-bbox",
			name: "Grouped bbox text",
			mode: "point",
			x: 160,
			y: 200,
			appearance: initial.objects[0]?.appearance ?? {},
			text: "A ",
			typography: {
				font: reference,
				size: 24,
				leading: 32,
				tracking: 0,
				kerning: "auto",
				alignment: "start",
				direction: "auto",
			},
		})
		const expanded = {
			...initial,
			objects: [...initial.objects, point],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: "object" as const, id: point.id },
				],
			})),
		}
		const grouped = groupDesignSelection(
			expanded,
			[initial.objects[0]!.id, point.id],
			() => "text-group",
		)
		if (grouped === null) throw new Error("Text group fixture was not created.")
		const session = sourceSession({
			initialDocument: grouped.document,
			fonts: [{ reference, bytes: new Uint8Array([1]) }],
		})
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const stage = mountDesign({
			initialDocument: grouped.document,
			sourceSession: session,
			textService,
		})
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		let pointer = { x: 200, y: 180 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const hit = () => {
			const node = stage
				.find(".design-text-hit")
				.find((candidate: { name(): string }) =>
					candidate.name().includes(point.id),
				)
			if (node === undefined)
				throw new Error("Grouped text bbox was not rendered.")
			return node
		}
		const pointerEvent = (
			type: "pointerdown" | "pointerup",
			next: { x: number; y: number },
		) => {
			pointer = next
			hit().fire(
				type,
				{
					evt: new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: next.x,
						clientY: next.y,
						isPrimary: true,
						pointerId: 73,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		await act(async () => {
			pointerEvent("pointerdown", pointer)
			pointerEvent("pointerup", pointer)
			hit().fire(
				"click",
				{ evt: new MouseEvent("click", { bubbles: true, detail: 1 }) },
				true,
			)
			pointerEvent("pointerdown", { x: 201, y: 181 })
			pointerEvent("pointerup", { x: 201, y: 181 })
			hit().fire(
				"dblclick",
				{ evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }) },
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.querySelector("textarea[data-design-text-editor]"),
		).toBeNull()
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Editing inside")
		await act(async () => {
			hit().fire(
				"dblclick",
				{ evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }) },
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.querySelector("textarea[data-design-text-editor]"),
		).not.toBeNull()
		expect(session.save).not.toHaveBeenCalled()
	})

	it("authors new text with a loaded workspace font and selects its initial draft", async () => {
		const reference = {
			id: "font:workspace-sans",
			family: "Workspace Sans",
			revision: 7,
		}
		const save = vi.fn(async (_document: DesignDocument) => ({
			revision: "source:two",
		}))
		const session = sourceSession({
			fonts: [{ reference, bytes: new Uint8Array([1, 2, 3]) }],
			save,
		})
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(loadedTextLayout),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const stage = mountDesign({
			initialDocument: session.initialDocument,
			sourceSession: session,
			textService,
		})
		const pointType = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Type"]',
		)
		if (pointType === null) throw new Error("Type tool was not found.")
		expect(pointType.disabled).toBe(false)
		act(() => pointType.click())
		const canvas = stage.container().querySelector("canvas")
		if (canvas === null) throw new Error("Design canvas was not found.")
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					buttons: 1,
					clientX: 360,
					clientY: 280,
					isPrimary: true,
					pointerId: 91,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const textarea = document.querySelector<HTMLTextAreaElement>(
			"textarea[data-design-text-editor]",
		)
		if (textarea === null) throw new Error("Native text editor was not opened.")
		expect(textarea.value).toBe("Hello world")
		expect(textarea.selectionStart).toBe(0)
		expect(textarea.selectionEnd).toBe(11)
		expect(textarea.style.background).toBe("transparent")
		await vi.waitFor(() => expect(save).toHaveBeenCalled())
		const saved = save.mock.calls.at(-1)?.[0]
		const authored = saved?.objects.at(-1)
		expect(authored?.geometry.kind).toBe("text")
		if (authored?.geometry.kind !== "text")
			throw new Error("Saved object was not text.")
		expect(authored.geometry.typography.font).toEqual(reference)
		expect(document.querySelector("persistence-alert")).toBeNull()
	})

	it("returns safely to Select when workspace fonts disappear", async () => {
		const reference = {
			id: "font:temporary",
			family: "Temporary",
			revision: 1,
		}
		const session = sourceSession({
			fonts: [{ reference, bytes: new Uint8Array([1]) }],
		})
		const textService = {
			registerFont: vi.fn(() => []),
			unregisterFont: vi.fn(() => true),
			layout: vi.fn(() => null),
			expand: vi.fn(() => null),
			cacheStats: vi.fn(() => ({
				layouts: 0,
				parsing: { entries: 1, hits: 0, misses: 0 },
				shaping: { entries: 0, hits: 0, misses: 0 },
				metrics: { entries: 0, hits: 0, misses: 0 },
				outlines: { entries: 0, hits: 0, misses: 0 },
			})),
			clearCaches: vi.fn(),
		}
		const host = prepareDesignDom()
		act(() =>
			render(
				h(DesignApplication, { sourceSession: session, textService }),
				host,
			),
		)
		const pointType = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Type"]',
		)
		if (pointType === null) throw new Error("Type tool was not found.")
		act(() => pointType.click())
		expect(pointType.getAttribute("aria-pressed")).toBe("true")
		await act(async () => {
			render(
				h(DesignApplication, {
					sourceSession: { ...session, fonts: [] },
					textService,
				}),
				host,
			)
			await Promise.resolve()
		})
		expect(
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Select"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")
		expect(
			document.querySelector<HTMLButtonElement>('button[aria-label="Type"]')
				?.disabled,
		).toBe(true)
	})

	it("remounts the state graph when browser options switch source sessions", async () => {
		const first = createInitialDocument()
		const documentA: DesignDocument = {
			...first,
			title: "Document A",
			objects: first.objects.map((object, index) =>
				index === 0 ? { ...object, name: "Object from A" } : object,
			),
		}
		const second = createInitialDocument()
		const documentB: DesignDocument = {
			...second,
			title: "Document B",
			objects: second.objects.map((object, index) =>
				index === 0 ? { ...object, name: "Object from B" } : object,
			),
		}
		const saveA = vi.fn(async () => ({ revision: "a:two" }))
		const saveB = vi.fn(async () => ({ revision: "b:two" }))
		const sessionA = sourceSession({ initialDocument: documentA, save: saveA })
		const sessionB = sourceSession({ initialDocument: documentB, save: saveB })
		const host = prepareDesignDom()
		let mounted!: ReturnType<typeof mountDesignEditor>
		act(() => {
			mounted = mountDesignEditor(host, {
				initialDocument: documentA,
				sourceSession: sessionA,
			})
		})

		act(() => {
			mounted.update({
				initialDocument: documentB,
				sourceSession: sessionB,
			})
		})
		const title = host.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title was not found.")
		expect(title.value).toBe("Document B")
		act(() => {
			title.value = "Edited B"
			title.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})

		await act(async () => {
			await vi.waitFor(() => expect(saveB).toHaveBeenCalledOnce())
		})
		expect(saveA).not.toHaveBeenCalled()
		expect(saveB).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Edited B",
				objects: expect.arrayContaining([
					expect.objectContaining({ name: "Object from B" }),
				]),
			}),
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await vi.waitFor(() => expect(saveB).toHaveBeenCalledTimes(2))
		})
		expect(saveB).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ title: "Document B" }),
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					shiftKey: true,
				}),
			)
			await vi.waitFor(() => expect(saveB).toHaveBeenCalledTimes(3))
		})
		expect(saveB).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ title: "Edited B" }),
		)
		act(() => mounted.unmount())
	})

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
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("has not been saved")
		expect(
			document.querySelector("footer [data-footer-status]")?.textContent,
		).toContain("Ready")
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
			document.querySelector<HTMLInputElement>(
				'design-canvas-tile input[aria-label="Document title"]',
			)?.value,
		).toBe("Recovered design")
		await vi.waitFor(() => {
			expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
			expect(
				document.querySelector('footer [role="status"]')?.textContent,
			).toContain("source:two")
		})
	})

	it("isolates recovery drafts by workspace and project identity", () => {
		const storage = new Map<string, string>()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: { ...createInitialDocument(), title: "Other workspace" },
			updatedAt: 42,
		}
		const otherKey = `create-design:project:${encodeURIComponent("workspace:other:poster")}:${DESIGN_RECOVERY_STORAGE_KEY}`
		storage.set(otherKey, JSON.stringify(draft))
		const session = sourceSession({
			projectId: "poster",
			workspaceId: "workspace:current",
		})
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		expect(document.querySelector("persistence-alert")).toBeNull()
		expect(storage.get(otherKey)).toBe(JSON.stringify(draft))
	})

	it("migrates the legacy recovery key for an unambiguous workspace", () => {
		const storage = new Map<string, string>()
		const draft: DesignRecoveryDraft = {
			version: 1,
			baseRevision: "source:one",
			document: { ...createInitialDocument(), title: "Legacy recovery" },
			updatedAt: 42,
		}
		storage.set(DESIGN_RECOVERY_STORAGE_KEY, JSON.stringify(draft))
		const session = sourceSession({
			allowLegacyRecovery: true,
			projectId: "poster",
			workspaceId: "workspace:current",
		})
		mountDesign(
			{ initialDocument: session.initialDocument, sourceSession: session },
			storage,
		)
		const scopedKey = `create-design:project:${encodeURIComponent("workspace:current:poster")}:${DESIGN_RECOVERY_STORAGE_KEY}`
		expect(storage.has(DESIGN_RECOVERY_STORAGE_KEY)).toBe(false)
		expect(storage.get(scopedKey)).toBe(JSON.stringify(draft))
		expect(document.querySelector("persistence-alert")?.textContent).toContain(
			"has not been saved",
		)
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
		expect(
			document.querySelector('footer [role="status"]')?.textContent,
		).toContain("source:one")
		expect(
			document.querySelector("footer [data-footer-status]")?.textContent,
		).toContain("Ready")
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
			document.querySelector<HTMLInputElement>(
				'design-canvas-tile input[aria-label="Document title"]',
			)?.value,
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
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
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
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
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
			expect(
				document.querySelector('footer [role="status"]')?.textContent,
			).toContain("source:two"),
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
		expect(document.querySelector("curvature-comb-controls")).not.toBeNull()
		expect(document.querySelector("design-object-tile")).not.toBeNull()
		expect(document.querySelector("design-appearance-tile")).not.toBeNull()
	})

	it("scopes the curvature comb to selected projected vectors and updates its compact controls", async () => {
		const stage = mountDesign()
		const layerRows = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		const ellipse = layerRows.find((button) =>
			button.textContent?.includes("Cyan ellipse"),
		)
		const rectangle = layerRows.find((button) =>
			button.textContent?.includes("Coral rectangle"),
		)
		const toggle = document.querySelector<HTMLInputElement>(
			'curvature-comb-controls input[type="checkbox"]',
		)
		if (ellipse === undefined || rectangle === undefined || toggle === null)
			throw new Error("Curvature comb controls were not found.")
		expect(toggle.disabled).toBe(true)
		act(() => ellipse.click())
		expect(toggle.disabled).toBe(false)
		act(() => toggle.click())
		expect(stage.find(".design-curvature-comb-cell")).toHaveLength(400)
		const group = stage.findOne(".design-curvature-comb")
		expect(group.listening()).toBe(false)
		const original = stage.findOne(".design-curvature-comb-cell").data()

		const size = document.querySelector<HTMLInputElement>(
			'curvature-comb-controls input[aria-label="Size"]',
		)!
		act(() => {
			size.focus()
			size.value = "2"
			size.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		await act(async () => {
			size.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "Enter",
				}),
			)
			await Promise.resolve()
		})
		expect(stage.findOne(".design-curvature-comb-cell").data()).not.toBe(
			original,
		)

		act(() => {
			rectangle.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
		})
		expect(stage.find(".design-curvature-comb-cell")).toHaveLength(400)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					ctrlKey: true,
					shiftKey: true,
					key: "x",
				}),
			)
			await Promise.resolve()
		})
		expect(stage.find(".design-curvature-comb-cell")).toHaveLength(0)
	})

	it("presents an accessible icon-only Tools palette with distinct A and B shortcuts", async () => {
		mountDesign()
		const toolbar = document.querySelector("design-tools-tile")
		if (toolbar === null) throw new Error("Tools toolbar was not found.")
		expect(toolbar.getAttribute("role")).toBe("toolbar")
		expect(toolbar.getAttribute("aria-label")).toBe("Tools")
		const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("button")]
		expect(buttons).toHaveLength(Object.keys(DESIGN_TOOLS).length)
		for (const button of buttons) {
			expect(button.hasAttribute("aria-label")).toBe(true)
			expect(button.hasAttribute("title")).toBe(button.disabled)
			expect(button.children).toHaveLength(1)
			expect(button.firstElementChild?.tagName).toBe("svg")
		}
		const direct = toolbar.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		const artboard = toolbar.querySelector<HTMLButtonElement>(
			'button[aria-label="Artboard"]',
		)
		if (direct === null || artboard === null)
			throw new Error("A/B tool controls were not found.")
		expect(direct.getAttribute("aria-keyshortcuts")).toBe("A")
		expect(artboard.getAttribute("aria-keyshortcuts")).toBe("B")

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
			await Promise.resolve()
		})
		expect(direct.getAttribute("aria-pressed")).toBe("true")
		expect(artboard.getAttribute("aria-pressed")).toBe("false")

		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }))
			await Promise.resolve()
		})
		expect(direct.getAttribute("aria-pressed")).toBe("false")
		expect(artboard.getAttribute("aria-pressed")).toBe("true")

		const modified = new KeyboardEvent("keydown", {
			cancelable: true,
			ctrlKey: true,
			key: "b",
		})
		await act(async () => {
			window.dispatchEvent(modified)
			await Promise.resolve()
		})
		expect(modified.defaultPrevented).toBe(false)
		expect(artboard.getAttribute("aria-pressed")).toBe("true")

		const title = document.querySelector<HTMLInputElement>(
			'input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		await act(async () => {
			title.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
			)
			await Promise.resolve()
		})
		expect(artboard.getAttribute("aria-pressed")).toBe("true")
	})

	it("navigates and edits the ordered artboard collection accessibly", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const pages = document.querySelector("design-pages-tile")
		if (pages === null) throw new Error("Pages tile was not found.")
		const button = (label: string): HTMLButtonElement => {
			const match = [...pages.querySelectorAll("button")].find(
				(candidate) => candidate.textContent?.trim() === label,
			)
			if (match === undefined) throw new Error(`${label} was not found.`)
			return match
		}

		await act(async () => {
			button("New").click()
			await Promise.resolve()
		})
		let options = [
			...pages.querySelectorAll<HTMLButtonElement>('[role="option"]'),
		]
		expect(options).toHaveLength(2)
		expect(options[1]?.getAttribute("aria-current")).toBe("page")

		const name = pages.querySelector<HTMLInputElement>(
			'label[data-field] input:not([type="number"])',
		)
		if (name === null) throw new Error("Artboard name was not found.")
		await act(async () => {
			name.value = "Outside artwork"
			name.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		await act(async () => {
			name.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
			await Promise.resolve()
		})
		expect(options[1]?.textContent).toContain("Outside artwork")

		await act(async () => {
			options[1]?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
			)
			await Promise.resolve()
		})
		options = [...pages.querySelectorAll<HTMLButtonElement>('[role="option"]')]
		expect(options[0]?.getAttribute("aria-current")).toBe("page")
		expect(button("Fit active").disabled).toBe(false)
		expect(button("Fit all").disabled).toBe(false)

		await act(async () => {
			button("Delete").click()
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(1)
		expect(saved.objects).toHaveLength(2)
	})

	it("creates an artboard with a distinct canvas gesture and undoes it atomically", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => {
			captured.add(pointerId)
		})
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(function (this: HTMLCanvasElement, pointerId) {
			captured.delete(pointerId)
			this.dispatchEvent(
				new PointerEvent("lostpointercapture", {
					bubbles: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		})
		const artboardTool = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Artboard"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (artboardTool === null || canvas === null)
			throw new Error("Artboard tool or canvas was not found.")
		act(() => artboardTool.click())
		const fire = (type: string, x: number, y: number): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId: 42,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown", 80, 100)
			fire("pointermove", 140, 160)
			fire("pointerup", 180, 200)
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(2)
		expect(saved.objects).toHaveLength(2)
		expect(stage.find(".design-paper")).toHaveLength(2)
		expect(saved.artboards[1]?.width).toBeGreaterThan(60)
		expect(saved.artboards[1]?.height).toBeGreaterThan(60)
		expect(captured.size).toBe(0)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(1)
		expect(saved.objects).toHaveLength(2)
	})

	it("durably commits repeated Select drags before synchronous capture loss", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
		const canvas = stage.container().querySelector("canvas")
		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => {
			captured.add(pointerId)
		})
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(function (this: HTMLCanvasElement, pointerId) {
			captured.delete(pointerId)
			this.dispatchEvent(
				new PointerEvent("lostpointercapture", {
					bubbles: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		})
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		let pointer = { x: 260, y: 220 }
		if (canvas === null) throw new Error("Design canvas was not found.")

		const objectNode = () =>
			stage
				.find(".design-object")
				.find((candidate: { name(): string }) =>
					candidate.name().includes(source.objects[0]!.id),
				)
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: Readonly<{ x: number; y: number }>,
			pointerId: number,
		): void => {
			pointer = at
			const event = new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				clientX: at.x,
				clientY: at.y,
				isPrimary: true,
				pointerId,
				pointerType: "mouse",
			})
			Object.defineProperty(event, "currentTarget", { value: canvas })
			objectNode()?.fire(type, { evt: event }, true)
		}
		const read = (): DesignDocument =>
			JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}") as DesignDocument

		for (let index = 0; index < 20; index += 1) {
			const before = read().objects[0]!.transform
			const start = { x: 260 + index, y: 220 + index }
			await act(async () => {
				fire("pointerdown", start, 100 + index)
				fire("pointermove", { x: start.x + 7, y: start.y + 6 }, 100 + index)
				fire(
					"pointerup",
					index === 19
						? { x: 1_200, y: 900 }
						: { x: start.x + 13, y: start.y + 11 },
					100 + index,
				)
				await Promise.resolve()
			})
			expect(read().objects[0]!.transform).not.toEqual(before)
			expect(captured.size).toBe(0)
		}

		const committed = read()
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		const undone = read()
		expect(undone.objects[0]!.transform).not.toEqual(
			committed.objects[0]!.transform,
		)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					ctrlKey: true,
					key: "z",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(read()).toEqual(committed)

		const beforeCancel = read()
		await act(async () => {
			fire("pointerdown", { x: 300, y: 250 }, 151)
			fire("pointermove", { x: 380, y: 330 }, 151)
			canvas.dispatchEvent(
				new PointerEvent("pointercancel", {
					bubbles: true,
					pointerId: 151,
					pointerType: "mouse",
				}),
			)
			captured.delete(151)
			fire("pointerup", { x: 400, y: 350 }, 151)
			await Promise.resolve()
		})
		expect(read()).toEqual(beforeCancel)
		expect(captured.size).toBe(0)
	})

	it("commits a same-frame Select drag from the raw pointer-up position", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
		const canvas = stage.container().querySelector("canvas")
		const artboard = document.querySelector<HTMLElement>(
			'[role="application"][aria-label="Design artboard"]',
		)
		const paper = stage.findOne(".design-paper")
		const start = { x: 260, y: 220 }
		const pageOffset = { x: 73, y: 41 }
		if (canvas === null || artboard === null || paper === undefined)
			throw new Error("Design canvas was not found.")
		vi.spyOn(artboard, "getBoundingClientRect").mockReturnValue({
			bottom: 841,
			height: 800,
			left: pageOffset.x,
			right: 1_273,
			top: pageOffset.y,
			width: 1_200,
			x: pageOffset.x,
			y: pageOffset.y,
			toJSON: () => undefined,
		})
		vi.spyOn(stage, "getPointerPosition").mockReturnValue(start)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			true,
		)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		act(() => {
			for (const checkbox of document.querySelectorAll<HTMLInputElement>(
				'design-canvas-tile snap-options input[type="checkbox"]',
			))
				if (checkbox.checked) checkbox.click()
		})
		const object = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(source.objects[0]!.id),
			)
		const fire = (
			type: "pointerdown" | "pointerup",
			at: Readonly<{ x: number; y: number }>,
		): void => {
			const event = new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				clientX: at.x + pageOffset.x,
				clientY: at.y + pageOffset.y,
				isPrimary: true,
				pointerId: 201,
				pointerType: "mouse",
			})
			Object.defineProperty(event, "currentTarget", { value: canvas })
			object?.fire(type, { evt: event }, true)
		}

		const end = { x: start.x + 83, y: start.y + 57 }
		const documentTransform = paper
			.getParent()
			.getAbsoluteTransform()
			.copy()
			.invert()
		const worldStart = documentTransform.point(start)
		const worldEnd = documentTransform.point(end)
		await act(async () => {
			fire("pointerdown", start)
			// Deliberately do not dispatch pointermove or update Konva's cached
			// pointer. A rapid native release must still own its final coordinates.
			fire("pointerup", end)
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]!.transform.e).toBeCloseTo(
			source.objects[0]!.transform.e + worldEnd.x - worldStart.x,
		)
		expect(saved.objects[0]!.transform.f).toBeCloseTo(
			source.objects[0]!.transform.f + worldEnd.y - worldStart.y,
		)
	})

	it("commits a flick when capture fails and Konva misses native pointer-up", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
		const canvas = stage.container().querySelector("canvas")
		const artboard = document.querySelector<HTMLElement>(
			'[role="application"][aria-label="Design artboard"]',
		)
		const paper = stage.findOne(".design-paper")
		const start = { x: 260, y: 220 }
		const end = { x: 391, y: 307 }
		const pageOffset = { x: 67, y: 37 }
		if (canvas === null || artboard === null || paper === undefined)
			throw new Error("Design canvas was not found.")
		vi.spyOn(artboard, "getBoundingClientRect").mockReturnValue({
			bottom: 837,
			height: 800,
			left: pageOffset.x,
			right: 1_267,
			top: pageOffset.y,
			width: 1_200,
			x: pageOffset.x,
			y: pageOffset.y,
			toJSON: () => undefined,
		})
		vi.spyOn(stage, "getPointerPosition").mockReturnValue(start)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => {
			throw new DOMException("Pointer capture unavailable")
		})
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			true,
		)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		act(() => {
			for (const checkbox of document.querySelectorAll<HTMLInputElement>(
				'design-canvas-tile snap-options input[type="checkbox"]',
			))
				if (checkbox.checked) checkbox.click()
		})
		const object = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(source.objects[0]!.id),
			)
		const down = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			clientX: start.x + pageOffset.x,
			clientY: start.y + pageOffset.y,
			isPrimary: true,
			pointerId: 202,
			pointerType: "mouse",
		})
		Object.defineProperty(down, "currentTarget", { value: canvas })
		const documentTransform = paper
			.getParent()
			.getAbsoluteTransform()
			.copy()
			.invert()
		const worldStart = documentTransform.point(start)
		const worldEnd = documentTransform.point(end)

		await act(async () => {
			object?.fire("pointerdown", { evt: down }, true)
			// A high-velocity release can reach the browser without Konva routing a
			// Stage pointer-up. The native boundary still has to finalize the drag.
			window.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: end.x + pageOffset.x,
					clientY: end.y + pageOffset.y,
					isPrimary: true,
					pointerId: 202,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]!.transform.e).toBeCloseTo(
			source.objects[0]!.transform.e + worldEnd.x - worldStart.x,
		)
		expect(saved.objects[0]!.transform.f).toBeCloseTo(
			source.objects[0]!.transform.f + worldEnd.y - worldStart.y,
		)
	})

	it("finalizes a native flick once before Konva and synchronous capture loss", async () => {
		const source = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
		const canvas = stage.container().querySelector("canvas")
		const artboard = document.querySelector<HTMLElement>(
			'[role="application"][aria-label="Design artboard"]',
		)
		const start = { x: 260, y: 220 }
		const end = { x: 382, y: 301 }
		const pageOffset = { x: 61, y: 31 }
		if (canvas === null || artboard === null)
			throw new Error("Design canvas was not found.")
		vi.spyOn(artboard, "getBoundingClientRect").mockReturnValue({
			bottom: 831,
			height: 800,
			left: pageOffset.x,
			right: 1_261,
			top: pageOffset.y,
			width: 1_200,
			x: pageOffset.x,
			y: pageOffset.y,
			toJSON: () => undefined,
		})
		vi.spyOn(stage, "getPointerPosition").mockReturnValue(start)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(HTMLCanvasElement.prototype, "hasPointerCapture").mockReturnValue(
			true,
		)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation((pointerId) => {
			canvas.dispatchEvent(
				new PointerEvent("lostpointercapture", {
					bubbles: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		})
		act(() => {
			for (const checkbox of document.querySelectorAll<HTMLInputElement>(
				'design-canvas-tile snap-options input[type="checkbox"]',
			))
				if (checkbox.checked) checkbox.click()
		})
		const object = stage
			.find(".design-object")
			.find((candidate: { name(): string }) =>
				candidate.name().includes(source.objects[0]!.id),
			)
		const down = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			clientX: start.x + pageOffset.x,
			clientY: start.y + pageOffset.y,
			isPrimary: true,
			pointerId: 203,
			pointerType: "mouse",
		})
		Object.defineProperty(down, "currentTarget", { value: canvas })

		await act(async () => {
			object?.fire("pointerdown", { evt: down }, true)
			// Window capture finalizes first, explicit capture release emits a nested
			// lostpointercapture, then the same native event reaches Konva's canvas.
			canvas.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: end.x + pageOffset.x,
					clientY: end.y + pageOffset.y,
					isPrimary: true,
					pointerId: 203,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const committed = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(committed.objects[0]!.transform).not.toEqual(
			source.objects[0]!.transform,
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
	})

	it.each([
		["Rectangle", "rectangle"],
		["Ellipse", "ellipse"],
	] as const)(
		"keeps %s hover hints, live edges, and committed geometry on the same snap targets",
		async (label, kind) => {
			const initial = createInitialDocument()
			const initialDocument: DesignDocument = {
				...initial,
				objects: [],
				layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
				guides: [
					{ id: "guide:left", a: { x: 120, y: 0 }, b: { x: 120, y: 1 } },
					{ id: "guide:top", a: { x: 0, y: 160 }, b: { x: 1, y: 160 } },
					{ id: "guide:right", a: { x: 300, y: 0 }, b: { x: 300, y: 1 } },
					{ id: "guide:bottom", a: { x: 0, y: 320 }, b: { x: 1, y: 320 } },
				],
			}
			const storage = new Map<string, string>()
			const stage = mountDesign({ initialDocument }, storage)
			const canvas = stage.container().querySelector("canvas")
			const paper = stage.findOne(".design-paper")
			const tool = document.querySelector<HTMLButtonElement>(
				`button[aria-label="${label}"]`,
			)
			if (canvas === null || paper === undefined || tool === null)
				throw new Error(`${label} creation controls were not found.`)
			const world = paper.getParent().getAbsoluteTransform()
			const fire = (
				type: string,
				point: Readonly<{ x: number; y: number }>,
				pointerId = 81,
			): void => {
				const screen = world.point(point)
				canvas.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: screen.x,
						clientY: screen.y,
						isPrimary: true,
						pointerId,
						pointerType: "mouse",
					}),
				)
			}
			act(() => tool.click())
			const beforeHover = storage.get(DESIGN_STORAGE_KEY)
			act(() => fire("pointermove", { x: 122, y: 162 }))
			expect(stage.find(".active-snap")).toHaveLength(2)
			expect(document.querySelector("[data-footer-status]")?.textContent).toBe(
				"Snap: Guide.",
			)
			expect(storage.get(DESIGN_STORAGE_KEY)).toBe(beforeHover)
			act(() =>
				stage
					.container()
					.dispatchEvent(new PointerEvent("pointerleave", { pointerId: 81 })),
			)

			await act(async () => {
				fire("pointerdown", { x: 122, y: 162 })
				fire("pointermove", { x: 298, y: 318 })
				expect(stage.find(".active-snap")).toHaveLength(2)
				fire("pointerup", { x: 298, y: 318 })
				await Promise.resolve()
			})
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			expect(saved.objects).toHaveLength(1)
			const geometry = saved.objects[0]?.geometry
			expect(geometry?.kind).toBe(kind)
			if (geometry?.kind === "rectangle")
				expect(geometry).toMatchObject({
					x: 120,
					y: 160,
					width: 180,
					height: 160,
				})
			else if (geometry?.kind === "ellipse")
				expect(geometry).toMatchObject({
					centerX: 210,
					centerY: 240,
					radiusX: 90,
					radiusY: 80,
				})
			expect(stage.find(".active-snap")).toHaveLength(0)
		},
	)

	it("snaps Pen nodes and new Artboard bounds without changing existing edit gestures", async () => {
		const initial = createInitialDocument()
		const initialDocument: DesignDocument = {
			...initial,
			objects: [],
			layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
			guides: [
				{ id: "guide:pen-x1", a: { x: 120, y: 0 }, b: { x: 120, y: 1 } },
				{ id: "guide:pen-y1", a: { x: 0, y: 160 }, b: { x: 1, y: 160 } },
				{ id: "guide:pen-x2", a: { x: 300, y: 0 }, b: { x: 300, y: 1 } },
				{ id: "guide:pen-y2", a: { x: 0, y: 320 }, b: { x: 1, y: 320 } },
				{ id: "guide:board-x1", a: { x: 700, y: 0 }, b: { x: 700, y: 1 } },
				{ id: "guide:board-y1", a: { x: 0, y: 100 }, b: { x: 1, y: 100 } },
				{ id: "guide:board-x2", a: { x: 850, y: 0 }, b: { x: 850, y: 1 } },
				{ id: "guide:board-y2", a: { x: 0, y: 250 }, b: { x: 1, y: 250 } },
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument }, storage)
		const canvas = stage.container().querySelector("canvas")
		const paper = stage.findOne(".design-paper")
		if (canvas === null || paper === undefined)
			throw new Error("Creation canvas was not found.")
		const world = paper.getParent().getAbsoluteTransform()
		const fire = (
			type: string,
			point: Readonly<{ x: number; y: number }>,
			pointerId: number,
		): void => {
			const screen = world.point(point)
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: screen.x,
					clientY: screen.y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		const artboard = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Artboard"]',
		)
		if (pen === null || artboard === null)
			throw new Error("Pen or Artboard tool was not found.")
		act(() => pen.click())
		await act(async () => {
			fire("pointerdown", { x: 122, y: 162 }, 91)
			fire("pointerup", { x: 122, y: 162 }, 91)
			await Promise.resolve()
		})
		expect(document.querySelector("[data-footer-status]")?.textContent).toBe(
			"Pen tool",
		)
		await act(async () => {
			fire("pointerdown", { x: 298, y: 318 }, 92)
			fire("pointerup", { x: 298, y: 318 }, 92)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Snapped Pen path was not committed.")
		expect(saved.objects[0].geometry.contours[0]?.points).toMatchObject([
			{ x: 120, y: 160 },
			{ x: 300, y: 320 },
		])

		act(() => artboard.click())
		await act(async () => {
			fire("pointerdown", { x: 702, y: 102 }, 93)
			fire("pointermove", { x: 848, y: 248 }, 93)
			fire("pointerup", { x: 848, y: 248 }, 93)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.artboards).toHaveLength(2)
		expect(saved.artboards[1]).toMatchObject({
			x: 700,
			y: 100,
			width: 150,
			height: 150,
		})
	})

	it.each([
		{
			label: "Shift",
			modifiers: { shiftKey: true },
			expected: { x: 120, y: 160, width: 178, height: 178 },
		},
		{
			label: "Shift+Alt",
			modifiers: { shiftKey: true, altKey: true },
			expected: { x: -58, y: -18, width: 356, height: 356 },
		},
	] as const)(
		"keeps $label constraint previews and commits identical when one pointer axis snaps",
		async ({ modifiers, expected }) => {
			const initial = createInitialDocument()
			const initialDocument: DesignDocument = {
				...initial,
				objects: [],
				layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
				guides: [
					{ id: "guide:start-x", a: { x: 120, y: 0 }, b: { x: 120, y: 1 } },
					{ id: "guide:start-y", a: { x: 0, y: 160 }, b: { x: 1, y: 160 } },
					{ id: "guide:end-x", a: { x: 300, y: 0 }, b: { x: 300, y: 1 } },
				],
			}
			const storage = new Map<string, string>()
			const stage = mountDesign({ initialDocument }, storage)
			const canvas = stage.container().querySelector("canvas")
			const paper = stage.findOne(".design-paper")
			const rectangle = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Rectangle"]',
			)
			if (canvas === null || paper === undefined || rectangle === null)
				throw new Error("Constrained creation controls were not found.")
			const world = paper.getParent().getAbsoluteTransform()
			const fire = (
				type: "pointerdown" | "pointermove" | "pointerup",
				point: Readonly<{ x: number; y: number }>,
			): void => {
				const screen = world.point(point)
				canvas.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						button: 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: screen.x,
						clientY: screen.y,
						isPrimary: true,
						pointerId: 95,
						pointerType: "mouse",
						...modifiers,
					}),
				)
			}
			act(() => rectangle.click())
			act(() => {
				fire("pointerdown", { x: 120, y: 160 })
				fire("pointermove", { x: 298, y: 250 })
			})
			const previewData = stage.findOne(".shape-placement-preview")?.data()
			expect(previewData).toBeDefined()
			expect(stage.find(".active-snap")).toHaveLength(0)
			await act(async () => {
				fire("pointerup", { x: 298, y: 250 })
				await Promise.resolve()
			})
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			expect(saved.objects[0]?.geometry).toMatchObject({
				kind: "rectangle",
				...expected,
			})
			const vertices = (data: string | undefined): readonly string[] => [
				...new Set(
					(data?.match(/-?\d+(?:\.\d+)?/gu) ?? [])
						.reduce<string[]>((points, value, index, values) => {
							if (index % 2 === 0) points.push(`${value},${values[index + 1]}`)
							return points
						}, [])
						.toSorted(),
				),
			]
			expect(vertices(stage.findOne(".design-object")?.data())).toEqual(
				vertices(previewData),
			)
		},
	)

	it("lets creation gestures pass through a guide's hit target", async () => {
		const initial = createInitialDocument()
		const initialDocument: DesignDocument = {
			...initial,
			objects: [],
			layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
			guides: [
				{ id: "guide:left", a: { x: 120, y: 0 }, b: { x: 120, y: 1 } },
				{ id: "guide:top", a: { x: 0, y: 160 }, b: { x: 1, y: 160 } },
				{ id: "guide:right", a: { x: 300, y: 0 }, b: { x: 300, y: 1 } },
				{ id: "guide:bottom", a: { x: 0, y: 320 }, b: { x: 1, y: 320 } },
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument }, storage)
		const paper = stage.findOne(".design-paper")
		const guide = stage
			.find(".design-guide")
			.find((node: { name(): string }) => node.name().includes("guide:left"))
		const rectangle = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Rectangle"]',
		)
		if (paper === undefined || guide === undefined || rectangle === null)
			throw new Error("Guide-hit creation controls were not found.")
		const world = paper.getParent().getAbsoluteTransform()
		const pointer = (
			type: "pointerdown" | "pointermove" | "pointerup",
			point: Readonly<{ x: number; y: number }>,
		): PointerEvent => {
			const screen = world.point(point)
			return new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				clientX: screen.x,
				clientY: screen.y,
				isPrimary: true,
				pointerId: 96,
				pointerType: "mouse",
			})
		}
		act(() => rectangle.click())
		await act(async () => {
			const down = pointer("pointerdown", { x: 122, y: 162 })
			stage.setPointersPositions(down)
			guide.fire("pointerdown", { evt: down }, true)
			const move = pointer("pointermove", { x: 298, y: 318 })
			stage.setPointersPositions(move)
			stage.fire("pointermove", { evt: move }, true)
			const up = pointer("pointerup", { x: 298, y: 318 })
			stage.setPointersPositions(up)
			stage.fire("pointerup", { evt: up }, true)
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.guides).toEqual(initialDocument.guides)
		expect(saved.objects[0]?.geometry).toMatchObject({
			kind: "rectangle",
			x: 120,
			y: 160,
			width: 180,
			height: 160,
		})
	})

	it("authors mixed multi-object paints atomically with accessible appearance controls", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layers = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		if (layers.length < 2) throw new Error("Expected two design layers.")
		await act(async () => {
			layers[0]!.click()
			layers[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
			await Promise.resolve()
		})

		expect(
			layers.every((layer) => layer.getAttribute("aria-selected") === "true"),
		).toBe(true)
		expect(
			document.querySelector<HTMLButtonElement>(
				'button[aria-label="Fill paint: Mixed"]',
			),
		).not.toBeNull()
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (strokeTarget === null) throw new Error("Stroke target was not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		if (ink === null) throw new Error("Stroke swatch was not found.")
		await act(async () => {
			ink.click()
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.appearance.stroke)).toEqual([
			{
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 1,
			},
			{
				...DEFAULT_DESIGN_STROKE_STYLE,
				swatchId: "swatch:ink",
				width: 1,
			},
		])

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
		expect(
			saved.objects.every((object) => object.appearance.stroke === undefined),
		).toBe(true)

		const strokeInk = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		const noFill = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Set fill paint to none"]',
		)
		const swap = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Swap fill and stroke paints"]',
		)
		if (strokeInk === null || noFill === null || swap === null)
			throw new Error("Appearance paint actions were not found.")
		await act(async () => {
			strokeInk.click()
			await Promise.resolve()
		})
		await act(async () => {
			noFill.click()
			await Promise.resolve()
		})
		await act(async () => {
			swap.click()
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.appearance)).toEqual([
			{ fill: { swatchId: "swatch:ink" } },
			{ fill: { swatchId: "swatch:ink" } },
		])
	})

	it("routes stacking shortcuts through commands, guards, no-op edges, and history", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const second = base.objects[1]!
		const third = {
			...first,
			id: "object:stack-third",
			name: "Third stack object",
			transform: { ...first.transform, e: first.transform.e + 360 },
		}
		const fourth = {
			...first,
			id: "object:stack-fourth",
			name: "Fourth stack object",
			transform: { ...first.transform, e: first.transform.e + 540 },
		}
		const initialDocument: DesignDocument = {
			...base,
			objects: [first, second, third, fourth],
			layers: [
				{
					...base.layers[0]!,
					children: [first, second, third, fourth].map(({ id }) => ({
						kind: "object" as const,
						id,
					})),
				},
			],
		}
		const storage = new Map<string, string>()
		mountDesign({ initialDocument }, storage)
		const selectLayer = (name: string): void => {
			const layer = [
				...document.querySelectorAll<HTMLButtonElement>(
					'design-layers-tile [data-layer-kind="object"]',
				),
			].find((button) => button.textContent?.includes(name))
			if (layer === undefined) throw new Error(`${name} was not found.`)
			act(() => layer.click())
		}
		selectLayer(second.name)

		const platformMod = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
			? { metaKey: true }
			: { ctrlKey: true }
		const key = async (options: KeyboardEventInit): Promise<KeyboardEvent> => {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...platformMod,
				...options,
			})
			await act(async () => {
				window.dispatchEvent(event)
				await Promise.resolve()
			})
			return event
		}
		const order = (): readonly string[] => {
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			return saved.layers[0]?.children.map(({ id }) => id) ?? []
		}
		const original = [first.id, second.id, third.id, fourth.id]

		const commandCenter = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (commandCenter === null) throw new Error("Command center was not found.")
		act(() => commandCenter.click())
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		await act(async () => {
			search.value = "Bring Forward"
			search.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const forwardCommand = document.getElementById("command-stack-forward")
		expect(forwardCommand?.textContent).toContain("Bring Forward")
		expect(forwardCommand?.querySelector("kbd")?.textContent).toBe(
			`${/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘" : "Ctrl"}+]`,
		)
		await act(async () => {
			search.value = "Bring to Front"
			search.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const frontCommand = document.getElementById("command-stack-front")
		expect(frontCommand?.querySelector("kbd")?.textContent).toBe(
			`${/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌥+⌘" : "Alt+Ctrl"}+]`,
		)
		const paletteGuard = await key({ key: "]" })
		expect(paletteGuard.defaultPrevented).toBe(false)
		expect(order()).toEqual(original)
		await act(async () => {
			search.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
		})

		const forward = await key({ key: "]" })
		expect(forward.defaultPrevented).toBe(true)
		expect(order()).toEqual([first.id, third.id, second.id, fourth.id])
		await key({ key: "z" })
		expect(order()).toEqual(original)
		const backward = await key({ key: "[" })
		expect(backward.defaultPrevented).toBe(true)
		expect(order()).toEqual([second.id, first.id, third.id, fourth.id])
		await key({ key: "z" })
		expect(order()).toEqual(original)

		const front = await key({
			altKey: true,
			code: "BracketRight",
			key: "Dead",
		})
		expect(front.defaultPrevented).toBe(true)
		expect(order()).toEqual([first.id, third.id, fourth.id, second.id])
		const noOp = await key({
			altKey: true,
			code: "BracketRight",
			key: "Dead",
		})
		expect(noOp.defaultPrevented).toBe(true)
		expect(order()).toEqual([first.id, third.id, fourth.id, second.id])
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("already at that stacking position")
		await key({ key: "z" })
		expect(order()).toEqual(original)
		selectLayer(third.name)
		const back = await key({
			altKey: true,
			code: "BracketLeft",
			key: "«",
		})
		expect(back.defaultPrevented).toBe(true)
		expect(order()).toEqual([third.id, first.id, second.id, fourth.id])
		await key({ key: "z" })
		expect(order()).toEqual(original)
		await key({ key: "z", shiftKey: true })
		expect(order()).toEqual([third.id, first.id, second.id, fourth.id])

		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		title.focus()
		const beforeEditable = order()
		const editable = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			...platformMod,
			key: "]",
		})
		title.dispatchEvent(editable)
		expect(editable.defaultPrevented).toBe(false)
		expect(order()).toEqual(beforeEditable)

		const help = document.querySelector<HTMLButtonElement>(
			'button[aria-controls="design-contextual-help"]',
		)
		if (help === null) throw new Error("Canvas Help was not found.")
		act(() => help.click())
		expect(document.querySelector("canvas-help")?.textContent).toContain(
			"changes stacking",
		)
	})

	it("routes X paint shortcuts with exact modifier, focus, selection, and history semantics", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const stroke = {
			...DEFAULT_DESIGN_STROKE_STYLE,
			swatchId: "swatch:ink",
			width: 5,
			cap: "round" as const,
		}
		const initialDocument: DesignDocument = {
			...base,
			objects: base.objects.map((object) =>
				object.id === first.id
					? {
							...object,
							appearance: {
								fill: { swatchId: "swatch:coral" },
								stroke,
							},
						}
					: object,
			),
		}
		const storage = new Map<string, string>()
		mountDesign({ initialDocument }, storage)
		const artboard = document.querySelector<HTMLElement>("artboard-wrap")
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(first.name))
		if (artboard === null || layer === undefined)
			throw new Error("Design artboard or source layer was not found.")
		expect(artboard.getAttribute("aria-keyshortcuts")).toBe(
			"X Shift+X Meta+X Control+X Meta+] Control+] Meta+[ Control+[ Alt+Meta+] Alt+Control+] Alt+Meta+[ Alt+Control+[",
		)
		act(() => layer.click())

		const key = (options: KeyboardEventInit): KeyboardEvent => {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...options,
			})
			window.dispatchEvent(event)
			return event
		}
		await act(async () => {
			key({ key: "x" })
			await Promise.resolve()
		})
		expect(
			document
				.querySelector('button[aria-label^="Stroke paint:"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")
		expect(document.querySelector("[data-footer-status]")?.textContent).toBe(
			"Stroke paint target active.",
		)
		const afterToggle = storage.get(DESIGN_STORAGE_KEY)
		const alt = key({ altKey: true, key: "x" })
		expect(alt.defaultPrevented).toBe(false)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(afterToggle)

		await act(async () => {
			// Uppercase from Caps Lock remains the plain-X command without Shift.
			key({ key: "X" })
			await Promise.resolve()
		})
		expect(
			document
				.querySelector('button[aria-label^="Fill paint:"]')
				?.getAttribute("aria-pressed"),
		).toBe("true")

		const mod = key({ ctrlKey: true, key: "x" })
		expect(mod.defaultPrevented).toBe(false)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(afterToggle)

		await act(async () => {
			key({ key: "x", shiftKey: true })
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.find(({ id }) => id === first.id)?.appearance).toEqual(
			{
				fill: { swatchId: "swatch:ink" },
				stroke: { ...stroke, swatchId: "swatch:coral" },
			},
		)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain(`Swapped fill and stroke for ${first.name}`)

		await act(async () => {
			key({ ctrlKey: true, key: "z" })
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.find(({ id }) => id === first.id)?.appearance).toEqual(
			{
				fill: { swatchId: "swatch:coral" },
				stroke,
			},
		)
		await act(async () => {
			key({ ctrlKey: true, key: "z", shiftKey: true })
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.find(({ id }) => id === first.id)?.appearance.fill,
		).toEqual({
			swatchId: "swatch:ink",
		})

		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		title.focus()
		const editableX = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "x",
		})
		title.dispatchEvent(editableX)
		expect(editableX.defaultPrevented).toBe(false)
		expect(document.activeElement).toBe(title)

		const otherLayer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => !button.textContent?.includes(first.name))
		if (otherLayer === undefined) throw new Error("Second layer was not found.")
		act(() => {
			otherLayer.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
		})
		const beforeRejected = storage.get(DESIGN_STORAGE_KEY)
		await act(async () => {
			key({ key: "x", shiftKey: true })
			await Promise.resolve()
		})
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(beforeRejected)
	})

	it("defers paint swapping and Cut while a Pen draft is active", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const initialDocument: DesignDocument = {
			...base,
			objects: base.objects.map((object) =>
				object.id === first.id
					? {
							...object,
							appearance: {
								fill: { swatchId: "swatch:coral" },
								stroke: {
									...DEFAULT_DESIGN_STROKE_STYLE,
									swatchId: "swatch:ink",
									width: 2,
								},
							},
						}
					: object,
			),
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument }, storage)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation(() => undefined)
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(() => undefined)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(first.name))
		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		const canvas = stage.container().querySelector("canvas")
		const artboard = document.querySelector<HTMLElement>("artboard-wrap")
		if (
			layer === undefined ||
			pen === null ||
			canvas === null ||
			artboard === null
		)
			throw new Error("Pen draft controls were not found.")
		act(() => {
			layer.click()
			pen.click()
		})
		const fire = (type: string): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: 80,
					clientY: 100,
					isPrimary: true,
					pointerId: 91,
					pointerType: "mouse",
				}),
			)
		}
		await act(async () => {
			fire("pointerdown")
			fire("pointerup")
			await Promise.resolve()
		})
		const before = storage.get(DESIGN_STORAGE_KEY)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "x", shiftKey: true }),
			)
			await Promise.resolve()
		})
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(before)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Finish the active canvas gesture")
		const writes: string[] = []
		const cut = clipboardEvent("cut", {
			getData: () => "",
			setData: (format) => writes.push(format),
		})
		act(() => artboard.dispatchEvent(cut))
		expect(cut.defaultPrevented).toBe(false)
		expect(writes).toEqual([])
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(before)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("before cutting")
	})

	it("cuts the same payload as Copy only after a successful clipboard write", async () => {
		const storage = new Map<string, string>()
		const initialDocument = createInitialDocument()
		mountDesign({ initialDocument }, storage)
		const first = initialDocument.objects[0]!
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(first.name))
		const artboard = document.querySelector<HTMLElement>("artboard-wrap")
		if (layer === undefined || artboard === null)
			throw new Error("Design artboard or source layer was not found.")
		act(() => layer.click())

		const copyEntries = new Map<string, string>()
		const copyData = {
			getData: (format: string) => copyEntries.get(format) ?? "",
			setData: (format: string, value: string) => {
				copyEntries.set(format, value)
			},
		}
		const copy = clipboardEvent("copy", copyData)
		act(() => artboard.dispatchEvent(copy))
		expect(copy.defaultPrevented).toBe(true)

		const cutEntries = new Map<string, string>()
		const cutData = {
			getData: (format: string) => cutEntries.get(format) ?? "",
			setData: (format: string, value: string) => {
				cutEntries.set(format, value)
			},
		}
		const cut = clipboardEvent("cut", cutData)
		await act(async () => {
			artboard.dispatchEvent(cut)
			await Promise.resolve()
		})
		expect(cut.defaultPrevented).toBe(true)
		expect([...cutEntries]).toEqual([...copyEntries])
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map(({ id }) => id)).not.toContain(first.id)
		expect(document.querySelector("[data-footer-status]")?.textContent).toBe(
			"Cut 1 vector object.",
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map(({ id }) => id)).toContain(first.id)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					ctrlKey: true,
					key: "z",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map(({ id }) => id)).not.toContain(first.id)

		const paste = clipboardEvent("paste", cutData)
		await act(async () => {
			artboard.dispatchEvent(paste)
			await Promise.resolve()
		})
		expect(paste.defaultPrevented).toBe(true)
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects).toHaveLength(initialDocument.objects.length)
		expect(saved.objects.some(({ id }) => id === first.id)).toBe(false)
		expect(saved.objects.some(({ name }) => name === first.name)).toBe(true)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(
			[
				...document.querySelectorAll(
					'design-layers-tile [data-layer-kind="object"]',
				),
			].some((button) => button.getAttribute("aria-selected") === "true"),
		).toBe(false)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		expect(
			[
				...document.querySelectorAll<HTMLButtonElement>(
					'design-layers-tile [data-layer-kind="object"]',
				),
			]
				.find((button) => button.textContent?.includes(first.name))
				?.getAttribute("aria-selected"),
		).toBe("true")
	})

	it("keeps failed, locked, editable, and palette-local cuts non-destructive", async () => {
		const base = createInitialDocument()
		const first = base.objects[0]!
		const initialDocument: DesignDocument = {
			...base,
			objects: base.objects.map((object) =>
				object.id === first.id ? { ...object, locked: true } : object,
			),
		}
		const storage = new Map<string, string>()
		mountDesign({ initialDocument }, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(first.name))
		const artboard = document.querySelector<HTMLElement>("artboard-wrap")
		if (layer === undefined || artboard === null)
			throw new Error("Design artboard or locked layer was not found.")
		act(() => layer.click())
		const initial = storage.get(DESIGN_STORAGE_KEY)
		const writes: string[] = []
		const locked = clipboardEvent("cut", {
			getData: () => "",
			setData: (format) => writes.push(format),
		})
		act(() => artboard.dispatchEvent(locked))
		expect(locked.defaultPrevented).toBe(false)
		expect(writes).toEqual([])
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(initial)

		act(() => {
			const unlock = [
				...document.querySelectorAll<HTMLButtonElement>(
					"design-object-actions button",
				),
			].find((button) => button.textContent?.includes("Locked"))
			if (unlock === undefined) throw new Error("Unlock action was not found.")
			unlock.click()
		})
		const beforeThrow = storage.get(DESIGN_STORAGE_KEY)
		let writeCount = 0
		const throwing = clipboardEvent("cut", {
			getData: () => "",
			setData: () => {
				writeCount += 1
				if (writeCount === 3) throw new Error("clipboard full")
			},
		})
		act(() => artboard.dispatchEvent(throwing))
		expect(writeCount).toBe(3)
		expect(throwing.defaultPrevented).toBe(false)
		expect(storage.get(DESIGN_STORAGE_KEY)).toBe(beforeThrow)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("nothing was cut")

		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		const editableWrites: string[] = []
		const editable = clipboardEvent("cut", {
			getData: () => "",
			setData: (format) => editableWrites.push(format),
		})
		act(() => title.dispatchEvent(editable))
		expect(editable.defaultPrevented).toBe(false)
		expect(editableWrites).toEqual([])

		const command = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Command Palette"]',
		)
		if (command === null) throw new Error("Command center was not found.")
		act(() => command.click())
		const search = document.querySelector<HTMLInputElement>(
			'input[aria-label="Search commands"]',
		)
		if (search === null) throw new Error("Command search was not found.")
		const paletteWrites: string[] = []
		const paletteCut = clipboardEvent("cut", {
			getData: () => "",
			setData: (format) => paletteWrites.push(format),
		})
		act(() => search.dispatchEvent(paletteCut))
		expect(paletteCut.defaultPrevented).toBe(false)
		expect(paletteWrites).toEqual([])
	})

	it("authors the complete stroke vocabulary and renders it on canvas", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]:last-of-type',
		)
		if (layer === null) throw new Error("Design layer was not found.")
		act(() => layer.click())
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (strokeTarget === null) throw new Error("Stroke target was not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		if (ink === null) throw new Error("Stroke swatch was not found.")
		await act(async () => {
			ink.click()
			await Promise.resolve()
		})

		const input = (label: string): HTMLInputElement => {
			const result = document.querySelector<HTMLInputElement>(
				`input[aria-label="Stroke ${label}"]`,
			)
			if (result === null) throw new Error(`Stroke ${label} was not found.`)
			return result
		}
		const setNumber = async (label: string, value: string): Promise<void> => {
			await act(async () => {
				const field = input(label)
				field.focus()
				field.value = value
				field.dispatchEvent(new InputEvent("input", { bubbles: true }))
				await Promise.resolve()
			})
			await act(async () => {
				const field = input(label)
				field.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						cancelable: true,
						key: "Enter",
					}),
				)
				await Promise.resolve()
			})
		}
		const setSelect = async (label: string, value: string): Promise<void> => {
			await act(async () => {
				const field = document.querySelector<HTMLSelectElement>(
					`select[aria-label="Stroke ${label}"]`,
				)
				if (field === null) throw new Error(`Stroke ${label} was not found.`)
				field.value = value
				field.dispatchEvent(new Event("change", { bubbles: true }))
				await Promise.resolve()
			})
		}
		await setNumber("width", "6")
		await setSelect("cap", "round")
		await setSelect("join", "bevel")
		await setNumber("miter limit", "8")
		await act(async () => {
			const dash = input("dash pattern")
			dash.value = "7, 3, 2"
			dash.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		await act(async () => {
			input("dash pattern").dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			)
			await Promise.resolve()
		})
		await setNumber("dash offset", "-2")
		await act(async () => {
			const width = input("width")
			width.focus()
			width.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "ArrowUp",
					shiftKey: true,
				}),
			)
			width.blur()
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.find((object) => object.appearance.stroke !== undefined)
				?.appearance.stroke,
		).toEqual({
			swatchId: "swatch:ink",
			width: 16,
			cap: "round",
			join: "bevel",
			miterLimit: 8,
			dashArray: [7, 3, 2],
			dashOffset: -2,
		})
		const rendered = stage
			.find(".design-object")
			.find(
				(node: { getAttr(name: string): unknown }) =>
					node.getAttr("strokeWidth") === 16,
			)
		expect(rendered?.getAttrs()).toMatchObject({
			strokeWidth: 16,
			lineCap: "round",
			lineJoin: "bevel",
			miterLimit: 8,
			dash: [7, 3, 2],
			dashOffset: -2,
		})

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					ctrlKey: true,
					key: "z",
				}),
			)
			await Promise.resolve()
		})
		expect(input("width").value).toBe("6")
		expect(
			JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}").objects.find(
				(object: DesignObject) => object.appearance.stroke !== undefined,
			)?.appearance.stroke?.width,
		).toBe(6)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					ctrlKey: true,
					key: "z",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(input("width").value).toBe("16")
	})

	it("exposes why selection appearance controls are disabled", () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Expected a design object.")
		mountDesign({
			initialDocument: {
				...initial,
				objects: [{ ...first, locked: true }, ...initial.objects.slice(1)],
			},
		})
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes(first.name))
		if (layer === undefined) throw new Error("Locked layer was not found.")
		act(() => layer.click())
		const fill = document.querySelector<HTMLButtonElement>(
			'button[aria-label^="Fill paint:"]',
		)
		expect(fill?.disabled).toBe(true)
		expect(fill?.getAttribute("aria-describedby")).toBe(
			"appearance-eligibility",
		)
		expect(
			document.getElementById("appearance-eligibility")?.textContent,
		).toContain(`Unlock ${first.name}`)
	})

	it("updates shared swatch consumers without rewriting object geometry", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const before = createInitialDocument().objects.map(
			(object) => object.geometry,
		)
		const red = [...document.querySelectorAll("channel-input label")]
			.find((label) => label.querySelector("span")?.textContent === "R")
			?.querySelector("input")
		if (!(red instanceof HTMLInputElement))
			throw new Error("Selected swatch red channel was not found.")
		await act(async () => {
			red.value = "120"
			red.dispatchEvent(new InputEvent("input", { bubbles: true }))
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.geometry)).toEqual(before)
		expect(saved.objects[0]?.appearance.fill?.swatchId).toBe("swatch:coral")
		expect(stage.findOne(".design-object").fill()).toContain("120")
	})

	it("uses the current optional appearance for new Pen, rectangle, and ellipse objects", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
		const canvas = stage.container().querySelector("canvas")
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (canvas === null || strokeTarget === null)
			throw new Error("Appearance or canvas controls were not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		const noFill = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Set fill paint to none"]',
		)
		if (ink === null || noFill === null)
			throw new Error("Optional paint actions were not found.")
		await act(async () => {
			ink.click()
			noFill.click()
			await Promise.resolve()
		})

		const fire = (
			type: string,
			x: number,
			y: number,
			pointerId: number,
		): void => {
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
		const drawShape = async (
			label: "Rectangle" | "Ellipse",
			start: readonly [number, number],
			end: readonly [number, number],
			pointerId: number,
		): Promise<void> => {
			const tool = document.querySelector<HTMLButtonElement>(
				`button[aria-label="${label}"]`,
			)
			if (tool === null) throw new Error(`${label} tool was not found.`)
			act(() => tool.click())
			await act(async () => {
				fire("pointerdown", start[0], start[1], pointerId)
				fire("pointermove", end[0], end[1], pointerId)
				fire("pointerup", end[0], end[1], pointerId)
				await Promise.resolve()
			})
		}
		await drawShape("Rectangle", [300, 240], [380, 300], 21)
		await drawShape("Ellipse", [420, 260], [500, 340], 22)

		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		if (pen === null) throw new Error("Pen tool was not found.")
		act(() => pen.click())
		await act(async () => {
			fire("pointerdown", 340, 420, 23)
			fire("pointerup", 340, 420, 23)
			fire("pointerdown", 440, 440, 24)
			fire("pointerup", 440, 440, 24)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(
			saved.objects.slice(-3).map((object) => object.geometry.kind),
		).toEqual(["rectangle", "ellipse", "path"])
		expect(saved.objects.slice(-3).map((object) => object.appearance)).toEqual([
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
			{
				stroke: {
					...DEFAULT_DESIGN_STROKE_STYLE,
					swatchId: "swatch:ink",
					width: 1,
				},
			},
		])
	})

	it("renders authored geometry through the shared contour component", () => {
		const stage = mountDesign()
		expect(stage.find(".vector-contour-path").length).toBeGreaterThan(1)
		expect(stage.findOne(".design-object")).toBeDefined()
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]:last-of-type',
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

	it("keeps Select All and Escape mode-aware without stealing native text selection", async () => {
		const initial = createInitialDocument()
		mountDesign({
			initialDocument: {
				...initial,
				objects: [
					initial.objects[0]!,
					{ ...initial.objects[1]!, locked: true },
					{ ...initial.objects[0]!, id: "object:hidden", hidden: true },
				],
			},
		})
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "a",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		const selected = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		]
		expect(selected).toHaveLength(1)
		expect(selected[0]?.textContent).toContain("Coral rectangle")
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toContain("1 object selected")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(
			document.querySelectorAll(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		).toHaveLength(0)
		const title = document.querySelector<HTMLInputElement>(
			'design-canvas-tile input[aria-label="Document title"]',
		)
		if (title === null) throw new Error("Document title field was not found.")
		title.focus()
		title.setSelectionRange(0, title.value.length)
		await act(async () => {
			title.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "a",
					ctrlKey: true,
					bubbles: true,
				}),
			)
			await Promise.resolve()
		})
		expect(title.selectionStart).toBe(0)
		expect(title.selectionEnd).toBe(title.value.length)
		expect(
			document.querySelectorAll(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			),
		).toHaveLength(0)
	})

	it("keeps corner controls in Object and exposes handles in Select mode", async () => {
		const initial = createInitialDocument()
		const storage = new Map<string, string>()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [expanded] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		if (layer === null) throw new Error("Path layer was not found.")
		act(() => layer.click())
		expect(stage.find(".vector-node")).toHaveLength(0)
		expect(stage.find(".vector-corner-profile-handle")).toHaveLength(4)
		const fieldset = document.querySelector<HTMLFieldSetElement>(
			"fieldset[data-corner-profile-controls]",
		)
		const profile = fieldset?.querySelector<HTMLSelectElement>(
			'select[aria-label="Corner profile"]',
		)
		if (fieldset === null || profile === undefined || profile === null)
			throw new Error("Corner profile controls were not rendered.")
		expect(fieldset.closest("design-object-tile")).not.toBeNull()
		expect(fieldset.closest("design-canvas")).toBeNull()
		expect(fieldset.getAttribute("aria-label")).toContain("4 selected corners")
		await act(async () => {
			profile.value = "circular"
			profile.dispatchEvent(new Event("change", { bubbles: true }))
			await Promise.resolve()
		})
		const savedCorners = () => {
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			const object = saved.objects?.[0]
			return object?.geometry.kind === "path"
				? object.geometry.contours[0]?.points.map(({ corner }) => corner)
				: []
		}
		expect(savedCorners()).toEqual(
			Array.from({ length: 4 }, () => ({
				profile: "circular",
				amount: 12,
			})),
		)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(savedCorners()).toEqual([undefined, undefined, undefined, undefined])
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(savedCorners()).toEqual(
			Array.from({ length: 4 }, () => ({
				profile: "circular",
				amount: 12,
			})),
		)
	})

	it("renders layer-colored contour nodes at Select and Direct Selection sizes", () => {
		const initial = createInitialDocument()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		if (expanded.geometry.kind !== "path") throw new Error("Expected a path.")
		const shaped: DesignObject = {
			...expanded,
			geometry: {
				...expanded.geometry,
				contours: expanded.geometry.contours.map((contour, contourIndex) => ({
					...contour,
					points: contour.points.map((point, pointIndex) =>
						contourIndex === 0 && pointIndex === 0
							? {
									...point,
									mode: "soft" as const,
									incoming: { x: -12, y: 0 },
									outgoing: { x: 12, y: 0 },
								}
							: { ...point, mode: "hard" as const },
					),
				})),
			},
		}
		const stage = mountDesign({
			initialDocument: { ...initial, objects: [shaped] },
		})
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct selection controls were not found.")

		act(() => layer.click())
		const selectedContourNodes = stage.find(".design-contour-node")
		expect(selectedContourNodes.length).toBeGreaterThan(0)
		for (const marker of selectedContourNodes) {
			expect(marker.width() * marker.getAbsoluteScale().x).toBeCloseTo(3)
			expect(marker.height() * marker.getAbsoluteScale().y).toBeCloseTo(3)
			expect(marker.fill()).toBe(designLayerUiColorCss("red"))
		}

		act(() => direct.click())
		const directNodes = stage.find(".vector-node")
		expect(directNodes.length).toBeGreaterThan(0)
		expect(
			directNodes.filter((node) => node.getClassName() === "Circle"),
		).toHaveLength(1)
		expect(
			directNodes.filter((node) => node.getClassName() === "Rect"),
		).toHaveLength(directNodes.length - 1)
		const theme = readDesignCanvasTheme(
			document.querySelector("design-application"),
		)
		for (const marker of directNodes) {
			expect(marker.width() * marker.getAbsoluteScale().x).toBeCloseTo(5)
			expect(marker.height() * marker.getAbsoluteScale().y).toBeCloseTo(5)
			expect(marker.strokeWidth() * marker.getAbsoluteScale().x).toBeCloseTo(1)
			expect(marker.fill()).toBe(theme.handleFill)
		}
	})

	it("quietly warns when a contour clamps its intended corner amount", () => {
		const initial = createInitialDocument()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		if (expanded.geometry.kind !== "path") throw new Error("Expected a path.")
		const profiled: DesignObject = {
			...expanded,
			transform: { a: 2, b: 0, c: 0, d: 0.2, e: 0, f: 0 },
			geometry: {
				...expanded.geometry,
				contours: expanded.geometry.contours.map((contour) => ({
					...contour,
					points: contour.points.map((point) => ({
						...point,
						corner: { profile: "circular" as const, amount: 30 },
					})),
				})),
			},
		}
		mountDesign({ initialDocument: { ...initial, objects: [profiled] } })
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		if (layer === null) throw new Error("Profiled path layer was not found.")
		act(() => layer.click())
		const amount = document.querySelector<HTMLInputElement>(
			'input[aria-label="Corner amount in document geometry units"]',
		)
		const warning = document.querySelector<HTMLElement>(
			"[data-corner-amount-warning]",
		)
		expect(amount?.dataset.cornerAmountClamped).toBe("true")
		expect(amount?.getAttribute("aria-describedby")).toBe(
			"corner-amount-clamp-warning",
		)
		expect(warning?.textContent).toContain("4 corners render as small as")
		expect(warning?.textContent).toContain("Intended sizes are retained")
	})

	it("expands a live rectangle from Object and reveals Select-mode corner handles", async () => {
		const initial = createInitialDocument()
		const original = initial.objects[0]!
		const originalIndex = initial.objects.findIndex(
			(object) => object.id === original.id,
		)
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: initial }, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		if (layer === undefined) throw new Error("Rectangle layer was not found.")
		act(() => layer.click())
		expect(stage.find(".vector-corner-profile-handle")).toHaveLength(0)
		expect(
			document.querySelector("fieldset[data-corner-profile-controls]"),
		).toBeNull()
		const expand = document.querySelector<HTMLButtonElement>(
			"design-object-tile button[data-expand-shape]",
		)
		if (expand === null) throw new Error("Expand Shape was not rendered.")
		expect(expand.disabled).toBe(false)

		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		const nodes = stage.find(".vector-node")
		const handles = stage.find(".vector-corner-profile-handle")
		expect(nodes).toHaveLength(0)
		expect(handles).toHaveLength(4)
		const profileControls = document.querySelector<HTMLFieldSetElement>(
			"fieldset[data-corner-profile-controls]",
		)
		expect(profileControls?.closest("design-object-tile")).not.toBeNull()
		expect(profileControls?.getAttribute("aria-label")).toContain(
			"4 selected corners",
		)
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const converted = saved.objects[originalIndex]
		expect(converted?.geometry.kind).toBe("path")
		expect(converted?.id).toBe(original.id)
		expect(converted?.transform).toEqual(original.transform)
		expect(converted?.appearance).toEqual(original.appearance)
		expect(saved.objects.map(({ id }) => id)).toEqual(
			initial.objects.map(({ id }) => id),
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		const restored = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(restored.objects[originalIndex]).toEqual(original)
		expect(stage.find(".vector-corner-profile-handle")).toHaveLength(0)
		expect(
			document.querySelector("fieldset[data-corner-profile-controls]"),
		).toBeNull()
	})

	it("materializes live corners for ordinary Direct Selection editing", async () => {
		const initial = createInitialDocument()
		const rectangle = initial.objects[0]
		if (rectangle === undefined)
			throw new Error("Rectangle fixture is missing.")
		let identity = 0
		const path = expandDesignShape(rectangle, () => `source:${identity++}`)
		if (path.geometry.kind !== "path") throw new Error("Expected a path.")
		const profiled: DesignObject = {
			...path,
			geometry: {
				...path.geometry,
				contours: path.geometry.contours.map((contour, contourIndex) => ({
					...contour,
					points: contour.points.map((point, pointIndex) =>
						contourIndex === 0 && pointIndex === 0
							? {
									...point,
									corner: {
										profile: "circular" as const,
										amount: 40,
									},
								}
							: point,
					),
				})),
			},
		}
		const storage = new Map<string, string>()
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [profiled] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Shape editing controls were not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"design-object-tile button[data-expand-shape]",
		)
		if (expand === null) throw new Error("Expand Shape was not found.")
		expect(expand.disabled).toBe(false)
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const materialized = saved.objects[0]
		if (materialized?.geometry.kind !== "path")
			throw new Error("Expected materialized path geometry.")
		const materializedPoints = materialized.geometry.contours.flatMap(
			({ points }) => points,
		)
		expect(materializedPoints.length).toBeGreaterThan(4)
		expect(materializedPoints.every(({ corner }) => corner === undefined)).toBe(
			true,
		)
		expect(
			materializedPoints.some(
				({ incoming, outgoing }) =>
					incoming !== undefined || outgoing !== undefined,
			),
		).toBe(true)
		expect(expand.disabled).toBe(true)
		expect(
			document.getElementById("expand-shape-eligibility")?.textContent,
		).toContain("already ordinary path")

		act(() => direct.click())
		expect(stage.find(".vector-node")).toHaveLength(materializedPoints.length)
		expect(stage.find(".vector-handle").length).toBeGreaterThan(0)
	})

	it("commits all Select-mode corners from a native release with a stale stage sample", async () => {
		const initial = createInitialDocument()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: initial }, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		const canvas = stage.container().querySelector("canvas")
		if (layer === undefined || canvas === null)
			throw new Error("Corner gesture controls were not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"design-object-tile button[data-expand-shape]",
		)
		if (expand === null) throw new Error("Expand Shape was not found.")
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		const handle = stage.findOne(".vector-corner-profile-handle")
		if (handle === undefined) throw new Error("Corner handle was not rendered.")

		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => captured.add(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation((pointerId) => {
			captured.delete(pointerId)
		})
		const staleStagePoint = handle.getAbsolutePosition()
		vi.spyOn(stage, "getPointerPosition").mockImplementation(
			() => staleStagePoint,
		)
		const pointerId = 183
		const pointerDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			clientX: staleStagePoint.x,
			clientY: staleStagePoint.y,
			isPrimary: true,
			pointerId,
			pointerType: "mouse",
		})
		Object.defineProperty(pointerDown, "currentTarget", { value: canvas })
		await act(async () => {
			handle.fire("pointerdown", { evt: pointerDown }, true)
			window.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: staleStagePoint.x + 18,
					clientY: staleStagePoint.y + 18,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected converted path geometry.")
		const amounts = saved.objects[0].geometry.contours[0]?.points.map(
			(point) => point.corner?.amount ?? 0,
		)
		expect(amounts).toHaveLength(4)
		expect(amounts?.every((amount) => amount > 0)).toBe(true)
		expect(new Set(amounts)).toHaveLength(1)
	})

	it("keeps a large corner sharp when an outward drag crosses the perimeter", async () => {
		const initial = createInitialDocument()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		if (expanded.geometry.kind !== "path")
			throw new Error("Expected expanded path geometry.")
		const profiled: DesignObject = {
			...expanded,
			geometry: {
				...expanded.geometry,
				contours: expanded.geometry.contours.map((contour, contourIndex) => ({
					...contour,
					points: contour.points.map((point, pointIndex) =>
						contourIndex === 0 && pointIndex === 0
							? {
									...point,
									corner: { profile: "circular" as const, amount: 120 },
								}
							: point,
					),
				})),
			},
		}
		const storage = new Map<string, string>()
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [profiled] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (layer === null || direct === null || canvas === null)
			throw new Error("Corner drag controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.find(".vector-node")[0]
		if (node === undefined) throw new Error("Direct node was not rendered.")
		const selectPointerId = 184
		const selectDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: selectPointerId,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(selectDown)
			node.fire("pointerdown", { evt: selectDown }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: selectPointerId,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		const handle = stage.findOne(".vector-corner-profile-handle")
		if (handle === undefined) throw new Error("Corner handle was not rendered.")
		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => captured.add(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation((pointerId) => captured.delete(pointerId))
		const handlePosition = handle.getAbsolutePosition()
		const nodePosition = node.getAbsolutePosition()
		const outsidePosition = {
			x: nodePosition.x - (handlePosition.x - nodePosition.x),
			y: nodePosition.y - (handlePosition.y - nodePosition.y),
		}
		const pointerId = 185
		const pointerDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			clientX: handlePosition.x,
			clientY: handlePosition.y,
			isPrimary: true,
			pointerId,
			pointerType: "mouse",
		})
		Object.defineProperty(pointerDown, "currentTarget", { value: canvas })
		await act(async () => {
			stage.setPointersPositions(pointerDown)
			handle.fire("pointerdown", { evt: pointerDown }, true)
			window.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: outsidePosition.x,
					clientY: outsidePosition.y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const savedCorner = () => {
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			const object = saved.objects?.[0]
			return object?.geometry.kind === "path"
				? object.geometry.contours[0]?.points[0]?.corner
				: undefined
		}
		expect(savedCorner()).toBeUndefined()
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(savedCorner()).toEqual({ profile: "circular", amount: 120 })
	})

	it("synchronizes direct node selection across canvas, inspector, and accessibility state", async () => {
		const initial = createInitialDocument()
		const storage = new Map<string, string>()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [expanded] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct selection controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.findOne(".vector-node")
		if (node === undefined) throw new Error("Direct node was not rendered.")
		const event = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 72,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(event)
			node.fire("pointerdown", { evt: event }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 72,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(0)
		expect(stage.findOne(".vector-node").fill()).toBe(
			designLayerUiColorCss("red"),
		)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Direct selection: 1 node",
		)
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 node")
		if (expanded.geometry.kind !== "path") throw new Error("Expected a path.")
		const originalPoints = expanded.geometry.contours[0]?.points
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected saved path geometry.")
		expect(saved.objects[0].geometry.contours[0]?.points[0]?.x).toBe(
			(originalPoints?.[0]?.x ?? 0) + 1,
		)
		expect(saved.objects[0].geometry.contours[0]?.points.slice(1)).toEqual(
			originalPoints?.slice(1),
		)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (saved.objects[0]?.geometry.kind !== "path")
			throw new Error("Expected restored path geometry.")
		expect(saved.objects[0].geometry.contours[0]?.points).toEqual(
			originalPoints,
		)
	})

	it("selects and nudges handles independently with modifiers and mixed controls", async () => {
		const fixture = directControlFixture()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: fixture.document }, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct Selection controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.findOne(`#${fixture.hardPointId}`)
		const handle = node
			?.getParent()
			?.find(".bezier-handle")
			.find((candidate) => candidate.hasName("vector-handle-outgoing"))
		const handleTarget = handle?.getParent()?.findOne(".outline-control-helper")
		if (
			node === undefined ||
			handle === undefined ||
			handleTarget === undefined
		)
			throw new Error("Hard node handles were not rendered.")
		const select = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 431,
			pointerType: "mouse",
		})
		await act(async () => {
			handleTarget.fire("pointerdown", { evt: select }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 431,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 handle")
		const original =
			fixture.object.geometry.kind === "path"
				? fixture.object.geometry.contours[0]!.points[0]!
				: undefined
		if (original === undefined) throw new Error("Expected path geometry.")
		const savedPoint = (): DesignObject["geometry"] extends never
			? never
			: typeof original => {
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			const object = saved.objects[0]
			if (object?.geometry.kind !== "path")
				throw new Error("Expected saved path geometry.")
			return object.geometry.contours[0]!.points[0]!
		}
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
			await Promise.resolve()
		})
		expect(savedPoint()).toMatchObject({
			x: original.x,
			y: original.y,
			incoming: original.incoming,
			outgoing: {
				x: (original.outgoing?.x ?? 0) + 1,
				y: original.outgoing?.y,
			},
		})
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(savedPoint().outgoing?.x).toBe((original.outgoing?.x ?? 0) + 101)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(savedPoint()).toEqual(original)
		await act(async () => {
			stage.findOne(`#${fixture.hardPointId}`).fire(
				"pointerdown",
				{
					evt: new PointerEvent("pointerdown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						pointerId: 432,
						pointerType: "mouse",
						shiftKey: true,
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 handle, 1 node")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
			await Promise.resolve()
		})
		expect(savedPoint()).toMatchObject({
			x: original.x,
			y: original.y + 1,
			incoming: original.incoming,
			outgoing: original.outgoing,
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 handle, 1 node")
	})

	it("Alt-drags a hard node with fixed endpoints and supports history and cancel", async () => {
		const fixture = directControlFixture()
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: fixture.document }, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (layer === null || direct === null || canvas === null)
			throw new Error("Direct Selection controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.findOne(`#${fixture.hardPointId}`)
		if (node === undefined) throw new Error("Hard node was not rendered.")
		const originalProjected = projectDesignObjectContours(fixture.object)[0]!
			.points[0]!
		const originalIncoming = {
			x: originalProjected.x + (originalProjected.incoming?.x ?? 0),
			y: originalProjected.y + (originalProjected.incoming?.y ?? 0),
		}
		const originalOutgoing = {
			x: originalProjected.x + (originalProjected.outgoing?.x ?? 0),
			y: originalProjected.y + (originalProjected.outgoing?.y ?? 0),
		}
		let pointer = node.getAbsolutePosition()
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => captured.add(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation((pointerId) => {
			captured.delete(pointerId)
		})
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: Readonly<{ x: number; y: number }>,
			pointerId: number,
		): void => {
			pointer = at
			const event = new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				clientX: at.x,
				clientY: at.y,
				isPrimary: true,
				pointerId,
				pointerType: "mouse",
				altKey: true,
			})
			Object.defineProperty(event, "currentTarget", { value: canvas })
			node.fire(type, { evt: event }, true)
		}
		const start = { ...pointer }
		const end = { x: start.x + 34, y: start.y + 21 }
		await act(async () => {
			fire("pointerdown", start, 433)
			fire("pointermove", end, 433)
			fire("pointerup", end, 433)
			await Promise.resolve()
		})
		const savedObject = (): DesignObject => {
			const saved = JSON.parse(
				storage.get(DESIGN_STORAGE_KEY) ?? "{}",
			) as DesignDocument
			const object = saved.objects[0]
			if (object === undefined) throw new Error("Expected a saved object.")
			return object
		}
		let projected = projectDesignObjectContours(savedObject())[0]!.points[0]!
		expect({
			x: projected.x + (projected.incoming?.x ?? 0),
			y: projected.y + (projected.incoming?.y ?? 0),
		}).toEqual(originalIncoming)
		expect({
			x: projected.x + (projected.outgoing?.x ?? 0),
			y: projected.y + (projected.outgoing?.y ?? 0),
		}).toEqual(originalOutgoing)
		expect(projected.x).not.toBe(originalProjected.x)
		expect(captured.size).toBe(0)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		expect(savedObject()).toEqual(fixture.object)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		projected = projectDesignObjectContours(savedObject())[0]!.points[0]!
		expect(projected.x).not.toBe(originalProjected.x)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
			pointer = node.getAbsolutePosition()
			const cancelEnd = { x: pointer.x + 18, y: pointer.y - 12 }
			fire("pointerdown", pointer, 434)
			fire("pointermove", cancelEnd, 434)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		expect(savedObject()).toEqual(fixture.object)
		expect(captured.size).toBe(0)
	})

	it("commits Direct Selection from the raw release before capture loss", async () => {
		const initial = createInitialDocument()
		let identity = 0
		const expanded = expandDesignShape(initial.objects[0]!, () =>
			(identity += 1).toString(),
		)
		const storage = new Map<string, string>()
		const stage = mountDesign(
			{ initialDocument: { ...initial, objects: [expanded] } },
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (layer === null || direct === null || canvas === null)
			throw new Error("Direct Selection controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.findOne(".vector-node")
		const paper = stage.findOne(".design-paper")
		if (node === undefined || paper === undefined)
			throw new Error("Direct Selection geometry was not rendered.")

		const captured = new Set<number>()
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"setPointerCapture",
		).mockImplementation((pointerId) => {
			captured.add(pointerId)
		})
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"hasPointerCapture",
		).mockImplementation((pointerId) => captured.has(pointerId))
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"releasePointerCapture",
		).mockImplementation(function (this: HTMLCanvasElement, pointerId) {
			captured.delete(pointerId)
			this.dispatchEvent(
				new PointerEvent("lostpointercapture", {
					bubbles: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		})
		let pointer = node.getAbsolutePosition()
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			at: Readonly<{ x: number; y: number }>,
		): void => {
			pointer = at
			const event = new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				clientX: at.x,
				clientY: at.y,
				isPrimary: true,
				pointerId: 173,
				pointerType: "mouse",
			})
			Object.defineProperty(event, "currentTarget", { value: canvas })
			node.fire(type, { evt: event }, true)
		}
		const start = { ...pointer }
		const end = { x: start.x + 31, y: start.y + 23 }
		const documentTransform = paper
			.getParent()
			.getAbsoluteTransform()
			.copy()
			.invert()
		const worldStart = documentTransform.point(start)
		const worldEnd = documentTransform.point(end)
		await act(async () => {
			fire("pointerdown", start)
			fire("pointermove", { x: start.x + 9, y: start.y + 7 })
			fire("pointerup", end)
			await Promise.resolve()
		})

		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		if (
			saved.objects[0]?.geometry.kind !== "path" ||
			expanded.geometry.kind !== "path"
		)
			throw new Error("Expected saved path geometry.")
		const original = expanded.geometry.contours[0]!.points[0]!
		const committed = saved.objects[0].geometry.contours[0]!.points[0]!
		expect(committed.x).toBeCloseTo(original.x + worldEnd.x - worldStart.x)
		expect(committed.y).toBeCloseTo(original.y + worldEnd.y - worldStart.y)
		expect(captured.size).toBe(0)
	})

	it("nudges a multi-object selection as one atomic undo entry", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layers = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		]
		if (layers.length !== 2) throw new Error("Expected two design layers.")
		await act(async () => {
			layers[0]!.click()
			layers[1]!.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			)
			await Promise.resolve()
		})
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.transform.e)).toEqual([1, 1])
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects.map((object) => object.transform.e)).toEqual([0, 0])
	})

	it("edits exact live parameters and expands a selected shape in one undo step", async () => {
		const storage = new Map<string, string>()
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
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

	it("expands a selected stroke atomically and restores it with one undo", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...first,
					appearance: {
						...first.appearance,
						stroke: {
							swatchId: "swatch:ink",
							width: 12,
							cap: "round",
							join: "bevel",
							miterLimit: 4,
							dashArray: [20, 8],
							dashOffset: -3,
						},
					},
				},
				...initial.objects.slice(1),
			],
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Coral rectangle"))
		if (layer === undefined) throw new Error("Rectangle layer was not found.")
		act(() => layer.click())

		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		expect(expand.disabled).toBe(false)
		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects).toHaveLength(3)
		expect(saved.objects[0]).toMatchObject({
			name: "Coral rectangle fill",
			appearance: { fill: { swatchId: "swatch:coral" } },
		})
		expect(saved.objects[1]).toMatchObject({
			id: "object:coral",
			geometry: { kind: "path" },
			appearance: { fill: { swatchId: "swatch:ink" } },
		})
		expect(saved.objects[2]).toEqual(source.objects[1])
		expect(expand.disabled).toBe(true)
		expect(
			document.getElementById("expand-stroke-eligibility")?.textContent,
		).toContain("Assign a stroke")

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
		expect(saved).toEqual(source)
		expect(expand.disabled).toBe(false)
	})

	it("clears stale direct node selection after expanding a path stroke", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		let identity = 0
		const path = expandDesignShape(first, () => `source:${identity++}`)
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...path,
					appearance: {
						stroke: {
							swatchId: "swatch:ink",
							width: 12,
							cap: "round",
							join: "bevel",
							miterLimit: 4,
							dashArray: [],
							dashOffset: 0,
						},
					},
				},
			],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [{ kind: "object", id: path.id }],
			})),
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		const stage = mountDesign({}, storage)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct selection controls were not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		act(() => direct.click())
		const node = stage.findOne(".vector-node")
		if (node === undefined) throw new Error("Direct node was not rendered.")
		const pointerDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 267,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(pointerDown)
			node.fire("pointerdown", { evt: pointerDown }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 267,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(0)
		expect(stage.findOne(".vector-node").fill()).toBe(
			designLayerUiColorCss("red"),
		)

		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		expect(stage.find(".vector-node-selection")).toHaveLength(0)
		expect(stage.findOne(".vector-node").fill()).toBe(
			readDesignCanvasTheme(document.querySelector("design-application"))
				.handleFill,
		)
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"No direct controls selected.",
		)
	})

	it("leaves document, selection, and history unchanged when stroke expansion fails", async () => {
		const initial = createInitialDocument()
		const first = initial.objects[0]
		if (first === undefined) throw new Error("Missing rectangle fixture.")
		const source: DesignDocument = {
			...initial,
			objects: [
				{
					...first,
					name: "Degenerate stroke",
					geometry: {
						kind: "path",
						contours: [
							{
								id: "contour:degenerate",
								closed: false,
								points: [
									{ id: "point:degenerate:0", x: 10, y: 10 },
									{ id: "point:degenerate:1", x: 10, y: 10 },
								],
							},
						],
					},
					appearance: {
						stroke: {
							swatchId: "swatch:ink",
							width: 10,
							cap: "round",
							join: "round",
							miterLimit: 4,
							dashArray: [],
							dashOffset: 0,
						},
					},
				},
				...initial.objects.slice(1),
			],
		}
		const storage = new Map([[DESIGN_STORAGE_KEY, JSON.stringify(source)]])
		mountDesign({}, storage)
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
			),
		].find((button) => button.textContent?.includes("Degenerate stroke"))
		if (layer === undefined) throw new Error("Degenerate layer was not found.")
		act(() => layer.click())
		const expand = document.querySelector<HTMLButtonElement>(
			"button[data-expand-stroke]",
		)
		if (expand === null) throw new Error("Expand Stroke action was not found.")
		expect(expand.disabled).toBe(false)

		await act(async () => {
			expand.click()
			await Promise.resolve()
		})
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		expect(layer.getAttribute("aria-selected")).toBe("true")
		expect(document.querySelector("footer > span")?.textContent).toContain(
			"no visible length",
		)

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
		expect(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}")).toEqual(source)
		expect(layer.getAttribute("aria-selected")).toBe("true")
	})

	it.each([
		["nw", { x: -40, y: -30 }, ["maxX", "maxY"]],
		["n", { x: 23, y: -30 }, ["minX", "maxX", "maxY"]],
		["n", { x: -19, y: 30 }, ["minX", "maxX", "maxY"]],
		["ne", { x: 40, y: -30 }, ["minX", "maxY"]],
		["e", { x: 40, y: 17 }, ["minX", "minY", "maxY"]],
		["e", { x: -40, y: -21 }, ["minX", "minY", "maxY"]],
		["se", { x: 40, y: 30 }, ["minX", "minY"]],
		["s", { x: 13, y: 30 }, ["minX", "maxX", "minY"]],
		["s", { x: -11, y: -30 }, ["minX", "maxX", "minY"]],
		["sw", { x: -40, y: 30 }, ["maxX", "minY"]],
		["w", { x: -40, y: 29 }, ["maxX", "minY", "maxY"]],
		["w", { x: 40, y: -25 }, ["maxX", "minY", "maxY"]],
	] as const)(
		"previews and commits %s while preserving its opposite edge and inactive axis",
		async (handleName, delta, unchanged) => {
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
					'design-layers-tile [data-layer-kind="object"]',
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
			const beforeDrag = localStorage.getItem(DESIGN_STORAGE_KEY)
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
				canvas.dispatchEvent(
					new PointerEvent("pointermove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: pointer.x,
						clientY: pointer.y,
						isPrimary: true,
						pointerId: 7,
						pointerType: "mouse",
					}),
				)
				await Promise.resolve()
			})
			expect(localStorage.getItem(DESIGN_STORAGE_KEY)).toBe(beforeDrag)
			const previewPosition = stage
				.findOne(`.transform-handle-${handleName}`)
				.getAbsolutePosition()
			await act(async () => {
				canvas.dispatchEvent(
					new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						buttons: 0,
						clientX: pointer.x,
						clientY: pointer.y,
						isPrimary: true,
						pointerId: 7,
						pointerType: "mouse",
					}),
				)
				await Promise.resolve()
			})
			expect(
				stage.findOne(`.transform-handle-${handleName}`).getAbsolutePosition(),
			).toEqual(previewPosition)
			const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
			if (saved === null) throw new Error("Design document was not persisted.")
			const next = JSON.parse(saved) as DesignDocument
			const bounds = objectBounds(
				next.objects.find((object) => object.id === "object:coral")!,
			)
			if (bounds === null) throw new Error("Transformed object has no bounds.")
			const original = { minX: 82, minY: 102, maxX: 362, maxY: 342 }
			for (const key of unchanged) expect(bounds[key]).toBe(original[key])
		},
	)

	it("recomputes proportional edge resizing as Shift and Alt toggle", async () => {
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
		const layer = [
			...document.querySelectorAll<HTMLButtonElement>(
				'design-layers-tile [data-layer-kind="object"]',
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
		const east = stage.findOne(".transform-handle-e")
		const canvas = stage.container().querySelector("canvas")
		if (east === undefined || canvas === null)
			throw new Error("East design transform handle was not found.")
		const originalWest = stage
			.findOne(".transform-handle-w")
			.getAbsolutePosition()
		const originalEast = east.getAbsolutePosition()
		const originalNorth = stage
			.findOne(".transform-handle-n")
			.getAbsolutePosition()
		const originalSouth = stage
			.findOne(".transform-handle-s")
			.getAbsolutePosition()
		let pointer = originalEast
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
		await act(async () => {
			east.fire("pointerdown", {
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
			pointer = { x: pointer.x + 40, y: pointer.y + 19 }
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					buttons: 1,
					clientX: pointer.x,
					clientY: pointer.y,
					pointerId: 7,
					pointerType: "mouse",
				}),
			)
			await Promise.resolve()
		})
		const normalWest = stage
			.findOne(".transform-handle-w")
			.getAbsolutePosition()
		const normalEast = stage
			.findOne(".transform-handle-e")
			.getAbsolutePosition()
		expect(normalWest).toEqual(originalWest)
		expect(normalEast.x).not.toBe(originalEast.x)
		expect(normalEast.y).toBe(originalEast.y)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "Shift",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		const constrainedWest = stage
			.findOne(".transform-handle-w")
			.getAbsolutePosition()
		const constrainedEast = stage
			.findOne(".transform-handle-e")
			.getAbsolutePosition()
		const constrainedNorth = stage
			.findOne(".transform-handle-n")
			.getAbsolutePosition()
		const constrainedSouth = stage
			.findOne(".transform-handle-s")
			.getAbsolutePosition()
		expect(constrainedWest).toEqual(originalWest)
		expect(constrainedEast.x).toBe(normalEast.x)
		expect(
			(constrainedEast.x - constrainedWest.x) /
				(constrainedSouth.y - constrainedNorth.y),
		).toBeCloseTo(
			(originalEast.x - originalWest.x) / (originalSouth.y - originalNorth.y),
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					altKey: true,
					bubbles: true,
					key: "Alt",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		const centeredWest = stage
			.findOne(".transform-handle-w")
			.getAbsolutePosition()
		const centeredEast = stage
			.findOne(".transform-handle-e")
			.getAbsolutePosition()
		expect((centeredWest.x + centeredEast.x) / 2).toBeCloseTo(
			(originalWest.x + originalEast.x) / 2,
		)
		expect(centeredWest.y).toBe(originalWest.y)
		expect(centeredEast.y).toBe(originalEast.y)
		const centeredNorth = stage
			.findOne(".transform-handle-n")
			.getAbsolutePosition()
		const centeredSouth = stage
			.findOne(".transform-handle-s")
			.getAbsolutePosition()
		expect((centeredNorth.y + centeredSouth.y) / 2).toBeCloseTo(
			(originalNorth.y + originalSouth.y) / 2,
		)
		expect(
			(centeredEast.x - centeredWest.x) / (centeredSouth.y - centeredNorth.y),
		).toBeCloseTo(
			(originalEast.x - originalWest.x) / (originalSouth.y - originalNorth.y),
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keyup", {
					altKey: false,
					bubbles: true,
					key: "Alt",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(stage.findOne(".transform-handle-w").getAbsolutePosition()).toEqual(
			constrainedWest,
		)
		expect(stage.findOne(".transform-handle-e").getAbsolutePosition()).toEqual(
			constrainedEast,
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keyup", {
					bubbles: true,
					key: "Shift",
					shiftKey: false,
				}),
			)
			await Promise.resolve()
		})
		expect(stage.findOne(".transform-handle-w").getAbsolutePosition()).toEqual(
			normalWest,
		)
		expect(stage.findOne(".transform-handle-e").getAbsolutePosition()).toEqual(
			normalEast,
		)

		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					buttons: 1,
					clientX: pointer.x,
					clientY: pointer.y,
					pointerId: 7,
					pointerType: "mouse",
					shiftKey: true,
				}),
			)
			await Promise.resolve()
		})
		expect(stage.findOne(".transform-handle-w").getAbsolutePosition()).toEqual(
			constrainedWest,
		)
		expect(stage.findOne(".transform-handle-e").getAbsolutePosition()).toEqual(
			constrainedEast,
		)
		await act(async () => {
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					buttons: 1,
					clientX: pointer.x,
					clientY: pointer.y,
					pointerId: 7,
					pointerType: "mouse",
					shiftKey: false,
				}),
			)
			await Promise.resolve()
		})
		expect(stage.findOne(".transform-handle-w").getAbsolutePosition()).toEqual(
			normalWest,
		)
		expect(stage.findOne(".transform-handle-e").getAbsolutePosition()).toEqual(
			normalEast,
		)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "Shift",
					shiftKey: true,
				}),
			)
			canvas.dispatchEvent(
				new PointerEvent("pointerup", {
					bubbles: true,
					buttons: 0,
					clientX: pointer.x,
					clientY: pointer.y,
					pointerId: 7,
					pointerType: "mouse",
					shiftKey: true,
				}),
			)
			window.dispatchEvent(
				new KeyboardEvent("keyup", {
					bubbles: true,
					key: "Shift",
					shiftKey: false,
				}),
			)
			await Promise.resolve()
		})
		const saved = localStorage.getItem(DESIGN_STORAGE_KEY)
		if (saved === null) throw new Error("Design document was not persisted.")
		const next = JSON.parse(saved) as DesignDocument
		const bounds = objectBounds(
			next.objects.find((object) => object.id === "object:coral")!,
		)
		if (bounds === null) throw new Error("Transformed object has no bounds.")
		expect(bounds.minX).toBe(82)
		expect((bounds.minY + bounds.maxY) / 2).toBe(222)
		expect(
			(bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY),
		).toBeCloseTo(280 / 240)
	})

	it.each(["pointercancel", "lostpointercapture", "Escape"] as const)(
		"restores an edge-resize preview after %s cancellation",
		async (cancellation) => {
			const storage = new Map<string, string>()
			const stage = mountDesign({}, storage)
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
					'design-layers-tile [data-layer-kind="object"]',
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
			const east = stage.findOne(".transform-handle-e")
			const canvas = stage.container().querySelector("canvas")
			if (east === undefined || canvas === null)
				throw new Error("East design transform handle was not found.")
			const originalEast = east.getAbsolutePosition()
			const originalStorage = storage.get(DESIGN_STORAGE_KEY)
			let pointer = originalEast
			vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
			await act(async () => {
				east.fire("pointerdown", {
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
				pointer = { x: pointer.x + 40, y: pointer.y }
				canvas.dispatchEvent(
					new PointerEvent("pointermove", {
						bubbles: true,
						buttons: 1,
						clientX: pointer.x,
						clientY: pointer.y,
						pointerId: 7,
						pointerType: "mouse",
					}),
				)
				await Promise.resolve()
			})
			expect(
				stage.findOne(".transform-handle-e").getAbsolutePosition().x,
			).not.toBe(originalEast.x)
			await act(async () => {
				if (cancellation === "Escape")
					window.dispatchEvent(
						new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
					)
				else
					canvas.dispatchEvent(
						new PointerEvent(cancellation, {
							bubbles: true,
							pointerId: 7,
							pointerType: "mouse",
						}),
					)
				await Promise.resolve()
			})
			expect(storage.get(DESIGN_STORAGE_KEY)).toBe(originalStorage)
			expect(
				stage.findOne(".transform-handle-e").getAbsolutePosition(),
			).toEqual(originalEast)
			if (cancellation === "Escape")
				expect(
					document.querySelector("[data-footer-status]")?.textContent,
				).toBe("Canceled canvas gesture.")
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
			document.querySelector(
				'design-layers-tile [data-layer-kind="object"][aria-selected="true"]',
			)?.textContent,
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

	it("selects every contour from a painted fill and adds another object as one unit", async () => {
		const initial = createInitialDocument()
		let identity = 0
		const firstPath = expandDesignShape(
			initial.objects[0]!,
			() => `fill:first:${identity++}`,
		)
		const secondPath = expandDesignShape(
			initial.objects[1]!,
			() => `fill:second:${identity++}`,
		)
		if (
			firstPath.geometry.kind !== "path" ||
			secondPath.geometry.kind !== "path"
		)
			throw new Error("Expected path fixtures.")
		const firstContour = firstPath.geometry.contours[0]!
		const compound: DesignObject = {
			...firstPath,
			geometry: {
				...firstPath.geometry,
				contours: [
					firstContour,
					{
						...firstContour,
						id: `${firstContour.id}:second`,
						points: firstContour.points.map((point) => ({
							...point,
							id: `${point.id}:second`,
							x: point.x + 20,
							y: point.y + 20,
						})),
					},
				],
			},
		}
		const source: DesignDocument = {
			...initial,
			objects: [compound, secondPath],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [compound, secondPath].map((object) => ({
					kind: "object" as const,
					id: object.id,
				})),
			})),
		}
		const stage = mountDesign({ initialDocument: source })
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (direct === null) throw new Error("Direct Selection was not found.")
		act(() => direct.click())
		const fills = stage.find(".design-direct-fill")
		expect(fills).toHaveLength(2)
		const press = (
			target: { fire: (type: string, event: unknown, bubble: boolean) => void },
			ctrlKey = false,
		): void => {
			target.fire(
				"pointerdown",
				{
					evt: new PointerEvent("pointerdown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						ctrlKey,
						pointerId: ctrlKey ? 302 : 301,
						pointerType: "mouse",
					}),
				},
				true,
			)
		}
		await act(async () => {
			press(
				fills.find((fill: { name: () => string }) =>
					fill.name().includes(compound.id),
				)!,
			)
			await Promise.resolve()
		})
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Direct selection: 2 contours",
		)
		expect(stage.find(".vector-node")).toHaveLength(
			firstContour.points.length * 2,
		)
		await act(async () => {
			press(
				fills.find((fill: { name: () => string }) =>
					fill.name().includes(secondPath.id),
				)!,
				true,
			)
			await Promise.resolve()
		})
		expect(document.querySelector("design-object-tile")?.textContent).toContain(
			"Direct selection: 3 contours",
		)
	})

	it("hides axis and arbitrary guides as a persisted view preference and bulk-locks atomically", async () => {
		const initial = createInitialDocument()
		const source: DesignDocument = {
			...initial,
			guides: [
				{
					id: "guide:x",
					a: { x: 100, y: 0 },
					b: { x: 100, y: 1 },
					locked: true,
				},
				{ id: "guide:diagonal", a: { x: 0, y: 120 }, b: { x: 1, y: 121 } },
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument: source }, storage)
		const lockAll = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Lock all guides"]',
		)
		const hideAll = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Hide all guides"]',
		)
		if (lockAll === null || hideAll === null)
			throw new Error("Global guide controls were not found.")
		expect(lockAll.getAttribute("aria-pressed")).toBe("mixed")
		expect(stage.find(".design-guide")).toHaveLength(2)
		await act(async () => {
			lockAll.click()
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.guides.every((guide) => guide.locked)).toBe(true)
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.guides.map(({ locked }) => Boolean(locked))).toEqual([
			true,
			false,
		])
		await act(async () => {
			hideAll.click()
			await Promise.resolve()
		})
		expect(stage.find(".design-guide")).toHaveLength(0)
		expect(storage.get(DESIGN_GUIDES_VISIBLE_STORAGE_KEY)).toBe("false")
		expect(
			(JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}") as DesignDocument)
				.guides,
		).toEqual(source.guides)
	})

	it("Alt-click inverts every other layer in one undo step", async () => {
		const initial = createInitialDocument()
		const source: DesignDocument = {
			...initial,
			layers: [
				{
					id: "layer:target",
					name: "Target",
					children: [{ kind: "object", id: initial.objects[0]!.id }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object", id: initial.objects[1]!.id }],
				},
				{
					id: "layer:locked",
					name: "Locked",
					locked: true,
					children: [],
				},
			],
		}
		const storage = new Map<string, string>()
		mountDesign({ initialDocument: source }, storage)
		const visibility = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Hide Target"]',
		)
		if (visibility === null) throw new Error("Target visibility was not found.")
		await act(async () => {
			visibility.dispatchEvent(
				new MouseEvent("click", { altKey: true, bubbles: true }),
			)
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.layers.map(({ hidden }) => Boolean(hidden))).toEqual([
			false,
			false,
			true,
		])
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Visibility inverted for 2 other layers")
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { ctrlKey: true, key: "z" }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved).toEqual(source)
		const lock = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Lock Target"]',
		)
		if (lock === null) throw new Error("Target lock was not found.")
		await act(async () => {
			lock.dispatchEvent(
				new MouseEvent("click", { altKey: true, bubbles: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.layers.map(({ locked }) => Boolean(locked))).toEqual([
			false,
			true,
			false,
		])
	})

	it("finishes an active Pen draft on Escape and detaches subsequent Pen input", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
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
			throw new Error("Pen Escape controls were not found.")
		act(() => pen.click())
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			x: number,
			y: number,
			pointerId: number,
		): void => {
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
		const click = (x: number, y: number, pointerId: number): void => {
			fire("pointerdown", x, y, pointerId)
			fire("pointerup", x, y, pointerId)
		}

		await act(async () => {
			click(330, 280, 201)
			click(430, 330, 202)
			fire("pointerdown", 520, 260, 203)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			fire("pointerup", 520, 260, 203)
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects).toHaveLength(3)
		const first = saved.objects.at(-1)
		expect(first?.geometry.kind).toBe("path")
		if (first?.geometry.kind !== "path") return
		expect(first.geometry.contours[0]).toMatchObject({ closed: false })
		expect(first.geometry.contours[0]?.points).toHaveLength(2)
		expect(stage.findOne(".vector-pen-preview")).toBeUndefined()

		await act(async () => {
			fire("pointermove", 570, 360, 204)
			click(570, 360, 204)
			click(650, 410, 205)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects).toHaveLength(4)
		const second = saved.objects.at(-1)
		expect(second?.geometry.kind).toBe("path")
		if (second?.geometry.kind !== "path") return
		expect(second.geometry.contours[0]).toMatchObject({ closed: false })
		expect(second.geometry.contours[0]?.points).toHaveLength(2)
		expect(second.id).not.toBe(first.id)
		expect(second.geometry.contours[0]?.points[0]?.id).not.toBe(
			first.geometry.contours[0]?.points.at(-1)?.id,
		)
	})

	it("paints Pen drafts with authored appearance and a complete layer-color editing outline", async () => {
		const initial = createInitialDocument()
		const documentWithTealLayer: DesignDocument = {
			...initial,
			layers: initial.layers.map((layer) => ({ ...layer, uiColor: "teal" })),
		}
		const stage = mountDesign({ initialDocument: documentWithTealLayer })
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
		const strokeTarget = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Stroke paint: None"]',
		)
		if (strokeTarget === null) throw new Error("Stroke target was not found.")
		await act(async () => {
			strokeTarget.click()
			await Promise.resolve()
		})
		const ink = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Use Rich black as stroke paint"]',
		)
		const pen = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Pen"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (ink === null || pen === null || canvas === null)
			throw new Error("Pen appearance controls were not found.")
		await act(async () => {
			ink.click()
			pen.click()
			await Promise.resolve()
		})
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			x: number,
			y: number,
			pointerId: number,
			buttons = type === "pointerup" ? 0 : 1,
		): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons,
					clientX: x,
					clientY: y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		const click = (x: number, y: number, pointerId: number): void => {
			fire("pointerdown", x, y, pointerId)
			fire("pointerup", x, y, pointerId)
		}
		await act(async () => {
			click(330, 280, 301)
			click(440, 280, 302)
			click(410, 380, 303)
			fire("pointermove", 530, 350, 304, 0)
			await Promise.resolve()
		})

		const authoredPath = stage.findOne(".pen-preview-path")
		const editingPath = stage.findOne(".vector-contour-selection")
		const hanging = stage.findOne(".pen-preview-hanging")
		const terminalNode = stage.findOne("#pen-preview")
		const coral = initial.swatches.find(({ id }) => id === "swatch:coral")!
		const richBlack = initial.swatches.find(({ id }) => id === "swatch:ink")!
		const layerColor = designLayerUiColorCss("teal")
		expect(authoredPath.fillEnabled()).toBe(true)
		expect(authoredPath.fill()).toBe(swatchCss(coral))
		expect(authoredPath.stroke()).toBe(swatchCss(richBlack))
		expect(authoredPath.strokeWidth()).toBe(1)
		expect(editingPath.data()).toBe(authoredPath.data())
		expect(editingPath.stroke()).toBe(layerColor)
		expect(hanging.stroke()).toBe(layerColor)
		expect(hanging.data()).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/)
		expect(terminalNode.stroke()).toBe(layerColor)
		expect(terminalNode.fill()).toBe(
			readDesignCanvasTheme(document.querySelector("design-application"))
				.handleFill,
		)
	})

	it("previews the exact curved segment and snapped close that the Pen will commit", async () => {
		const initial = createInitialDocument()
		const initialDocument: DesignDocument = {
			...initial,
			objects: [],
			layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
			guides: [
				{ id: "guide:start-x", a: { x: 330, y: 0 }, b: { x: 330, y: 1 } },
				{ id: "guide:start-y", a: { x: 0, y: 280 }, b: { x: 1, y: 280 } },
			],
		}
		const storage = new Map<string, string>()
		const stage = mountDesign({ initialDocument }, storage)
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
		const paper = stage.findOne(".design-paper")
		if (pen === null || canvas === null || paper === undefined)
			throw new Error("Pen preview controls were not found.")
		act(() => pen.click())
		const world = paper.getParent().getAbsoluteTransform()
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			point: Readonly<{ x: number; y: number }>,
			pointerId: number,
		): void => {
			const screen = world.point(point)
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: screen.x,
					clientY: screen.y,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		const click = (
			point: Readonly<{ x: number; y: number }>,
			pointerId: number,
		): void => {
			fire("pointerdown", point, pointerId)
			fire("pointerup", point, pointerId)
		}

		await act(async () => {
			fire("pointerdown", { x: 330, y: 280 }, 401)
			fire("pointermove", { x: 360, y: 280 }, 401)
			fire("pointerup", { x: 360, y: 280 }, 401)
			fire("pointermove", { x: 440.314, y: 350.686 }, 402)
			await Promise.resolve()
		})
		const fractionalPreview = stage.findOne(".pen-preview-hanging").data()
		expect(fractionalPreview).toContain(" C ")

		await act(async () => {
			click({ x: 440.314, y: 350.686 }, 402)
			await Promise.resolve()
		})
		expect(stage.findOne(".pen-preview-path").data()).toBe(fractionalPreview)

		await act(async () => {
			click({ x: 380, y: 430 }, 403)
			fire("pointermove", { x: 520, y: 360 }, 404)
			await Promise.resolve()
		})
		const openPreview = stage.findOne(".pen-preview-hanging")
		expect(openPreview.data()).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/)
		expect(stage.findOne(".pen-preview-connection")).toBeUndefined()

		await act(async () => {
			fire("pointermove", { x: 333, y: 283 }, 405)
			await Promise.resolve()
		})
		const closePreview = stage.findOne(".pen-preview-hanging")
		expect(closePreview.data()).toContain(" C ")
		expect(stage.findOne(".pen-preview-connection")).toBeDefined()

		await act(async () => {
			click({ x: 333, y: 283 }, 406)
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const contour =
			saved.objects[0]?.geometry.kind === "path"
				? saved.objects[0].geometry.contours[0]
				: undefined
		expect(contour?.closed).toBe(true)
		expect(contour?.points[0]).toMatchObject({ x: 330, y: 280 })
		expect(contour?.points[0]?.incoming).toBeDefined()

		await act(async () => {
			click({ x: 600, y: 300 }, 407)
			fire("pointermove", { x: 684.686, y: 412.314 }, 408)
			await Promise.resolve()
		})
		const straightFractionalPreview = stage
			.findOne(".pen-preview-hanging")
			.data()
		expect(straightFractionalPreview).toContain(" L ")
		await act(async () => {
			click({ x: 684.686, y: 412.314 }, 408)
			await Promise.resolve()
		})
		expect(stage.findOne(".pen-preview-path").data()).toBe(
			straightFractionalPreview,
		)
	})

	it("commits a same-frame Pen handle drag when capture loss precedes pointer-up", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
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
		const artboard = document.querySelector<HTMLElement>(
			'artboard-wrap[aria-label="Design artboard"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (pen === null || artboard === null || canvas === null)
			throw new Error("Pen capture-loss controls were not found.")
		act(() => pen.click())
		const fire = (
			type: "pointerdown" | "pointermove" | "pointerup",
			x: number,
			y: number,
			pointerId: number,
		): void => {
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
		const click = (x: number, y: number, pointerId: number): void => {
			fire("pointerdown", x, y, pointerId)
			fire("pointerup", x, y, pointerId)
		}
		await act(async () => {
			click(340, 300, 101)
			click(430, 350, 102)
			fire("pointerdown", 520, 300, 103)
			fire("pointermove", 560, 340, 103)
			artboard.dispatchEvent(
				new PointerEvent("lostpointercapture", {
					bubbles: true,
					button: 0,
					buttons: 0,
					clientX: 560,
					clientY: 340,
					isPrimary: true,
					pointerId: 103,
					pointerType: "mouse",
				}),
			)
			fire("pointerup", 560, 340, 103)
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const geometry = saved.objects.at(-1)?.geometry
		expect(geometry?.kind).toBe("path")
		if (geometry?.kind !== "path") return
		expect(geometry.contours[0]).toMatchObject({ closed: false })
		expect(geometry.contours[0]?.points).toHaveLength(3)
		expect(geometry.contours[0]?.points[2]).toMatchObject({
			incoming: expect.any(Object),
			outgoing: expect.any(Object),
		})
	})

	it("finishes open Pen drafts on double-click and tool switch", async () => {
		const storage = new Map<string, string>()
		const stage = mountDesign({}, storage)
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
		const select = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Select"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (pen === null || select === null || canvas === null)
			throw new Error("Pen completion controls were not found.")
		act(() => pen.click())
		const fire = (
			type: "pointerdown" | "pointerup",
			x: number,
			y: number,
			pointerId: number,
			detail = 1,
		): void => {
			canvas.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					button: 0,
					buttons: type === "pointerup" ? 0 : 1,
					clientX: x,
					clientY: y,
					detail,
					isPrimary: true,
					pointerId,
					pointerType: "mouse",
				}),
			)
		}
		const click = (
			x: number,
			y: number,
			pointerId: number,
			detail = 1,
		): void => {
			fire("pointerdown", x, y, pointerId, detail)
			fire("pointerup", x, y, pointerId, detail)
		}
		await act(async () => {
			click(340, 300, 91)
			click(430, 350, 92)
			stage.fire(
				"dblclick",
				{
					evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(
			JSON.parse(storage.get(DESIGN_STORAGE_KEY) ?? "{}").objects,
		).toHaveLength(2)
		await act(async () => {
			click(520, 300, 93)
			click(520, 300, 94)
			stage.fire(
				"dblclick",
				{
					evt: new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
				},
				true,
			)
			await Promise.resolve()
		})
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		let contour = saved.objects.at(-1)?.geometry
		expect(contour?.kind).toBe("path")
		if (contour?.kind !== "path") return
		expect(contour.contours[0]).toMatchObject({ closed: false })
		expect(contour.contours[0]?.points).toHaveLength(3)

		await act(async () => {
			click(380, 430, 95)
			click(500, 470, 96)
			select.click()
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		contour = saved.objects.at(-1)?.geometry
		expect(contour?.kind).toBe("path")
		if (contour?.kind !== "path") return
		expect(contour.contours[0]).toMatchObject({ closed: false })
		expect(contour.contours[0]?.points).toHaveLength(2)
		expect(saved.objects).toHaveLength(4)
		expect(
			document.querySelector("[data-footer-status]")?.textContent,
		).toContain("Created open pen path 4; Select tool.")

		act(() => pen.click())
		await act(async () => {
			click(350, 500, 97)
			click(450, 500, 98)
			click(450, 600, 99)
			click(350, 500, 100)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		contour = saved.objects.at(-1)?.geometry
		expect(contour?.kind).toBe("path")
		if (contour?.kind !== "path") return
		expect(contour.contours[0]).toMatchObject({ closed: true })
		expect(contour.contours[0]?.points).toHaveLength(3)
		expect(saved.objects).toHaveLength(5)
	})

	it("deletes a directly selected node without deleting its path object", async () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const object: DesignObject = {
			...source,
			geometry: {
				kind: "path",
				contours: [
					{
						id: "contour:delete-node",
						closed: false,
						points: [
							{ id: "point:a", x: 100, y: 100 },
							{ id: "point:b", x: 150, y: 80 },
							{ id: "point:c", x: 200, y: 120 },
							{ id: "point:d", x: 250, y: 80 },
							{ id: "point:e", x: 300, y: 100 },
						],
					},
				],
			},
		}
		const storage = new Map<string, string>()
		const stage = mountDesign(
			{
				initialDocument: {
					...initial,
					objects: [object],
					layers: initial.layers.map((layer) => ({
						...layer,
						children: [{ kind: "object", id: object.id }],
					})),
				},
			},
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		if (layer === null || direct === null)
			throw new Error("Direct node deletion controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const node = stage.find(".vector-node")[2]
		if (node === undefined)
			throw new Error("Middle path node was not rendered.")
		const pointerDown = new PointerEvent("pointerdown", {
			bubbles: true,
			button: 0,
			buttons: 1,
			pointerId: 97,
			pointerType: "mouse",
		})
		await act(async () => {
			stage.setPointersPositions(pointerDown)
			node.fire("pointerdown", { evt: pointerDown }, true)
			stage.fire(
				"pointerup",
				{
					evt: new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						pointerId: 97,
						pointerType: "mouse",
					}),
				},
				true,
			)
			await Promise.resolve()
		})
		expect(
			document.getElementById("design-selection-status")?.textContent,
		).toBe("1 node")
		await act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))
			await Promise.resolve()
		})
		const saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		const edited = saved.objects.find(({ id }) => id === object.id)
		expect(edited).toBeDefined()
		if (edited?.geometry.kind !== "path") return
		expect(
			edited.geometry.contours.map((contour) =>
				contour.points.map(({ id }) => id),
			),
		).toEqual([
			["point:a", "point:b"],
			["point:d", "point:e"],
		])
		expect(document.querySelector("[data-footer-status]")?.textContent).toBe(
			"Deleted 1 selected path control.",
		)
	})

	it("commits Alt-edge handles and Knife cuts as undoable canvas gestures", async () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]
		if (source === undefined) throw new Error("Design fixture is missing.")
		const authoredPath: DesignObject = {
			...source,
			id: "object:gesture-path",
			name: "Gesture path",
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			geometry: {
				kind: "path",
				fillRule: "nonzero",
				contours: [
					{
						id: "contour:gesture-path",
						closed: true,
						points: [
							{ id: "point:a", x: 100, y: 100 },
							{ id: "point:b", x: 300, y: 100 },
							{ id: "point:c", x: 300, y: 300 },
							{ id: "point:d", x: 100, y: 300 },
						],
					},
				],
			},
		}
		const storage = new Map<string, string>()
		const stage = mountDesign(
			{
				initialDocument: {
					...initial,
					objects: [authoredPath],
					layers: [
						{
							id: "layer:gesture-path",
							name: "Gesture path",
							children: [{ kind: "object", id: authoredPath.id }],
						},
					],
				},
			},
			storage,
		)
		const layer = document.querySelector<HTMLButtonElement>(
			'design-layers-tile [data-layer-kind="object"]',
		)
		const direct = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Direct Selection"]',
		)
		const knife = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Knife"]',
		)
		const canvas = stage.container().querySelector("canvas")
		if (layer === null || direct === null || knife === null || canvas === null)
			throw new Error("Segment gesture controls were not found.")
		act(() => {
			layer.click()
			direct.click()
		})
		const [firstNode, secondNode] = stage.find(".vector-node")
		if (firstNode === undefined || secondNode === undefined)
			throw new Error("Direct path nodes were not rendered.")
		const first = firstNode.getAbsolutePosition()
		const second = secondNode.getAbsolutePosition()
		const midpoint = {
			x: (first.x + second.x) / 2,
			y: (first.y + second.y) / 2,
		}
		let pointerId = 901
		const gesture = async (altKey = false): Promise<void> => {
			const down = new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX: midpoint.x,
				clientY: midpoint.y,
				isPrimary: true,
				pointerId,
				pointerType: "mouse",
				altKey,
			})
			Object.defineProperty(down, "currentTarget", { value: canvas })
			await act(async () => {
				stage.setPointersPositions(down)
				stage.fire("pointerdown", { evt: down }, true)
				window.dispatchEvent(
					new PointerEvent("pointerup", {
						bubbles: true,
						button: 0,
						buttons: 0,
						clientX: midpoint.x,
						clientY: midpoint.y,
						isPrimary: true,
						pointerId,
						pointerType: "mouse",
						altKey,
					}),
				)
				pointerId += 1
				await Promise.resolve()
			})
		}

		await gesture(true)
		let saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		let geometry = saved.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected saved path.")
		expect(geometry.contours[0]?.points[0]?.outgoing).toEqual({
			x: 200 / 3,
			y: 0,
		})
		expect(geometry.contours[0]?.points[1]?.incoming).toEqual({
			x: -200 / 3,
			y: 0,
		})

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toEqual(authoredPath.geometry)

		act(() => knife.click())
		await gesture()
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		geometry = saved.objects[0]?.geometry
		if (geometry?.kind !== "path") throw new Error("Expected cut path.")
		expect(geometry.contours).toHaveLength(1)
		expect(geometry.contours[0]?.closed).toBe(false)
		expect(geometry.contours[0]?.points).toHaveLength(6)
		const cutPoints = geometry.contours[0]?.points ?? []
		expect(cutPoints[0]).toMatchObject({
			x: cutPoints.at(-1)?.x,
			y: cutPoints.at(-1)?.y,
		})
		expect(cutPoints[0]?.id).not.toBe(cutPoints.at(-1)?.id)

		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
			)
			await Promise.resolve()
		})
		saved = JSON.parse(
			storage.get(DESIGN_STORAGE_KEY) ?? "{}",
		) as DesignDocument
		expect(saved.objects[0]?.geometry).toEqual(authoredPath.geometry)
	}, 15_000)
})
