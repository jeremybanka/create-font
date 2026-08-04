// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
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

function mountCanvas() {
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
	workspace.font.silo.setState(workspace.ui.previewText, "AO\n\nO")
	const host = document.createElement("section")
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
	const textarea = host.querySelector(
		'textarea[aria-label="Text canvas contents"]',
	)
	const stage = Konva.stages.at(-1)
	if (!(textarea instanceof HTMLTextAreaElement) || stage === undefined)
		throw new Error("GlyphCanvas did not mount.")
	return { host, stage, textarea, workspace }
}

async function select(
	textarea: HTMLTextAreaElement,
	start: number,
	end: number,
	direction: SelectionDirection = "forward",
): Promise<void> {
	await act(async () => {
		textarea.setSelectionRange(start, end, direction)
		textarea.dispatchEvent(new Event("selectionchange"))
		await Promise.resolve()
	})
}

describe("GlyphCanvas text selection", () => {
	it("renders multiline native ranges, keeps the focus edge, and clears collapsed ranges", async () => {
		const { host, stage, textarea, workspace } = mountCanvas()
		await select(textarea, 1, 4, "forward")
		expect(stage.find(".typing-selection")).toHaveLength(2)
		expect(workspace.font.silo.getState(workspace.ui.caretIndex)).toBe(4)
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"positions 1 through 4 selected; focus at 4",
		)

		await select(textarea, 1, 4, "backward")
		expect(stage.find(".typing-selection")).toHaveLength(2)
		expect(workspace.font.silo.getState(workspace.ui.caretIndex)).toBe(1)

		act(() => textarea.blur())
		expect(stage.findOne(".typing-selection")?.opacity()).toBe(0.18)
		act(() => textarea.focus())
		expect(stage.findOne(".typing-selection")?.opacity()).toBe(0.3)

		await select(textarea, 2, 2, "none")
		expect(stage.find(".typing-selection")).toHaveLength(0)
		expect(
			stage
				.find("Line")
				.some((node: { stroke(): string }) => node.stroke() === "#df7655"),
		).toBe(true)
	})
})
