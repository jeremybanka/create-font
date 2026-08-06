// @vitest-environment happy-dom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, h, render } from "../../../../scripts/react-test-render.ts"

import { designArtboardCanvasChrome } from "../src/artboard-canvas-appearance.ts"
import { DesignTileContent } from "../src/DesignTileContent.tsx"
import { createInitialDocument } from "../src/document.ts"
import type { DesignTileContext } from "../src/design-tile-registry.ts"

const hosts: HTMLElement[] = []

afterEach(() => {
	for (const host of hosts) {
		render(null, host)
		host.remove()
	}
	hosts.length = 0
})

describe("artboard appearance", () => {
	it("keeps the configurable border wholly outside and labels screen-constant", () => {
		const artboard = {
			...createInitialDocument().artboards[0]!,
			name: "Packaging front",
			borderColor: "#123456",
		}
		const normal = designArtboardCanvasChrome(artboard, 1, true)
		const zoomed = designArtboardCanvasChrome(artboard, 4, true)

		expect(normal.background).toBeUndefined()
		expect(normal.border.stroke).toBe("#123456")
		expect(normal.border.x + normal.border.strokeWidth / 2).toBe(artboard.x)
		expect(normal.border.y + normal.border.strokeWidth / 2).toBe(artboard.y)
		expect(
			normal.border.x + normal.border.width - normal.border.strokeWidth / 2,
		).toBe(artboard.x + artboard.width)
		expect(normal.label.text).toBe("Packaging front")
		expect(normal.label.fontSize).toBe(12)
		expect(zoomed.label.fontSize).toBe(3)
		expect(zoomed.label.y).toBe(artboard.y - 19 / 4)
		expect(normal.border.strokeWidth).toBe(1)
		expect(zoomed.border.strokeWidth).toBe(1 / 4)
		expect(normal.selection).toBeDefined()
		expect(normal.selection!.strokeWidth).toBe(1)
		expect(zoomed.selection!.strokeWidth).toBe(1 / 4)
		expect(
			normal.selection!.x + normal.selection!.strokeWidth / 2,
		).toBeLessThan(artboard.x)
	})

	it("edits and clears per-artboard colors while preserving active semantics", () => {
		const initial = createInitialDocument()
		const second = {
			...initial.artboards[0]!,
			id: "artboard:second",
			name: "Second",
			x: 700,
			borderColor: "#123456",
		}
		const designDocument = {
			...initial,
			artboards: [...initial.artboards, second],
		}
		const setArtboardProperty = vi.fn()
		const context = {
			document: designDocument,
			activeArtboard: second,
			activateArtboard: vi.fn(),
			createArtboard: vi.fn(),
			deleteArtboard: vi.fn(),
			duplicateArtboard: vi.fn(),
			reorderArtboard: vi.fn(),
			setArtboardProperty,
			artworkOutsideArtboardsPreference: "warn",
			setArtworkOutsideArtboardsPreference: vi.fn(),
		} as unknown as DesignTileContext
		const host = document.createElement("section")
		document.body.append(host)
		hosts.push(host)
		render(h(DesignTileContent, { context, kind: "pages" }), host)

		const rows = host.querySelectorAll('[role="option"]')
		expect(rows).toHaveLength(2)
		expect(rows[0]?.getAttribute("aria-selected")).toBe("false")
		expect(rows[1]?.getAttribute("aria-current")).toBe("page")

		const background = host.querySelector<HTMLInputElement>(
			'input[aria-label="Artboard background color"]',
		)!
		act(() => {
			background.value = "#abcdef"
			background.dispatchEvent(new InputEvent("input", { bubbles: true }))
		})
		expect(setArtboardProperty).toHaveBeenCalledWith({
			backgroundColor: "#abcdef",
		})

		act(() =>
			[...host.querySelectorAll("button")]
				.find(({ textContent }) => textContent === "Reset border")
				?.click(),
		)
		expect(setArtboardProperty).toHaveBeenCalledWith({
			borderColor: undefined,
		})
	})

	it("styles active, keyboard-focus, and forced-colors states distinctly", () => {
		const packageRoot = process.cwd().endsWith("packages/create-design/editor")
			? process.cwd()
			: join(process.cwd(), "packages/create-design/editor")
		const css = readFileSync(
			join(packageRoot, "src/DesignTileContent.module.css"),
			"utf8",
		)
		expect(css).toContain('&[aria-current="page"]')
		expect(css).toContain("&:focus-visible")
		expect(css).toContain("@media (forced-colors: active)")
	})
})
