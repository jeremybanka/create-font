import {
	assertFinitePoint,
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Bounds, Cubic, ParameterizedPoint, Point } from "./types.ts"
import { distance, interpolate, subtract } from "./vector.ts"

export interface CubicSplit {
	readonly point: Point
	readonly left: Cubic
	readonly right: Cubic
}

export function evaluateCubic(cubic: Cubic, parameter: number): Point {
	validateCubic(cubic)
	if (!Number.isFinite(parameter)) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Cubic parameter must be finite.",
			{ parameter },
		)
	}
	const inverse = 1 - parameter
	const inverseSquared = inverse * inverse
	const parameterSquared = parameter * parameter
	return {
		x:
			inverseSquared * inverse * cubic.p0.x +
			3 * inverseSquared * parameter * cubic.c1.x +
			3 * inverse * parameterSquared * cubic.c2.x +
			parameterSquared * parameter * cubic.p3.x,
		y:
			inverseSquared * inverse * cubic.p0.y +
			3 * inverseSquared * parameter * cubic.c1.y +
			3 * inverse * parameterSquared * cubic.c2.y +
			parameterSquared * parameter * cubic.p3.y,
	}
}

export function splitCubic(cubic: Cubic, parameter: number): CubicSplit {
	validateCubic(cubic)
	if (!Number.isFinite(parameter) || parameter < 0 || parameter > 1) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Cubic split parameter must be in [0, 1].",
			{ parameter },
		)
	}
	const p01 = interpolate(cubic.p0, cubic.c1, parameter)
	const p12 = interpolate(cubic.c1, cubic.c2, parameter)
	const p23 = interpolate(cubic.c2, cubic.p3, parameter)
	const p012 = interpolate(p01, p12, parameter)
	const p123 = interpolate(p12, p23, parameter)
	const point = interpolate(p012, p123, parameter)
	return {
		point,
		left: { p0: cubic.p0, c1: p01, c2: p012, p3: point },
		right: { p0: point, c1: p123, c2: p23, p3: cubic.p3 },
	}
}

function derivativeRoots(
	p0: number,
	c1: number,
	c2: number,
	p3: number,
	parameterTolerance: number,
): readonly number[] {
	const a = -p0 + 3 * c1 - 3 * c2 + p3
	const b = 2 * (p0 - 2 * c1 + c2)
	const c = c1 - p0
	const coefficientTolerance =
		Number.EPSILON *
		Math.max(1, Math.abs(p0), Math.abs(c1), Math.abs(c2), Math.abs(p3)) *
		64
	if (Math.abs(a) <= coefficientTolerance) {
		if (Math.abs(b) <= coefficientTolerance) return []
		const root = -c / b
		return root > parameterTolerance && root < 1 - parameterTolerance
			? [root]
			: []
	}
	const discriminant = b * b - 4 * a * c
	if (discriminant < -coefficientTolerance) return []
	const squareRoot = Math.sqrt(Math.max(0, discriminant))
	// This form avoids losing the smaller root when b and sqrt(discriminant)
	// are nearly equal.
	const q = -0.5 * (b + Math.sign(b || 1) * squareRoot)
	const roots = q === 0 ? [-b / (2 * a)] : [q / a, c / q]
	return roots
		.filter(
			(root) => root > parameterTolerance && root < 1 - parameterTolerance,
		)
		.sort((left, right) => left - right)
		.filter(
			(root, index, all) =>
				index === 0 ||
				Math.abs(root - (all[index - 1] ?? root)) > parameterTolerance,
		)
}

/** Exact axis-aligned cubic bounds, including interior extrema. */
export function cubicBounds(
	cubic: Cubic,
	overrides: Partial<GeometryTolerances> = {},
): Bounds {
	validateCubic(cubic)
	const tolerances = resolveGeometryTolerances(overrides)
	const parameters = [
		0,
		...derivativeRoots(
			cubic.p0.x,
			cubic.c1.x,
			cubic.c2.x,
			cubic.p3.x,
			tolerances.parameter,
		),
		...derivativeRoots(
			cubic.p0.y,
			cubic.c1.y,
			cubic.c2.y,
			cubic.p3.y,
			tolerances.parameter,
		),
		1,
	].sort((left, right) => left - right)
	const points = parameters.map((parameter) => evaluateCubic(cubic, parameter))
	return {
		minX: Math.min(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxX: Math.max(...points.map((point) => point.x)),
		maxY: Math.max(...points.map((point) => point.y)),
	}
}

function controlLineDistance(point: Point, start: Point, end: Point): number {
	const chord = subtract(end, start)
	const chordLength = Math.hypot(chord.x, chord.y)
	if (chordLength === 0) return distance(point, start)
	return (
		Math.abs(chord.x * (start.y - point.y) - (start.x - point.x) * chord.y) /
		chordLength
	)
}

function cubicFlatness(cubic: Cubic): number {
	return Math.max(
		controlLineDistance(cubic.c1, cubic.p0, cubic.p3),
		controlLineDistance(cubic.c2, cubic.p0, cubic.p3),
	)
}

interface FlattenWork {
	readonly cubic: Cubic
	readonly startParameter: number
	readonly endParameter: number
	readonly depth: number
}

/**
 * Flattens a cubic with a deterministic, left-first de Casteljau traversal.
 *
 * Every returned point includes its source parameter. The control-to-chord
 * distance is at most `flatness` for each accepted span. This is a practical
 * approximation criterion, not a proof of Hausdorff distance.
 */
export function flattenCubic(
	cubic: Cubic,
	overrides: Partial<GeometryTolerances> = {},
): readonly ParameterizedPoint[] {
	validateCubic(cubic)
	const tolerances = resolveGeometryTolerances(overrides)
	const result: ParameterizedPoint[] = [{ ...cubic.p0, parameter: 0 }]
	const stack: FlattenWork[] = [
		{ cubic, startParameter: 0, endParameter: 1, depth: 0 },
	]
	while (stack.length > 0) {
		const work = stack.pop()
		if (work === undefined) continue
		const flatness = cubicFlatness(work.cubic)
		if (flatness <= tolerances.flatness) {
			result.push({
				...work.cubic.p3,
				parameter: work.endParameter,
			})
			continue
		}
		if (work.depth >= tolerances.maxDepth) {
			throw new GeometryError(
				"MAX_DEPTH_EXCEEDED",
				"Adaptive cubic flattening did not reach the requested flatness.",
				{
					flatness,
					maxDepth: tolerances.maxDepth,
					requestedFlatness: tolerances.flatness,
				},
			)
		}
		const split = splitCubic(work.cubic, 0.5)
		const middleParameter = (work.startParameter + work.endParameter) / 2
		stack.push(
			{
				cubic: split.right,
				startParameter: middleParameter,
				endParameter: work.endParameter,
				depth: work.depth + 1,
			},
			{
				cubic: split.left,
				startParameter: work.startParameter,
				endParameter: middleParameter,
				depth: work.depth + 1,
			},
		)
	}
	return result
}

function validateCubic(cubic: Cubic): void {
	assertFinitePoint(cubic.p0, "cubic.p0")
	assertFinitePoint(cubic.c1, "cubic.c1")
	assertFinitePoint(cubic.c2, "cubic.c2")
	assertFinitePoint(cubic.p3, "cubic.p3")
}
