// @vitest-environment happy-dom

import { createRequire } from "node:module"
import type { PointId } from "@create-font/states"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
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

function mountWithSelectedNodes(count = 2, hard = false) {
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
	const layer = workspace.font.silo.getState(workspace.ui.activeLayer)
	let selected = layer?.contours[0]?.nodes.slice(0, count)
	if (selected === undefined || selected.length !== count)
		throw new Error("The demo glyph does not contain enough nodes.")
	if (hard) {
		for (const node of selected) {
			workspace.font.actions.setNodeMode({
				masterId: workspace.font.silo.getState(workspace.ui.activeMasterId),
				glyphId: oGlyphId,
				pointId: node.pointId,
				mode: "hard",
			})
		}
		workspace.font.clearHistory(oGlyphId)
		selected = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes.slice(0, count)
		if (selected === undefined || selected.length !== count)
			throw new Error("The hard demo nodes are unavailable.")
	}
	workspace.font.silo.setState(
		workspace.ui.selection,
		selected.map(({ pointId }) => ({ kind: "node" as const, pointId })),
	)
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
	const root = host.querySelector('[role="application"]')
	const stage = Konva.stages.at(-1)
	if (!(root instanceof HTMLElement) || stage === undefined)
		throw new Error("GlyphCanvas did not mount.")
	return { root, selected, stage, workspace }
}

function absoluteEndpoints(node: {
	readonly x: number
	readonly y: number
	readonly incoming?: Readonly<{ x: number; y: number }>
	readonly outgoing?: Readonly<{ x: number; y: number }>
}) {
	return (["incoming", "outgoing"] as const).flatMap((handle) => {
		const vector = node[handle]
		return vector === undefined
			? []
			: [{ handle, x: node.x + vector.x, y: node.y + vector.y }]
	})
}

function positions(
	workspace: ReturnType<typeof createEditorWorkspace>,
	pointIds: readonly PointId[],
) {
	const nodes = workspace.font.silo
		.getState(workspace.ui.activeLayer)
		?.contours.flatMap((contour) => contour.nodes)
	return pointIds.map((pointId) => {
		const node = nodes?.find((candidate) => candidate.pointId === pointId)
		if (node === undefined) throw new Error(`Missing selected node ${pointId}.`)
		return { pointId: node.pointId, x: node.x, y: node.y }
	})
}

