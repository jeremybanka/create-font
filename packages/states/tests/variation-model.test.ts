import { describe, expect, it } from "vitest"

import type { VariationRegionSource } from "@trigraph/target"

import {
	buildMasterScalarMatrix,
	invertScalarMatrix,
	normalizeAxisCoordinate,
	normalizeEditorLocation,
	quantizeF2Dot14,
	quantizeFixed16Dot16,
	regionScalar,
	solveMasterDeltaVector,
	solveMasterDeltaVectors,
} from "../src/variation-model.ts"
import type { EditorAxisSource, ProjectionResult } from "../src/types.ts"

const fixedUnit = 1 / 65_536
const f2Dot14Unit = 1 / 16_384

function axis(overrides: Partial<EditorAxisSource> = {}): EditorAxisSource {
	return {
		id: "axis:wght",
		tag: "wght",
		name: "Weight",
		min: 100,
		default: 100,
		max: 900,
		...overrides,
	}
}

function failureCodes(result: ProjectionResult<unknown>): readonly string[] {
	if (result.ok) throw new Error("Expected projection to fail.")
	return result.errors.map(({ code }) => code)
}

describe("variation-model quantization and normalization", () => {
	it("rounds exact Fixed16.16 and F2Dot14 halves toward positive infinity", () => {
		expect(quantizeFixed16Dot16(fixedUnit / 2)).toBe(fixedUnit)
		expect(quantizeFixed16Dot16(-fixedUnit / 2)).toBe(0)
		expect(quantizeFixed16Dot16(1 + fixedUnit / 2)).toBe(1 + fixedUnit)

		expect(quantizeF2Dot14(f2Dot14Unit / 2)).toBe(f2Dot14Unit)
		expect(quantizeF2Dot14(-f2Dot14Unit / 2)).toBe(0)
		expect(quantizeF2Dot14(2)).toBe(1)
		expect(quantizeF2Dot14(-2)).toBe(-1)
	})

	it("accepts defaults at either axis endpoint without dividing by zero", () => {
		const minimumDefault = axis({ min: 100, default: 100, max: 900 })
		const maximumDefault = axis({ min: 100, default: 900, max: 900 })

		expect(normalizeAxisCoordinate(minimumDefault, 100)).toEqual({
			ok: true,
			value: 0,
			warnings: [],
		})
		expect(normalizeAxisCoordinate(minimumDefault, 900)).toEqual({
			ok: true,
			value: 1,
			warnings: [],
		})
		expect(normalizeAxisCoordinate(maximumDefault, 100)).toEqual({
			ok: true,
			value: -1,
			warnings: [],
		})
		expect(normalizeAxisCoordinate(maximumDefault, 900)).toEqual({
			ok: true,
			value: 0,
			warnings: [],
		})
	})

	it("normalizes by stable axis ID, applies avar, and emits tag-keyed output", () => {
		const weight = axis({
			min: -1,
			default: 0,
			max: 1,
			map: [
				{ from: -1, to: -1 },
				{ from: 0, to: 0 },
				{ from: 0.5, to: 0.75 },
				{ from: 1, to: 1 },
			],
		})
		const width = axis({
			id: "axis:wdth",
			tag: "wdth",
			name: "Width",
			min: 50,
			default: 100,
			max: 200,
		})

		expect(
			normalizeEditorLocation([weight, width], {
				"axis:wght": 0.25,
				"axis:wdth": 150,
			}),
		).toEqual({
			ok: true,
			value: { wght: 0.375, wdth: 0.5 },
			warnings: [],
		})
	})

	it("reports collapsed axes, out-of-range coordinates, and incomplete locations", () => {
		const collapsed = normalizeAxisCoordinate(
			axis({ min: 0, default: 0, max: fixedUnit * 0.4 }),
			0,
		)
		expect(failureCodes(collapsed)).toContain("variation.axis.invalid")

		const outOfRange = normalizeAxisCoordinate(axis(), 901)
		expect(failureCodes(outOfRange)).toEqual(["variation.location.range"])

		const incomplete = normalizeEditorLocation(
			[axis()],
			{ "axis:unknown": 400 },
			"$.master.location",
		)
		expect(failureCodes(incomplete)).toEqual([
			"variation.location.missing",
			"variation.location.unknown_axis",
		])
		if (!incomplete.ok) {
			expect(incomplete.errors.map(({ path }) => path)).toEqual([
				"$.master.location.axis:wght",
				"$.master.location.axis:unknown",
			])
		}
	})

	it("rejects avar maps whose quantized output reverses direction", () => {
		const result = normalizeAxisCoordinate(
			axis({
				min: -1,
				default: 0,
				max: 1,
				map: [
					{ from: -1, to: -1 },
					{ from: 0, to: 0 },
					{ from: 0.5, to: -0.25 },
					{ from: 1, to: 1 },
				],
			}),
			0.5,
		)

		expect(failureCodes(result)).toContain("variation.axis.invalid")
		if (!result.ok) {
			expect(result.errors).toContainEqual(
				expect.objectContaining({ path: "$.axis.map[2].to" }),
			)
		}
	})
})

