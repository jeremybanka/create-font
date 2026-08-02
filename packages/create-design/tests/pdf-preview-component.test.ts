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
		const selectObject = vi.fn()
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
			selectObject,
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
		expect(exportDocument).toHaveBeenCalledWith(
			{
				includeBleed: false,
				scope: { kind: "all" },
			},
			{ enabledLints: [] },
		)
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

		const outsideObject = {
			...document.objects[0]!,
			geometry: {
				kind: "rectangle" as const,
				x: document.artboards[0]!.width - 10,
				y: 20,
				width: 30,
				height: 20,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		}
		const warningContext = {
			...context,
			document: { ...document, objects: [outsideObject] },
		}
		act(() =>
			render(
				h(DesignTileContent, { context: warningContext, kind: "export" }),
				host,
			),
		)
		const warningScope = host.querySelector<HTMLSelectElement>(
			"[data-export-scope]",
		)!
		act(() => {
			warningScope.value = "active"
			warningScope.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.querySelector("[data-export-preflight]")).toBeNull()
		const lint = host.querySelector<HTMLInputElement>(
			"[data-outside-artwork-lint] input",
		)!
		act(() => {
			lint.checked = true
			lint.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const preflight = host.querySelector<HTMLDetailsElement>(
			"[data-export-preflight]",
		)!
		expect(preflight.getAttribute("data-decision")).toBe("ready")
		expect(preflight.open).toBe(false)
		expect(preflight.textContent).toContain(
			"extends outside the requested artboards",
		)
		expect(preflight.querySelector("section")?.getAttribute("aria-label")).toBe(
			`${document.artboards[0]!.name} diagnostics`,
		)
		const selectButton = [...preflight.querySelectorAll("button")].find(
			(button) => button.textContent === "Select object",
		)!
		act(() => selectButton.click())
		expect(selectObject).toHaveBeenCalledWith(outsideObject)
		const exportButton = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Export 1 page"),
		)!
		expect(exportButton.disabled).toBe(false)
		act(() => exportButton.click())
		expect(exportDocument).toHaveBeenLastCalledWith(
			{
				includeBleed: false,
				scope: { kind: "active", artboardId: document.artboards[0]!.id },
			},
			{
				enabledLints: ["common.artwork-outside-requested-artboards"],
			},
		)
		act(() => render(null, host))
	})
})
