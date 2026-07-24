// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import {
	createEditorWorkspace,
	type EditorToolId,
} from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

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

function mountTool(tool: EditorToolId) {
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
	workspace.actions.enterGlyphEdit(2, oGlyphId)
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
			h(EditorStateContext.Provider, {
				value: workspace.font.silo,
				children: h(GlyphCanvas, { workspace }),
			}),
			host,
		),
	)
	const stage = Konva.stages.at(-1)
	const segment = stage?.findOne(".outline-segment-helper")
	if (stage === undefined || segment === undefined)
		throw new Error("GlyphCanvas segment helpers did not mount.")
	const pointer = segment
		.getAbsoluteTransform()
		.point(cubicMidpoint(start, end))
	vi.spyOn(stage, "getPointerPosition").mockReturnValue(pointer)
	return { contour, segment, stage, workspace }
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
})
