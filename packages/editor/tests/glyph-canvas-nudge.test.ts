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

function mountWithSelectedNodes(count = 2) {
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
	const selected = layer?.contours[0]?.nodes.slice(0, count)
	if (selected === undefined || selected.length !== count)
		throw new Error("The demo glyph does not contain enough nodes.")
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
	if (!(root instanceof HTMLElement) || Konva.stages.at(-1) === undefined)
		throw new Error("GlyphCanvas did not mount.")
	return { root, selected, workspace }
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
