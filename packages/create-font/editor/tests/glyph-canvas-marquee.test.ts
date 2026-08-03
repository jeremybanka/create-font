// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { selectionKey } from "../src/outline-selection.ts"
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

function mountMarqueeCanvas() {
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
		?.contours[0]?.nodes.slice(0, 3)
	if (nodes === undefined || nodes.length !== 3)
		throw new Error("The demo glyph does not have enough nodes.")
	workspace.font.silo.setState(
		workspace.ui.selection,
		nodes.map(({ pointId }) => ({ kind: "node" as const, pointId })),
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
	const stage = Konva.stages.at(-1)
	const background = stage?.findOne(".canvas-background")
	if (stage === undefined || background === undefined)
		throw new Error("GlyphCanvas stage did not mount.")
	const controlHelper = stage.findOne(".outline-control-helper")
	const segmentHelper = stage.findOne(".outline-segment-helper")
	if (controlHelper === undefined || segmentHelper === undefined)
		throw new Error("GlyphCanvas helper targets did not mount.")
	return { background, controlHelper, nodes, segmentHelper, stage, workspace }
}

async function marquee(
	stage: {
		setPointersPositions(event: MouseEvent): void
		fire(type: string, event: { evt: MouseEvent }): void
		findOne(
			selector: string,
		): { getAbsolutePosition(): { x: number; y: number } } | undefined
	},
	background: {
		fire(type: string, event: { evt: MouseEvent }, bubble?: boolean): void
	},
	pointId: string,
	modifiers: MouseEventInit,
	reverse = false,
): Promise<void> {
	const rendered = stage.findOne(`#${pointId}`)
	if (rendered === undefined)
		throw new Error(`Point ${pointId} was not rendered.`)
	const point = rendered.getAbsolutePosition()
	const from = reverse
		? { x: point.x + 2, y: point.y + 2 }
		: { x: point.x - 2, y: point.y - 2 }
	const to = reverse
		? { x: point.x - 2, y: point.y - 2 }
		: { x: point.x + 2, y: point.y + 2 }
	const mouse = (type: string, position: { x: number; y: number }) =>
		new MouseEvent(type, {
			bubbles: true,
			clientX: position.x,
			clientY: position.y,
			...modifiers,
		})
	const down = mouse("mousedown", from)
	await act(async () => {
		stage.setPointersPositions(down)
		background.fire("mousedown", { evt: down }, true)
		await Promise.resolve()
	})
	const move = mouse("mousemove", to)
	await act(async () => {
		stage.setPointersPositions(move)
		stage.fire("mousemove", { evt: move })
		await Promise.resolve()
	})
	await act(async () => {
		stage.fire("mouseup", { evt: mouse("mouseup", to) })
		await Promise.resolve()
	})
}

describe("GlyphCanvas marquee completion", () => {
	it("uses Shift-first inversion while preserving add and replace gestures", async () => {
		const { background, nodes, stage, workspace } = mountMarqueeCanvas()
		const [first, second, third] = nodes
		if (first === undefined || second === undefined || third === undefined)
			throw new Error("Expected nodes are missing.")

		await marquee(stage, background, first.pointId, {
			shiftKey: true,
			ctrlKey: true,
		})
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${second.pointId}`, `node/${third.pointId}`])

		await marquee(stage, background, second.pointId, { shiftKey: true }, true)
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${third.pointId}`])

		await marquee(stage, background, first.pointId, { shiftKey: true })
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${third.pointId}`, `node/${first.pointId}`])

		await marquee(stage, background, second.pointId, { ctrlKey: true })
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([
			`node/${third.pointId}`,
			`node/${first.pointId}`,
			`node/${second.pointId}`,
		])

		await marquee(stage, background, second.pointId, {})
		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${second.pointId}`])
	})

	it.each([
		["control", "controlHelper"],
		["segment", "segmentHelper"],
	] as const)(
		"starts a marquee from a %s helper target",
		async (_kind, helperKey) => {
			const mounted = mountMarqueeCanvas()
			const { nodes, stage, workspace } = mounted
			const first = nodes[0]
			if (first === undefined) throw new Error("Expected a node.")
			const rendered = stage.findOne(`#${first.pointId}`)
			if (rendered === undefined) throw new Error("Expected a rendered point.")
			const point = rendered.getAbsolutePosition()
			const from = { x: point.x + 8, y: point.y + 8 }
			const to = { x: point.x - 2, y: point.y - 2 }
			const mouse = (type: string, position: { x: number; y: number }) =>
				new MouseEvent(type, {
					bubbles: true,
					clientX: position.x,
					clientY: position.y,
				})

			workspace.font.silo.setState(workspace.ui.selection, Object.freeze([]))
			const down = mouse("mousedown", from)
			await act(async () => {
				stage.setPointersPositions(down)
				mounted[helperKey].fire("mousedown", { evt: down }, true)
				await Promise.resolve()
			})
			const move = mouse("mousemove", to)
			await act(async () => {
				stage.setPointersPositions(move)
				stage.fire("mousemove", { evt: move })
				await Promise.resolve()
			})
			await act(async () => {
				stage.fire("mouseup", { evt: mouse("mouseup", to) })
				await Promise.resolve()
			})

			expect(
				workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
			).toContain(`node/${first.pointId}`)
		},
	)

	it("keeps visible point geometry out of the marquee path", async () => {
		const { nodes, stage, workspace } = mountMarqueeCanvas()
		const first = nodes[0]
		if (first === undefined) throw new Error("Expected a node.")
		const rendered = stage.findOne(`#${first.pointId}`)
		if (rendered === undefined) throw new Error("Expected a rendered point.")
		const point = rendered.getAbsolutePosition()
		const down = new MouseEvent("mousedown", {
			bubbles: true,
			clientX: point.x,
			clientY: point.y,
		})
		workspace.font.silo.setState(
			workspace.ui.selection,
			Object.freeze([{ kind: "node", pointId: first.pointId }]),
		)

		await act(async () => {
			stage.setPointersPositions(down)
			rendered.fire("mousedown", { evt: down }, true)
			stage.fire("mouseup", { evt: new MouseEvent("mouseup") })
			await Promise.resolve()
		})

		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${first.pointId}`])
	})

	it("keeps forgiving helper clicks routed to the nearest control", async () => {
		const { controlHelper, nodes, stage, workspace } = mountMarqueeCanvas()
		const first = nodes[0]
		if (first === undefined) throw new Error("Expected a node.")
		const rendered = stage.findOne(`#${first.pointId}`)
		if (rendered === undefined) throw new Error("Expected a rendered point.")
		const point = rendered.getAbsolutePosition()
		const click = new MouseEvent("click", {
			bubbles: true,
			clientX: point.x + 8,
			clientY: point.y,
		})
		workspace.font.silo.setState(workspace.ui.selection, Object.freeze([]))

		await act(async () => {
			stage.setPointersPositions(click)
			controlHelper.fire("click", { evt: click }, true)
			await Promise.resolve()
		})

		expect(
			workspace.font.silo.getState(workspace.ui.selection).map(selectionKey),
		).toEqual([`node/${first.pointId}`])
	})
})
