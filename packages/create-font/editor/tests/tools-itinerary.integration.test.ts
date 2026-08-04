// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { aGlyphId, oGlyphId } from "../src/demo-font.ts"
import {
	createEditorWorkspace,
	type EditorToolId,
} from "../src/editor-workspace.ts"
import { StoreProvider } from "atom.io/react"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/editor/package.json`,
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
})

function cubicMidpoint(
	start: Readonly<{
		x: number
		y: number
		outgoing?: Readonly<{ x: number; y: number }>
	}>,
	end: Readonly<{
		x: number
		y: number
		incoming?: Readonly<{ x: number; y: number }>
	}>,
) {
	const control1 = {
		x: start.x + (start.outgoing?.x ?? 0),
		y: start.y + (start.outgoing?.y ?? 0),
	}
	const control2 = {
		x: end.x + (end.incoming?.x ?? 0),
		y: end.y + (end.incoming?.y ?? 0),
	}
	return {
		x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8,
		y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8,
	}
}

function activeLayer(workspace: ReturnType<typeof createEditorWorkspace>) {
	const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
	if (layer === null) throw new Error("Expected an active glyph layer.")
	return layer
}

function pointerEvent(
	canvas: HTMLCanvasElement,
	pointerId: number,
	type: string,
	modifiers: Readonly<{
		altKey?: boolean
		ctrlKey?: boolean
		metaKey?: boolean
		shiftKey?: boolean
	}> = {},
) {
	return {
		altKey: modifiers.altKey ?? false,
		button: 0,
		ctrlKey: modifiers.ctrlKey ?? false,
		isPrimary: true,
		metaKey: modifiers.metaKey ?? false,
		pointerId,
		preventDefault: vi.fn(),
		shiftKey: modifiers.shiftKey ?? false,
		target: canvas,
		type,
	}
}

function mountTool(
	tool: EditorToolId,
	options: Readonly<{ glyph?: "A" | "O" }> = {},
) {
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
	const workspace = createEditorWorkspace()
	const glyphId = options.glyph === "A" ? aGlyphId : oGlyphId
	workspace.actions.enterGlyphEdit(options.glyph === "A" ? 0 : 2, glyphId)
	workspace.font.silo.setState(workspace.ui.activeTool, tool)
	const contour = workspace.font.silo.getState(workspace.ui.activeLayer)
		?.contours[0]
	const start = contour?.nodes[0]
	const end = contour?.nodes[1]
	if (contour === undefined || start === undefined || end === undefined)
		throw new Error("Expected a demo contour segment.")
	const host = document.createElement("section")
	host.style.width = "800px"
	host.style.height = "600px"
	document.body.append(host)
	hosts.push(host)
	act(() =>
		render(
			h(StoreProvider, {
				store: workspace.font.silo.store,
				children: h(GlyphCanvas, { workspace }),
			}),
			host,
		),
	)
	const stage = Konva.stages.at(-1)
	const segment = stage?.findOne(".outline-segment-helper")
	if (stage === undefined || segment === undefined)
		throw new Error("GlyphCanvas segment helpers did not mount.")
	const background = stage.findOne(".canvas-background")
	const canvas = stage.container().querySelector("canvas")
	if (background === undefined || !(canvas instanceof HTMLCanvasElement))
		throw new Error("GlyphCanvas background did not mount.")
	let pointer = segment.getAbsoluteTransform().point(cubicMidpoint(start, end))
	vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)
	return {
		background,
		canvas,
		contour,
		glyphId,
		host,
		segment,
		setPointer(next: Readonly<{ x: number; y: number }>) {
			pointer = { ...next }
		},
		stage,
		workspace,
	}
}

describe("create-font tool itinerary mounted segment routes", () => {
	it("Pen — routes an authored segment press through one split action", () => {
		const { contour, segment, workspace } = mountTool("pen")
		const split = vi.spyOn(workspace.font.actions, "splitSegment")
		act(() => {
			segment.fire("pointerdown", {
				evt: {
					altKey: false,
					button: 0,
					ctrlKey: false,
					metaKey: false,
					pointerId: 7,
					shiftKey: false,
					type: "pointerdown",
				},
			})
		})
		expect(split).toHaveBeenCalledOnce()
		expect(split).toHaveBeenCalledWith(
			expect.objectContaining({
				contourId: contour.id,
				segmentIndex: 0,
				amount: expect.closeTo(0.5, 3),
			}),
		)
		const selection = workspace.font.silo.getState(workspace.ui.selection)
		expect(selection).toEqual([
			{
				kind: "node",
				pointId: split.mock.calls[0]?.[0].pointId,
			},
		])
	})

	it("Knife — routes an authored segment click through one cut action", () => {
		const { contour, segment, workspace } = mountTool("knife")
		const cut = vi.spyOn(workspace.font.actions, "cutSegment")
		act(() => {
			segment.fire("click", {
				evt: new MouseEvent("click", { button: 0 }),
			})
		})
		expect(cut).toHaveBeenCalledOnce()
		expect(cut).toHaveBeenCalledWith(
			expect.objectContaining({
				contourId: contour.id,
				segmentIndex: 0,
				amount: expect.closeTo(0.5, 3),
			}),
		)
		const input = cut.mock.calls[0]?.[0]
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([
			{ kind: "node", pointId: input?.leftPointId },
			{ kind: "node", pointId: input?.rightPointId },
		])
	})

	it("Select — Alt-clicks a straight segment into line-equivalent handles", () => {
		const { contour, segment, workspace } = mountTool("select", { glyph: "A" })
		const addHandles = vi.spyOn(workspace.font.actions, "addSegmentHandles")
		const start = contour.nodes[0]
		const end = contour.nodes[1]
		if (start === undefined || end === undefined)
			throw new Error("Expected a straight demo segment.")

		act(() => {
			segment.fire(
				"mousedown",
				{
					evt: new MouseEvent("mousedown", {
						altKey: true,
						button: 0,
					}),
				},
				true,
			)
		})

		expect(addHandles).toHaveBeenCalledOnce()
		const changed = activeLayer(workspace).contours.find(
			(candidate) => candidate.id === contour.id,
		)
		const changedStart = changed?.nodes[0]
		const changedEnd = changed?.nodes[1]
		expect(changedStart?.outgoing).toEqual({
			x: (end.x - start.x) / 3,
			y: (end.y - start.y) / 3,
		})
		expect(changedEnd?.incoming).toEqual({
			x: (start.x - end.x) / 3,
			y: (start.y - end.y) / 3,
		})
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([
			{
				kind: "handle",
				pointId: start.pointId,
				handle: "outgoing",
			},
			{
				kind: "handle",
				pointId: end.pointId,
				handle: "incoming",
			},
		])
	})
})

describe("create-font tool itinerary mounted background lifecycles", () => {
	it("Pen — previews without a selection halo and commits click/curve history", () => {
		const { background, canvas, glyphId, setPointer, stage, workspace } =
			mountTool("pen")
		const before = activeLayer(workspace).contours
		const createContour = vi.spyOn(workspace.font.actions, "createContour")
		const insertPoint = vi.spyOn(workspace.font.actions, "insertPoint")

		setPointer({ x: 250, y: 260 })
		act(() => {
			background.fire(
				"pointerdown",
				{ evt: pointerEvent(canvas, 31, "pointerdown") },
				true,
			)
		})
		const clickPreview = stage.findOne(".vector-pen-preview")
		if (clickPreview === undefined)
			throw new Error("Hard Pen preview did not render.")
		expect(clickPreview.findOne(".vector-node")).toBeDefined()
		expect(clickPreview.findOne(".vector-node-selection")).toBeUndefined()
		expect(clickPreview.find(".vector-handle")).toHaveLength(0)

		act(() => {
			stage.fire("pointerup", {
				evt: pointerEvent(canvas, 31, "pointerup"),
			})
		})
		expect(createContour).toHaveBeenCalledOnce()
		expect(stage.findOne(".vector-pen-preview")).toBeUndefined()
		const contourId = createContour.mock.calls[0]?.[0].contourId
		let authored = activeLayer(workspace).contours.find(
			(contour) => contour.id === contourId,
		)
		expect(authored?.nodes).toHaveLength(1)
		expect(authored?.nodes[0]?.mode).toBe("hard")

		setPointer({ x: 330, y: 280 })
		const currentBackground = stage.findOne(".canvas-background")
		if (currentBackground === undefined)
			throw new Error("Canvas background disappeared after Pen commit.")
		act(() => {
			currentBackground.fire(
				"pointerdown",
				{ evt: pointerEvent(canvas, 32, "pointerdown") },
				true,
			)
			setPointer({ x: 370, y: 320 })
			stage.fire("pointermove", {
				evt: pointerEvent(canvas, 32, "pointermove"),
			})
		})
		const curvePreview = stage.findOne(".vector-pen-preview")
		const previewHandles = curvePreview?.find(".bezier-handle") ?? []
		const incoming = previewHandles[0]
		const outgoing = previewHandles[1]
		const previewNode = curvePreview?.findOne(".vector-node")
		if (
			outgoing === undefined ||
			incoming === undefined ||
			previewNode === undefined
		)
			throw new Error("Curved Pen preview handles did not render.")
		expect(incoming.hasName("vector-handle-incoming")).toBe(true)
		expect(outgoing.hasName("vector-handle-outgoing")).toBe(true)
		const outgoingVector = {
			x: outgoing.x() - previewNode.x(),
			y: outgoing.y() - previewNode.y(),
		}
		const incomingVector = {
			x: incoming.x() - previewNode.x(),
			y: incoming.y() - previewNode.y(),
		}
		expect(curvePreview?.findOne(".pen-preview-path")).toBeDefined()
		expect(curvePreview?.findOne(".vector-node-selection")).toBeUndefined()
		expect(Math.hypot(outgoingVector.x, outgoingVector.y)).toBeGreaterThan(0)
		expect(incomingVector.x).toBeCloseTo(-outgoingVector.x)
		expect(incomingVector.y).toBeCloseTo(-outgoingVector.y)

		act(() => {
			stage.fire("pointerup", {
				evt: pointerEvent(canvas, 32, "pointerup"),
			})
		})
		expect(insertPoint).toHaveBeenCalledOnce()
		authored = activeLayer(workspace).contours.find(
			(contour) => contour.id === contourId,
		)
		expect(authored?.nodes).toHaveLength(2)
		const curve = authored?.nodes[1]
		expect(curve?.mode).toBe("soft")
		expect(curve?.incoming).toEqual({
			x: -(curve?.outgoing?.x ?? Number.NaN),
			y: -(curve?.outgoing?.y ?? Number.NaN),
		})

		workspace.font.undo(glyphId)
		expect(
			activeLayer(workspace).contours.find(
				(contour) => contour.id === contourId,
			)?.nodes,
		).toHaveLength(1)
		workspace.font.undo(glyphId)
		expect(activeLayer(workspace).contours).toEqual(before)
	})

	it.each(["rect", "ellipse"] as const)(
		"%s — reflects live Shift+Alt preview modifiers into one undoable contour",
		(tool) => {
			const { background, canvas, glyphId, setPointer, stage, workspace } =
				mountTool(tool)
			const before = activeLayer(workspace).contours

			setPointer({ x: 260, y: 270 })
			act(() => {
				background.fire(
					"pointerdown",
					{ evt: pointerEvent(canvas, 41, "pointerdown") },
					true,
				)
				setPointer({ x: 323, y: 307 })
				stage.fire("pointermove", {
					evt: pointerEvent(canvas, 41, "pointermove"),
				})
			})
			const unconstrained = stage.findOne(".shape-placement-preview")?.data()
			expect(unconstrained).toBeTypeOf("string")

			act(() => {
				stage.fire("pointermove", {
					evt: pointerEvent(canvas, 41, "pointermove", {
						altKey: true,
						shiftKey: true,
					}),
				})
			})
			const constrained = stage.findOne(".shape-placement-preview")?.data()
			expect(constrained).toBeTypeOf("string")
			expect(constrained).not.toBe(unconstrained)

			act(() => {
				stage.fire("pointerup", {
					evt: pointerEvent(canvas, 41, "pointerup", {
						altKey: true,
						shiftKey: true,
					}),
				})
			})
			expect(stage.findOne(".shape-placement-preview")).toBeUndefined()
			const after = activeLayer(workspace).contours
			expect(after).toHaveLength(before.length + 1)
			const authored = after.find(
				(contour) => !before.some((existing) => existing.id === contour.id),
			)
			if (authored === undefined)
				throw new Error(`${tool} did not author a contour.`)
			const xs = authored.nodes.map((node) => node.x)
			const ys = authored.nodes.map((node) => node.y)
			expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
				Math.max(...ys) - Math.min(...ys),
			)
			expect(authored.nodes).toHaveLength(4)
			expect(authored.closed).toBe(true)
			if (tool === "rect") {
				expect(authored.nodes.every((node) => node.mode === "hard")).toBe(true)
			} else {
				expect(authored.nodes.every((node) => node.mode === "soft")).toBe(true)
				expect(
					authored.nodes.every(
						(node) =>
							node.incoming !== undefined && node.outgoing !== undefined,
					),
				).toBe(true)
			}
			expect(workspace.font.silo.getState(workspace.ui.selection)).toHaveLength(
				4,
			)

			workspace.font.undo(glyphId)
			expect(activeLayer(workspace).contours).toEqual(before)
			workspace.font.redo(glyphId)
			expect(activeLayer(workspace).contours).toHaveLength(before.length + 1)
		},
	)

	it.each(["pen", "rect", "ellipse"] as const)(
		"%s — pointer cancellation clears preview and commits nothing",
		(tool) => {
			const { background, canvas, setPointer, stage, workspace } =
				mountTool(tool)
			const before = activeLayer(workspace).contours
			const selection = workspace.font.silo.getState(workspace.ui.selection)

			setPointer({ x: 280, y: 250 })
			act(() => {
				background.fire(
					"pointerdown",
					{ evt: pointerEvent(canvas, 51, "pointerdown") },
					true,
				)
				setPointer({ x: 340, y: 310 })
				stage.fire("pointermove", {
					evt: pointerEvent(canvas, 51, "pointermove"),
				})
			})
			expect(
				stage.findOne(
					tool === "pen" ? ".vector-pen-preview" : ".shape-placement-preview",
				),
			).toBeDefined()

			act(() => {
				stage.fire("pointercancel", {
					evt: pointerEvent(canvas, 51, "pointercancel"),
				})
				stage.fire("pointerup", {
					evt: pointerEvent(canvas, 51, "pointerup"),
				})
			})
			expect(
				stage.findOne(
					tool === "pen" ? ".vector-pen-preview" : ".shape-placement-preview",
				),
			).toBeUndefined()
			expect(activeLayer(workspace).contours).toEqual(before)
			expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual(
				selection,
			)
		},
	)

	it("Ellipse — native lost capture and a sub-threshold release both abort", () => {
		const { background, canvas, setPointer, stage, workspace } =
			mountTool("ellipse")
		const before = activeLayer(workspace).contours

		setPointer({ x: 270, y: 260 })
		act(() => {
			background.fire(
				"pointerdown",
				{ evt: pointerEvent(canvas, 61, "pointerdown") },
				true,
			)
			setPointer({ x: 340, y: 320 })
			stage.fire("pointermove", {
				evt: pointerEvent(canvas, 61, "pointermove"),
			})
			canvas.dispatchEvent(
				new PointerEvent("lostpointercapture", { pointerId: 61 }),
			)
		})
		expect(stage.findOne(".shape-placement-preview")).toBeUndefined()
		expect(activeLayer(workspace).contours).toEqual(before)

		setPointer({ x: 300, y: 280 })
		const currentBackground = stage.findOne(".canvas-background")
		if (currentBackground === undefined)
			throw new Error("Canvas background disappeared after cancellation.")
		act(() => {
			currentBackground.fire(
				"pointerdown",
				{ evt: pointerEvent(canvas, 62, "pointerdown") },
				true,
			)
			setPointer({ x: 302, y: 281 })
			stage.fire("pointerup", {
				evt: pointerEvent(canvas, 62, "pointerup"),
			})
		})
		expect(activeLayer(workspace).contours).toEqual(before)
	})

	it("Rule — Escape cancels the pending first point without persistence", () => {
		const { background, canvas, glyphId, host, setPointer, stage, workspace } =
			mountTool("rule")
		const before = workspace.font.read.editorGlyphSource(glyphId)?.rules ?? []

		setPointer({ x: 310, y: 270 })
		act(() => {
			background.fire(
				"pointerdown",
				{ evt: pointerEvent(canvas, 71, "pointerdown") },
				true,
			)
		})
		expect(stage.findOne(".rule-pending-point-a")).toBeDefined()

		act(() => {
			host.firstElementChild?.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "Escape",
				}),
			)
		})
		expect(stage.findOne(".rule-pending-point-a")).toBeUndefined()
		expect(workspace.font.read.editorGlyphSource(glyphId)?.rules ?? []).toEqual(
			before,
		)
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"Canceled rule",
		)
	})
})
