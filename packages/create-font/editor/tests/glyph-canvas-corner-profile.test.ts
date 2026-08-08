// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { StoreProvider } from "atom.io/react"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { makeDemoFont, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"

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

function mountEligibleCorner() {
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
	const original = makeDemoFont()
	const source = {
		...original,
		glyphs: original.glyphs.map((glyph) =>
			glyph.id !== oGlyphId
				? glyph
				: {
						...glyph,
						layers: glyph.layers.map((layer) => ({
							...layer,
							contours: layer.contours.map((contour, contourIndex) => ({
								...contour,
								points: contour.points.map((point, pointIndex) => {
									if (contourIndex !== 0 || pointIndex !== 0) return point
									const {
										incoming: _incoming,
										outgoing: _outgoing,
										...hard
									} = point
									return { ...hard, mode: "hard" as const }
								}),
							})),
						})),
					},
		),
	}
	const workspace = createEditorWorkspace(source)
	workspace.actions.enterGlyphEdit(2, oGlyphId)
	const point = workspace.font.silo.getState(workspace.ui.activeLayer)
		?.contours[0]?.nodes[0]
	if (point === undefined) throw new Error("The corner fixture is missing.")
	workspace.font.silo.setState(workspace.ui.selection, [
		{ kind: "node", pointId: point.pointId },
	])
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
	return { host, point, stage, workspace }
}

describe("GlyphCanvas corner profiles", () => {
	it("renders the inset handle and commits one undoable accessible control edit", () => {
		const { host, point, stage, workspace } = mountEligibleCorner()
		expect(stage.findOne(`#corner-profile:${point.pointId}`)).toBeDefined()
		const fieldset = host.querySelector<HTMLFieldSetElement>(
			"fieldset[data-corner-profile-controls]",
		)
		const profile = fieldset?.querySelector<HTMLSelectElement>(
			'select[aria-label="Corner profile"]',
		)
		if (fieldset === null || profile === null)
			throw new Error("Corner profile controls were not rendered.")
		expect(fieldset.getAttribute("aria-label")).toContain("1 selected corner")
		const commit = vi.spyOn(workspace.font.actions, "setCornerProfiles")
		act(() => {
			profile.value = "circular"
			profile.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(commit).toHaveBeenCalledOnce()
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.every(
					(layer) =>
						layer.contours[0]?.points[0]?.corner?.profile === "circular",
				),
		).toBe(true)
		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.every(
					(layer) => layer.contours[0]?.points[0]?.corner === undefined,
				),
		).toBe(true)
		workspace.font.redo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.every(
					(layer) => layer.contours[0]?.points[0]?.corner?.amount === 12,
				),
		).toBe(true)
	})
})
