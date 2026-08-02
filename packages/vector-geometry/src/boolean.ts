import {
	booleanOp,
	ClipType,
	FillRule,
	type Path64,
	type Paths64,
} from "clipper2-ts"

import { normalizeContours, signedArea, windingNumber } from "./contours.ts"
import {
	assertFinitePoint,
	GeometryError,
	resolveGeometryTolerances,
	type GeometryTolerances,
} from "./tolerances.ts"
import type { Contour } from "./types.ts"

export type BooleanOperation = "difference" | "intersection" | "union" | "xor"
export type BooleanFillRule = "evenodd" | "nonzero"

export interface ResolveFilledContoursOptions {
	readonly fillRule?: BooleanFillRule
	readonly tolerances?: Partial<GeometryTolerances>
}

export interface BooleanContoursOptions {
	readonly operation: BooleanOperation
	/** Clip filled regions used by difference. Ignored by other operations. */
	readonly clips?: readonly (readonly Contour[])[]
	readonly tolerances?: Partial<GeometryTolerances>
}

/** A minimal, runtime-neutral cancellation signal for synchronous geometry. */
export interface BooleanOperationSignal {
	readonly aborted: boolean
}

export interface PartitionContoursProgress {
	/** Number of authored regions whose boundaries have been incorporated. */
	readonly completedRegions: number
	readonly totalRegions: number
	/** Number of independently selectable connected pieces produced so far. */
	readonly pieceCount: number
}

export interface PartitionContoursOptions {
	readonly tolerances?: Partial<GeometryTolerances>
	/** Checked before each authored region is resolved and after progress reports. */
	readonly signal?: BooleanOperationSignal
	/** Called initially and after every authored region has been incorporated. */
	readonly onProgress?: (progress: PartitionContoursProgress) => void
}

export interface ContourPartition {
	/** One connected filled component, including any directly enclosed holes. */
	readonly contours: readonly Contour[]
	/** Ascending indexes of the authored input regions covering this component. */
	readonly contributors: readonly number[]
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

function resolvedIntegerRegion(
	region: readonly Contour[],
	scale: number,
	label: string,
	fillRule: BooleanFillRule,
): Paths64 {
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
		fillRule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero,
	)
	if (resolved.length === 0)
		throw new GeometryError(
			"DEGENERATE_CONTOUR",
			"A Boolean operand does not contain a filled region.",
			{ label },
		)
	return resolved
}

function contoursFromIntegerPaths(
	paths: Paths64,
	scale: number,
	tolerances: GeometryTolerances,
): readonly Contour[] {
	const contours = paths.flatMap((path) =>
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
	return normalizeContours(contours, { tolerances })
}

/** Resolves one authored compound fill into canonical even-odd boundaries. */
export function resolveFilledContours(
	contours: readonly Contour[],
	options: ResolveFilledContoursOptions = {},
): readonly Contour[] {
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const topologyGrid = Math.max(tolerances.normalization, 1e-6)
	const scale = 1 / topologyGrid
	return contoursFromIntegerPaths(
		resolvedIntegerRegion(
			contours,
			scale,
			"contours",
			options.fillRule ?? "evenodd",
		),
		scale,
		{ ...tolerances, normalization: topologyGrid },
	)
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
	const subjectRegions = subjects.map((region, index) =>
		resolvedIntegerRegion(region, scale, `subjects[${index}]`, "evenodd"),
	)
	const clipPaths =
		options.operation === "difference"
			? (options.clips ?? []).flatMap((region, index) =>
					resolvedIntegerRegion(region, scale, `clips[${index}]`, "evenodd"),
				)
			: []
	if (options.operation === "difference" && clipPaths.length === 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Difference needs at least one clip contour.",
		)
	const subjectPaths = subjectRegions.flat()
	const solution =
		options.operation === "intersection" || options.operation === "xor"
			? subjectRegions
					.slice(1)
					.reduce(
						(current, region) =>
							options.operation === "intersection" && current.length === 0
								? current
								: booleanOp(
										options.operation === "intersection"
											? ClipType.Intersection
											: ClipType.Xor,
										current,
										region,
										FillRule.NonZero,
									),
						subjectRegions[0] ?? [],
					)
			: booleanOp(
					options.operation === "union" ? ClipType.Union : ClipType.Difference,
					subjectPaths,
					options.operation === "union" ? null : clipPaths,
					FillRule.NonZero,
				)
	return contoursFromIntegerPaths(solution, scale, {
		...tolerances,
		normalization: topologyGrid,
	})
}

function connectedComponents(
	contours: readonly Contour[],
	tolerances: GeometryTolerances,
): readonly (readonly Contour[])[] {
	const normalized = normalizeContours(contours, { tolerances })
	const outers = normalized
		.filter((contour) => signedArea(contour.points) > 0)
		.map((contour) => ({ contour, holes: [] as Contour[] }))
	for (const hole of normalized.filter(
		(contour) => signedArea(contour.points) < 0,
	)) {
		const probe = hole.points[0]
		if (probe === undefined) continue
		const parent = outers
			.filter(
				({ contour }) =>
					windingNumber(probe, contour.points, tolerances).classification ===
					"inside",
			)
			.sort(
				(left, right) =>
					Math.abs(signedArea(left.contour.points)) -
					Math.abs(signedArea(right.contour.points)),
			)[0]
		if (parent !== undefined) parent.holes.push(hole)
	}
	return outers.map(({ contour, holes }) =>
		normalizeContours([contour, ...holes], { tolerances }),
	)
}

function resolvedComponents(
	contours: readonly Contour[],
	tolerances: GeometryTolerances,
): readonly (readonly Contour[])[] {
	if (contours.length === 0) return []
	return connectedComponents(contours, tolerances)
}

function combine(
	subjects: readonly Contour[],
	clips: readonly Contour[],
	operation: "difference" | "intersection",
	tolerances: GeometryTolerances,
): readonly Contour[] {
	if (subjects.length === 0) return []
	if (clips.length === 0) return operation === "difference" ? subjects : []
	return booleanContours(
		operation === "intersection" ? [subjects, clips] : [subjects],
		{
			operation,
			...(operation === "difference" ? { clips: [clips] } : {}),
			tolerances,
		},
	)
}

function assertPartitionActive(
	options: PartitionContoursOptions,
	completedRegions: number,
	totalRegions: number,
): void {
	if (!options.signal?.aborted) return
	throw new GeometryError(
		"INVALID_ARGUMENT",
		"Boolean partition was aborted.",
		{
			completedRegions,
			totalRegions,
		},
	)
}

function comparePartitionGeometry(
	left: readonly Contour[],
	right: readonly Contour[],
): number {
	const contourCount = Math.min(left.length, right.length)
	for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
		const leftContour = left[contourIndex]
		const rightContour = right[contourIndex]
		if (leftContour === undefined || rightContour === undefined) continue
		const pointCount = Math.min(
			leftContour.points.length,
			rightContour.points.length,
		)
		for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
			const leftPoint = leftContour.points[pointIndex]
			const rightPoint = rightContour.points[pointIndex]
			if (leftPoint === undefined || rightPoint === undefined) continue
			const comparison =
				leftPoint.x - rightPoint.x || leftPoint.y - rightPoint.y
			if (comparison !== 0) return comparison
		}
		const points = leftContour.points.length - rightContour.points.length
		if (points !== 0) return points
	}
	return left.length - right.length
}

