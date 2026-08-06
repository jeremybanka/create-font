import { describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import { createDesignBlend } from "@create-design/model"
import {
	createSvgProjectionGraph,
	exportSvg,
	importSvg,
	preflightSvgExport,
	serializeSvg,
} from "../src/index.ts"
import { parseSvgFixture } from "./svg-parser-fixture.ts"

describe("SVG export", () => {
	it("embeds placed pixels and applies the same explicit clipping group", () => {
		const initial = createInitialDocument()
		const clip = initial.objects[0]!
		const image = {
			id: "object:image",
			name: "Portrait",
			geometry: {
				kind: "image" as const,
				source: { kind: "embedded" as const, id: "asset:portrait" },
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 2,
				intrinsicHeight: 1,
			},
			transform: { a: 20, b: 0, c: 0, d: 20, e: 12, f: 18 },
			appearance: {},
		}
		const document = {
			...initial,
			objects: [image, clip],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "group" as const, id: "group:mask" }],
				},
			],
			groups: [
				{
					id: "group:mask",
					name: "Portrait mask",
					children: [
						{ kind: "object" as const, id: image.id },
						{ kind: "object" as const, id: clip.id },
					],
					clippingPathId: clip.id,
				},
			],
		}
		const imageResources = new Map([
			[
				"asset:portrait",
				{
					id: "asset:portrait",
					mediaType: "image/jpeg" as const,
					bytes: new Uint8Array([1, 2]),
				},
			],
		])
		const options = { imageResources }
		const svg = new TextDecoder().decode(
			exportSvg(document, undefined, options),
		)
		expect(preflightSvgExport(document, undefined, options).decision).toBe(
			"ready",
		)
		expect(svg).toContain('href="data:image/jpeg;base64,AQI="')
		expect(svg).toContain('clip-path="url(#group:mask:clip)"')
		expect(svg).toContain('<clipPath id="group:mask:clip">')
		expect(svg.match(new RegExp(`id="${clip.id}"`, "g"))).toBeNull()
	})

	it("keeps linked-image identity as an external SVG href", () => {
		const initial = createInitialDocument()
		const image = {
			id: "object:linked",
			name: "Linked",
			geometry: {
				kind: "image" as const,
				source: {
					kind: "linked" as const,
					id: "asset:linked",
					href: "../images/linked.jpg?revision=4&proof=true",
				},
				mediaType: "image/jpeg" as const,
				intrinsicWidth: 40,
				intrinsicHeight: 30,
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: {},
		}
		const document = {
			...initial,
			objects: [image],
			layers: [
				{
					...initial.layers[0]!,
					children: [{ kind: "object" as const, id: image.id }],
				},
			],
			groups: [],
		}
		const svg = new TextDecoder().decode(exportSvg(document))
		expect(svg).toContain(
			'href="../images/linked.jpg?revision=4&amp;proof=true"',
		)
		expect(preflightSvgExport(document).decision).toBe("ready")
	})
	it("matches effective layer visibility, locking, nesting, and paint order", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const back = { ...source, id: "object:layer-back", name: "Layer back" }
		const hidden = {
			...source,
			id: "object:layer-hidden",
			name: "Layer hidden",
		}
		const front = {
			...initial.objects[1]!,
			id: "object:layer-front",
			name: "Layer front",
		}
		const document = {
			...initial,
			objects: [front, hidden, back],
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "group" as const, id: "group:back" }],
				},
				{
					id: "layer:hidden",
					name: "Hidden",
					hidden: true,
					children: [{ kind: "object" as const, id: hidden.id }],
				},
				{
					id: "layer:front",
					name: "Front",
					locked: true,
					children: [{ kind: "object" as const, id: front.id }],
				},
			],
			groups: [
				{
					id: "group:back",
					name: "Back group",
					children: [{ kind: "object" as const, id: back.id }],
				},
			],
		}
		const svg = new TextDecoder().decode(exportSvg(document))
		const unlockedSvg = new TextDecoder().decode(
			exportSvg({
				...document,
				layers: document.layers.map((layer) => ({
					...layer,
					...(layer.id === "layer:front" ? { locked: false } : {}),
				})),
			}),
		)

		expect(svg).toBe(unlockedSvg)
		expect(svg).toContain('<g id="group:back" aria-label="Back group">')
		expect(svg).not.toContain(hidden.id)
		expect(svg.indexOf(back.id)).toBeLessThan(svg.indexOf(front.id))
		expect(
			preflightSvgExport(document).diagnostics.find(
				({ code }) => code === "svg.paint.cmyk-converted",
			),
		).toMatchObject({
			entityId: front.id,
			layerId: "layer:front",
			layerName: "Front",
		})
	})

	it("lowers live blends into the later endpoint's layer and group slot", () => {
		const initial = createInitialDocument()
		const source = initial.objects[0]!
		const start = { ...source, id: "object:blend-start", name: "Start" }
		const end = {
			...source,
			id: "object:blend-end",
			name: "End",
			transform: { ...source.transform, e: source.transform.e + 100 },
		}
		const blend = createDesignBlend("blend:svg", "SVG blend", start, end, 1)
		const document = {
			...initial,
			objects: [end, start],
			blends: [blend],
			layers: [
				{
					id: "layer:start",
					name: "Start layer",
					children: [{ kind: "object" as const, id: start.id }],
				},
				{
					id: "layer:end",
					name: "End layer",
					children: [{ kind: "group" as const, id: "group:end" }],
				},
			],
			groups: [
				{
					id: "group:end",
					name: "End group",
					children: [{ kind: "object" as const, id: end.id }],
				},
			],
		}
		const svg = new TextDecoder().decode(exportSvg(document))
		const derivedId = "object:blend:svg:step:1"

		expect(preflightSvgExport(document).decision).toBe("ready")
		expect(svg.indexOf(start.id)).toBeLessThan(svg.indexOf(derivedId))
		expect(svg.indexOf(derivedId)).toBeLessThan(svg.indexOf(end.id))
		expect(svg.indexOf("group:end")).toBeLessThan(svg.indexOf(derivedId))
	})

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
	it("imports into an explicit layer or group scope and derives paint order", () => {
		const initial = createInitialDocument()
		const scoped = {
			...initial,
			layers: [
				{
					id: "layer:back",
					name: "Back",
					children: [{ kind: "group" as const, id: "group:back" }],
				},
				{
					id: "layer:front",
					name: "Front",
					children: [{ kind: "object" as const, id: "object:cyan" }],
				},
			],
			groups: [
				{
					id: "group:back",
					name: "Back group",
					children: [{ kind: "object" as const, id: "object:coral" }],
				},
			],
		}
		let scopeId = 0
		const result = importSvg(
			`<svg viewBox="0 0 100 100"><rect id="scoped" x="10" y="10" width="20" height="20" fill="#123456"/></svg>`,
			scoped,
			{
				hierarchyScope: {
					layerId: "layer:back",
					groupId: "group:back",
				},
				nextId: () => `scoped-${scopeId++}`,
			},
		)
		expect(result.ok).toBe(true)
		const importedId = result.importedObjectIds[0]
		expect(result.document.groups[0]?.children.at(-1)).toEqual({
			kind: "object",
			id: importedId,
		})
		expect(result.document.layers[1]).toEqual(scoped.layers[1])
		expect(result.document.objects.map(({ id }) => id)).toEqual([
			"object:coral",
			importedId,
			"object:cyan",
		])
	})

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
