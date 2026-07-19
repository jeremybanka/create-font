// @vitest-environment happy-dom

import type { MasterId } from "@create-font/states"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import { blackMasterId, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
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
	return { stage, transform }
}

describe("GlyphCanvas center transform", () => {
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
})
