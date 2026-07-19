// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it } from "vitest"

import { PreviewTile } from "../src/PreviewTile.tsx"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
	act(() => {
		element.value = value
		element.dispatchEvent(new InputEvent("input", { bubbles: true }))
	})
}

function change(element: HTMLSelectElement, value: string) {
	act(() => {
		element.value = value
		element.dispatchEvent(new Event("change", { bubbles: true }))
	})
}

function mountTwo() {
	const host = document.createElement("section")
	document.body.append(host)
	hosts.push(host)
	const workspace = createEditorWorkspace()
	act(() =>
		render(
			h(EditorStateContext.Provider, {
				value: workspace.font.silo,
				children: h("div", {}, [
					h(PreviewTile, { workspace, tileId: "preview:first" }),
					h(PreviewTile, { workspace, tileId: "preview:second" }),
				]),
			}),
			host,
		),
	)
	const tiles = [...host.querySelectorAll("preview-tile")]
	if (tiles.length !== 2) throw new Error("The preview tiles did not mount.")
	return { first: tiles[0]!, second: tiles[1]! }
}

describe("PreviewTile", () => {
	it("keeps text, typography, axes, and colors local to each tile", () => {
		const { first, second } = mountTwo()
		const firstText = first.querySelector('textarea[aria-label="Preview text"]')
		const firstSize = first.querySelector('input[aria-label="Font size"]')
		const firstWeight = first.querySelector('input[type="range"]')
		const initialColors = second.getAttribute("data-colors")
		const nextColors = initialColors === "light" ? "dark" : "light"
		const colorButton = [...first.querySelectorAll("button")].find(
			(button) =>
				button.textContent ===
				(nextColors === "light" ? "Black on white" : "White on black"),
		)
		if (
			!(firstText instanceof HTMLTextAreaElement) ||
			!(firstSize instanceof HTMLInputElement) ||
			!(firstWeight instanceof HTMLInputElement) ||
			!(colorButton instanceof HTMLButtonElement)
		)
			throw new Error("Preview controls were not rendered.")

		input(firstText, "AHO")
		input(firstSize, "72")
		input(firstWeight, "700")
		act(() => colorButton.click())

		expect(firstText.value).toBe("AHO")
		expect(
			first.querySelector("preview-scroll")?.getAttribute("style"),
		).toContain("72px")
		expect(first.querySelector("output")?.textContent).toBe("700")
		expect(first.getAttribute("data-colors")).toBe(nextColors)
		expect(
			(
				second.querySelector(
					'textarea[aria-label="Preview text"]',
				) as HTMLTextAreaElement
			).value,
		).toBe("Hamburgefontsiv")
		expect(second.querySelector("output")?.textContent).not.toBe("700")
		expect(second.getAttribute("data-colors")).toBe(initialColors)
	})

	it("loads long samples and regenerates glyph noise", () => {
		const { first } = mountTwo()
		const sample = first.querySelector('select[aria-label="Preview sample"]')
		const text = first.querySelector('textarea[aria-label="Preview text"]')
		if (
			!(sample instanceof HTMLSelectElement) ||
			!(text instanceof HTMLTextAreaElement)
		)
			throw new Error("Preview sample controls were not rendered.")

		change(sample, "pi")
		expect(text.value.replace(".", "")).toHaveLength(1_000)
		change(sample, "noise")
		const seed = first.querySelector('input[aria-label="Noise glyphs"]')
		if (!(seed instanceof HTMLInputElement))
			throw new Error("The glyph noise field was not rendered.")
		input(seed, "can")
		expect(text.value.length).toBeGreaterThanOrEqual(384)
		expect(new Set(text.value)).toEqual(new Set(["c", "a", "n"]))
	})

	it("refills glyph noise when the proof area grows", () => {
		const resizeCallbacks: ResizeObserverCallback[] = []
		const OriginalResizeObserver = globalThis.ResizeObserver
		globalThis.ResizeObserver = class {
			constructor(callback: ResizeObserverCallback) {
				resizeCallbacks.push(callback)
			}
			disconnect() {}
			observe() {}
			unobserve() {}
		} as unknown as typeof ResizeObserver
		try {
			const { first } = mountTwo()
			const sample = first.querySelector('select[aria-label="Preview sample"]')
			const text = first.querySelector('textarea[aria-label="Preview text"]')
			if (
				!(sample instanceof HTMLSelectElement) ||
				!(text instanceof HTMLTextAreaElement)
			)
				throw new Error("Preview sample controls were not rendered.")
			change(sample, "noise")
			const before = text.value.length
			act(() => {
				for (const resize of resizeCallbacks)
					resize(
						[
							{
								contentRect: { width: 900, height: 700 },
							} as ResizeObserverEntry,
						],
						{} as ResizeObserver,
					)
			})
			expect(text.value.length).toBeGreaterThan(before)
		} finally {
			globalThis.ResizeObserver = OriginalResizeObserver
		}
	})

	it("renders proof glyphs as live inline outlines", () => {
		const { first } = mountTwo()
		expect(first.querySelectorAll("preview-scroll svg").length).toBeGreaterThan(
			0,
		)
		expect(
			first.querySelector("preview-scroll path")?.getAttribute("d"),
		).toContain("M")
	})
})
