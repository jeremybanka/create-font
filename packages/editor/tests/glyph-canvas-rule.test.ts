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

	it("previews an endpoint drag and commits one undoable rule edit", async () => {
		const { host, stage, workspace } = mountCanvas()
		await installSelectedRule(workspace)
		const handle = stage.findOne(".rule-endpoint-b")
		if (handle === undefined)
			throw new Error("Rule endpoint B interaction target was not rendered.")
		const beforeSummary = host.querySelector("[data-rule-summary]")?.textContent

		act(() => {
			handle.fire("dragstart", { evt: { type: "pointerdown" } })
			handle.position({ x: 650, y: 360 })
			handle.fire("dragmove", { evt: { type: "pointermove" } })
		})
		expect(host.querySelector("[data-rule-summary]")?.textContent).not.toBe(
			beforeSummary,
		)

		act(() => {
			handle.fire("dragend", { evt: { type: "pointerup" } })
		})
		expect(
			workspace.font.read.editorGlyphSource(oGlyphId)?.rules?.[0]?.b,
		).toEqual({ x: 650, y: 360 })

		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.read.editorGlyphSource(oGlyphId)?.rules?.[0]?.b,
		).toEqual(rule.b)
		workspace.font.redo(oGlyphId)
		expect(
			workspace.font.read.editorGlyphSource(oGlyphId)?.rules?.[0]?.b,
		).toEqual({ x: 650, y: 360 })
	})
})
