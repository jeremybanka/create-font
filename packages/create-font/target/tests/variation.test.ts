import { describe, expect, it } from "vitest"

import {
	deriveSimpleGlyphDeltas,
	ingestVariableFont,
	instantiateGlyph,
	normalizeLocation,
	regionScalar,
	type NormalizedLocation,
	type VariationRegion,
} from "../src/index.ts"
import {
	blackCounter,
	makeGeometricOFont,
	outerContour,
	razorCounter,
	razorToBlackDeltas,
} from "./fixtures/geometric-o.ts"

const normalized = (...values: number[]): NormalizedLocation =>
	values as unknown as NormalizedLocation

function makeCustomAxisFont(
	map?: readonly { readonly from: number; readonly to: number }[],
): unknown {
	const source = makeGeometricOFont()
	return {
		...source,
		axes: [
			{
				tag: "TEST",
				name: "Test",
				min: -1,
				default: 0,
				max: 1,
				...(map === undefined ? {} : { map }),
			},
		],
		instances: source.instances.map((instance, index) => ({
			...instance,
			coordinates: { TEST: index === 0 ? 0 : 1 },
		})),
		glyphs: source.glyphs.map((glyph) => ({
			...glyph,
			variations: glyph.variations.map((variation) => ({
				...variation,
				region: { peak: { TEST: 1 } },
			})),
		})),
	}
}

