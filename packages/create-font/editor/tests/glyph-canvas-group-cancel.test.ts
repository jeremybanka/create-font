// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import type { ContourId, PointId } from "@create-font/states"

import { blackMasterId, oGlyphId, razorMasterId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { contourSelectionTargets } from "../src/outline-selection.ts"
import { StoreProvider } from "atom.io/react"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/editor/package.json`,
)
const { default: Konva } = await import(
	requireFromRenderer.resolve("konva/lib/Core")
)
type MountedStage = (typeof Konva.stages)[number]
type MountedNode = NonNullable<ReturnType<MountedStage["findOne"]>>

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
})

function mountSelectedContour({
	withOpenContour = false,
	zoom = 1,
	editing = true,
	selectWholeContour = false,
	selectAllContours = false,
} = {}) {
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
	if (withOpenContour) {
		const contourId = "contour:open-render-test" as ContourId
		workspace.font.actions.createContour({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			contourId,
			point: {
				id: "point:open-render-test:first" as PointId,
				mode: "hard",
			},
			coordinates: [
				{ masterId: razorMasterId, x: 200, y: 200 },
				{ masterId: blackMasterId, x: 220, y: 220 },
			],
		})
		workspace.font.actions.insertPoint({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			contourId,
			point: {
				id: "point:open-render-test:second" as PointId,
				mode: "hard",
			},
			coordinates: [
				{ masterId: razorMasterId, x: 500, y: 350 },
				{ masterId: blackMasterId, x: 520, y: 370 },
			],
		})
	}
	if (editing) workspace.actions.enterGlyphEdit(2, oGlyphId)
	else workspace.font.silo.setState(workspace.ui.previewText, "O")
	workspace.font.silo.setState(workspace.ui.canvasView, {
		...workspace.font.silo.getState(workspace.ui.canvasView),
		zoom,
	})
	const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
	const contour = layer?.contours[0]
	if (contour === undefined || contour.nodes.length < 2)
		throw new Error("The demo glyph needs a contour with two nodes.")
	const selectedPointIds = contour.nodes.slice(0, 2).map((node) => node.pointId)
	workspace.font.silo.setState(
		workspace.ui.selection,
		selectAllContours
			? (layer?.contours.flatMap((candidate) =>
					contourSelectionTargets(candidate.nodes),
				) ?? [])
			: selectWholeContour
				? contourSelectionTargets(contour.nodes)
				: selectedPointIds.map((pointId) => ({
						kind: "node" as const,
						pointId,
					})),
	)
	const transform = vi.spyOn(workspace.font.actions, "transformControls")
	const join = vi.spyOn(workspace.font.actions, "joinOpenContours")
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
	const canvas = host.querySelector("canvas")
	if (stage === undefined || !(canvas instanceof HTMLCanvasElement))
		throw new Error("GlyphCanvas did not mount a Konva stage.")
	return {
		canvas,
		contour,
		host,
		join,
		layer,
		selectedPointIds,
		stage,
		transform,
		workspace,
	}
}

function pointerDown(
	target: MountedNode,
	canvas: HTMLCanvasElement,
	pointer?: Readonly<{ x: number; y: number }>,
): void {
	target.fire("pointerdown", {
		evt: {
			button: 0,
			isPrimary: true,
			...(pointer === undefined
				? {}
				: { offsetX: pointer.x, offsetY: pointer.y }),
			pointerId: 7,
			target: canvas,
		},
	})
}

function dragEvent(
	type: string,
	altKey = false,
): Readonly<Record<string, unknown>> {
	return {
		evt: {
			altKey,
			offsetX: 0,
			offsetY: 0,
			shiftKey: false,
			type,
		},
	}
}

function expectCancelledSession(
	target: MountedNode,
	origin: Readonly<{ x: number; y: number }>,
	transform: ReturnType<typeof vi.fn>,
	join: ReturnType<typeof vi.fn>,
	altKey = false,
): void {
	target.position({ x: origin.x + 40, y: origin.y + 30 })
	target.fire("dragmove", dragEvent("touchmove", altKey))
	expect(target.position()).not.toEqual(origin)
	target.fire("dragend", dragEvent("touchcancel"))
	expect(target.position()).toEqual(origin)
	expect(transform).not.toHaveBeenCalled()
	expect(join).not.toHaveBeenCalled()
	target.fire("dragend", dragEvent("mouseup"))
	expect(target.position()).toEqual(origin)
	expect(transform).not.toHaveBeenCalled()
	expect(join).not.toHaveBeenCalled()
}

describe("GlyphCanvas group drag cancellation", () => {
	it("keeps a selected multi-contour glyph visually aligned with a pointer drag", () => {
		const { canvas, contour, layer, stage, transform } = mountSelectedContour({
			selectAllContours: true,
			zoom: 3.55,
		})
		if (layer === null) throw new Error("The demo glyph layer was not loaded.")
		const beforePoints = layer.contours.flatMap((candidate) => candidate.nodes)
		const controller = stage.findOne(`#${contour.nodes[0]?.pointId}`)
		if (controller === undefined)
			throw new Error("The selected contour controller was not rendered.")
		const origin = controller.position()
		const pointerStart = controller.getAbsolutePosition()
		stage.setPointersPositions({
			clientX: pointerStart.x,
			clientY: pointerStart.y,
		} as PointerEvent)
		pointerDown(controller, canvas, pointerStart)
		controller.fire("dragstart", dragEvent("mousedown"))

		stage.setPointersPositions({
			clientX: pointerStart.x + 36,
			clientY: pointerStart.y + 27,
		} as PointerEvent)
		act(() => {
			controller.position({ x: origin.x - 400, y: origin.y + 400 })
			controller.fire("dragmove", dragEvent("mousemove"))
		})
		expect(stage.findOne(`#${contour.nodes[0]?.pointId}`)).toBe(controller)
		const fill = stage.findOne(".glyph-fill-preview")
		const outline = stage.findOne(".closed-contour-outline")
		expect(fill?.data()).toBe(outline?.data())
		for (const ring of stage.find(".vector-node-selection")) {
			const node = ring.getParent().findOne(".outline-point")
			expect(node?.getAbsolutePosition()).toEqual(ring.getAbsolutePosition())
			const ringBounds = ring.getClientRect()
			expect(ringBounds.width).toBeGreaterThanOrEqual(18)
			expect(ringBounds.width).toBeLessThanOrEqual(26)
			expect(ringBounds.height).toBeGreaterThanOrEqual(18)
			expect(ringBounds.height).toBeLessThanOrEqual(26)
		}
		controller.position({ x: origin.x - 400, y: origin.y + 400 })
		controller.fire("dragend", dragEvent("mouseup"))

		expect(transform).toHaveBeenCalledOnce()
		const result = transform.mock.calls[0]?.[0]
		const firstBefore = contour.nodes[0]
		const firstAfter = result?.points.find(
			(point) => point.pointId === firstBefore?.pointId,
		)
		if (firstBefore === undefined || firstAfter === undefined)
			throw new Error("The selected contour did not commit its controller.")
		const delta = {
			x: firstAfter.x - firstBefore.x,
			y: firstAfter.y - firstBefore.y,
		}
		expect(delta.x).toBeGreaterThan(0)
		expect(delta.y).toBeLessThan(0)
		for (const point of result?.points ?? []) {
			const before = beforePoints.find((node) => node.pointId === point.pointId)
			if (before === undefined)
				throw new Error(`Unexpected transformed point ${point.pointId}.`)
			expect(point.x - before.x).toBe(delta.x)
			expect(point.y - before.y).toBe(delta.y)
		}
		expect(result?.handles.length).toBeGreaterThan(0)
		for (const handle of result?.handles ?? []) {
			const owner = beforePoints.find((node) => node.pointId === handle.pointId)
			const vector = owner?.[handle.handle]
			if (owner === undefined || vector === undefined)
				throw new Error(`Unexpected transformed handle ${handle.pointId}.`)
			expect(handle.x - (owner.x + vector.x)).toBe(delta.x)
			expect(handle.y - (owner.y + vector.y)).toBe(delta.y)
		}
	})

	it("previews, commits, and undoes a multi-soft-node controlled drag atomically", () => {
		const { canvas, contour, selectedPointIds, stage, transform, workspace } =
			mountSelectedContour()
		const [controllerId, followerId] = selectedPointIds
		const controller =
			controllerId === undefined ? undefined : stage.findOne(`#${controllerId}`)
		if (controller === undefined || followerId === undefined)
			throw new Error("The selected nodes were not rendered.")
		const before = contour.nodes.slice(0, 2).map((node) => ({
			pointId: node.pointId,
			x: node.x,
			y: node.y,
		}))
		const origin = controller.position()
		pointerDown(controller, canvas)
		controller.fire("dragstart", dragEvent("mousedown", true))
		controller.position({ x: origin.x + 40, y: origin.y + 30 })
		controller.fire("dragmove", dragEvent("mousemove", true))
		controller.fire("dragend", dragEvent("mouseup", true))

		expect(transform).toHaveBeenCalledTimes(1)
		const result = transform.mock.calls[0]?.[0]
		expect(result?.points).toEqual([
			{ pointId: controllerId, x: before[0]!.x + 40, y: before[0]!.y },
			{ pointId: followerId, x: before[1]!.x, y: before[1]!.y },
		])
		const committed = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.slice(0, 2)
		expect(committed?.map(({ pointId, x, y }) => ({ pointId, x, y }))).toEqual(
			result?.points,
		)

		workspace.font.undo(oGlyphId)
		const undone = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.slice(0, 2)
		expect(undone?.map(({ pointId, x, y }) => ({ pointId, x, y }))).toEqual(
			before,
		)
		workspace.font.redo(oGlyphId)
		const redone = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.slice(0, 2)
		expect(redone?.map(({ pointId, x, y }) => ({ pointId, x, y }))).toEqual(
			result?.points,
		)
	})

	it("uses the final modifier state when Alt is released during a group drag", () => {
		const { canvas, contour, selectedPointIds, stage, transform } =
			mountSelectedContour()
		const controllerId = selectedPointIds[0]
		const controller =
			controllerId === undefined ? undefined : stage.findOne(`#${controllerId}`)
		if (controller === undefined)
			throw new Error("The selected controller was not rendered.")
		const origin = controller.position()
		pointerDown(controller, canvas)
		controller.fire("dragstart", dragEvent("mousedown", true))
		controller.position({ x: origin.x + 40, y: origin.y + 30 })
		controller.fire("dragmove", dragEvent("mousemove", true))
		controller.position({ x: origin.x + 40, y: origin.y + 30 })
		controller.fire("dragmove", dragEvent("mousemove", false))
		controller.fire("dragend", dragEvent("mouseup", false))

		const points = transform.mock.calls[0]?.[0].points
		expect(points).toHaveLength(2)
		expect(points?.map(({ pointId, x }) => ({ pointId, x }))).toEqual(
			contour.nodes.slice(0, 2).map((node) => ({
				pointId: node.pointId,
				x: node.x + 40,
			})),
		)
	})

	it("renders open authoring contours in the typing view", () => {
		const { stage, workspace } = mountSelectedContour({
			withOpenContour: true,
			editing: false,
		})
		const previewItem = workspace.font.silo.getState(workspace.ui.previewRun)[0]
		expect(
			previewItem?.kind === "glyph"
				? previewItem.sourcePreview?.openPath
				: null,
		).toContain("M 200 200 L 500 350")
		const fills = stage.find(".typing-glyph-fill")
		const openStroke = stage
			.find(".typing-open-contour-stroke")
			.find((path: { data(): string }) => path.data() === "M 200 200 L 500 350")
		if (fills.length === 0 || openStroke === undefined)
			throw new Error("Typing paint layers were not rendered.")

		expect(
			fills.every(
				(path: { data(): string }) => !path.data().includes("M 200 200"),
			),
		).toBe(true)
		expect(openStroke.data()).toBe("M 200 200 L 500 350")
		expect(openStroke.fillEnabled()).toBe(false)
		expect(openStroke.strokeWidth()).toBeCloseTo(1.25 / 0.18)
	})

	it("paints open contours only as screen-constant strokes", () => {
		const { stage } = mountSelectedContour({ withOpenContour: true })
		const fill = stage.findOne(".momentary-glyph-preview")
		const closedOutline = stage.findOne(".closed-contour-outline")
		const openStroke = stage.findOne(".open-contour-stroke")
		if (closedOutline === undefined || openStroke === undefined)
			throw new Error("The separated contour paint layers were not rendered.")

		expect(closedOutline.data()).toContain("Z")
		expect(openStroke.data()).toBe("M 200 200 L 500 350")
		expect(openStroke.data()).not.toContain("Z")
		expect(openStroke.fillEnabled()).toBe(false)
		expect(openStroke.listening()).toBe(false)
		expect(openStroke.stroke()).toBe("#f4f3ef")
		expect(openStroke.strokeWidth()).toBeCloseTo(1.25 / 0.18)
		expect(fill).toBeUndefined()

		const zoomed = mountSelectedContour({ withOpenContour: true, zoom: 2 })
		expect(
			zoomed.stage.findOne(".open-contour-stroke")?.strokeWidth(),
		).toBeCloseTo(1.25 / 0.36)

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }))
		})
		const momentaryFill = zoomed.stage.findOne(".momentary-glyph-preview")
		const momentaryOpen = zoomed.stage.findOne(".momentary-open-contour-stroke")
		if (momentaryFill === undefined || momentaryOpen === undefined)
			throw new Error("Momentary preview paint layers were not rendered.")
		expect(momentaryFill.data()).not.toContain("M 200 200")
		expect(momentaryOpen.data()).toBe("M 200 200 L 500 350")
		expect(momentaryOpen.fillEnabled()).toBe(false)
		expect(momentaryOpen.strokeWidth()).toBeCloseTo(1.25 / 0.36)
	})

	it("restores a node group drag when Konva forwards touchcancel as dragend", () => {
		const { canvas, join, selectedPointIds, stage, transform } =
			mountSelectedContour()
		const node = stage.findOne(`#${selectedPointIds[0]}`)
		if (node === undefined)
			throw new Error("The selected node was not rendered.")
		const origin = node.position()
		pointerDown(node, canvas)
		node.fire("dragstart", dragEvent("touchmove"))
		expectCancelledSession(node, origin, transform, join, true)
	})

	it("drags an owned segment from the wide edge hit target", () => {
		const { canvas, selectedPointIds, stage, transform } =
			mountSelectedContour()
		const [firstId, secondId] = selectedPointIds
		const first =
			firstId === undefined ? undefined : stage.findOne(`#${firstId}`)
		const second =
			secondId === undefined ? undefined : stage.findOne(`#${secondId}`)
		const helper = stage.find(".outline-segment-helper")[0]
		const direct = stage.find(".outline-segment")[0]
		if (
			first === undefined ||
			second === undefined ||
			helper === undefined ||
			direct === undefined
		)
			throw new Error("The selected segment hit targets were not rendered.")
		expect(helper.draggable()).toBe(true)
		expect(helper.hitStrokeWidth()).toBeGreaterThan(direct.hitStrokeWidth())
		const firstOrigin = first.position()
		const firstPosition = first.getAbsolutePosition()
		const secondPosition = second.getAbsolutePosition()
		const pointerStart = {
			x: (firstPosition.x + secondPosition.x) / 2,
			y: (firstPosition.y + secondPosition.y) / 2 + 8,
		}
		stage.setPointersPositions({
			clientX: pointerStart.x,
			clientY: pointerStart.y,
		} as PointerEvent)
		pointerDown(helper, canvas, pointerStart)
		helper.fire("dragstart", dragEvent("mousedown"))
		stage.setPointersPositions({
			clientX: pointerStart.x + 30,
			clientY: pointerStart.y + 20,
		} as PointerEvent)
		act(() => helper.fire("dragmove", dragEvent("mousemove")))
		helper.fire("dragend", dragEvent("mouseup"))
		expect(transform).toHaveBeenCalledOnce()
		const committed = transform.mock.calls[0]?.[0]
		const movedFirst = committed?.points.find(
			(point) => point.pointId === firstId,
		)
		expect(movedFirst?.x).toBeGreaterThan(firstOrigin.x)
		expect(movedFirst?.y).toBeLessThan(firstOrigin.y)
	})

	it("restores a path group drag when Konva forwards touchcancel as dragend", () => {
		const { canvas, join, selectedPointIds, stage, transform } =
			mountSelectedContour()
		const [firstId, secondId] = selectedPointIds
		const first =
			firstId === undefined ? undefined : stage.findOne(`#${firstId}`)
		const second =
			secondId === undefined ? undefined : stage.findOne(`#${secondId}`)
		const path = stage.find(".outline-segment-helper")[0]
		if (first === undefined || second === undefined || path === undefined)
			throw new Error("The selected segment was not rendered.")
		const firstPosition = first.getAbsolutePosition()
		const secondPosition = second.getAbsolutePosition()
		stage.setPointersPositions({
			clientX: (firstPosition.x + secondPosition.x) / 2,
			clientY: (firstPosition.y + secondPosition.y) / 2,
		} as PointerEvent)
		const pointerStart = stage.getPointerPosition()
		if (pointerStart === null)
			throw new Error("The path drag start pointer was not registered.")
		const origin = path.position()
		pointerDown(path, canvas, pointerStart)
		path.fire("dragstart", dragEvent("touchmove"))
		stage.setPointersPositions({
			clientX: pointerStart.x + 20,
			clientY: pointerStart.y + 20,
		} as PointerEvent)
		expectCancelledSession(path, origin, transform, join)
	})
})
