// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { act, h, render } from "../../../../scripts/react-test-render.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { makeDemoFont, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { StoreProvider } from "atom.io/react"
import type { EditorVersionControl } from "../src/version-control.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/editor/package.json`,
)
const Konva = (await import(requireFromRenderer.resolve("konva/lib/Core")))
	.default
const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
	vi.restoreAllMocks()
})

describe("GlyphCanvas Diff View", () => {
	it("renders baseline and current topology independently without editing source", () => {
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
						key in target
							? target[key as keyof typeof target]
							: () => undefined,
				}) as unknown as CanvasRenderingContext2D
			},
		)
		const current = makeDemoFont()
		const baseline = {
			...current,
			glyphs: current.glyphs.map((glyph) =>
				glyph.id === oGlyphId
					? {
							...glyph,
							layers: glyph.layers.map((layer) => ({
								...layer,
								contours: layer.contours.slice(0, 1),
							})),
						}
					: glyph,
			),
		}
		const versionControl: EditorVersionControl = {
			loading: false,
			onCompare: async () => undefined,
			onCommit: async () => undefined,
			comparison: {
				base: {
					identity: "base",
					kind: "ref",
					label: "HEAD",
					ref: "HEAD",
					source: baseline,
				},
				changes: [
					{
						change: "modified",
						id: oGlyphId,
						kind: "glyph",
						label: "O",
						paths: ["glyphs/o.json"],
					},
				],
				identity: "comparison",
				target: {
					identity: "working",
					kind: "working",
					label: "Working source",
					source: current,
				},
			},
		}
		const workspace = createEditorWorkspace(current)
		workspace.actions.enterGlyphEdit(2, oGlyphId)
		const before = workspace.font.read.editorSource()
		const host = document.createElement("section")
		host.style.width = "800px"
		host.style.height = "600px"
		document.body.append(host)
		hosts.push(host)
		act(() =>
			render(
				h(StoreProvider, {
					store: workspace.font.silo.store,
					children: h(GlyphCanvas, {
						workspace,
						diffView: true,
						versionControl,
					}),
				}),
				host,
			),
		)
		const stage = Konva.stages.at(-1)
		expect(stage?.find(".diff-baseline-path")).toHaveLength(1)
		expect(stage?.find(".diff-current-path")).toHaveLength(2)
		expect(host.querySelector("diff-glyph-status")).toBeNull()
		const dash = stage?.findOne(".diff-baseline-path")?.dash()
		expect(dash).toHaveLength(2)
		expect(dash?.[0]).toBeGreaterThan(dash?.[1] ?? Number.POSITIVE_INFINITY)
		expect(workspace.font.read.editorSource()).toBe(before)
	})
})
