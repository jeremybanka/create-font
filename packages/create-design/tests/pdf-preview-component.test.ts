/**
 * @vitest-environment happy-dom
 */
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { describe, expect, it, vi } from "vitest"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"
import { createInitialDocument } from "../src/document.ts"

describe("PDF preview tile", () => {
	it("lets the user opt in and disposes the preview when disabled", () => {
		const document = createInitialDocument()
		const context: DesignTileContext = {
			addSwatch: vi.fn(),
			deleteSelection: vi.fn(),
			document,
			exportDocument: vi.fn(),
			focusCanvas: vi.fn(),
			selectObject: vi.fn(),
			selectSwatch: vi.fn(),
			selectTool: vi.fn(),
			selectedObject: null,
			selectedSwatch: document.swatches[0],
			selectedSwatchId: document.swatches[0]!.id,
			setObjectProperty: vi.fn(),
			tool: "select",
			updateSwatch: vi.fn(),
			zoom: 1,
		}
		const host = window.document.createElement("div")
		act(() => render(h(DesignTileContent, { context, kind: "export" }), host))
		const checkbox = host.querySelector<HTMLInputElement>(
			"input[type=checkbox]",
		)!
		expect(host.querySelector("pdf-preview")).toBeNull()
		act(() => {
			checkbox.checked = true
			checkbox.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.querySelector("pdf-preview")).not.toBeNull()
		act(() => {
			checkbox.checked = false
			checkbox.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.querySelector("pdf-preview")).toBeNull()
		act(() => render(null, host))
	})
})
