import { describe, expect, it } from "vitest"

import {
	cubicBounds as kernelCubicBounds,
	evaluateCubic as kernelEvaluateCubic,
	splitCubic as kernelSplitCubic,
} from "@create-art/vector-geometry"

import {
	cubicCurveBounds,
	evaluateCubicCurve,
	interpolateCurvePoint,
	splitCubicCurve,
	straightSegmentHandles,
	type CubicCurve,
	type CurveBounds,
	type CurvePoint,
	type CubicSplit,
} from "../src/index.ts"

const legacyEvaluateCubicCurve = (
	cubic: CubicCurve,
	amount: number,
): CurvePoint => {
	const inverse = 1 - amount
	const inverseSquared = inverse * inverse
	const amountSquared = amount * amount
	return {
		x:
			inverseSquared * inverse * cubic.p0.x +
			3 * inverseSquared * amount * cubic.c1.x +
			3 * inverse * amountSquared * cubic.c2.x +
			amountSquared * amount * cubic.p3.x,
		y:
			inverseSquared * inverse * cubic.p0.y +
			3 * inverseSquared * amount * cubic.c1.y +
			3 * inverse * amountSquared * cubic.c2.y +
			amountSquared * amount * cubic.p3.y,
	}
}

const legacySplitCubicCurve = (
	cubic: CubicCurve,
	amount: number,
): CubicSplit => {
	const p01 = interpolateCurvePoint(cubic.p0, cubic.c1, amount)
	const p12 = interpolateCurvePoint(cubic.c1, cubic.c2, amount)
	const p23 = interpolateCurvePoint(cubic.c2, cubic.p3, amount)
	const p012 = interpolateCurvePoint(p01, p12, amount)
	const p123 = interpolateCurvePoint(p12, p23, amount)
	const point = interpolateCurvePoint(p012, p123, amount)
	return {
		point,
		left: { p0: cubic.p0, c1: p01, c2: p012, p3: point },
		right: { p0: point, c1: p123, c2: p23, p3: cubic.p3 },
	}
}

const legacyDerivativeRoots = (
	p0: number,
	c1: number,
	c2: number,
	p3: number,
): readonly number[] => {
	const a = -p0 + 3 * c1 - 3 * c2 + p3
	const b = 2 * (p0 - 2 * c1 + c2)
	const c = c1 - p0
	const epsilon = Number.EPSILON * 64
	if (Math.abs(a) <= epsilon) {
		if (Math.abs(b) <= epsilon) return []
		const root = -c / b
		return root > 0 && root < 1 ? [root] : []
	}
	const discriminant = b * b - 4 * a * c
	if (discriminant < 0) return []
	const squareRoot = Math.sqrt(Math.max(0, discriminant))
	const first = (-b + squareRoot) / (2 * a)
	const second = (-b - squareRoot) / (2 * a)
	return [first, second].filter(
		(root, index, roots) =>
			root > 0 &&
			root < 1 &&
			(index === 0 || Math.abs(root - (roots[0] ?? root)) > epsilon),
	)
}

