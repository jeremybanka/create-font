import { describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import {
	createSvgProjectionGraph,
	exportSvg,
	importSvg,
	preflightSvgExport,
	serializeSvg,
} from "../src/index.ts"
import { parseSvgFixture } from "./svg-parser-fixture.ts"

describe("SVG export", () => {
	it("serializes deterministic, independently parseable artboard SVG", () => {
		const document = createInitialDocument()
		const graph = createSvgProjectionGraph()
		const first = serializeSvg(graph.project(document))
		const second = new TextDecoder().decode(exportSvg(document))
		expect(second).toBe(first)
		expect(exportSvg(document)).toEqual(exportSvg(document))
		const parsed = parseSvgFixture(first)
		expect(parsed.rootAttributes).toEqual({
			xmlns: "http://www.w3.org/2000/svg",
			width: "612",
			height: "792",
			viewBox: "0 0 612 792",
		})
		expect(parsed.elementNames).toEqual([
			"svg",
			"title",
			"defs",
			"clipPath",
			"rect",
			"g",
			"rect",
			"title",
			"ellipse",
			"title",
		])
	})

	it("preserves authored transforms, groups, path rules, and stroke styles", () => {
		const initial = createInitialDocument()
		const object = {
			...initial.objects[0]!,
			id: "object:path",
			name: 'Curve & "line"',
			geometry: {
				kind: "path" as const,
				fillRule: "nonzero" as const,
				contours: [
					{
						id: "contour:path",
						closed: true,
						points: [
							{ id: "point:0", x: 1, y: 2, outgoing: { x: 3, y: 4 } },
							{ id: "point:1", x: 8, y: 9, incoming: { x: -2, y: -1 } },
						],
					},
				],
			},
			transform: { a: 1, b: 0.25, c: 0, d: 1, e: 10, f: 20 },
			appearance: {
				fill: { swatchId: "swatch:coral" },
				stroke: {
					swatchId: "swatch:ink",
					width: 3,
					cap: "round" as const,
					join: "bevel" as const,
					miterLimit: 5,
					dashArray: [2, 4],
					dashOffset: 1,
				},
			},
		}
		const document = {
			...initial,
			objects: [object],
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [{ kind: "group" as const, id: "group:one" }],
			})),
			groups: [
				{
					id: "group:one",
					name: "One",
					children: [{ kind: "object" as const, id: object.id }],
				},
			],
		}
		const svg = new TextDecoder().decode(exportSvg(document))
		expect(svg).toContain('<g id="group:one" aria-label="One">')
		expect(svg).toContain('fill-rule="nonzero"')
		expect(svg).toContain('stroke-dasharray="2 4"')
		expect(svg).toContain('transform="matrix(1 0.25 0 1 10 20)"')
		expect(svg).toContain("Curve &amp; &quot;line&quot;")
	})

	it("reports deterministic CMYK conversion and missing paints", () => {
		const initial = createInitialDocument()
		expect(preflightSvgExport(initial)).toMatchObject({
			decision: "ready",
			summary: { errors: 0, warnings: 1 },
		})
		const invalid = {
			...initial,
			objects: [
				{
					...initial.objects[0]!,
					appearance: { fill: { swatchId: "swatch:missing" } },
				},
			],
		}
		expect(preflightSvgExport(invalid)).toMatchObject({
			decision: "blocked",
			diagnostics: [{ code: "svg.paint.missing-swatch", severity: "error" }],
		})
	})
})

describe("SVG import", () => {
	it("round trips supported geometry with fresh IDs in one returned document", () => {
		const initial = createInitialDocument()
		let id = 0
		const imported = importSvg(
			new TextDecoder().decode(exportSvg(initial)),
			{
				...initial,
				objects: [],
				layers: initial.layers.map((layer) => ({ ...layer, children: [] })),
				groups: [],
				swatches: [],
			},
			{ nextId: () => `roundtrip-${id++}` },
		)
		expect(imported.ok).toBe(true)
		expect(imported.document.objects).toHaveLength(2)
		expect(imported.importedObjectIds).toEqual([
			"object:roundtrip-0",
			"object:roundtrip-2",
		])
		expect(
			imported.document.objects.map(({ geometry }) => geometry.kind),
		).toEqual(["rectangle", "ellipse"])
		expect(imported.document.objects[0]).toMatchObject({
			geometry: { x: 82, y: 102, width: 280, height: 240 },
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		})
		expect(
			new Set(imported.document.objects.map(({ id: objectId }) => objectId))
				.size,
		).toBe(2)
	})

	it("imports nested transforms, cubic and quadratic paths, and hierarchy", () => {
		const initial = createInitialDocument()
		const result = importSvg(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 200">
				<g aria-label="Layer" transform="translate(5 6)">
					<path id="curve" d="M 10 20 C 20 20 30 40 40 40 Q 50 50 60 40 Z" fill="#123456" stroke="rgb(1, 2, 3)"/>
				</g>
			</svg>`,
			initial,
			{
				nextId: (() => {
					let id = 0
					return () => String(id++)
				})(),
			},
		)
		expect(result.ok).toBe(true)
		expect(result.document.objects.at(-1)).toMatchObject({
			name: "curve",
			geometry: { kind: "path", contours: [{ closed: true }] },
			transform: { e: -30.6, f: -55.440000000000005 },
		})
		expect(result.document.groups?.at(-1)).toMatchObject({
			name: "Layer",
			children: [{ kind: "object" }],
		})
	})

	it("surfaces unsupported content without rasterizing it", () => {
		const initial = createInitialDocument()
		const result = importSvg(
			`<svg viewBox="0 0 100 100"><defs><linearGradient id="g"/></defs><text>hello</text><image href="https://example.com/a.png"/><rect width="10" height="10" fill="url(#g)" filter="url(#blur)"/></svg>`,
			initial,
		)
		expect(result.ok).toBe(true)
		expect(result.document.objects).toHaveLength(initial.objects.length + 1)
		expect(result.diagnostics.map(({ code }) => code)).toEqual([
			"svg.import.unsupported-lineargradient",
			"svg.import.unsupported-text",
			"svg.import.unsupported-image",
			"svg.import.unsupported-filter",
			"svg.import.unsupported-fill",
		])
	})
})
