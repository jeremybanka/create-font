// @vitest-environment happy-dom

import { createRequire } from "node:module"
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlyphCanvas } from "../src/GlyphCanvas.tsx"
import { blackMasterId, oGlyphId, razorMasterId } from "../src/demo-font.ts"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { OUTLINE_CLIPBOARD_MIME } from "../src/outline-clipboard.ts"
import type { EditorSelectionTarget } from "../src/outline-selection.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const requireFromRenderer = createRequire(
	`${process.cwd()}/../preact-konva/package.json`,
)
await import(requireFromRenderer.resolve("konva/lib/Core"))

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
	const nodes = workspace.font.silo
		.getState(workspace.ui.activeLayer)
		?.contours[0]?.nodes.slice(0, 3)
	if (nodes === undefined || nodes.length !== 3)
		throw new Error("The demo glyph does not have enough nodes.")
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
	return { host, nodes, root, workspace }
}

function clipboardEvent(
	type: "copy" | "cut" | "paste",
	clipboard: {
		setData(format: string, data: string): void
		getData(format: string): string
	} | null,
): Event {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, "clipboardData", { value: clipboard })
	return event
}

function pointCount(
	workspace: ReturnType<typeof createEditorWorkspace>,
): number {
	return (
		workspace.font.silo
			.getState(workspace.ui.activeLayer)
			?.contours.reduce((total, contour) => total + contour.nodes.length, 0) ??
		0
	)
}

async function setSelection(
	workspace: ReturnType<typeof createEditorWorkspace>,
	selection: readonly EditorSelectionTarget[],
): Promise<void> {
	await act(async () => {
		workspace.font.silo.setState(workspace.ui.selection, selection)
		await Promise.resolve()
	})
}

