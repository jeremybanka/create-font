// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import type { ContourId, PointId } from "@create-font/states"

import { blackMasterId, oGlyphId, razorMasterId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../preact-konva/package.json`,
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
		selectedPointIds.map((pointId) => ({ kind: "node" as const, pointId })),
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
			h(EditorStateContext.Provider, {
				value: workspace.font.silo,
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
		selectedPointIds,
		stage,
		transform,
		workspace,
	}
}

function pointerDown(target: MountedNode, canvas: HTMLCanvasElement): void {
	target.fire("pointerdown", {
		evt: {
			button: 0,
			isPrimary: true,
			pointerId: 7,
			target: canvas,
		},
	})
}

function dragEvent(type: string): Readonly<Record<string, unknown>> {
	return {
		evt: {
			altKey: false,
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
): void {
	target.position({ x: origin.x + 40, y: origin.y + 30 })
	target.fire("dragmove", dragEvent("touchmove"))
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
		expectCancelledSession(node, origin, transform, join)
	})

	it("restores a path group drag when Konva forwards touchcancel as dragend", () => {
		const { canvas, join, selectedPointIds, stage, transform } =
			mountSelectedContour()
		const [firstId, secondId] = selectedPointIds
		const first =
			firstId === undefined ? undefined : stage.findOne(`#${firstId}`)
		const second =
			secondId === undefined ? undefined : stage.findOne(`#${secondId}`)
		const path = stage.find(".outline-segment")[0]
		if (first === undefined || second === undefined || path === undefined)
			throw new Error("The selected segment was not rendered.")
		const firstPosition = first.getAbsolutePosition()
		const secondPosition = second.getAbsolutePosition()
		stage.setPointersPositions({
			clientX: (firstPosition.x + secondPosition.x) / 2,
			clientY: (firstPosition.y + secondPosition.y) / 2,
		} as PointerEvent)
		const origin = path.position()
		pointerDown(path, canvas)
		path.fire("dragstart", dragEvent("touchmove"))
		expectCancelledSession(path, origin, transform, join)
	})
})
