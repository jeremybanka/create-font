/**
 * @vitest-environment happy-dom
 */
import { h, render } from "preact"
import { act } from "preact/test-utils"
import { describe, expect, it, vi } from "vitest"

import { DesignTileContent } from "../src/DesignTileContent.tsx"
import type { DesignTileContext } from "../src/design-tile-registry.ts"
import { createInitialDocument } from "../src/document.ts"
import { DEFAULT_DESIGN_SNAP_SETTINGS } from "../src/design-canvas.ts"

describe("PDF preview tile", () => {
	it("lets the user opt in and disposes the preview when disabled", () => {
		const initial = createInitialDocument()
		const document = {
			...initial,
			artboards: [
				initial.artboards[0]!,
				{
					id: "artboard:second",
					name: "Second",
					x: 700,
					y: 0,
					width: 300,
					height: 200,
				},
			],
		}
		const exportDocument = vi.fn()
		const context: DesignTileContext = {
			activateArtboard: vi.fn(),
			activeArtboard: document.artboards[0]!,
			createArtboard: vi.fn(),
			deleteArtboard: vi.fn(),
			duplicateArtboard: vi.fn(),
			fitAllArtboards: vi.fn(),
			moveArtworkWithArtboard: false,
			reorderArtboard: vi.fn(),
			setArtboardProperty: vi.fn(),
			setMoveArtworkWithArtboard: vi.fn(),
			addSwatch: vi.fn(),
			appearanceDisabledReason: null,
			appearanceSummary: {
				fill: null,
				stroke: null,
				strokeStyle: {
					width: null,
					cap: null,
					join: null,
					miterLimit: null,
					dashArray: null,
					dashOffset: null,
				},
			},
			appearanceTarget: "fill",
			applyAppearancePaint: vi.fn(),
			applyStrokeProperties: vi.fn(),
			deleteSelection: vi.fn(),
			directSelectionSummary: "No direct controls selected.",
			document,
			expandSelection: vi.fn(),
			expansionDisabledReason: "Select a live rectangle or ellipse.",
			expandStrokeSelection: vi.fn(),
			exportDocument,
			focusCanvas: vi.fn(),
			selectObject: vi.fn(),
			selectSwatch: vi.fn(),
			selectTool: vi.fn(),
			selectedObject: null,
			selectedObjectCount: 0,
			selectedObjectIds: [],
			selectedSwatch: document.swatches[0],
			selectedSwatchId: document.swatches[0]!.id,
			selectedGuideId: null,
			snapSettings: DEFAULT_DESIGN_SNAP_SETTINGS,
			setSnapCategory: vi.fn(),
			setSnapThreshold: vi.fn(),
			selectGuide: vi.fn(),
			toggleGuideLock: vi.fn(),
			deleteGuide: vi.fn(),
			setObjectProperty: vi.fn(),
			setObjectGeometry: vi.fn(),
			setAppearanceTarget: vi.fn(),
			swapAppearancePaints: vi.fn(),
			strokePropertiesDisabledReason: "Assign a stroke paint first.",
			strokeExpansionDisabledReason: "Select one stroked object.",
			tool: "select",
			updateSwatch: vi.fn(),
			zoom: 1,
		}
		const host = window.document.createElement("div")
		act(() => render(h(DesignTileContent, { context, kind: "export" }), host))
		const scope = host.querySelector<HTMLSelectElement>("[data-export-scope]")!
		act(() => {
			scope.value = "all"
			scope.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.querySelector("button")?.textContent).toContain("2 pages")
		act(() => host.querySelector<HTMLButtonElement>("button")!.click())
		expect(exportDocument).toHaveBeenCalledWith({
			includeBleed: false,
			scope: { kind: "all" },
		})
		const checkbox = host.querySelector<HTMLInputElement>(
			"[data-live-preview] input[type=checkbox]",
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
