import {
	booleanOp,
	ClipType,
	FillRule,
	type Path64,
	type Paths64,
} from "clipper2-ts"

import { normalizeContours } from "./contours.ts"
import {
	assertFinitePoint,
	GeometryError,
	resolveGeometryTolerances,
	type GeometryTolerances,
} from "./tolerances.ts"
import type { Contour } from "./types.ts"

export type BooleanOperation = "difference" | "union"

export interface BooleanContoursOptions {
	readonly operation: BooleanOperation
	/** Clip filled regions used by difference. Ignored by union. */
	readonly clips?: readonly (readonly Contour[])[]
	readonly tolerances?: Partial<GeometryTolerances>
}

function integerPaths(
	contours: readonly Contour[],
	scale: number,
	label: string,
): Paths64 {
	return contours.map((contour, contourIndex): Path64 => {
		if (!contour.closed)
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"Filled-region Boolean operations require closed contours.",
				{ label, contourIndex },
			)
		if (contour.points.length < 3)
			throw new GeometryError(
				"DEGENERATE_CONTOUR",
				"Filled-region Boolean contours need at least three points.",
				{ label, contourIndex, pointCount: contour.points.length },
			)
		return contour.points.map((point, pointIndex) => {
			assertFinitePoint(
				point,
				`${label}[${contourIndex}].points[${pointIndex}]`,
			)
			const x = Math.round(point.x * scale)
			const y = Math.round(point.y * scale)
			if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))
				throw new GeometryError(
					"INVALID_ARGUMENT",
					"Boolean coordinates exceed the safe topology range.",
					{ label, contourIndex, pointIndex, x: point.x, y: point.y },
				)
			return { x, y }
		})
	})
}

/**
 * Resolves groups of ordinary closed polylines as even-odd filled regions,
 * then combines those independently resolved regions. Each inner contour
 * array is one authored fill object, which prevents overlap between separate
 * objects from being mistaken for an even-odd counterform.
 *
 * The integer topology grid is derived from the normalization tolerance.
 * Returned contours have canonical starts, nesting-aware winding, and stable
 * ordering, so equivalent inputs produce byte-stable topology.
 */
export function booleanContours(
	subjects: readonly (readonly Contour[])[],
	options: BooleanContoursOptions,
): readonly Contour[] {
	if (subjects.length === 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"A Boolean operation needs at least one subject contour.",
		)
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const topologyGrid = Math.max(tolerances.normalization, 1e-6)
	const scale = 1 / topologyGrid
	const resolveRegion = (
		region: readonly Contour[],
		label: string,
	): Paths64 => {
		if (region.length === 0)
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"A filled Boolean region needs at least one contour.",
				{ label },
			)
		const resolved = booleanOp(
			ClipType.Union,
			integerPaths(region, scale, label),
			null,
			FillRule.EvenOdd,
		)
		if (resolved.length === 0)
			throw new GeometryError(
				"DEGENERATE_CONTOUR",
				"A Boolean operand does not contain a filled region.",
				{ label },
			)
		return resolved
	}
	const subjectPaths = subjects.flatMap((region, index) =>
		resolveRegion(region, `subjects[${index}]`),
	)
	const clipPaths = (options.clips ?? []).flatMap((region, index) =>
		resolveRegion(region, `clips[${index}]`),
	)
	if (options.operation === "difference" && clipPaths.length === 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Difference needs at least one clip contour.",
		)
	const solution = booleanOp(
		options.operation === "union" ? ClipType.Union : ClipType.Difference,
		subjectPaths,
		options.operation === "union" ? null : clipPaths,
		FillRule.NonZero,
	)
	const contours = solution.flatMap((path) =>
		path.length < 3
			? []
			: [
					{
						closed: true,
						points: path.map(({ x, y }) => ({
							x: x / scale,
							y: y / scale,
						})),
					},
				],
	)
	return normalizeContours(contours, {
		tolerances: { ...tolerances, normalization: topologyGrid },
	})
}