describe("variation semantics", () => {
	it("derives the exact compatible-master deltas", () => {
		const result = deriveSimpleGlyphDeltas(
			[outerContour, razorCounter],
			[outerContour, blackCounter],
		)

		expect(result).toEqual({ ok: true, value: razorToBlackDeltas })
		if (result.ok) expect(Object.isFrozen(result.value)).toBe(true)
	})

	it("normalizes the min/default, midpoint, and maximum exactly", () => {
		const result = ingestVariableFont(makeGeometricOFont())
		if (!result.ok) throw new Error("fixture must ingest")

		expect(normalizeLocation(result.value, {})).toEqual({
			ok: true,
			value: [0],
		})
		expect(normalizeLocation(result.value, { wght: 500 })).toEqual({
			ok: true,
			value: [0.5],
		})
		expect(normalizeLocation(result.value, { wght: 900 })).toEqual({
			ok: true,
			value: [1],
		})
		expect(normalizeLocation(result.value, { wght: 9_999 })).toEqual({
			ok: true,
			value: [1],
		})
	})

	it("evaluates razor, midpoint, and black outlines without changing topology", () => {
		const result = ingestVariableFont(makeGeometricOFont())
		if (!result.ok) throw new Error("fixture must ingest")
		const glyphId = result.value.cmap[0].glyph

		const razor = instantiateGlyph(result.value, glyphId, { wght: 100 })
		const middle = instantiateGlyph(result.value, glyphId, { wght: 500 })
		const black = instantiateGlyph(result.value, glyphId, { wght: 900 })

		expect(razor.contours).toEqual([outerContour, razorCounter])
		expect(black.contours).toEqual([outerContour, blackCounter])
		expect(middle.contours[1]).toEqual(
			razorCounter.map((point, index) => ({
				x: (point.x + (blackCounter[index]?.x ?? point.x)) / 2,
				y: (point.y + (blackCounter[index]?.y ?? point.y)) / 2,
				onCurve: point.onCurve,
			})),
		)
		for (const instance of [razor, middle, black]) {
			expect(
				instance.contours.map((contour) =>
					contour.map((point) => point.onCurve),
				),
			).toEqual([
				[true, false, true, false, true, false, true, false],
				[true, false, true, false, true, false, true, false],
			])
			expect(instance.advanceWidth).toBe(1_000)
			expect(instance.leftSideBearing).toBe(100)
			expect(instance.phantomDeltas).toEqual({
				left: 0,
				right: 0,
				top: 0,
				bottom: 0,
			})
		}
		expect(Object.isFrozen(black.contours[1])).toBe(true)
	})

	it("applies an exact piecewise avar remapping", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont({
			...source,
			axes: [
				{
					...source.axes[0],
					map: [
						{ from: -1, to: -1 },
						{ from: 0, to: 0 },
						{ from: 0.5, to: 0.75 },
						{ from: 1, to: 1 },
					],
				},
			],
		})
		if (!result.ok) throw new Error("mapped fixture must ingest")

		expect(normalizeLocation(result.value, { wght: 500 })).toEqual({
			ok: true,
			value: [0.75],
		})
	})

	it("uses the specified Fixed16.16-to-F2Dot14 tie rounding", () => {
		const result = ingestVariableFont(makeCustomAxisFont())
		if (!result.ok) throw new Error("custom-axis fixture must ingest")
		const rawValues = [1, 2, 3, 4, -1, -2, -3, -4]
		const expected = [
			0,
			1 / 16_384,
			1 / 16_384,
			1 / 16_384,
			0,
			0,
			-1 / 16_384,
			-1 / 16_384,
		]

		expect(
			rawValues.map((raw) => {
				const location = normalizeLocation(result.value, {
					TEST: raw / 65_536,
				})
				return location.ok ? location.value[0] : undefined
			}),
		).toEqual(expected)
	})

	it("interpolates inside positive and negative avar segments", () => {
		const result = ingestVariableFont(
			makeCustomAxisFont([
				{ from: -1, to: -1 },
				{ from: -0.5, to: -0.75 },
				{ from: 0, to: 0 },
				{ from: 0.5, to: 0.75 },
				{ from: 1, to: 1 },
			]),
		)
		if (!result.ok) throw new Error("mapped custom-axis fixture must ingest")

		expect(normalizeLocation(result.value, { TEST: 0.25 })).toEqual({
			ok: true,
			value: [0.375],
		})
		expect(normalizeLocation(result.value, { TEST: -0.25 })).toEqual({
			ok: true,
			value: [-0.375],
		})
	})

	it("uses the peak itself as the far bound of non-intermediate support", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return
		const result = ingestVariableFont({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [{ ...variation, region: { peak: { wght: 0.5 } } }],
				},
			],
		})
		if (!result.ok) throw new Error("half-peak fixture must ingest")
		const region = result.value.glyphs[1]?.variations[0]?.region
		if (region === undefined) return

		expect(regionScalar(region, normalized(0.25))).toBe(0.5)
		expect(regionScalar(region, normalized(0.5))).toBe(1)
		expect(regionScalar(region, normalized(0.75))).toBe(0)
	})

	it("evaluates negative, intermediate, neutral, and multi-axis supports", () => {
		const negative = {
			kind: "non-intermediate",
			peak: [-1],
		} as unknown as VariationRegion
		const intermediate = {
			kind: "intermediate",
			start: [0.25],
			peak: [0.5],
			end: [0.75],
		} as unknown as VariationRegion
		const neutralAxis = {
			kind: "non-intermediate",
			peak: [1, 0],
		} as unknown as VariationRegion
		const twoAxis = {
			kind: "non-intermediate",
			peak: [1, 1],
		} as unknown as VariationRegion

		expect(regionScalar(negative, normalized(-0.5))).toBe(0.5)
		expect(regionScalar(negative, normalized(0.5))).toBe(0)
		expect(regionScalar(intermediate, normalized(0.25))).toBe(0)
		expect(regionScalar(intermediate, normalized(0.375))).toBe(0.5)
		expect(regionScalar(intermediate, normalized(0.5))).toBe(1)
		expect(regionScalar(intermediate, normalized(0.625))).toBe(0.5)
		expect(regionScalar(intermediate, normalized(0.75))).toBe(0)
		expect(regionScalar(neutralAxis, normalized(0.5, -1))).toBe(0.5)
		expect(regionScalar(twoAxis, normalized(0.5, 0.25))).toBe(0.125)
	})

	it("accumulates outline and phantom deltas from two applicable tuples", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return
		const makeVariation = (pointX: number, left: number, right: number) => ({
			...variation,
			deltas: {
				points: variation.deltas.points.map(() => ({ x: pointX, y: 0 })),
				phantom: { left, right, top: 0, bottom: 0 },
			},
		})
		const result = ingestVariableFont({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [makeVariation(10, 5, 25), makeVariation(5, 2, 12)],
				},
			],
		})
		if (!result.ok) throw new Error("metric-variation fixture must ingest")

		const instance = instantiateGlyph(
			result.value,
			result.value.cmap[0].glyph,
			{ wght: 900 },
		)
		expect(Math.min(...instance.contours.flat().map((point) => point.x))).toBe(
			115,
		)
		expect(instance.phantomDeltas).toEqual({
			left: 7,
			right: 37,
			top: 0,
			bottom: 0,
		})
		expect(instance.advanceWidth).toBe(1_030)
		expect(instance.leftSideBearing).toBe(108)
	})

	it("reports incompatible master topology before subtraction", () => {
		const incompatible = blackCounter.map((point, index) =>
			index === 1 ? { ...point, onCurve: true } : point,
		)
		const result = deriveSimpleGlyphDeltas(
			[outerContour, razorCounter],
			[outerContour, incompatible],
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.glyf_delta",
				path: "$.masterContours[1][1].onCurve",
			}),
		)
	})

	it("rejects master coordinates outside the TrueType grid", () => {
		const invalid = [[{ x: -16_385, y: 0, onCurve: true }]]
		const result = deriveSimpleGlyphDeltas(invalid, invalid)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.coordinate",
				path: "$.defaultContours[0][0].x",
			}),
		)
	})

	it("rejects unknown or non-finite evaluation coordinates", () => {
		const result = ingestVariableFont(makeGeometricOFont())
		if (!result.ok) throw new Error("fixture must ingest")

		const location = normalizeLocation(result.value, {
			unknown: 1,
			wght: Number.NaN,
		})
		expect(location.ok).toBe(false)
		if (location.ok) return
		expect(location.errors.map(({ path }) => path)).toEqual([
			"$.coordinates.unknown",
			"$.coordinates.wght",
		])
	})
})
