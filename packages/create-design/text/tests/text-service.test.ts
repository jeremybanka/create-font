import {
	ingestVariableFont,
	serializeVariableFont,
	type VariableFontSource,
} from "@create-font/target"
import { describe, expect, test } from "vitest"

import type { DesignObject, DesignTextGeometry } from "@create-design/source"
import { makeGeometricOFont } from "../../../create-font/target/tests/fixtures/geometric-o.ts"
import { createDesignTextService } from "../src/index.ts"

const font = { id: "font:test", family: "Text Fixture", revision: 1 }

function fixtureBytes(): Uint8Array {
	const source = makeGeometricOFont()
	const template = source.glyphs[1]
	if (template === undefined) throw new Error("Missing glyph template.")
	const glyph = (name: string, advanceWidth: number) => ({
		...template,
		name,
		advanceWidth,
	})
	const space = {
		...template,
		name: "space",
		advanceWidth: 300,
		leftSideBearing: 0,
		contours: [],
		variations: template.variations.map((variation) => ({
			...variation,
			deltas: { ...variation.deltas, points: [] },
		})),
	}
	const expanded: VariableFontSource = {
		...source,
		names: {
			...source.names,
			family: font.family,
			fullName: font.family,
			uniqueId: "CRFT:TextFixture:1",
			postScriptName: "TextFixture",
		},
		glyphs: [
			source.glyphs[0] as (typeof source.glyphs)[number],
			glyph("O", 1_000),
			glyph("A", 700),
			glyph("B", 680),
			space,
		],
		cmap: [
			{ codePoint: 0x4f, glyph: 1 },
			{ codePoint: 0x41, glyph: 2 },
			{ codePoint: 0x42, glyph: 3 },
			{ codePoint: 0x20, glyph: 4 },
			{ codePoint: 0x0627, glyph: 2 },
			{ codePoint: 0x0628, glyph: 3 },
		],
	}
	const ingested = ingestVariableFont(expanded)
	if (!ingested.ok) throw new Error(JSON.stringify(ingested.errors))
	return serializeVariableFont(ingested.value)
}

function textObject(geometry: Partial<DesignTextGeometry> = {}): DesignObject {
	return {
		id: "object:text",
		name: "Editable text",
		geometry: {
			kind: "text",
			mode: "point",
			text: "AB",
			x: 40,
			y: 80,
			typography: {
				font,
				size: 20,
				leading: 24,
				tracking: 0,
				kerning: "auto",
				alignment: "start",
				direction: "auto",
			},
			...geometry,
		} as DesignTextGeometry,
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		appearance: { fill: { swatchId: "swatch:black" } },
	}
}

describe("canonical create-design text", () => {
	test("lays out deterministic point text and caches unrelated projections", () => {
		const service = createDesignTextService()
		expect(service.registerFont(font, fixtureBytes())).toEqual([])
		const object = textObject()
		const first = service.layout(object)
		const second = service.layout(object)
		expect(second).toBe(first)
		expect(first?.glyphs.map(({ cluster }) => cluster)).toEqual([0, 1])
		expect(first?.glyphs.every(({ contours }) => contours.length > 0)).toBe(
			true,
		)
		expect(first?.overset).toBe(false)
		expect(service.cacheStats().layouts).toBe(1)
	})

	test("reflows area text and preserves hidden overflow characters", () => {
		const service = createDesignTextService()
		service.registerFont(font, fixtureBytes())
		const area = textObject({
			mode: "area",
			text: "AB AB AB AB",
			frame: {
				width: 38,
				height: 24,
				inset: { top: 0, right: 0, bottom: 0, left: 0 },
				verticalAlignment: "top",
			},
		})
		const small = service.layout(area)
		const large = service.layout({
			...area,
			geometry: {
				...area.geometry,
				frame: { ...area.geometry.frame!, height: 96 },
			} as DesignTextGeometry,
		})
		expect(small?.overset).toBe(true)
		expect(small?.visibleTextEnd).toBeLessThan(
			area.geometry.kind === "text" ? area.geometry.text.length : 0,
		)
		expect(large?.visibleTextEnd).toBe(
			area.geometry.kind === "text" ? area.geometry.text.length : 0,
		)
	})

	test("encloses point line boxes, advances, spacing, multiline ink, and keeps area interaction at its frame", () => {
		const service = createDesignTextService()
		service.registerFont(font, fixtureBytes())
		const point = service.layout(textObject({ text: "A A\nB" }))
		expect(point?.lines).toHaveLength(2)
		expect(point?.logicalBounds).toMatchObject({ x: 40, y: 62, height: 48 })
		expect(point?.logicalBounds.width).toBe(point?.lines[0]?.advance)
		expect(point?.inkBounds).not.toBeNull()
		expect(point?.bounds.x).toBeLessThanOrEqual(point!.inkBounds!.x)
		expect(point!.bounds.x + point!.bounds.width).toBeGreaterThanOrEqual(
			point!.inkBounds!.x + point!.inkBounds!.width,
		)
		expect(point?.bounds.y).toBeLessThanOrEqual(point!.inkBounds!.y)
		expect(point!.bounds.y + point!.bounds.height).toBeGreaterThanOrEqual(
			point!.inkBounds!.y + point!.inkBounds!.height,
		)

		const area = service.layout(
			textObject({
				mode: "area",
				text: "AB AB AB AB",
				frame: {
					width: 38,
					height: 24,
					inset: { top: 0, right: 0, bottom: 0, left: 0 },
					verticalAlignment: "top",
				},
			}),
		)
		expect(area?.overset).toBe(true)
		expect(area?.logicalBounds).toEqual({ x: 40, y: 80, width: 38, height: 24 })
		expect(area?.bounds).toEqual(area?.logicalBounds)
		expect(area?.inkBounds).not.toBeNull()
	})

	test("expands to fresh ordinary path identities and fails before mutation for missing fonts", () => {
		const service = createDesignTextService()
		const object = textObject()
		expect(service.expand(object)).toBeNull()
		service.registerFont(font, fixtureBytes())
		const expanded = service.expand(object, "object:expanded")
		expect(expanded?.objects).toHaveLength(2)
		expect(
			expanded?.objects.every(({ geometry }) => geometry.kind === "path"),
		).toBe(true)
		const ids =
			expanded?.objects.flatMap((item) =>
				item.geometry.kind === "path"
					? item.geometry.contours.flatMap((contour) => [
							contour.id,
							...contour.points.map(({ id }) => id),
						])
					: [],
			) ?? []
		expect(new Set(ids).size).toBe(ids.length)
	})

	test("uses shaped visual order for RTL text and reports missing glyphs", () => {
		const service = createDesignTextService()
		service.registerFont(font, fixtureBytes())
		const base = textObject()
		if (base.geometry.kind !== "text") throw new Error("Expected text.")
		const rtl = service.layout(
			textObject({
				text: "\u0627\u0628",
				typography: {
					...base.geometry.typography,
					direction: "rtl",
					script: "Arab",
				},
			}),
		)
		expect(rtl?.glyphs.map(({ cluster }) => cluster)).toEqual([1, 0])
		const missing = service.layout(textObject({ text: "Z" }))
		expect(
			missing?.diagnostics.some(({ code }) => code === "glyph.missing"),
		).toBe(true)
	})
})