const legacyCubicCurveBounds = (cubic: CubicCurve): CurveBounds => {
	const amounts = new Set<number>([
		0,
		1,
		...legacyDerivativeRoots(cubic.p0.x, cubic.c1.x, cubic.c2.x, cubic.p3.x),
		...legacyDerivativeRoots(cubic.p0.y, cubic.c1.y, cubic.c2.y, cubic.p3.y),
	])
	const points = [...amounts].map((amount) =>
		legacyEvaluateCubicCurve(cubic, amount),
	)
	return {
		minX: Math.min(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxX: Math.max(...points.map((point) => point.x)),
		maxY: Math.max(...points.map((point) => point.y)),
	}
}

const expectSamePoint = (actual: CurvePoint, expected: CurvePoint): void => {
	expect(Object.is(actual.x, expected.x)).toBe(true)
	expect(Object.is(actual.y, expected.y)).toBe(true)
}

const equivalenceFixtures = {
	straight: {
		p0: { x: -30, y: 40 },
		c1: { x: 10, y: 20 },
		c2: { x: 50, y: 0 },
		p3: { x: 90, y: -20 },
	},
	"interior-extrema": {
		p0: { x: 0, y: 0 },
		c1: { x: -120, y: 120 },
		c2: { x: 220, y: 120 },
		p3: { x: 100, y: 0 },
	},
	"degenerate-handles": {
		p0: { x: -20, y: 40 },
		c1: { x: -20, y: 40 },
		c2: { x: 60, y: -10 },
		p3: { x: 60, y: -10 },
	},
	"negative-zero": {
		p0: { x: -0, y: 0 },
		c1: { x: -0, y: -0 },
		c2: { x: 0, y: -0 },
		p3: { x: 0, y: 0 },
	},
	"large-coordinates": {
		p0: { x: 1e12, y: -1e12 },
		c1: { x: 1e12 - 1_200, y: -1e12 + 2_400 },
		c2: { x: 1e12 + 2_200, y: -1e12 + 2_400 },
		p3: { x: 1e12 + 1_000, y: -1e12 },
	},
} satisfies Readonly<Record<string, CubicCurve>>

describe("cubic curve geometry", () => {
	it.each(Object.entries(equivalenceFixtures))(
		"preserves legacy and kernel evaluation for %s",
		(_name, cubic) => {
			for (const amount of [-0.25, 0, 0.125, 0.3, 0.5, 0.9, 1, 1.25]) {
				const actual = evaluateCubicCurve(cubic, amount)
				expectSamePoint(actual, legacyEvaluateCubicCurve(cubic, amount))
				expectSamePoint(actual, kernelEvaluateCubic(cubic, amount))
			}
		},
	)

	it.each(Object.entries(equivalenceFixtures))(
		"preserves legacy and kernel subdivision for %s",
		(_name, cubic) => {
			for (const amount of [0, 0.3, 0.5, 1]) {
				const actual = splitCubicCurve(cubic, amount)
				expect(actual).toEqual(legacySplitCubicCurve(cubic, amount))
				expect(actual).toEqual(kernelSplitCubic(cubic, amount))
			}
		},
	)

	it.each(Object.entries(equivalenceFixtures))(
		"preserves legacy and kernel bounds for %s",
		(_name, cubic) => {
			const actual = cubicCurveBounds(cubic)
			expect(actual).toEqual(legacyCubicCurveBounds(cubic))
			expect(actual).toEqual(kernelCubicBounds(cubic))
		},
	)

	it("finds interior extrema instead of using the control hull", () => {
		const bounds = cubicCurveBounds({
			p0: { x: 0, y: 0 },
			c1: { x: -120, y: 120 },
			c2: { x: 220, y: 120 },
			p3: { x: 100, y: 0 },
		})
		expect(bounds.minX).toBeCloseTo(-26.072, 3)
		expect(bounds.maxX).toBeCloseTo(126.072, 3)
		expect(bounds.minY).toBe(0)
		expect(bounds.maxY).toBe(90)
	})

	it("bounds degenerate linear cubics by their endpoints", () => {
		expect(
			cubicCurveBounds({
				p0: { x: -20, y: 40 },
				c1: { x: -20, y: 40 },
				c2: { x: 60, y: -10 },
				p3: { x: 60, y: -10 },
			}),
		).toEqual({ minX: -20, minY: -10, maxX: 60, maxY: 40 })
	})

	it("splits a cubic without changing its locus", () => {
		const cubic = {
			p0: { x: 0, y: 0 },
			c1: { x: 20, y: 100 },
			c2: { x: 80, y: 100 },
			p3: { x: 100, y: 0 },
		}
		const amount = 0.3
		const split = splitCubicCurve(cubic, amount)
		const expectedSplit = evaluateCubicCurve(cubic, amount)
		expect(split.point.x).toBeCloseTo(expectedSplit.x, 12)
		expect(split.point.y).toBeCloseTo(expectedSplit.y, 12)
		for (const local of [0, 0.2, 0.5, 0.8, 1]) {
			expect(evaluateCubicCurve(split.left, local).x).toBeCloseTo(
				evaluateCubicCurve(cubic, local * amount).x,
				10,
			)
			expect(evaluateCubicCurve(split.left, local).y).toBeCloseTo(
				evaluateCubicCurve(cubic, local * amount).y,
				10,
			)
			expect(evaluateCubicCurve(split.right, local).x).toBeCloseTo(
				evaluateCubicCurve(cubic, amount + local * (1 - amount)).x,
				10,
			)
			expect(evaluateCubicCurve(split.right, local).y).toBeCloseTo(
				evaluateCubicCurve(cubic, amount + local * (1 - amount)).y,
				10,
			)
		}
	})

	it("rejects non-normalized split parameters", () => {
		const cubic = {
			p0: { x: 0, y: 0 },
			c1: { x: 0, y: 0 },
			c2: { x: 1, y: 1 },
			p3: { x: 1, y: 1 },
		}
		expect(() => splitCubicCurve(cubic, -0.1)).toThrowError(RangeError)
		expect(() => splitCubicCurve(cubic, -0.1)).toThrow(/\[0, 1\]/)
		expect(() => splitCubicCurve(cubic, 1.1)).toThrowError(RangeError)
		expect(() => splitCubicCurve(cubic, 1.1)).toThrow(/\[0, 1\]/)
	})

	it("preserves permissive malformed-curve behavior", () => {
		const malformed = {
			p0: { x: 0, y: 0 },
			c1: { x: Number.NaN, y: 10 },
			c2: { x: 20, y: Number.POSITIVE_INFINITY },
			p3: { x: 30, y: 0 },
		}
		expect(() => evaluateCubicCurve(malformed, 0.5)).not.toThrow()
		expect(evaluateCubicCurve(malformed, 0.5)).toEqual(
			legacyEvaluateCubicCurve(malformed, 0.5),
		)
		expect(() => cubicCurveBounds(malformed)).not.toThrow()
		expect(cubicCurveBounds(malformed)).toEqual(
			legacyCubicCurveBounds(malformed),
		)
		expect(() => splitCubicCurve(malformed, 0.5)).not.toThrow()
		expect(splitCubicCurve(malformed, 0.5)).toEqual(
			legacySplitCubicCurve(malformed, 0.5),
		)
		expect(() =>
			evaluateCubicCurve(equivalenceFixtures.straight, Number.NaN),
		).not.toThrow()
	})

	it.each([
		[
			{ x: 0, y: 0 },
			{ x: 90, y: 0 },
		],
		[
			{ x: 20, y: -30 },
			{ x: 20, y: 60 },
		],
		[
			{ x: -40, y: 80 },
			{ x: 50, y: -10 },
		],
	] as const)(
		"creates one-third handles that preserve a straight segment",
		(start, end) => {
			const handles = straightSegmentHandles(start, end)
			if (handles === null) throw new Error("Fixture segment is degenerate.")
			expect(handles.startOutgoing).toEqual({
				x: (end.x - start.x) / 3,
				y: (end.y - start.y) / 3,
			})
			expect(handles.endIncoming).toEqual({
				x: (start.x - end.x) / 3,
				y: (start.y - end.y) / 3,
			})
			const cubic = {
				p0: start,
				c1: {
					x: start.x + handles.startOutgoing.x,
					y: start.y + handles.startOutgoing.y,
				},
				c2: {
					x: end.x + handles.endIncoming.x,
					y: end.y + handles.endIncoming.y,
				},
				p3: end,
			}
			for (const amount of [0, 0.2, 0.5, 0.8, 1]) {
				const actual = evaluateCubicCurve(cubic, amount)
				const expected = interpolateCurvePoint(start, end, amount)
				expect(actual.x).toBeCloseTo(expected.x, 12)
				expect(actual.y).toBeCloseTo(expected.y, 12)
			}
		},
	)

	it("rejects invalid segments without producing signed zero", () => {
		expect(straightSegmentHandles({ x: 4, y: -2 }, { x: 4, y: -2 })).toBeNull()
		expect(
			straightSegmentHandles({ x: Number.NaN, y: 0 }, { x: 10, y: 0 }),
		).toBeNull()
		expect(
			straightSegmentHandles(
				{ x: 0, y: 0 },
				{ x: Number.POSITIVE_INFINITY, y: 0 },
			),
		).toBeNull()
		expect(straightSegmentHandles({ x: 0, y: 0 }, { x: 0, y: 30 })).toEqual({
			startOutgoing: { x: 0, y: 10 },
			endIncoming: { x: 0, y: -10 },
		})
	})
})
