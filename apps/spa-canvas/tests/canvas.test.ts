// @vitest-environment happy-dom

import type { SpaRoot } from "@atom.io/spa"
import Konva from "konva"
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vite-plus/test"

import { readPrototypeDocuments } from "../documents.ts"
import { mountCanvas } from "../src/Canvas.tsx"
import {
	createDesignCanvasModel,
	createFontCanvasModel,
	type CanvasModel,
} from "../src/models.ts"

let documents: Awaited<ReturnType<typeof readPrototypeDocuments>>
const roots: SpaRoot[] = []
const hosts: HTMLElement[] = []
const disconnect = vi.fn()

beforeAll(async () => {
	documents = await readPrototypeDocuments()
})

beforeEach(() => {
	Konva.autoDrawEnabled = false
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect = disconnect
		},
	)
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
		x: 0,
		y: 0,
		width: 640,
		height: 400,
		top: 0,
		left: 0,
		right: 640,
		bottom: 400,
		toJSON() {
			return {}
		},
	})
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		function (this: HTMLCanvasElement) {
			const context = {
				canvas: this,
				measureText: () => ({ width: 0 }),
				getImageData: () => ({ data: new Uint8ClampedArray(4) }),
			}
			return new Proxy(context, {
				get: (target, key) =>
					key in target ? target[key as keyof typeof target] : () => undefined,
			}) as unknown as CanvasRenderingContext2D
		},
	)
})

afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	for (const host of hosts.splice(0)) host.remove()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	expect(Konva.stages).toHaveLength(0)
	disconnect.mockClear()
})

function mount(model: CanvasModel) {
	const host = document.createElement("div")
	document.body.append(host)
	hosts.push(host)
	const setup = vi.fn()
	const stages: (Konva.Stage | null)[] = []
	const root = mountCanvas(host, model, {
		onSetup: setup,
		onStage: (stage) => stages.push(stage),
	})
	roots.push(root)
	const stage = stages[0]!
	if (stage === null) throw new Error("Stage did not mount.")
	return { host, root, stage, setup, stages }
}

function click(host: HTMLElement, label: string, root: SpaRoot) {
	const button = [...host.querySelectorAll("button")].find(
		(button) => button.textContent === label,
	)
	if (button === undefined) throw new Error(`Missing ${label} button.`)
	button.click()
	root.flush()
}