describe("GlyphCanvas cut", () => {
	it("writes copy-compatible formats, deletes represented nodes, and round-trips history", async () => {
		const { nodes, root, workspace } = mountCanvas()
		const [first, second] = nodes
		if (first === undefined || second === undefined)
			throw new Error("Selected nodes are missing.")
		await setSelection(workspace, [
			{ kind: "node", pointId: first.pointId },
			{ kind: "node", pointId: second.pointId },
			// This handle is deliberately not represented independently by the payload.
			{ kind: "handle", pointId: first.pointId, handle: "incoming" },
		])
		const before = pointCount(workspace)
		const values = new Map<string, string>()
		const clipboard = {
			setData: (format: string, data: string) => {
				values.set(format, data)
			},
			getData: (format: string) => values.get(format) ?? "",
		}
		const cut = clipboardEvent("cut", clipboard)
		act(() => {
			root.dispatchEvent(cut)
		})

		expect(cut.defaultPrevented).toBe(true)
		expect(values.get(OUTLINE_CLIPBOARD_MIME)).toBeTruthy()
		expect(values.get("text/plain")).toMatch(/^create-font-outline:/)
		expect(pointCount(workspace)).toBe(before - 2)
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([])

		workspace.font.undo(oGlyphId)
		expect(pointCount(workspace)).toBe(before)
		workspace.font.redo(oGlyphId)
		expect(pointCount(workspace)).toBe(before - 2)
	})

	it("pastes the fragment produced by Cut with fresh selected point IDs", async () => {
		const { nodes, root, workspace } = mountCanvas()
		const [first, second] = nodes
		if (first === undefined || second === undefined)
			throw new Error("Selected nodes are missing.")
		await setSelection(workspace, [
			{ kind: "node", pointId: first.pointId },
			{ kind: "node", pointId: second.pointId },
		])
		const before = pointCount(workspace)
		const values = new Map<string, string>()
		const clipboard = {
			setData: (format: string, data: string) => values.set(format, data),
			getData: (format: string) => values.get(format) ?? "",
		}
		act(() => {
			root.dispatchEvent(clipboardEvent("cut", clipboard))
		})
		act(() => {
			root.dispatchEvent(clipboardEvent("paste", clipboard))
		})

		expect(pointCount(workspace)).toBe(before)
		const pasted = workspace.font.silo.getState(workspace.ui.selection)
		expect(pasted).toHaveLength(2)
		expect(pasted.every((target) => target.kind === "node")).toBe(true)
		expect(
			pasted.some(
				(target) =>
					target.pointId === first.pointId || target.pointId === second.pointId,
			),
		).toBe(false)
	})

	it("copies from one master and pastes into another master of the same glyph", async () => {
		const { nodes, root, workspace } = mountCanvas()
		const glyphBefore = workspace.font.read.editorGlyphSource(oGlyphId)
		const sourceBefore = structuredClone(
			glyphBefore?.layers.find((layer) => layer.masterId === razorMasterId),
		)
		const destinationBefore = glyphBefore?.layers.find(
			(layer) => layer.masterId === blackMasterId,
		)
		await setSelection(
			workspace,
			nodes.map(({ pointId }) => ({ kind: "node", pointId })),
		)
		const values = new Map<string, string>()
		const clipboard = {
			setData: (format: string, data: string) => {
				values.set(format, data)
			},
			getData: (format: string) => values.get(format) ?? "",
		}
		const copy = clipboardEvent("copy", clipboard)
		act(() => {
			root.dispatchEvent(copy)
		})
		expect(copy.defaultPrevented).toBe(true)

		await act(async () => {
			workspace.actions.selectMaster(blackMasterId)
			await Promise.resolve()
		})
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([])
		const paste = clipboardEvent("paste", clipboard)
		await act(async () => {
			root.dispatchEvent(paste)
			await Promise.resolve()
		})
		expect(paste.defaultPrevented).toBe(true)
		const destinationAfter = workspace.font.read
			.editorGlyphSource(oGlyphId)
			?.layers.find((layer) => layer.masterId === blackMasterId)
		expect(destinationAfter?.contours).toHaveLength(
			(destinationBefore?.contours.length ?? 0) + 1,
		)
		const pastedSelection = workspace.font.silo.getState(workspace.ui.selection)
		expect(pastedSelection).toHaveLength(nodes.length)
		expect(pastedSelection.every((target) => target.kind === "node")).toBe(true)
		expect(
			pastedSelection.some((target) =>
				nodes.some(({ pointId }) => pointId === target.pointId),
			),
		).toBe(false)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === razorMasterId),
		).toEqual(sourceBefore)

		workspace.font.undo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)?.contours,
		).toHaveLength(destinationBefore?.contours.length ?? 0)
		workspace.font.redo(oGlyphId)
		expect(
			workspace.font.read
				.editorGlyphSource(oGlyphId)
				?.layers.find((layer) => layer.masterId === blackMasterId)?.contours,
		).toHaveLength((destinationBefore?.contours.length ?? 0) + 1)
	})

	it("is non-destructive for unavailable, failed, and handles-only clipboards", async () => {
		const { host, nodes, root, workspace } = mountCanvas()
		const first = nodes[0]
		if (first === undefined) throw new Error("Selected node is missing.")
		const before = pointCount(workspace)
		await setSelection(workspace, [{ kind: "node", pointId: first.pointId }])
		act(() => {
			root.dispatchEvent(clipboardEvent("cut", null))
		})
		expect(pointCount(workspace)).toBe(before)
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"unavailable",
		)

		let writes = 0
		const failed = clipboardEvent("cut", {
			setData: () => {
				writes += 1
				if (writes === 2) throw new Error("denied")
			},
			getData: () => "",
		})
		act(() => {
			root.dispatchEvent(failed)
		})
		expect(failed.defaultPrevented).toBe(false)
		expect(pointCount(workspace)).toBe(before)
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([
			{ kind: "node", pointId: first.pointId },
		])

		await setSelection(workspace, [
			{ kind: "handle", pointId: first.pointId, handle: "incoming" },
		])
		act(() => {
			root.dispatchEvent(
				clipboardEvent("cut", {
					setData: vi.fn(),
					getData: () => "",
				}),
			)
		})
		expect(pointCount(workspace)).toBe(before)
		expect(workspace.font.silo.getState(workspace.ui.selection)).toEqual([
			{ kind: "handle", pointId: first.pointId, handle: "incoming" },
		])
		expect(host.querySelector('[role="status"]')?.textContent).toContain(
			"Select one or more outline nodes",
		)
	})

	it("leaves native text targets and canvas typing mode to the browser", () => {
		const { root, workspace } = mountCanvas()
		const setData = vi.fn()
		const clipboard = { setData, getData: () => "" }
		const textarea = root.querySelector("textarea")
		if (!(textarea instanceof HTMLTextAreaElement))
			throw new Error("Text canvas textarea is missing.")
		const nativeCut = clipboardEvent("cut", clipboard)
		textarea.dispatchEvent(nativeCut)
		expect(nativeCut.defaultPrevented).toBe(false)
		expect(setData).not.toHaveBeenCalled()

		workspace.actions.exitGlyphEdit()
		const typingCut = clipboardEvent("cut", clipboard)
		act(() => {
			root.dispatchEvent(typingCut)
		})
		expect(typingCut.defaultPrevented).toBe(false)
		expect(setData).not.toHaveBeenCalled()
	})
})
