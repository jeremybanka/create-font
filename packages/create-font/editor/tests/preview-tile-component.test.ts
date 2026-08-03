// @vitest-environment happy-dom

import { act, h, render } from "../../../../scripts/react-test-render.ts"
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
					h(PreviewTile, {
						key: "first",
						workspace,
						tileId: "preview:first",
					}),
					h(PreviewTile, {
						key: "second",
						workspace,
						tileId: "preview:second",
					}),
				]),
			}),
			host,
		),
	)
	const tiles = [...host.querySelectorAll("preview-tile")]
	if (tiles.length !== 2) throw new Error("The preview tiles did not mount.")
	return { first: tiles[0]!, second: tiles[1]!, workspace }
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

	it("updates colors without replacing the browser text proof", () => {
		const { first, second } = mountTwo()
		const firstText = first.querySelector('textarea[aria-label="Preview text"]')
		const firstColors = first.querySelector(
			'select[aria-label="Preview colors"]',
		)
		const firstProof = first.querySelector("preview-scroll")
		const secondProof = second.querySelector("preview-scroll")
		if (
			!(firstText instanceof HTMLTextAreaElement) ||
			!(firstColors instanceof HTMLSelectElement) ||
			firstProof === null ||
			secondProof === null
		)
			throw new Error("Preview color controls were not rendered.")

		input(firstText, "AAAAOOOO")
		const proof = firstProof.querySelector("preview-proof")
		if (proof === null)
			throw new Error("The browser text proof was not rendered.")
		const initialColors = firstProof.getAttribute("data-colors")
		const secondColors = secondProof.getAttribute("data-colors")
		if (initialColors !== "dark" && initialColors !== "light")
			throw new Error("The initial Preview color preset is invalid.")
		const otherColors = initialColors === "light" ? "dark" : "light"

		expect(proof.textContent).toBe("AAAAOOOO")

		for (const colors of [
			otherColors,
			initialColors,
			otherColors,
			initialColors,
		]) {
			change(firstColors, colors)
			expect(firstProof.getAttribute("data-colors")).toBe(colors)
			expect(firstProof.querySelector("preview-proof")).toBe(proof)
			expect(proof.textContent).toBe("AAAAOOOO")
			expect(secondProof.getAttribute("data-colors")).toBe(secondColors)
		}
	})

	it("announces a degraded live font while keeping the preview ready", async () => {
		const { first, workspace } = mountTwo()
		act(() => {
			workspace.font.silo.setState(workspace.liveFont.compilation, {
				status: "ready",
				generation: 2,
				revision: 3,
				artifact: {
					bytes: new Uint8Array([1]),
					generation: 2,
					revision: 3,
					timings: {
						queueing: 1,
						projectionAndIngestion: 2,
						serialization: 3,
						total: 6,
					},
				},
				diagnostics: [
					{
						code: "compatibility.node_count",
						message: "Live preview froze O to its default master.",
						stage: "projection",
					},
				],
				lastGood: {
					bytes: new Uint8Array([1]),
					generation: 2,
					revision: 3,
					timings: {
						queueing: 1,
						projectionAndIngestion: 2,
						serialization: 3,
						total: 6,
					},
				},
			})
		})
		await act(async () => {
			await Promise.resolve()
		})

		const status = first.querySelector("[data-live-font-status]")
		expect(status?.getAttribute("data-degraded")).toBe("true")
		expect(status?.getAttribute("data-error")).toBe("false")
		expect(status?.textContent).toContain("froze O")
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
		const characters = [
			...(first.querySelector("preview-proof")?.textContent ?? ""),
		]
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
			const before =
				first.querySelector("preview-proof")?.textContent?.length ?? 0
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
				first.querySelector("preview-proof")?.textContent?.length ?? 0,
			).toBeGreaterThan(before)
		} finally {
			globalThis.ResizeObserver = OriginalResizeObserver
		}
	})

	it("renders proof text through the browser font path rather than SVG uses", () => {
		const { first } = mountTwo()
		expect(
			first.querySelector("preview-scroll preview-proof")?.textContent,
		).toBe("Hamburgefontsiv")
		expect(first.querySelector("preview-scroll svg")).toBeNull()
		expect(first.querySelector("preview-scroll use")).toBeNull()
	})
})
