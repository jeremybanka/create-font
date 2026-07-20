// @vitest-environment happy-dom

import { h, render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
	FAVICON_INK,
	useEditorDocumentMetadata,
} from "../src/document-metadata.ts"
import type { GlyphPreview } from "../src/glyph-preview.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		act(() => render(null, host))
		host.remove()
	}
	hosts.length = 0
	document
		.querySelectorAll("link[data-create-font-favicon]")
		.forEach((link) => link.remove())
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function decodeFavicon(): string {
	const link = document.querySelector<HTMLLinkElement>(
		"link[data-create-font-favicon]",
	)
	if (link === null) throw new Error("The managed favicon was not installed.")
	return decodeURIComponent(link.href.slice(link.href.indexOf(",") + 1))
}

function MetadataHarness({
	preview,
}: {
	readonly preview: GlyphPreview | null
}) {
	useEditorDocumentMetadata(preview, "canvas", "Test")
	return null
}

function mount(preview: GlyphPreview | null): HTMLElement {
	const host = document.createElement("div")
	document.body.append(host)
	hosts.push(host)
	act(() => render(h(MetadataHarness, { preview }), host))
	return host
}

describe("live favicon color preference", () => {
	it("updates the existing link, keeps the latest preference on glyph changes, and cleans up", () => {
		let matches = true
		const listeners = new Set<() => void>()
		vi.spyOn(window, "matchMedia").mockImplementation(
			() =>
				({
					get matches() {
						return matches
					},
					addEventListener: (_type: string, listener: () => void) =>
						listeners.add(listener),
					removeEventListener: (_type: string, listener: () => void) =>
						listeners.delete(listener),
				}) as unknown as MediaQueryList,
		)
		const first = {
			advanceWidth: 10,
			openPath: "",
			path: "M 0 0 L 1 1",
			viewBox: "0 0 10 10",
		}
		const second = { ...first, path: "M 0 0 L 2 2" }
		const host = mount(first)
		const link = document.querySelector<HTMLLinkElement>(
			"link[data-create-font-favicon]",
		)
		expect(decodeFavicon()).toContain(`fill="${FAVICON_INK.light}"`)
		expect(listeners.size).toBe(1)

		const lightHref = link?.href
		matches = false
		act(() => listeners.forEach((listener) => listener()))
		expect(decodeFavicon()).toContain(`fill="${FAVICON_INK.dark}"`)
		expect(link?.href).not.toBe(lightHref)
		expect(
			document.querySelectorAll("link[data-create-font-favicon]"),
		).toHaveLength(1)

		act(() => render(h(MetadataHarness, { preview: second }), host))
		expect(decodeFavicon()).toContain("M 0 0 L 2 2")
		expect(decodeFavicon()).toContain(`fill="${FAVICON_INK.dark}"`)
		expect(listeners.size).toBe(1)

		act(() => render(null, host))
		expect(listeners.size).toBe(0)
	})

	it("installs a deterministic fallback when matchMedia is unavailable", () => {
		vi.stubGlobal("matchMedia", undefined)
		mount(null)
		expect(decodeFavicon()).toContain(`.background{fill:${FAVICON_INK.dark}}`)
	})
})
