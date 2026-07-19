// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PreviewTile } from "../src/PreviewTile.tsx"
import { createEditorWorkspace } from "../src/editor-workspace.ts"
import { EditorStateContext } from "../src/state-hooks.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	vi.useRealTimers()
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
		const firstLeading = first.querySelector('input[aria-label="Line height"]')
		const firstWeight = first.querySelector('input[aria-label="Weight (wght)"]')
		const firstColors = first.querySelector(
			'select[aria-label="Preview colors"]',
		)
		const secondProof = second.querySelector("preview-scroll")
		const initialColors = secondProof?.getAttribute("data-colors")
		const nextColors = initialColors === "light" ? "dark" : "light"
		if (
			!(firstText instanceof HTMLTextAreaElement) ||
			!(firstSize instanceof HTMLInputElement) ||
			!(firstLeading instanceof HTMLInputElement) ||
			!(firstWeight instanceof HTMLInputElement) ||
			!(firstColors instanceof HTMLSelectElement)
		)
			throw new Error("Preview controls were not rendered.")

		input(firstText, "AHO")
		input(firstSize, "72")
		input(firstLeading, "2.5")
		input(firstWeight, "700")
		change(firstColors, nextColors)

		expect(firstText.value).toBe("AHO")
		expect(
			first.querySelector("preview-scroll")?.getAttribute("style"),
		).toContain("72px")
		expect(firstSize.type).toBe("range")
		expect(firstSize.min).toBe("4")
		expect(firstSize.max).toBe("72")
		expect(firstLeading.type).toBe("range")
		expect(firstLeading.min).toBe("0.5")
		expect(firstLeading.max).toBe("2.5")
		expect(
			first.querySelector("preview-scroll")?.getAttribute("style"),
		).toContain("2.5")
		expect(
			first.querySelector("preview-scroll")?.getAttribute("data-colors"),
		).toBe(nextColors)
		expect(first.getAttribute("data-colors")).toBeNull()
		expect(
			(
				second.querySelector(
					'textarea[aria-label="Preview text"]',
				) as HTMLTextAreaElement
			).value,
		).toBe("Hamburgefontsiv")
		expect(secondProof?.getAttribute("data-colors")).toBe(initialColors)
	})

	it("loads long samples and regenerates glyph noise", () => {
		vi.useFakeTimers()
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
		expect(
			first.querySelector('textarea[aria-label="Preview text"]'),
		).toBeNull()
		const seed = first.querySelector('input[aria-label="Noise glyphs"]')
		if (!(seed instanceof HTMLInputElement))
			throw new Error("The glyph noise field was not rendered.")
		input(seed, "nne")
		act(() => {
			vi.advanceTimersByTime(120)
		})
		const characters = [...first.querySelectorAll("use[data-character]")].map(
			(glyph) => glyph.getAttribute("data-character"),
		)
		expect(characters.length).toBeGreaterThanOrEqual(384)
		expect(new Set(characters)).toEqual(new Set(["n", "e"]))
		expect(
			characters.filter((character) => character === "n").length,
		).toBeGreaterThan(
			characters.filter((character) => character === "e").length,
		)
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
			if (!(sample instanceof HTMLSelectElement))
				throw new Error("Preview sample controls were not rendered.")
			change(sample, "noise")
			const before = first.querySelectorAll("use[data-character]").length
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
			expect(
				first.querySelectorAll("use[data-character]").length,
			).toBeGreaterThan(before)
		} finally {
			globalThis.ResizeObserver = OriginalResizeObserver
		}
	})

	it("renders proof glyphs as live inline outlines", () => {
		const { first } = mountTwo()
		expect(first.querySelectorAll("preview-scroll svg").length).toBeGreaterThan(
			0,
		)
		expect(first.querySelectorAll("preview-scroll svg")).toHaveLength(1)
		expect(
			first.querySelector("preview-scroll path")?.getAttribute("d"),
		).toContain("M")
	})
})