/**
 * Splits independently filled authored regions at every boundary and reports
 * which inputs cover each connected, non-zero-area result piece.
 *
 * Input order is retained only through ascending contributor indexes; geometry
 * and piece order are canonical. Coincident boundaries therefore do not emit
 * duplicate faces, while tangent and disjoint regions remain separate pieces.
 * Callers can derive Divide directly and implement stacking-aware operations
 * such as Trim, Merge, and Crop without embedding appearance policy here.
 */
export function partitionContours(
	regions: readonly (readonly Contour[])[],
	options: PartitionContoursOptions = {},
): readonly ContourPartition[] {
	if (regions.length === 0)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"A Boolean partition needs at least one filled region.",
		)
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const topologyGrid = Math.max(tolerances.normalization, 1e-6)
	const topologyTolerances = {
		...tolerances,
		normalization: topologyGrid,
	}
	let partitions: ContourPartition[] = []
	options.onProgress?.({
		completedRegions: 0,
		totalRegions: regions.length,
		pieceCount: 0,
	})
	assertPartitionActive(options, 0, regions.length)
	for (const [regionIndex, authoredRegion] of regions.entries()) {
		assertPartitionActive(options, regionIndex, regions.length)
		const region = booleanContours([authoredRegion], {
			operation: "union",
			tolerances: topologyTolerances,
		})
		let remainder = region
		const next: ContourPartition[] = []
		for (const partition of partitions) {
			const overlap = combine(
				partition.contours,
				region,
				"intersection",
				topologyTolerances,
			)
			const outside = combine(
				partition.contours,
				region,
				"difference",
				topologyTolerances,
			)
			next.push(
				...resolvedComponents(outside, topologyTolerances).map((contours) => ({
					contours,
					contributors: partition.contributors,
				})),
				...resolvedComponents(overlap, topologyTolerances).map((contours) => ({
					contours,
					contributors: [...partition.contributors, regionIndex],
				})),
			)
			remainder = combine(
				remainder,
				partition.contours,
				"difference",
				topologyTolerances,
			)
		}
		next.push(
			...resolvedComponents(remainder, topologyTolerances).map((contours) => ({
				contours,
				contributors: [regionIndex],
			})),
		)
		partitions = next
		options.onProgress?.({
			completedRegions: regionIndex + 1,
			totalRegions: regions.length,
			pieceCount: partitions.length,
		})
		assertPartitionActive(options, regionIndex + 1, regions.length)
	}
	return partitions.toSorted((left, right) => {
		const geometry = comparePartitionGeometry(left.contours, right.contours)
		if (geometry !== 0) return geometry
		return left.contributors
			.join(",")
			.localeCompare(right.contributors.join(","))
	})
}