describe("GlyphCanvas group nudging", () => {
	it("Alt-drags one hard node through a fixed-endpoint preview and commit", () => {
		const { selected, stage, workspace } = mountWithSelectedNodes(1, true)
		const before = selected[0]
		if (
			before === undefined ||
			(before.incoming === undefined && before.outgoing === undefined)
		)
			throw new Error("The hard node needs an authored handle.")
		const target = stage.findOne(`#${before.pointId}`)
		if (target === undefined) throw new Error("The hard node was not rendered.")
		const endpoints = absoluteEndpoints(before)
		const transform = vi.spyOn(workspace.font.actions, "transformControls")
		const dragEvent = {
			evt: { altKey: true, shiftKey: false, type: "mousemove" },
		}
		const setStagePointerFromTarget = (): void => {
			const position = target.getAbsolutePosition()
			stage.setPointersPositions({
				clientX: position.x,
				clientY: position.y,
			} as PointerEvent)
		}

		setStagePointerFromTarget()
		act(() => target.fire("dragstart", dragEvent))
		target.position({ x: before.x + 200, y: before.y + 160 })
		setStagePointerFromTarget()
		act(() => target.fire("dragmove", dragEvent))
		expect(transform).not.toHaveBeenCalled()
		const previewHandles = stage
			.find(".bezier-handle")
			.map((handle: { x(): number; y(): number }) => ({
				x: handle.x(),
				y: handle.y(),
			}))
		for (const { x, y } of endpoints) {
			expect(previewHandles).toContainEqual({ x, y })
		}

		const liveTarget = stage.findOne(`#${before.pointId}`)
		if (liveTarget === undefined)
			throw new Error("The shared hard node disappeared during drag preview.")
		act(() => liveTarget.fire("dragend", dragEvent))
		expect(transform).toHaveBeenCalledOnce()
		const committed = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((contour) => contour.nodes)
			.find((node) => node.pointId === before.pointId)
		if (committed === undefined) throw new Error("The dragged node is missing.")
		expect(committed.x).not.toBe(before.x)
		expect(committed.y).not.toBe(before.y)
		expect(absoluteEndpoints(committed)).toEqual(endpoints)
	})

	it("Alt-nudges one hard node while its absolute endpoints stay fixed", () => {
		const { root, selected, workspace } = mountWithSelectedNodes(1, true)
		const before = selected[0]
		if (
			before === undefined ||
			(before.incoming === undefined && before.outgoing === undefined)
		)
			throw new Error("The hard node needs an authored handle.")
		const endpoints = absoluteEndpoints(before)
		const transform = vi.spyOn(workspace.font.actions, "transformControls")

		for (const event of [
			new KeyboardEvent("keydown", {
				key: "ArrowRight",
				altKey: true,
				bubbles: true,
			}),
			new KeyboardEvent("keydown", {
				key: "ArrowUp",
				altKey: true,
				shiftKey: true,
				repeat: true,
				bubbles: true,
			}),
		]) {
			act(() => {
				root.dispatchEvent(event)
			})
		}

		expect(transform).toHaveBeenCalledTimes(2)
		for (const [input] of transform.mock.calls) {
			expect(input.handles).toEqual(
				endpoints.map(({ handle, x, y }) => ({
					pointId: before.pointId,
					handle,
					x,
					y,
				})),
			)
		}
		const after = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((contour) => contour.nodes)
			.find((node) => node.pointId === before.pointId)
		expect(after).toMatchObject({ x: before.x + 1, y: before.y + 10 })
		if (after === undefined) throw new Error("The moved node is missing.")
		expect(absoluteEndpoints(after)).toEqual(endpoints)

		workspace.font.undo(oGlyphId)
		workspace.font.undo(oGlyphId)
		const undone = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((contour) => contour.nodes)
			.find((node) => node.pointId === before.pointId)
		expect(undone).toMatchObject({ x: before.x, y: before.y })
		expect(undone === undefined ? [] : absoluteEndpoints(undone)).toEqual(
			endpoints,
		)
	})

	it("nudges every selected node in one atomic action and preserves selection", () => {
		const { root, selected, workspace } = mountWithSelectedNodes()
		const before = selected.map(({ pointId, x, y }) => ({ pointId, x, y }))
		const pointIds = before.map(({ pointId }) => pointId)
		const transform = vi.spyOn(workspace.font.actions, "transformControls")

		act(() => {
			root.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			)
		})

		expect(transform).toHaveBeenCalledTimes(1)
		expect(transform.mock.calls[0]?.[0].points).toEqual(
			before.map(({ pointId, x, y }) => ({ pointId, x: x + 1, y })),
		)
		expect(positions(workspace, pointIds)).toEqual(
			before.map(({ pointId, x, y }) => ({ pointId, x: x + 1, y })),
		)
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual(
			before.map(({ pointId }) => ({ kind: "node", pointId })),
		)

		workspace.font.undo(oGlyphId)
		expect(positions(workspace, pointIds)).toEqual(before)
		workspace.font.redo(oGlyphId)
		expect(positions(workspace, pointIds)).toEqual(
			before.map(({ pointId, x, y }) => ({ pointId, x: x + 1, y })),
		)
	})

	it("keeps Alt group nudging on the ordinary rigid-translation path", () => {
		const { root, selected, workspace } = mountWithSelectedNodes(2, true)
		const before = selected.map((node) => ({
			pointId: node.pointId,
			x: node.x,
			y: node.y,
			endpoints: absoluteEndpoints(node),
		}))
		act(() => {
			root.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowLeft",
					altKey: true,
					bubbles: true,
				}),
			)
		})
		const after = workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.flatMap((contour) => contour.nodes)
		for (const expected of before) {
			const node = after?.find(({ pointId }) => pointId === expected.pointId)
			expect(node).toMatchObject({ x: expected.x - 1, y: expected.y })
			if (node === undefined) continue
			expect(absoluteEndpoints(node)).toEqual(
				expected.endpoints.map((endpoint) => ({
					...endpoint,
					x: endpoint.x - 1,
				})),
			)
		}
	})

	it("uses modifiers and repeat from the latest committed group geometry", () => {
		const { root, selected, workspace } = mountWithSelectedNodes()
		const before = selected.map(({ pointId, x, y }) => ({ pointId, x, y }))
		const pointIds = before.map(({ pointId }) => pointId)

		for (const repeat of [false, true]) {
			act(() => {
				root.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "ArrowUp",
						bubbles: true,
						repeat,
						shiftKey: true,
					}),
				)
			})
		}

		expect(positions(workspace, pointIds)).toEqual(
			before.map(({ pointId, x, y }) => ({ pointId, x, y: y + 20 })),
		)
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual(
			before.map(({ pointId }) => ({ kind: "node", pointId })),
		)
	})
})
