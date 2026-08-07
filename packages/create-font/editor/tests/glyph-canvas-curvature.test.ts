// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"

import { oGlyphId } from "../src/demo-font.ts"
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

function mountCurvatureCanvas() {
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
	workspace.font.silo.setState(workspace.ui.showCurvature, true)
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
	if (stage === undefined) throw new Error("GlyphCanvas did not mount.")
	return { stage, workspace }
}

describe("GlyphCanvas curvature comb", () => {
	it("renders the active outline and reacts to gain changes", () => {
		const { stage, workspace } = mountCurvatureCanvas()
		const cells = stage.find(".curvature-comb-cell")
		expect(cells.length).toBeGreaterThan(0)
		const initialPath = cells[0]?.getAttr("data")

		act(() => workspace.font.silo.setState(workspace.ui.curvatureGain, 2.5))

		expect(stage.findOne(".curvature-comb")).toBeDefined()
		expect(stage.find(".curvature-comb-cell")[0]?.getAttr("data")).not.toBe(
			initialPath,
		)
	})
})
