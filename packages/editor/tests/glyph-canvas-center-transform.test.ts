// @vitest-environment happy-dom

import type { MasterId } from "@create-font/states"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import { blackMasterId, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import {
	contourSelectionTargets,
	selectionKey,
} from "../src/outline-selection.ts"
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

function mountTransformSelection() {
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
	workspace.font.silo.setState(workspace.ui.activeMasterId, blackMasterId)
	const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
	const nodes = layer?.contours[0]?.nodes.slice(0, 2)
	if (nodes === undefined || nodes.length < 2)
		throw new Error("Expected demo nodes.")
	workspace.font.silo.setState(
		workspace.ui.selection,
		nodes.map(({ pointId }) => ({ kind: "node" as const, pointId })),
	)
	workspace.font.silo.setState(workspace.ui.activeTool, "transform")
	const transform = vi.spyOn(workspace.font.actions, "transformControls")
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
	if (stage === undefined) throw new Error("GlyphCanvas did not mount.")
	return { host, stage, transform, workspace }
}

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
): Readonly<{ x: number; y: number }> {
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

function doubleClickContourSegment(
	stage: InstanceType<typeof Konva.Stage>,
	nodes: readonly [
		Readonly<{
			x: number
			y: number
			outgoing?: Readonly<{ x: number; y: number }>
		}>,
		Readonly<{
			x: number
			y: number
			incoming?: Readonly<{ x: number; y: number }>
		}>,
	],
	modifiers: Readonly<{
		altKey?: boolean
		ctrlKey?: boolean
		metaKey?: boolean
		shiftKey?: boolean
	}> = {},
): void {
	const segment = stage.findOne(".outline-segment")
	if (segment === undefined)
		throw new Error("Outline segment was not rendered.")
	const pointer = segment.getAbsoluteTransform().point(cubicMidpoint(...nodes))
	vi.spyOn(stage, "getPointerPosition").mockReturnValue(pointer)
	stage.fire("dblclick", {
		evt: {
			altKey: modifiers.altKey ?? false,
			ctrlKey: modifiers.ctrlKey ?? false,
			metaKey: modifiers.metaKey ?? false,
			offsetX: pointer.x,
			offsetY: pointer.y,
			shiftKey: modifiers.shiftKey ?? false,
		},
	})
}

describe("GlyphCanvas center transform", () => {
	it("selects a whole contour and refreshes Transform bounds immediately", () => {
		const { stage, workspace } = mountTransformSelection()
		const contours = workspace.font.silo.getState(
			workspace.ui.activeLayer,
		)?.contours
		const outer = contours?.[0]
		const counter = contours?.[1]
		if (
			outer === undefined ||
			counter === undefined ||
			outer.nodes[0] === undefined ||
			outer.nodes[1] === undefined
		) {
			throw new Error("Expected two demo contours.")
		}
		workspace.font.silo.setState(workspace.ui.selection, [
			{ kind: "node", pointId: counter.nodes[0]!.pointId },
		])

		act(() => {
			doubleClickContourSegment(stage, [outer.nodes[0]!, outer.nodes[1]!])
		})

		expect(
			workspace.font.silo
				.getState(workspace.ui.selection)
				.map(selectionKey)
				.sort(),
		).toEqual(contourSelectionTargets(outer.nodes).map(selectionKey).sort())
		expect(stage.findOne(".transform-selection-box")).toBeDefined()
		expect(stage.findOne(".vector-selection-bounds")).toBeDefined()
		expect(stage.findOne(".vector-contour-path")).toBeDefined()
		expect(stage.findOne(".transform-east")).toBeDefined()
		expect(stage.findOne(".transform-rotation")).toBeDefined()
	})

	it("adds and removes whole contours with Transform double-click modifiers", () => {
		const { stage, workspace } = mountTransformSelection()
		const contours = workspace.font.silo.getState(
			workspace.ui.activeLayer,
		)?.contours
		const outer = contours?.[0]
		const counter = contours?.[1]
		if (
			outer === undefined ||
			counter?.nodes[0] === undefined ||
			outer.nodes[0] === undefined ||
			outer.nodes[1] === undefined
		) {
			throw new Error("Expected two demo contours.")
		}
		workspace.font.silo.setState(workspace.ui.selection, [
			{ kind: "node", pointId: counter.nodes[0].pointId },
		])
		const existing = workspace.font.silo.getState(workspace.ui.selection)
		const expectedContourKeys = contourSelectionTargets(outer.nodes).map(
			selectionKey,
		)

		act(() => {
			doubleClickContourSegment(stage, [outer.nodes[0]!, outer.nodes[1]!], {
				shiftKey: true,
			})
		})
		expect(
			new Set(
				workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
			),
		).toEqual(new Set([...existing.map(selectionKey), ...expectedContourKeys]))

		act(() => {
			doubleClickContourSegment(stage, [outer.nodes[0]!, outer.nodes[1]!], {
				ctrlKey: true,
			})
		})
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual(existing.map(selectionKey))
	})

	it("previews and commits an Alt resize through the mounted handle path", () => {
		const { stage, transform } = mountTransformSelection()
		const handle = stage.findOne(".transform-east")
		if (handle === undefined)
			throw new Error("East transform handle was not rendered.")
		const centerX = stage.findOne(".transform-selection-box")?.x()
		const originalX = handle.x()
		handle.fire("dragstart", { evt: { altKey: true, shiftKey: false } })
		handle.x(originalX + 50)
		handle.fire("dragmove", { evt: { altKey: true, shiftKey: false } })
		act(() => {
			window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
		})
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Alt", altKey: true }),
			)
		})
		handle.fire("dragend", { evt: { altKey: true, shiftKey: false } })
		expect(transform).toHaveBeenCalledTimes(1)
		expect(transform.mock.calls[0]?.[0].masterId).toBe(
			blackMasterId as MasterId,
		)
		expect(transform.mock.calls[0]?.[0].points.length).toBeGreaterThan(0)
		expect(centerX).toBeTypeOf("number")
	})

	it("previews snapped rotation and commits exactly one atomic transform", () => {
		const { host, stage, transform, workspace } = mountTransformSelection()
		const originalLayer = workspace.font.silo.getState(workspace.ui.activeLayer)
		const handle = stage.findOne(".transform-rotation")
		const box = stage.findOne(".transform-selection-box")
		if (handle === undefined || box === undefined)
			throw new Error("Rotation transform affordance was not rendered.")
		const pivot = {
			x: box.x() + box.width() / 2,
			y: box.y() + box.height() / 2,
		}
		const radius = handle.y() - pivot.y
		act(() => {
			handle.fire("dragstart", { evt: { altKey: false, shiftKey: false } })
			handle.position({ x: pivot.x - radius, y: pivot.y })
			handle.fire("dragmove", { evt: { altKey: false, shiftKey: true } })
		})
		expect(stage.findOne(".transform-rotation-angle")?.text()).toBe(
			"90° · snapped",
		)
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"Rotation preview 90 degrees, snapped to 15 degree increments",
		)
		expect(transform).not.toHaveBeenCalled()
		act(() => {
			handle.fire("dragend", { evt: { altKey: false, shiftKey: true } })
		})
		expect(transform).toHaveBeenCalledTimes(1)
		const input = transform.mock.calls[0]?.[0]
		expect(input?.points.length).toBeGreaterThan(0)
		expect(
			input?.points.every(
				(point) => Number.isFinite(point.x) && Number.isFinite(point.y),
			),
		).toBe(true)
		expect(host.querySelector('[aria-label^="Rotation handle"]')).not.toBeNull()
		workspace.font.undo(oGlyphId)
		expect(workspace.font.silo.getState(workspace.ui.activeLayer)).toEqual(
			originalLayer,
		)
	})

	it("restores rotation preview and commits nothing on Escape", () => {
		const { host, stage, transform } = mountTransformSelection()
		const handle = stage.findOne(".transform-rotation")
		if (handle === undefined)
			throw new Error("Rotation transform affordance was not rendered.")
		const origin = handle.position()
		handle.fire("dragstart", { evt: { altKey: false, shiftKey: false } })
		handle.position({ x: origin.x + 40, y: origin.y - 20 })
		handle.fire("dragmove", { evt: { altKey: false, shiftKey: false } })
		act(() => {
			host.firstElementChild?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			)
		})
		handle.fire("dragend", {
			evt: { altKey: false, shiftKey: false, type: "pointercancel" },
		})
		expect(transform).not.toHaveBeenCalled()
		expect(stage.findOne(".transform-rotation-angle")).toBeUndefined()
	})

	it("commits nothing when the native drag end is a pointer cancellation", () => {
		const { stage, transform } = mountTransformSelection()
		const handle = stage.findOne(".transform-rotation")
		if (handle === undefined)
			throw new Error("Rotation transform affordance was not rendered.")
		const origin = handle.position()
		handle.fire("dragstart", { evt: { altKey: false, shiftKey: false } })
		handle.position({ x: origin.x + 40, y: origin.y - 20 })
		handle.fire("dragmove", { evt: { altKey: false, shiftKey: false } })
		handle.fire("dragend", {
			evt: { altKey: false, shiftKey: false, type: "pointercancel" },
		})
		expect(transform).not.toHaveBeenCalled()
		expect(stage.findOne(".transform-rotation-angle")).toBeUndefined()
	})
})
