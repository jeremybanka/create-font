import { describe, expect, it } from "vitest"

import { ingestVariableFont, type IngestFailure } from "../src/index.ts"
import { makeGeometricOFont } from "./fixtures/geometric-o.ts"

function failureOf(value: unknown): IngestFailure {
	const result = ingestVariableFont(value)
	if (result.ok) {
		throw new Error("Expected ingestion to fail")
	}
	return result
}

function sparseCopy<Value>(values: readonly Value[]): Value[] {
	const sparse = [...values] as (Value | undefined)[]
	delete sparse[0]
	return sparse as Value[]
}

describe("ingestVariableFont", () => {
	it("accepts, canonicalizes, brands, and freezes the geometric O font", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont(source)

		expect(result.ok).toBe(true)
		if (!result.ok) return

		expect(result.value.axes[0]).toMatchObject({
			tag: "wght",
			min: 100,
			default: 100,
			max: 900,
			hidden: false,
			map: null,
		})
		expect(result.value.cmap).toEqual([{ codePoint: 0x4f, glyph: 1 }])
		expect(result.value.glyphs[1]?.contours.flat()).toHaveLength(16)
		expect(result.value.glyphs[1]?.variations[0]?.deltas.points).toHaveLength(
			16,
		)
		expect(result.warnings.map(({ code }) => code)).toEqual([
			"recommendation.units_per_em_power_of_two",
		])

		expect(Object.isFrozen(result.value)).toBe(true)
		expect(Object.isFrozen(result.value.glyphs[1]?.contours[0])).toBe(true)

		const mutableSourceGlyph = source.glyphs[1] as unknown as { name: string }
		mutableSourceGlyph.name = "changed-after-ingestion"
		expect(result.value.glyphs[1]?.name).toBe("O")
	})

	it("warns when a default-location instance cannot reuse default names", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont({
			...source,
			instances: [
				{
					...source.instances[0],
					name: "Unexpected Default",
					postScriptName: "UnexpectedDefault",
				},
				source.instances[1],
			],
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "recommendation.default_instance_names",
					path: "$.instances[0].name",
				}),
				expect.objectContaining({
					code: "recommendation.default_instance_names",
					path: "$.instances[0].postScriptName",
				}),
			]),
		)
	})

	it("accumulates deterministic path-based diagnostics", () => {
		const source = makeGeometricOFont()
		const invalid = {
			...source,
			unexpected: true,
			axes: [{ ...source.axes[0], tag: "bad!", default: 2_000 }],
			cmap: [
				{ codePoint: 0xd800, glyph: 99 },
				{ codePoint: 0xd800, glyph: 1 },
			],
		}

		const failure = failureOf(invalid)
		const codes = failure.errors.map(({ code }) => code)
		expect(codes).toEqual(
			expect.arrayContaining([
				"font.unknown_property",
				"axis.tag",
				"axis.default_range",
				"cmap.code_point",
				"cmap.glyph",
				"cmap.duplicate",
			]),
		)
		const paths = failure.errors.map(({ path }) => path)
		expect(paths).toEqual(
			[...paths].sort((left, right) => left.localeCompare(right)),
		)
	})

	it("accepts only inert own-property data and never invokes escaping errors", () => {
		const source = makeGeometricOFont()
		const inheritedMetadata = Object.create(source.metadata) as object
		expect(
			failureOf({
				...source,
				metadata: inheritedMetadata,
			}).errors,
		).toContainEqual(
			expect.objectContaining({
				code: "font.object",
				path: "$.metadata",
			}),
		)

		const names = { ...source.names }
		Object.defineProperty(names, "family", {
			enumerable: true,
			get(): never {
				throw new Error("getter must not escape ingestion")
			},
		})
		expect(() => ingestVariableFont({ ...source, names })).not.toThrow()
		expect(failureOf({ ...source, names }).errors).toContainEqual(
			expect.objectContaining({
				code: "font.object",
				path: "$.names",
			}),
		)

		const coordinates = {
			wght: 100,
			[Symbol("extra")]: 1,
		}
		expect(
			failureOf({
				...source,
				instances: [
					{ ...source.instances[0], coordinates },
					source.instances[1],
				],
			}).errors,
		).toContainEqual(
			expect.objectContaining({
				code: "instance.coordinate",
				path: "$.instances[0].coordinates",
			}),
		)
	})

	it("rejects sparse arrays at every collection layer", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return
		const scenarios = [
			{
				value: { ...source, axes: sparseCopy(source.axes) },
				path: "$.axes",
			},
			{
				value: { ...source, glyphs: sparseCopy(source.glyphs) },
				path: "$.glyphs",
			},
			{
				value: { ...source, cmap: sparseCopy(source.cmap) },
				path: "$.cmap",
			},
			{
				value: { ...source, instances: sparseCopy(source.instances) },
				path: "$.instances",
			},
			{
				value: {
					...source,
					axes: [
						{
							...source.axes[0],
							map: sparseCopy([
								{ from: -1, to: -1 },
								{ from: 0, to: 0 },
								{ from: 1, to: 1 },
							]),
						},
					],
				},
				path: "$.axes[0].map",
			},
			{
				value: {
					...source,
					glyphs: [
						source.glyphs[0],
						{ ...glyph, contours: sparseCopy(glyph.contours) },
					],
				},
				path: "$.glyphs[1].contours",
			},
			{
				value: {
					...source,
					glyphs: [
						source.glyphs[0],
						{
							...glyph,
							contours: [
								sparseCopy(glyph.contours[0] ?? []),
								glyph.contours[1] ?? [],
							],
						},
					],
				},
				path: "$.glyphs[1].contours[0]",
			},
			{
				value: {
					...source,
					glyphs: [
						source.glyphs[0],
						{
							...glyph,
							variations: sparseCopy(glyph.variations),
						},
					],
				},
				path: "$.glyphs[1].variations",
			},
			{
				value: {
					...source,
					glyphs: [
						source.glyphs[0],
						{
							...glyph,
							variations: [
								{
									...variation,
									deltas: {
										...variation.deltas,
										points: sparseCopy(variation.deltas.points),
									},
								},
							],
						},
					],
				},
				path: "$.glyphs[1].variations[0].deltas.points",
			},
		]

		for (const scenario of scenarios) {
			expect(failureOf(scenario.value).errors).toContainEqual(
				expect.objectContaining({
					code: "scalar.type",
					path: scenario.path,
				}),
			)
		}
	})

	it("rejects values that would need silent Fixed16.16 quantization", () => {
		const source = makeGeometricOFont()
		const failure = failureOf({
			...source,
			axes: [{ ...source.axes[0], min: 100.1 }],
		})

		expect(failure.errors).toContainEqual(
			expect.objectContaining({
				code: "axis.fixed",
				path: "$.axes[0].min",
			}),
		)
	})

	it("requires canonical avar anchors and monotone maps", () => {
		const source = makeGeometricOFont()
		const failure = failureOf({
			...source,
			axes: [
				{
					...source.axes[0],
					map: [
						{ from: -1, to: -1 },
						{ from: 0, to: 0.5 },
						{ from: 1, to: 0.25 },
					],
				},
			],
		})

		expect(failure.errors.map(({ code }) => code)).toEqual(
			expect.arrayContaining(["axis.avar.anchor", "axis.avar.to_order"]),
		)
	})

	it("requires .notdef at glyph ID zero and LSB=xMin", () => {
		const source = makeGeometricOFont()
		const failure = failureOf({
			...source,
			glyphs: [
				{ ...source.glyphs[0], name: "missing", leftSideBearing: 99 },
				source.glyphs[1],
			],
		})

		expect(failure.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "glyph.notdef" }),
				expect.objectContaining({
					code: "glyph.lsb",
					path: "$.glyphs[0].leftSideBearing",
				}),
			]),
		)
	})

	it("rejects incomplete full-point gvar deltas", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		expect(glyph).toBeDefined()
		expect(variation).toBeDefined()
		if (glyph === undefined || variation === undefined) return

		const failure = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [
						{
							...variation,
							deltas: {
								...variation.deltas,
								points: variation.deltas.points.slice(1),
							},
						},
					],
				},
			],
		})

		expect(failure.errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.glyf_delta",
				path: "$.glyphs[1].variations[0].deltas.points",
			}),
		)
	})

	it("enforces the TrueType grid, not merely signed-16 storage", () => {
		const source = makeGeometricOFont()
		const failure = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					kind: "simple",
					name: "O",
					advanceWidth: 1_000,
					leftSideBearing: -16_385,
					contours: [
						[
							{ x: -16_385, y: 0, onCurve: true },
							{ x: 16_384, y: 0, onCurve: true },
						],
					],
					variations: [],
				},
			],
		})

		expect(failure.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "glyph.coordinate",
					path: "$.glyphs[1].contours[0][0].x",
				}),
				expect.objectContaining({
					code: "glyph.coordinate",
					path: "$.glyphs[1].contours[0][1].x",
				}),
			]),
		)
	})

	it("accepts both inclusive TrueType grid boundaries", () => {
		const source = makeGeometricOFont()
		const result = ingestVariableFont({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					kind: "simple",
					name: "O",
					advanceWidth: 1_000,
					leftSideBearing: -16_384,
					contours: [
						[
							{ x: -16_384, y: 0, onCurve: true },
							{ x: 16_383, y: 0, onCurve: true },
						],
					],
					variations: [],
				},
			],
		})

		expect(result.ok).toBe(true)
	})

	it("returns diagnostics rather than throwing on over-limit point arrays", () => {
		const source = makeGeometricOFont()
		const points = Array.from({ length: 150_000 }, (_, index) => ({
			x: index % 2,
			y: 0,
			onCurve: true,
		}))
		const value = {
			...source,
			glyphs: [
				source.glyphs[0],
				{
					kind: "simple",
					name: "O",
					advanceWidth: 1_000,
					leftSideBearing: 0,
					contours: [points],
					variations: [],
				},
			],
		}

		expect(() => ingestVariableFont(value)).not.toThrow()
		expect(failureOf(value).errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.point_count",
				path: "$.glyphs[1].contours",
			}),
		)
	})

	it("keeps interpolated phantom-point advances in the metric range", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return
		const failure = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [
						{
							...variation,
							deltas: {
								...variation.deltas,
								phantom: {
									left: 32_767,
									right: -32_768,
									top: 0,
									bottom: 0,
								},
							},
						},
					],
				},
			],
		})

		expect(failure.errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.metric_variation",
				path: "$.glyphs[1].variations",
			}),
		)
	})

	it("does not combine mutually exclusive one-axis masters", () => {
		const source = makeGeometricOFont()
		const withOppositeMasters = source.glyphs.map((glyph) => {
			const points = glyph.contours.flat().map(() => ({ x: 0, y: 0 }))
			const variation = (peak: -1 | 1) => ({
				region: { peak: { wght: peak } },
				deltas: {
					points,
					phantom: { left: 0, right: 20_000, top: 0, bottom: 0 },
				},
			})
			return {
				...glyph,
				advanceWidth: 30_000,
				variations: [variation(-1), variation(1)],
			}
		})
		const result = ingestVariableFont({
			...source,
			style: { ...source.style, weightClass: 400 },
			axes: [
				{
					...source.axes[0],
					default: 400,
				},
			],
			glyphs: withOppositeMasters,
		})

		expect(result.ok).toBe(true)
	})

	it("keeps every varied outline inside the TrueType grid", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return
		const points = variation.deltas.points.map((delta, index) =>
			index === 0 ? { x: 16_000, y: delta.y } : delta,
		)
		const failure = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [
						{
							...variation,
							deltas: { ...variation.deltas, points },
						},
					],
				},
			],
		})

		expect(failure.errors).toContainEqual(
			expect.objectContaining({
				code: "glyph.coordinate",
				path: "$.glyphs[1].variations",
			}),
		)
	})

	it("rejects lone surrogates while accepting valid non-BMP names", () => {
		const source = makeGeometricOFont()
		const valid = ingestVariableFont({
			...source,
			names: { ...source.names, family: "Trigraph O 😀" },
		})
		expect(valid.ok).toBe(true)

		for (const [value, path] of [
			[
				{ ...source, names: { ...source.names, family: "\ud800" } },
				"$.names.family",
			],
			[
				{
					...source,
					axes: [{ ...source.axes[0], name: "\udc00" }],
				},
				"$.axes[0].name",
			],
			[
				{
					...source,
					instances: [
						{ ...source.instances[0], name: "\ud800" },
						source.instances[1],
					],
				},
				"$.instances[0].name",
			],
		] as const) {
			expect(failureOf(value).errors).toContainEqual(
				expect.objectContaining({ code: "name.unicode", path }),
			)
		}
	})

	it("rejects all-zero and invalid intermediate tuple regions", () => {
		const source = makeGeometricOFont()
		const glyph = source.glyphs[1]
		const variation = glyph?.variations[0]
		if (glyph === undefined || variation === undefined) return

		const zeroPeak = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [{ ...variation, region: { peak: { wght: 0 } } }],
				},
			],
		})
		expect(zeroPeak.errors).toContainEqual(
			expect.objectContaining({
				code: "region.zero_peak",
			}),
		)

		const crossing = failureOf({
			...source,
			glyphs: [
				source.glyphs[0],
				{
					...glyph,
					variations: [
						{
							...variation,
							region: {
								start: { wght: -1 },
								peak: { wght: 0.5 },
								end: { wght: 1 },
							},
						},
					],
				},
			],
		})
		expect(crossing.errors).toContainEqual(
			expect.objectContaining({
				code: "region.intermediate",
			}),
		)
	})

	it("rejects duplicate and surrogate cmap entries", () => {
		const source = makeGeometricOFont()
		const failure = failureOf({
			...source,
			cmap: [
				{ codePoint: 0xdfff, glyph: 1 },
				{ codePoint: 0xdfff, glyph: 1 },
			],
		})

		expect(failure.errors.map(({ code }) => code)).toEqual(
			expect.arrayContaining(["cmap.code_point", "cmap.duplicate"]),
		)
	})

	it("proves the selected Windows cmap encoding is representable", () => {
		const source = makeGeometricOFont()
		const compact = Array.from({ length: 9_000 }, (_, index) => ({
			codePoint: 0x100 + index,
			glyph: 1,
		}))
		expect(ingestVariableFont({ ...source, cmap: compact }).ok).toBe(true)

		const sparse = Array.from({ length: 9_000 }, (_, index) => ({
			codePoint: index * 6,
			glyph: 1,
		}))
		expect(failureOf({ ...source, cmap: sparse }).errors).toContainEqual(
			expect.objectContaining({
				code: "font.table_size",
				path: "$.cmap",
				table: "cmap",
			}),
		)
	})

	it("reserves U+FFFF in BMP format 4 but permits full-repertoire format 12", () => {
		const source = makeGeometricOFont()
		const bmpOnly = failureOf({
			...source,
			cmap: [
				{ codePoint: 0xffff, glyph: 1 },
				{ codePoint: 0x4f, glyph: 1 },
			],
		})
		expect(bmpOnly.errors).toContainEqual(
			expect.objectContaining({
				code: "cmap.code_point",
				path: "$.cmap[0].codePoint",
			}),
		)

		expect(
			ingestVariableFont({
				...source,
				cmap: [
					{ codePoint: 0xffff, glyph: 1 },
					{ codePoint: 0x10000, glyph: 1 },
				],
			}).ok,
		).toBe(true)
	})
})
