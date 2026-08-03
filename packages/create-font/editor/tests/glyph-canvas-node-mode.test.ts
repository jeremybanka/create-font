// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { oGlyphId, razorMasterId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../preact-konva/package.json`,
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

function mountSelectedNodes() {
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
	const nodes = workspace.font.silo
		.getState(workspace.ui.activeLayer)
		?.contours[0]?.nodes.slice(0, 2)
	if (
		nodes === undefined ||
		nodes.length !== 2 ||
		nodes[0]?.incoming === undefined
	) {
		throw new Error(
			"The demo glyph does not contain the expected nodes and handle.",
		)
	}
	const [first, second] = nodes
	if (first === undefined || second === undefined)
		throw new Error("Nodes are missing.")
	const selection = [
		{ kind: "node" as const, pointId: first.pointId },
		{
			kind: "handle" as const,
			pointId: first.pointId,
			handle: "incoming" as const,
		},
		{ kind: "node" as const, pointId: second.pointId },
	]
	workspace.font.silo.setState(workspace.ui.selection, selection)
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
	if (!(root instanceof HTMLElement))
		throw new Error("GlyphCanvas did not mount.")
	const stage = Konva.stages.at(-1)
	if (stage === undefined) throw new Error("GlyphCanvas did not mount.")
	return { host, nodes, root, selection, stage, workspace }
}

describe("GlyphCanvas batch node-mode keyboard action", () => {
	it("toggles every selected node once and preserves node-and-handle selection", () => {
		const { nodes, root, selection, workspace } = mountSelectedNodes()
		const toggle = vi.spyOn(workspace.font.actions, "toggleNodeModes")

		act(() => {
			root.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			)
		})

		expect(toggle).toHaveBeenCalledOnce()
		expect(toggle).toHaveBeenCalledWith({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			pointIds: nodes.map(({ pointId }) => pointId),
		})
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual(
			selection,
		)
		expect(workspace.font.silo.getState(workspace.ui.activeTool)).toBe("select")
		for (const node of nodes) {
			expect(
				workspace.font.silo
					.getState(workspace.ui.activeLayer)
					?.contours.flatMap((contour) => contour.nodes)
					.find(({ pointId }) => pointId === node.pointId)?.mode,
			).toBe("hard")
		}
	})

	it("ignores repeat, modified, composing, and focused-input Enter", () => {
		const { host, root, workspace } = mountSelectedNodes()
		const toggle = vi.spyOn(workspace.font.actions, "toggleNodeModes")
		const events = [
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				repeat: true,
			}),
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				shiftKey: true,
			}),
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		]
		Object.defineProperty(events[2], "isComposing", { value: true })
		for (const event of events) root.dispatchEvent(event)
		const input = document.createElement("input")
		root.append(input)
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		)
		expect(toggle).not.toHaveBeenCalled()
		expect(host.contains(root)).toBe(true)
	})

	it("routes shared vector-node interaction to the font node-mode adapter", () => {
		const { nodes, stage, workspace } = mountSelectedNodes()
		const toggle = vi.spyOn(workspace.font.actions, "setNodeMode")
		const sharedNode = stage.findOne(`#${nodes[0]!.pointId}`)
		if (sharedNode === undefined)
			throw new Error("Shared vector node was not rendered.")

		act(() => {
			sharedNode.fire("dblclick", {
				evt: new MouseEvent("dblclick"),
			})
		})

		expect(toggle).toHaveBeenCalledOnce()
		expect(toggle).toHaveBeenCalledWith({
			masterId: razorMasterId,
			glyphId: oGlyphId,
			pointId: nodes[0]!.pointId,
			mode: "hard",
		})
	})
})
