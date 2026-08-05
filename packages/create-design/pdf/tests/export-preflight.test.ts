import { DEFAULT_DESIGN_STROKE_STYLE } from "@create-design/source"
import { describe, expect, it } from "vitest"

import {
	ARTWORK_OUTSIDE_ARTBOARDS_LINT,
	exportPreflightAllowsOutput,
	runExportPreflight,
	type ExportPreflightAdapter,
} from "../src/export-preflight.ts"
import {
	PDF_EXPORT_CAPABILITIES,
	preflightPdfExport,
} from "../src/pdf-preflight.ts"
import type { DesignDocument, DesignObject } from "@create-design/source"
import type { DesignTextService } from "@create-design/text"

const outsideArtworkLint = {
	enabledLints: [ARTWORK_OUTSIDE_ARTBOARDS_LINT],
} as const

const rectangle = (id: string, x: number, width: number): DesignObject => ({
	id,
	name: id.replace("object:", ""),
	geometry: { kind: "rectangle", x, y: 10, width, height: 20 },
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: { fill: { swatchId: "swatch:ink" } },
})

const openPath = (): DesignObject => ({
	id: "object:open",
	name: "Open path",
	geometry: {
		kind: "path",
		contours: [
			{
				id: "contour:open",
				closed: false,
				points: [
					{ id: "point:open:0", x: 20, y: 20 },
					{ id: "point:open:1", x: 40, y: 40 },
					{ id: "point:open:2", x: 20, y: 40 },
				],
			},
		],
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: {
		fill: { swatchId: "swatch:ink" },
		stroke: {
			...DEFAULT_DESIGN_STROKE_STYLE,
			swatchId: "swatch:ink",
			width: 2,
		},
	},
})

const areaText = (): DesignObject => ({
	id: "object:text",
	name: "Area text",
	geometry: {
		kind: "text",
		mode: "area",
		text: "Overflow remains editable",
		x: 10,
		y: 10,
		typography: {
			font: { id: "font:test", family: "Test" },
			size: 12,
			leading: 14,
			tracking: 0,
			kerning: "auto",
			alignment: "start",
			direction: "auto",
		},
		frame: {
			width: 50,
			height: 14,
			inset: { top: 0, right: 0, bottom: 0, left: 0 },
			verticalAlignment: "top",
		},
	},
	transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	appearance: { fill: { swatchId: "swatch:ink" } },
})

const documentWith = (...objects: readonly DesignObject[]): DesignDocument => ({
	format: "create-design.document",
	version: 6,
	title: "Preflight fixture",
	artboards: [
		{
			id: "artboard:first",
			name: "First",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			bleed: { top: 10, right: 10, bottom: 10, left: 10 },
		},
		{
			id: "artboard:second",
			name: "Second",
			x: 100,
			y: 0,
			width: 100,
			height: 100,
		},
	],
	swatches: [
		{
			id: "swatch:ink",
			name: "Ink",
			source: { space: "rgb", r: 0, g: 0, b: 0 },
		},
	],
	objects,
	layers: [
		{
			id: "layer:artwork",
			name: "Artwork",
			children: objects.map(({ id }) => ({ kind: "object", id })),
		},
	],
	groups: [],
	guides: [],
})

describe("export preflight", () => {
	it("blocks unloaded text and reports canonical area overset", () => {
		const document = documentWith(areaText())
		const unloaded = preflightPdfExport(document, { scope: { kind: "all" } })
		expect(unloaded).toMatchObject({
			decision: "blocked",
			summary: { errors: 1, warnings: 0 },
		})
		expect(unloaded.diagnostics[0]).toMatchObject({
			code: "pdf.text-service-missing",
			entityId: "object:text",
		})

		const textService = {
			layout: () => ({
				objectId: "object:text",
				diagnostics: [
					{
						code: "text.overset",
						message: "12 characters are overset and remain editable.",
						objectId: "object:text",
						severity: "warning",
					},
				],
			}),
		} as unknown as DesignTextService
		const overset = preflightPdfExport(
			document,
			{ scope: { kind: "all" } },
			{},
			textService,
		)
		expect(overset).toMatchObject({
			decision: "ready",
			summary: { errors: 0, warnings: 1 },
		})
		expect(overset.diagnostics[0]).toMatchObject({
			code: "pdf.text.overset",
			severity: "warning",
		})
	})

	it("reports only artwork not covered by the union of requested artboards", () => {
		const document = documentWith(
			rectangle("object:inside", 10, 20),
			rectangle("object:spanning", 90, 20),
			rectangle("object:outside", 190, 20),
		)
		expect(
			preflightPdfExport(document, { scope: { kind: "all" } }).diagnostics,
		).toEqual([])
		const result = preflightPdfExport(
			document,
			{ scope: { kind: "all" } },
			outsideArtworkLint,
		)
		expect(result).toMatchObject({
			target: "pdf",
			decision: "ready",
			summary: { errors: 0, warnings: 0, infos: 1 },
		})
		expect(result.diagnostics).toEqual([
			{
				action: {
					kind: "select-entity",
					entityKind: "object",
					entityId: "object:outside",
				},
				capability: "artboard.clip",
				artboardId: "artboard:second",
				code: "common.artwork-outside-requested-artboards",
				entityId: "object:outside",
				entityKind: "object",
				layerId: "layer:artwork",
				layerName: "Artwork",
				message:
					"outside extends outside the requested artboards and will be clipped.",
				severity: "info",
				target: "pdf",
			},
		])
		expect(exportPreflightAllowsOutput(result)).toBe(true)
		expect(Object.isFrozen(result)).toBe(true)
		expect(Object.isFrozen(result.diagnostics[0])).toBe(true)
		expect(Object.isFrozen(result.diagnostics[0]?.action)).toBe(true)
		expect(Object.isFrozen(result.regions[0]?.bounds)).toBe(true)
		expect(
			preflightPdfExport(
				document,
				{ scope: { kind: "all" } },
				outsideArtworkLint,
			),
		).toEqual(result)
	})

	it("removes only the fixed entity diagnostic on a narrow rerun", () => {
		const first = rectangle("object:first", 190, 20)
		const second = rectangle("object:second", 220, 20)
		const before = preflightPdfExport(
			documentWith(first, second),
			{ scope: { kind: "all" } },
			outsideArtworkLint,
		)
		const after = preflightPdfExport(
			documentWith(rectangle("object:first", 170, 20), second),
			{ scope: { kind: "all" } },
			outsideArtworkLint,
		)
		expect(before.diagnostics.map(({ entityId }) => entityId)).toEqual([
			"object:first",
			"object:second",
		])
		expect(after.diagnostics.map(({ entityId }) => entityId)).toEqual([
			"object:second",
		])
	})

	it("uses authored bleed when it is part of the requested PDF target", () => {
		const document = documentWith(rectangle("object:bleed", -5, 5))
		expect(
			preflightPdfExport(
				document,
				{ scope: { kind: "active", artboardId: "artboard:first" } },
				outsideArtworkLint,
			).diagnostics,
		).toHaveLength(1)
		expect(
			preflightPdfExport(
				document,
				{
					includeBleed: true,
					scope: { kind: "active", artboardId: "artboard:first" },
				},
				outsideArtworkLint,
			).diagnostics,
		).toEqual([])
	})

	it("turns invalid PDF scopes into structured blocking diagnostics", () => {
		const document = documentWith()
		const result = preflightPdfExport(document, {
			scope: { kind: "active", artboardId: "artboard:missing" },
		})
		expect(result).toMatchObject({
			decision: "blocked",
			summary: { errors: 1, warnings: 0, infos: 0 },
		})
		expect(result.diagnostics[0]).toMatchObject({
			artboardId: "artboard:missing",
			capability: "artboard.selection",
			code: "pdf.scope.unknown-artboard",
			severity: "error",
			target: "pdf",
		})
		expect(
			preflightPdfExport(document, {
				scope: {
					kind: "selected",
					artboardIds: ["artboard:first", "artboard:missing"],
				},
			}).diagnostics.map(({ code, artboardId }) => [code, artboardId]),
		).toEqual([["pdf.scope.unknown-artboard", "artboard:missing"]])
	})

	it("declares current open PDF paths supported and lets future adapters differ", () => {
		const document = documentWith(openPath())
		expect(PDF_EXPORT_CAPABILITIES).toContain("vector.open-path-fill")
		expect(PDF_EXPORT_CAPABILITIES).toContain("vector.open-path-stroke")
		expect(
			preflightPdfExport(document, { scope: { kind: "all" } }).diagnostics,
		).toEqual([])

		const futureAdapter: ExportPreflightAdapter<undefined> = {
			target: "future",
			capabilities: [
				"artboard.clip",
				"paint.fill.even-odd",
				"paint.rgb",
				"paint.stroke",
				"vector.path",
			],
			resolveTarget: (value) => ({
				regions: value.artboards.map((artboard) => ({
					artboard,
					bounds: {
						minX: artboard.x,
						minY: artboard.y,
						maxX: artboard.x + artboard.width,
						maxY: artboard.y + artboard.height,
					},
				})),
			}),
		}
		expect(
			runExportPreflight(document, undefined, futureAdapter).diagnostics.map(
				({ code, capability }) => [code, capability],
			),
		).toEqual([
			["future.unsupported-open-path-fill", "vector.open-path-fill"],
			["future.unsupported-open-path-stroke", "vector.open-path-stroke"],
		])
		expect(
			runExportPreflight(document, undefined, futureAdapter),
		).toMatchObject({
			decision: "blocked",
			summary: { errors: 2, warnings: 0 },
		})

		const limitedPaint = runExportPreflight(document, undefined, {
			...futureAdapter,
			target: "limited",
			capabilities: [
				"artboard.clip",
				"paint.fill.even-odd",
				"paint.stroke",
				"vector.open-path-fill",
				"vector.open-path-stroke",
				"vector.path",
			],
		})
		expect(
			limitedPaint.diagnostics.map(({ code, capability }) => [
				code,
				capability,
			]),
		).toEqual([["limited.unsupported-rgb-paint", "paint.rgb"]])

		const approximationOnly = runExportPreflight(document, undefined, {
			...futureAdapter,
			target: "approximate",
			approximatedCapabilities: ["paint.rgb"],
			capabilities: [
				...futureAdapter.capabilities.filter(
					(capability) => capability !== "paint.rgb",
				),
				"vector.open-path-fill",
				"vector.open-path-stroke",
			],
		})
		expect(approximationOnly).toMatchObject({
			decision: "ready",
			summary: { errors: 0, warnings: 1 },
		})
		expect(approximationOnly.diagnostics[0]).toMatchObject({
			code: "approximate.approximated-rgb-paint",
			severity: "warning",
		})
	})
})
