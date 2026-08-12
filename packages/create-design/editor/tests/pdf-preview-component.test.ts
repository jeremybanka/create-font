/**
 * @vitest-environment happy-dom
 */
import { act, h, render } from "../../../../scripts/react-test-render.ts"
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
			curvatureCombEnabled: false,
			curvatureCombDisabledReason: "Select a vector object.",
			curvatureCombSize: 1,
			curvatureCombIntensity: 0.7,
			curvatureCombSide: "outside",
			setCurvatureCombEnabled: vi.fn(),
			setCurvatureCombSize: vi.fn(),
			setCurvatureCombIntensity: vi.fn(),
			setCurvatureCombSide: vi.fn(),
			activeLayerId: document.layers[0]!.id,
			activeGroupScope: [],
			selectedGroupId: null,
			createLayer: vi.fn(),
			deleteLayer: vi.fn(),
			duplicateLayer: vi.fn(),
			renameLayer: vi.fn(),
			reorderLayer: vi.fn(),
			moveHierarchyNode: vi.fn(),
			setLayerLocked: vi.fn(),
			toggleOtherLayerLocks: vi.fn(),
			setLayerUiColor: vi.fn(),
			setLayerVisibility: vi.fn(),
			toggleOtherLayerVisibility: vi.fn(),
			selectLayer: vi.fn(),
			selectHierarchyGroup: vi.fn(),
			selectHierarchyObject: vi.fn(),
			setHierarchyScope: vi.fn(),
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
			setDocumentTitle: vi.fn(),
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
			alignSelection: vi.fn(),
			alignmentTarget: "selection",
			keyObjectId: null,
			setAlignmentTarget: vi.fn(),
			blendCreationDisabledReason: "Select exactly two ordinary objects.",
			blendDiagnosticMessages: [],
			deleteSelection: vi.fn(),
			distributeSelection: vi.fn(),
			directSelectionSummary: "No direct controls selected.",
			cornerProfileControls: null,
			setCornerProfiles: vi.fn(),
			document,
			expandSelection: vi.fn(),
			expansionDisabledReason: "Select a live rectangle or ellipse.",
			expandStrokeSelection: vi.fn(),
			expandBlend: vi.fn(),
			expandTextSelection: vi.fn(),
			textExpansionDisabledReason: "Select one text object.",
			textSelectionRange: null,
			textOverset: false,
			availableTextFonts: [],
			activeTextFontId: null,
			textToolsDisabledReason: "Add a workspace font.",
			beginTextEditing: vi.fn(),
			applyTextTypography: vi.fn(),
			selectTextFont: vi.fn(),
			registerTextFont: vi.fn(),
			applyAreaTextFrame: vi.fn(),
			convertSelectionToAreaText: vi.fn(),
			areaTextConversionDisabledReason: "Select a rectangle.",
			exportDocument,
			exportPngDocument: vi.fn(),
			exportSvgDocument: vi.fn(),
			importSvgDocument: vi.fn(),
			focusCanvas: vi.fn(),
			makeBlend: vi.fn(),
			reverseBlendEndpoint: vi.fn(),
			selectBlend: vi.fn(),
			selectedBlend: null,
			setBlendFirstPoint: vi.fn(),
			setBlendProperty: vi.fn(),
			selectObject,
			selectSwatch: vi.fn(),
			selectTool: vi.fn(),
			selectedObject: null,
			selectedObjectCount: 0,
			selectedObjectIds: [],
			selectionBounds: null,
			selectedSwatch: document.swatches[0],
			selectedSwatchId: document.swatches[0]!.id,
			selectedGuideId: null,
			guidesVisible: true,
			snapSettings: DEFAULT_DESIGN_SNAP_SETTINGS,
			setSnapCategory: vi.fn(),
			setSnapThreshold: vi.fn(),
			selectGuide: vi.fn(),
			toggleGuideLock: vi.fn(),
			setAllGuidesLocked: vi.fn(),
			setGuidesVisible: vi.fn(),
			deleteGuide: vi.fn(),
			setObjectProperty: vi.fn(),
			setObjectGeometry: vi.fn(),
			setAppearanceTarget: vi.fn(),
			swapAppearancePaints: vi.fn(),
			strokePropertiesDisabledReason: "Assign a stroke paint first.",
			strokeExpansionDisabledReason: "Select one stroked object.",
			tool: "select",
			transformSelection: vi.fn(),
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
		const pdfExport = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Export 2 pages as PDF"),
		)!
		expect(pdfExport.closest("tile-button")).not.toBeNull()
		expect(pdfExport.dataset.tone).toBe("primary")
		act(() => pdfExport.click())
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
			checkbox.click()
		})
		expect(host.querySelector("pdf-preview")).not.toBeNull()
		act(() => {
			checkbox.click()
		})
		expect(host.querySelector("pdf-preview")).toBeNull()

		const formatButtons = [
			...host.querySelectorAll<HTMLButtonElement>(
				'tile-button-group[aria-label="Export format"] button',
			),
		]
		expect(formatButtons.map(({ textContent }) => textContent)).toEqual([
			"PDF",
			"SVG",
			"PNG",
		])
		expect(formatButtons[0]?.getAttribute("aria-pressed")).toBe("true")
		act(() => formatButtons[1]?.click())
		expect(
			host.querySelector('[role="region"][aria-label="PDF export options"]'),
		).toBeNull()
		expect(
			host.querySelector('[role="region"][aria-label="SVG export options"]'),
		).not.toBeNull()
		expect(
			[...host.querySelectorAll("button")]
				.find((button) =>
					button.textContent?.includes("Export active artboard"),
				)
				?.closest("tile-button"),
		).not.toBeNull()
		act(() => formatButtons[2]?.click())
		expect(
			host.querySelector('[role="region"][aria-label="PNG export options"]'),
		).not.toBeNull()
		expect(host.querySelectorAll("export-field-row tile-select")).toHaveLength(
			2,
		)
		act(() => formatButtons[0]?.click())

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
			lint.click()
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

		const durableLink = {
			...document.objects[0]!,
			id: "object:portable-link",
			geometry: {
				kind: "artboard-link" as const,
				projectId: "source",
				artboardId: document.artboards[0]!.id,
				width: document.artboards[0]!.width,
				height: document.artboards[0]!.height,
			},
		}
		const resolvedHost = window.document.createElement("div")
		act(() =>
			render(
				h(DesignTileContent, {
					context: {
						...context,
						document: {
							...document,
							objects: [durableLink],
							layers: [
								{
									...document.layers[0]!,
									children: [{ kind: "object", id: durableLink.id }],
								},
							],
						},
						exportDocumentSnapshot: document,
					},
					kind: "export",
				}),
				resolvedHost,
			),
		)
		expect(resolvedHost.textContent).not.toContain("unavailable")
		const resolvedPdfButton = [...resolvedHost.querySelectorAll("button")].find(
			(button) => button.textContent?.includes("as PDF"),
		)!
		expect(resolvedPdfButton.disabled).toBe(false)
		act(() => render(null, resolvedHost))
		act(() => render(null, host))
	})
})
