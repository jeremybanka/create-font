// @vitest-environment happy-dom

import type { EditorRuleSource, RuleId } from "@create-font/states"
import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { aGlyphId, oGlyphId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { OUTLINE_CLIPBOARD_MIME } from "../src/outline-clipboard.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../../create-art/preact-konva/package.json`,
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
	workspace.actions.enterGlyphEdit(2, oGlyphId)
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
	return { host, root, stage, workspace }
}

const ruleId = "rule:test" as RuleId
const rule: EditorRuleSource = {
	id: ruleId,
	a: { x: 0, y: 300 },
	b: { x: 600, y: 300 },
}

async function installSelectedRule(
	workspace: ReturnType<typeof createEditorWorkspace>,
): Promise<void> {
	await act(async () => {
		workspace.font.actions.setGlyphRules({ glyphId: oGlyphId, rules: [rule] })
		workspace.font.silo.setState(workspace.ui.selectedRuleIds, [ruleId])
		await Promise.resolve()
	})
}

describe("GlyphCanvas rules", () => {
	it("previews a pending rule and commits its Shift-constrained angle", async () => {
		const { stage, workspace } = mountCanvas()
		await act(async () => {
			workspace.actions.selectTool("rule")
			await Promise.resolve()
		})
		const background = stage.findOne(".canvas-background")
		if (background === undefined)
			throw new Error("Canvas background was not rendered.")
		let pointer = { x: 300, y: 300 }
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)

		act(() => {
			background.fire(
				"pointerdown",
				{ evt: { type: "pointerdown", shiftKey: false } },
				true,
			)
		})
		expect(stage.findOne(".rule-pending-point-a")).toBeDefined()
		expect(stage.findOne(".rule-hover-preview")).toBeUndefined()

		pointer = { x: 430, y: 337 }
		act(() => {
			background.fire(
				"pointermove",
				{ evt: { type: "pointermove", shiftKey: true } },
				true,
			)
		})
		const previewA = stage.findOne(".rule-pending-point-a")
		const previewB = stage.findOne(".rule-hover-point-b")
		if (previewA === undefined || previewB === undefined)
			throw new Error("Rule hover preview was not rendered.")
		const angle =
			(Math.atan2(previewB.y() - previewA.y(), previewB.x() - previewA.x()) *
				180) /
			Math.PI
		expect(angle / 15).toBeCloseTo(Math.round(angle / 15))
		expect(stage.findOne(".rule-hover-preview-line")).toBeDefined()

		act(() => {
			background.fire(
				"pointerdown",
				{ evt: { type: "pointerdown", shiftKey: true } },
				true,
			)
		})
		const saved = workspace.font.read.editorGlyphSource(oGlyphId)?.rules?.[0]
		expect(saved?.a).toEqual({ x: previewA.x(), y: previewA.y() })
		expect(saved?.b.x).toBeCloseTo(previewB.x())
		expect(saved?.b.y).toBeCloseTo(previewB.y())
		expect(stage.findOne(".rule-hover-preview")).toBeUndefined()
	})

	it("snaps unconstrained rule points independently to node coordinates", async () => {
		const { stage, workspace } = mountCanvas()
		await act(async () => {
			workspace.actions.selectTool("rule")
			await Promise.resolve()
		})
		const background = stage.findOne(".canvas-background")
		const outline = stage.findOne(".outline-segment")
		const nodes = workspace.font.silo.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes
		const a = nodes?.[0]
		const b = nodes?.[2]
		if (
			background === undefined ||
			outline === undefined ||
			a === undefined ||
			b === undefined
		)
			throw new Error("Expected an outline and two nodes.")
		let pointer = outline
			.getAbsoluteTransform()
			.point({ x: a.x + 1, y: a.y - 1 })
		vi.spyOn(stage, "getPointerPosition").mockImplementation(() => pointer)

		act(() => {
			background.fire(
				"pointermove",
				{ evt: { type: "pointermove", shiftKey: true } },
				true,
			)
		})
		const previewA = stage.findOne(".rule-hover-point-a")
		expect({ x: previewA?.x(), y: previewA?.y() }).toEqual({
			x: a.x,
			y: a.y,
		})
		expect(stage.find(".active-snap")).toHaveLength(2)

		act(() => {
			background.fire(
				"pointerdown",
				{ evt: { type: "pointerdown", shiftKey: true } },
				true,
			)
		})
		const pendingA = stage.findOne(".rule-pending-point-a")
		expect({ x: pendingA?.x(), y: pendingA?.y() }).toEqual({
			x: a.x,
			y: a.y,
		})
		expect(stage.findOne(".rule-hover-point-a")).toBeUndefined()

		pointer = outline.getAbsoluteTransform().point({ x: b.x - 1, y: b.y + 1 })
		act(() => {
			background.fire(
				"pointermove",
				{ evt: { type: "pointermove", shiftKey: false } },
				true,
			)
		})
		const previewB = stage.findOne(".rule-hover-point-b")
		expect({ x: previewB?.x(), y: previewB?.y() }).toEqual({
			x: b.x,
			y: b.y,
		})
		expect(stage.find(".active-snap")).toHaveLength(2)
	})

	it("clears rule selection when editing a different glyph", async () => {
		const { workspace } = mountCanvas()
		await installSelectedRule(workspace)

		act(() => workspace.actions.enterGlyphEdit(0, aGlyphId))

		expect(workspace.font.silo.getState(workspace.ui.selectedRuleIds)).toEqual(
			[],
		)
	})

	it("reconciles a rule removed by undo and lets outline copy proceed", async () => {
		const { root, workspace } = mountCanvas()
		await installSelectedRule(workspace)
		const node = workspace.font.silo.getState(workspace.ui.activeLayer)
			?.contours[0]?.nodes[0]
		if (node === undefined) throw new Error("Expected an outline node.")
		workspace.font.silo.setState(workspace.ui.selection, [
			{ kind: "node", pointId: node.pointId },
		])

		await act(async () => {
			workspace.font.undo(oGlyphId)
			await Promise.resolve()
		})
		expect(workspace.font.silo.getState(workspace.ui.selectedRuleIds)).toEqual(
			[],
		)

		const values = new Map<string, string>()
		const copy = new Event("copy", { bubbles: true, cancelable: true })
		Object.defineProperty(copy, "clipboardData", {
			value: {
				setData: (format: string, data: string) => values.set(format, data),
				getData: (format: string) => values.get(format) ?? "",
			},
		})
		act(() => {
			root.dispatchEvent(copy)
		})
		expect(copy.defaultPrevented).toBe(true)
		expect(values.get(OUTLINE_CLIPBOARD_MIME)).toBeTruthy()
	})

	it("selects a completed rule by its line in Rule mode and deletes it", async () => {
		const { root, stage, workspace } = mountCanvas()
		await installSelectedRule(workspace)
		await act(async () => {
			workspace.font.silo.setState(workspace.ui.selectedRuleIds, [])
			workspace.actions.selectTool("rule")
			await Promise.resolve()
		})
		const line = stage.findOne(".glyph-rule-line")
		const measure = stage.findOne(".rule-measure")
		if (line === undefined) throw new Error("Rule line was not rendered.")
		expect(line.opacity()).toBe(0.1)
		expect(measure?.opacity()).toBe(0.85)

		await act(async () => {
			line.fire(
				"pointerdown",
				{ evt: { type: "pointerdown", shiftKey: false } },
				true,
			)
			await Promise.resolve()
		})
		expect(workspace.font.silo.getState(workspace.ui.selectedRuleIds)).toEqual([
			ruleId,
		])
		expect(stage.findOne(".glyph-rule-line")?.opacity()).toBe(0.3)
		expect(stage.findOne(".rule-point-a")).toBeUndefined()
		expect(stage.findOne(".rule-point-b")).toBeUndefined()
		expect(stage.findOne(".rule-endpoint-hit")).toBeUndefined()

		act(() => {
			root.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
			)
		})
		expect(
			workspace.font.read.editorGlyphSource(oGlyphId)?.rules,
		).toBeUndefined()
	})
})