describe("SPA canvases bound to existing editor state", () => {
	it.each(["font", "design"] as const)(
		"updates the %s canvas, commits node drags, and travels real history without rerunning setup",
		(kind) => {
			const model =
				kind === "font"
					? createFontCanvasModel(documents.font)
					: createDesignCanvasModel(documents.design)
			const { host, root, stage, setup } = mount(model)
			const object = stage.findOne<Konva.Group>(".canvas-object")!
			const path = object.findOne<Konva.Path>(".outline")!
			const originalPath = path.data()
			expect(originalPath).toContain("M ")
			path.fire(
				"pointerdown",
				{ evt: new PointerEvent("pointerdown", { button: 0 }) },
				true,
			)
			root.flush()
			const node = object.findOne<Konva.Circle>(".anchor")!
			expect(node).toBeDefined()
			const originalNode = node.position()
			node.position({ x: originalNode.x + 20, y: originalNode.y + 12 })
			node.fire("dragend", { evt: new MouseEvent("mouseup") }, true)
			root.flush()
			expect(stage.findOne(".canvas-object")).toBe(object)
			expect(object.findOne(".outline")).toBe(path)
			expect(path.data()).not.toBe(originalPath)
			expect(
				host.querySelector('[aria-label="History position"]')?.textContent,
			).toBe("1 / 1")
			click(host, "Undo", root)
			expect(path.data()).toBe(originalPath)
			click(host, "Redo", root)
			expect(path.data()).not.toBe(originalPath)
			click(host, "Reset sample", root)
			expect(path.data()).toBe(originalPath)
			expect(
				host.querySelector('[aria-label="History position"]')?.textContent,
			).toBe("0 / 0")
			expect(setup).toHaveBeenCalledOnce()
		},
	)

	it("preserves selection while moving objects and isolates the two editor stores", () => {
		const font = createFontCanvasModel(documents.font)
		const design = createDesignCanvasModel(documents.design)
		const fontCanvas = mount(font)
		const designCanvas = mount(design)
		const originalFont = fontCanvas.stage
			.findOne<Konva.Path>(".outline")!
			.data()
		const object = designCanvas.stage.findOne<Konva.Group>(".canvas-object")!
		object.fire(
			"pointerdown",
			{ evt: new PointerEvent("pointerdown", { button: 0 }) },
			true,
		)
		designCanvas.root.flush()
		object.position({ x: 10, y: -8 })
		object.fire("dragend", { evt: new MouseEvent("mouseup") }, true)
		designCanvas.root.flush()
		expect(object.position()).toEqual({ x: 0, y: 0 })
		expect(designCanvas.stage.findOne(".canvas-object")).toBe(object)
		expect(
			designCanvas.host.querySelector('[aria-label="Selection"]')?.textContent,
		).not.toBe("No selection")
		expect(fontCanvas.stage.findOne<Konva.Path>(".outline")!.data()).toBe(
			originalFont,
		)
		expect(
			fontCanvas.host.querySelector('[aria-label="History position"]')
				?.textContent,
		).toBe("0 / 0")
	})

	it("commits a native Bézier handle drag through the design state and restores it with undo", () => {
		const model = createDesignCanvasModel(documents.design)
		const { host, root, stage } = mount(model)
		const object = stage
			.find<Konva.Group>(".canvas-object")
			.find((group) => group.id() === "object:shape-orbit")!
		const path = object.findOne<Konva.Path>(".outline")!
		const original = path.data()
		path.fire(
			"pointerdown",
			{ evt: new PointerEvent("pointerdown", { button: 0 }) },
			true,
		)
		root.flush()
		const handle = object.findOne<Konva.Circle>(".handle-outgoing")!
		const before = handle.position()
		handle.position({ x: before.x + 4, y: before.y + 8 })
		handle.fire("dragend", { evt: new MouseEvent("mouseup") }, true)
		root.flush()
		expect(object.findOne(".outline")).toBe(path)
		expect(path.data()).not.toBe(original)
		expect(
			host.querySelector('[aria-label="History position"]')?.textContent,
		).toBe("1 / 1")
		click(host, "Undo", root)
		expect(path.data()).toBe(original)
	})

	it("changes glyph and master families through live props while keeping the canvas instance", () => {
		const model = createFontCanvasModel(documents.font)
		const { host, root, stage, setup } = mount(model)
		const glyph = host.querySelector<HTMLSelectElement>('[aria-label="Glyph"]')!
		glyph.value = "glyph:A"
		glyph.dispatchEvent(new Event("change", { bubbles: true }))
		root.flush()
		const path = stage.findOne<Konva.Path>(".outline")!
		const original = path.data()
		const master = host.querySelector<HTMLSelectElement>(
			'[aria-label="Master"]',
		)!
		master.value = model.masters.find(({ id }) => id !== master.value)!.id
		master.dispatchEvent(new Event("change", { bubbles: true }))
		root.flush()
		expect(path.data()).not.toBe(original)
		expect(stage.findOne<Konva.Path>(".outline")).toBe(path)
		expect(setup).toHaveBeenCalledOnce()
	})

	it("binds history to the chosen glyph when a family key changes", () => {
		const model = createFontCanvasModel(documents.font)
		const { host, root } = mount(model)
		const originalGlyph = model.silo.getState(model.choice)
		model.moveObject(originalGlyph, { x: 10, y: 0 })
		root.flush()
		const history = () =>
			host.querySelector('[aria-label="History position"]')!.textContent
		expect(history()).toBe("1 / 1")
		const choose = (id: string) => {
			const select = host.querySelector<HTMLSelectElement>(
				'[aria-label="Glyph"]',
			)!
			select.value = id
			select.dispatchEvent(new Event("change", { bubbles: true }))
			root.flush()
		}
		choose("glyph:A")
		expect(history()).toBe("0 / 0")
		model.moveObject("glyph:A", { x: 0, y: 12 })
		root.flush()
		expect(history()).toBe("1 / 1")
		click(host, "Undo", root)
		expect(history()).toBe("0 / 1")
		choose(originalGlyph)
		expect(history()).toBe("1 / 1")
	})

	it("zooms around the pointer and disposes stage refs, scene nodes, observers, and window listeners", () => {
		const { root, stage, stages } = mount(createFontCanvasModel(documents.font))
		const viewport = stage.findOne<Konva.Group>(".viewport")!
		const initial = viewport.scaleX()
		const event = new WheelEvent("wheel", {
			clientX: 160,
			clientY: 120,
			deltaY: -120,
			cancelable: true,
		})
		stage.setPointersPositions(event)
		stage.fire("wheel", { evt: event })
		root.flush()
		expect(viewport.scaleX()).toBeGreaterThan(initial)
		expect(viewport.scaleY()).toBe(-viewport.scaleX())
		expect(event.defaultPrevented).toBe(true)
		const remove = vi.spyOn(window, "removeEventListener")
		root.dispose()
		expect(stages.at(-1)).toBeNull()
		expect(stage.getChildren()).toHaveLength(0)
		expect(disconnect).toHaveBeenCalledOnce()
		for (const name of ["pointermove", "pointerup", "pointercancel"])
			expect(remove.mock.calls.some(([type]) => type === name)).toBe(true)
	})
})