describe("variation-model region supports", () => {
	it("evaluates non-intermediate, intermediate, negative, and multi-axis regions", () => {
		const positive = { peak: { wght: 1 } } satisfies VariationRegionSource
		const negative = { peak: { wght: -1 } } satisfies VariationRegionSource
		const intermediate = {
			start: { wght: 0.25 },
			peak: { wght: 0.5 },
			end: { wght: 0.75 },
		} satisfies VariationRegionSource
		const twoAxis = {
			peak: { wght: 1, wdth: 1 },
		} satisfies VariationRegionSource

		expect(regionScalar(positive, { wght: 0.5 })).toBe(0.5)
		expect(regionScalar(positive, { wght: -0.5 })).toBe(0)
		expect(regionScalar(negative, { wght: -0.5 })).toBe(0.5)
		expect(regionScalar(negative, { wght: 0.5 })).toBe(0)
		expect(regionScalar(intermediate, { wght: 0.25 })).toBe(0)
		expect(regionScalar(intermediate, { wght: 0.375 })).toBe(0.5)
		expect(regionScalar(intermediate, { wght: 0.5 })).toBe(1)
		expect(regionScalar(intermediate, { wght: 0.625 })).toBe(0.5)
		expect(regionScalar(intermediate, { wght: 0.75 })).toBe(0)
		expect(regionScalar(twoAxis, { wght: 0.5, wdth: 0.25 })).toBe(0.125)
	})

	it("treats neutral and malformed cross-origin supports as non-contributing axes", () => {
		const region = {
			start: { wght: -0.5, wdth: 0 },
			peak: { wght: 0.5, wdth: 1, opsz: 0 },
			end: { wght: 0.75, wdth: 1, opsz: 0 },
		} satisfies VariationRegionSource

		expect(regionScalar(region, { wght: -1, wdth: 0.5, opsz: -1 })).toBe(0.5)
	})
})

describe("variation-model master decomposition", () => {
	it("solves an overlapping two-master basis instead of subtracting each master independently", () => {
		const result = buildMasterScalarMatrix(
			[{ wght: 0.5 }, { wght: 1 }],
			[{ peak: { wght: 0.5 } }, { peak: { wght: 1 } }],
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return

		expect(result.value.matrix).toEqual([
			[1, 0.5],
			[0, 1],
		])
		expect(result.value.inverse).toEqual([
			[1, -0.5],
			[0, 1],
		])
		expect(solveMasterDeltaVector(result.value, [80, 80])).toEqual({
			ok: true,
			value: [40, 80],
			warnings: [],
		})
		expect(
			solveMasterDeltaVectors(result.value, [
				[80, 80],
				[10, 30],
			]),
		).toEqual({
			ok: true,
			value: [
				[40, 80],
				[-5, 30],
			],
			warnings: [],
		})
	})

	it("diagnoses singular and malformed scalar matrices", () => {
		const singular = buildMasterScalarMatrix(
			[{ wght: 1 }, { wght: 1 }],
			[{ peak: { wght: 1 } }, { peak: { wght: 1 } }],
		)
		expect(failureCodes(singular)).toEqual(["variation.matrix.singular"])

		const malformed = invertScalarMatrix([[1, Number.NaN], [0]])
		expect(failureCodes(malformed)).toEqual([
			"variation.matrix.shape",
			"variation.matrix.shape",
		])
	})

	it("diagnoses basis counts, nonintegral solutions, and int16 overflow", () => {
		const countMismatch = buildMasterScalarMatrix([{ wght: 1 }], [])
		expect(failureCodes(countMismatch)).toEqual(["variation.matrix.shape"])

		const identity = {
			size: 1,
			matrix: [[1]],
			inverse: [[1]],
		} as const
		expect(failureCodes(solveMasterDeltaVector(identity, []))).toEqual([
			"variation.delta.count",
		])
		expect(failureCodes(solveMasterDeltaVector(identity, [0.5]))).toEqual([
			"variation.delta.nonintegral",
		])
		expect(failureCodes(solveMasterDeltaVector(identity, [32_768]))).toEqual([
			"variation.delta.range",
		])
	})
})
