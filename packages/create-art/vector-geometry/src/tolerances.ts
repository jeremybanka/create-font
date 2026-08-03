import type { Point } from "./types.ts"

export interface GeometryTolerances {
	/** Absolute coordinate-space tolerance used for coincidence and boundaries. */
	readonly distance: number
	/** Maximum coordinate-space error accepted while flattening curves. */
	readonly flatness: number
	/** Tolerance for normalized parameters in the interval [0, 1]. */
	readonly parameter: number
	/** Grid used to make normalized coordinates byte-stable. */
	readonly normalization: number
	/** Hard subdivision limit for adaptive algorithms. */
	readonly maxDepth: number
	/** Maximum miter length as a multiple of the offset distance. */
	readonly miterLimit: number
}

export type GeometryErrorCode =
	| "DEGENERATE_CONTOUR"
	| "INVALID_ARGUMENT"
	| "MAX_DEPTH_EXCEEDED"
	| "NON_FINITE_COORDINATE"

export class GeometryError extends Error {
	readonly code: GeometryErrorCode
	readonly details: Readonly<Record<string, number | string>>

	constructor(
		code: GeometryErrorCode,
		message: string,
		details: Readonly<Record<string, number | string>> = {},
	) {
		super(message)
		this.name = "GeometryError"
		this.code = code
		this.details = details
	}
}

export const DEFAULT_GEOMETRY_TOLERANCES: GeometryTolerances = Object.freeze({
	distance: 1e-8,
	flatness: 0.25,
	parameter: 1e-9,
	normalization: 1e-9,
	maxDepth: 20,
	miterLimit: 4,
})

const positiveFinite = (name: string, value: number): void => {
	if (!Number.isFinite(value) || value <= 0) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			`${name} must be a positive finite number.`,
			{ [name]: value },
		)
	}
}

export function resolveGeometryTolerances(
	overrides: Partial<GeometryTolerances> = {},
): GeometryTolerances {
	const resolved = { ...DEFAULT_GEOMETRY_TOLERANCES, ...overrides }
	positiveFinite("distance", resolved.distance)
	positiveFinite("flatness", resolved.flatness)
	positiveFinite("parameter", resolved.parameter)
	positiveFinite("normalization", resolved.normalization)
	positiveFinite("miterLimit", resolved.miterLimit)
	if (
		!Number.isInteger(resolved.maxDepth) ||
		resolved.maxDepth < 1 ||
		resolved.maxDepth > 52
	) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"maxDepth must be an integer between 1 and 52.",
			{ maxDepth: resolved.maxDepth },
		)
	}
	return Object.freeze(resolved)
}

export function assertFinitePoint(point: Point, label = "point"): void {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		throw new GeometryError(
			"NON_FINITE_COORDINATE",
			`${label} must contain finite coordinates.`,
			{ x: point.x, y: point.y },
		)
	}
}

export const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

export function snapCoordinate(value: number, grid: number): number {
	const gridUnits = value / grid
	// Rounding an unsafe integer can move a large coordinate by an entire ULP,
	// even when the requested grid is much smaller than that ULP.
	if (Math.abs(gridUnits) > Number.MAX_SAFE_INTEGER) {
		return canonicalZero(value)
	}
	const snapped = Math.round(gridUnits) * grid
	return canonicalZero(snapped)
}
