import { flattenCubic, splitCubic } from "./cubic.ts"
import {
	assertFinitePoint,
	GeometryError,
	type GeometryTolerances,
	resolveGeometryTolerances,
} from "./tolerances.ts"
import type { Cubic, Point } from "./types.ts"
import { cross, distance, dot, interpolate, subtract } from "./vector.ts"

/** The durable, renderer-neutral corner vocabulary. An absent setting is sharp. */
export type CornerProfile = "sharp" | "circular" | "squircle"

export interface CornerProfileSetting {
	readonly profile: CornerProfile
	/** Distance consumed along each incident, in contour coordinate units. */
	readonly amount: number
}

/**
 * An authored contour point. Controls are absolute coordinates; an omitted
 * control coincides with its owning point, matching an ordinary cubic path.
 */
export interface CornerContourPoint<Id extends string = string> {
	readonly id: Id
	readonly point: Point
	readonly incoming?: Point
	readonly outgoing?: Point
	/** Omit this for the canonical sharp corner. */
	readonly corner?: CornerProfileSetting
}

export interface CornerContour<Id extends string = string> {
	readonly points: readonly CornerContourPoint<Id>[]
	readonly closed: boolean
}

/** An ordinary cubic contour point, with all live-corner metadata lowered. */
export interface CubicContourPoint<Id extends string = string> {
	readonly id: Id
	readonly point: Point
	readonly incoming?: Point
	readonly outgoing?: Point
}

export type CornerIneligibilityReason =
	| "open-endpoint"
	| "sharp"
	| "zero-amount"
	| "invalid-profile"
	| "invalid-amount"
	| "degenerate-incident"
	| "collinear-incidents"

export type CornerConvexity = "convex" | "concave" | "unclassified"

export type CornerEligibility =
	| Readonly<{ eligible: true; convexity: CornerConvexity }>
	| Readonly<{
			eligible: false
			reason: CornerIneligibilityReason
			convexity: CornerConvexity
	  }>

export interface CornerProfileResolution<Id extends string = string> {
	readonly pointId: Id
	readonly setting: CornerProfileSetting
	readonly eligibility: CornerEligibility
	readonly requestedAmount: number
	readonly appliedAmount: number
	readonly clamped: boolean
}

export interface LoweredCornerContour<Id extends string = string> {
	readonly points: readonly CubicContourPoint<string>[]
	/** Authored source point for each lowered point, in matching array order. */
	readonly sourcePointIds: readonly Id[]
	readonly closed: boolean
	readonly corners: readonly CornerProfileResolution<Id>[]
}

export interface LowerCornerProfilesOptions<Id extends string = string> {
	readonly tolerances?: Partial<GeometryTolerances>
	/** Lamé exponent for squircle profiles. Defaults to 4; must exceed 1. */
	readonly squircleExponent?: number
	/** Fixed deterministic cubic count for a squircle. Defaults to 4. */
	readonly squircleSubdivisions?: number
	/** Fixed circular cubic count. Omit to use at most quarter-circle cubics. */
	readonly circularSubdivisions?: number
	/** Override the stable derived-ID policy when integrating with another ID space. */
	readonly createId?: (
		sourceId: Id,
		part: "entry" | "exit" | `circular:${number}` | `squircle:${number}`,
	) => string
}

interface SegmentLookup {
	readonly cubic: Cubic
	readonly linear: boolean
	readonly points: readonly Readonly<Point & { parameter: number }>[]
	readonly cumulative: readonly number[]
	readonly length: number
}

interface MutablePoint {
	id: string
	point: Point
	incoming?: Point
	outgoing?: Point
}

const unit = (vector: Point): Point | null => {
	const magnitude = Math.hypot(vector.x, vector.y)
	return magnitude === 0
		? null
		: { x: vector.x / magnitude, y: vector.y / magnitude }
}

const addScaled = (origin: Point, direction: Point, amount: number): Point => ({
	x: origin.x + direction.x * amount,
	y: origin.y + direction.y * amount,
})

const segmentCubic = <Id extends string>(
	start: CornerContourPoint<Id>,
	end: CornerContourPoint<Id>,
): Cubic => {
	if (start.outgoing === undefined && end.incoming === undefined) {
		return {
			p0: start.point,
			c1: interpolate(start.point, end.point, 1 / 3),
			c2: interpolate(start.point, end.point, 2 / 3),
			p3: end.point,
		}
	}
	return {
		p0: start.point,
		c1: start.outgoing ?? start.point,
		c2: end.incoming ?? end.point,
		p3: end.point,
	}
}

const makeLookup = (
	cubic: Cubic,
	linear: boolean,
	tolerances: GeometryTolerances,
): SegmentLookup => {
	const points = linear
		? [
				{ ...cubic.p0, parameter: 0 },
				{ ...cubic.p3, parameter: 1 },
			]
		: flattenCubic(cubic, tolerances)
	const cumulative = [0]
	for (let index = 1; index < points.length; index += 1) {
		cumulative.push(
			(cumulative[index - 1] ?? 0) +
				distance(points[index - 1]!, points[index]!),
		)
	}
	return {
		cubic,
		linear,
		points,
		cumulative,
		length: cumulative.at(-1) ?? 0,
	}
}

const parameterAtLength = (lookup: SegmentLookup, target: number): number => {
	if (target <= 0 || lookup.length === 0) return 0
	if (target >= lookup.length) return 1
	for (let index = 1; index < lookup.cumulative.length; index += 1) {
		const endLength = lookup.cumulative[index]!
		if (endLength < target) continue
		const startLength = lookup.cumulative[index - 1]!
		const start = lookup.points[index - 1]!
		const end = lookup.points[index]!
		const span = endLength - startLength
		return interpolate(
			{ x: start.parameter, y: 0 },
			{ x: end.parameter, y: 0 },
			span === 0 ? 0 : (target - startLength) / span,
		).x
	}
	return 1
}

const subCubic = (cubic: Cubic, start: number, end: number): Cubic => {
	if (start <= 0 && end >= 1) return cubic
	const beforeEnd = end >= 1 ? cubic : splitCubic(cubic, end).left
	if (start <= 0) return beforeEnd
	return splitCubic(beforeEnd, start / end).right
}

const tangentAt = (cubic: Cubic, parameter: number): Point => {
	const inverse = 1 - parameter
	return {
		x:
			3 * inverse * inverse * (cubic.c1.x - cubic.p0.x) +
			6 * inverse * parameter * (cubic.c2.x - cubic.c1.x) +
			3 * parameter * parameter * (cubic.p3.x - cubic.c2.x),
		y:
			3 * inverse * inverse * (cubic.c1.y - cubic.p0.y) +
			6 * inverse * parameter * (cubic.c2.y - cubic.c1.y) +
			3 * parameter * parameter * (cubic.p3.y - cubic.c2.y),
	}
}

const stableTangent = (
	cubic: Cubic,
	parameter: number,
	fallback: Point,
): Point =>
	unit(tangentAt(cubic, parameter)) ?? unit(fallback) ?? { x: 1, y: 0 }

const convexityAt = <Id extends string>(
	contour: CornerContour<Id>,
	index: number,
	incoming: Point,
	outgoing: Point,
): CornerConvexity => {
	if (!contour.closed) return "unclassified"
	let area = 0
	for (
		let pointIndex = 0;
		pointIndex < contour.points.length;
		pointIndex += 1
	) {
		const current = contour.points[pointIndex]!.point
		const next = contour.points[(pointIndex + 1) % contour.points.length]!.point
		area += current.x * next.y - current.y * next.x
	}
	const turn = cross(incoming, outgoing)
	if (area === 0 || turn === 0) return "unclassified"
	return Math.sign(area) === Math.sign(turn) ? "convex" : "concave"
}

/** Reports whether one authored point can carry a live profile. */
export function cornerProfileEligibility<Id extends string>(
	contour: CornerContour<Id>,
	index: number,
	overrides: Partial<GeometryTolerances> = {},
): CornerEligibility {
	const tolerances = resolveGeometryTolerances(overrides)
	const count = contour.points.length
	if (!Number.isInteger(index) || index < 0 || index >= count) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Corner index is outside the contour.",
			{
				index,
				pointCount: count,
			},
		)
	}
	const source = contour.points[index]!
	const setting = source.corner ?? { profile: "sharp", amount: 0 }
	const unavailable = (
		reason: CornerIneligibilityReason,
	): CornerEligibility => ({
		eligible: false,
		reason,
		convexity: "unclassified",
	})
	if (!contour.closed && (index === 0 || index === count - 1)) {
		return unavailable("open-endpoint")
	}
	if (
		!(["sharp", "circular", "squircle"] as readonly unknown[]).includes(
			setting.profile,
		)
	) {
		return unavailable("invalid-profile")
	}
	if (!Number.isFinite(setting.amount) || setting.amount < 0) {
		return unavailable("invalid-amount")
	}
	if (setting.profile === "sharp") return unavailable("sharp")
	if (setting.amount <= tolerances.distance) return unavailable("zero-amount")
	const previous = contour.points[(index - 1 + count) % count]
	const next = contour.points[(index + 1) % count]
	if (previous === undefined || next === undefined)
		return unavailable("open-endpoint")
	const incoming =
		unit(subtract(source.point, source.incoming ?? previous.point)) ??
		unit(subtract(source.point, previous.point))
	const outgoing =
		unit(subtract(source.outgoing ?? next.point, source.point)) ??
		unit(subtract(next.point, source.point))
	if (incoming === null || outgoing === null) {
		return unavailable("degenerate-incident")
	}
	const convexity = convexityAt(contour, index, incoming, outgoing)
	if (Math.abs(cross(incoming, outgoing)) <= tolerances.parameter) {
		return { eligible: false, reason: "collinear-incidents", convexity }
	}
	return { eligible: true, convexity }
}

const assignCubic = (
	start: MutablePoint,
	end: MutablePoint,
	cubic: Cubic,
): void => {
	start.outgoing = cubic.c1
	end.incoming = cubic.c2
}

const circularCubics = (
	start: Point,
	end: Point,
	startTangent: Point,
	endTangent: Point,
	exactLineIncidents: boolean,
	fixedSubdivisions?: number,
): readonly Cubic[] => {
	const chord = distance(start, end)
	const turn = Math.atan2(
		cross(startTangent, endTangent),
		dot(startTangent, endTangent),
	)
	if (exactLineIncidents && Math.abs(turn) > 1e-12) {
		const radius = chord / (2 * Math.sin(Math.abs(turn) / 2))
		const side = Math.sign(turn)
		const center = {
			x: start.x - startTangent.y * side * radius,
			y: start.y + startTangent.x * side * radius,
		}
		const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
		const count =
			fixedSubdivisions ??
			Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2)))
		const result: Cubic[] = []
		for (let index = 0; index < count; index += 1) {
			const firstAngle = startAngle + (turn * index) / count
			const lastAngle = startAngle + (turn * (index + 1)) / count
			const sweep = lastAngle - firstAngle
			const kappa = (4 / 3) * Math.tan(Math.abs(sweep) / 4) * radius
			const p0 = {
				x: center.x + Math.cos(firstAngle) * radius,
				y: center.y + Math.sin(firstAngle) * radius,
			}
			const p3 = {
				x: center.x + Math.cos(lastAngle) * radius,
				y: center.y + Math.sin(lastAngle) * radius,
			}
			const firstTangent = {
				x: -Math.sin(firstAngle) * side,
				y: Math.cos(firstAngle) * side,
			}
			const lastTangent = {
				x: -Math.sin(lastAngle) * side,
				y: Math.cos(lastAngle) * side,
			}
			result.push({
				p0: index === 0 ? start : p0,
				c1: addScaled(index === 0 ? start : p0, firstTangent, kappa),
				c2: addScaled(index === count - 1 ? end : p3, lastTangent, -kappa),
				p3: index === count - 1 ? end : p3,
			})
		}
		return result
	}
	const angle = Math.acos(
		Math.max(-1, Math.min(1, dot(startTangent, endTangent))),
	)
	const handle = chord * (2 / (3 * (1 + Math.cos(angle / 2))))
	const approximation = {
		p0: start,
		c1: addScaled(start, startTangent, handle),
		c2: addScaled(end, endTangent, -handle),
		p3: end,
	}
	if (fixedSubdivisions === undefined || fixedSubdivisions === 1)
		return [approximation]
	return Array.from({ length: fixedSubdivisions }, (_, index) =>
		subCubic(
			approximation,
			index / fixedSubdivisions,
			(index + 1) / fixedSubdivisions,
		),
	)
}

interface SquircleSample {
	readonly point: Point
	readonly tangent: Point
}

const squircleSample = (
	vertex: Point,
	entry: Point,
	exit: Point,
	parameter: number,
	exponent: number,
	startTangent: Point,
	endTangent: Point,
): SquircleSample => {
	if (parameter === 0) return { point: entry, tangent: startTangent }
	if (parameter === 1) return { point: exit, tangent: endTangent }
	const angle = (Math.PI / 2) * parameter
	const alpha = 2 / exponent
	const sine = Math.sin(angle)
	const cosine = Math.cos(angle)
	const xFactor = 1 - sine ** alpha
	const yFactor = 1 - cosine ** alpha
	const entryVector = subtract(entry, vertex)
	const exitVector = subtract(exit, vertex)
	const point = {
		x: vertex.x + entryVector.x * xFactor + exitVector.x * yFactor,
		y: vertex.y + entryVector.y * xFactor + exitVector.y * yFactor,
	}
	const dx = -alpha * sine ** (alpha - 1) * cosine
	const dy = alpha * cosine ** (alpha - 1) * sine
	const tangent =
		unit({
			x: entryVector.x * dx + exitVector.x * dy,
			y: entryVector.y * dx + exitVector.y * dy,
		}) ?? startTangent
	return { point, tangent }
}

const squircleCubics = (
	vertex: Point,
	entry: Point,
	exit: Point,
	startTangent: Point,
	endTangent: Point,
	exponent: number,
	subdivisions: number,
): readonly Cubic[] => {
	const samples = Array.from({ length: subdivisions + 1 }, (_, index) =>
		squircleSample(
			vertex,
			entry,
			exit,
			index / subdivisions,
			exponent,
			startTangent,
			endTangent,
		),
	)
	return samples.slice(0, -1).map((sample, index) => {
		const next = samples[index + 1]!
		const handle = distance(sample.point, next.point) / 3
		return {
			p0: sample.point,
			c1: addScaled(sample.point, sample.tangent, handle),
			c2: addScaled(next.point, next.tangent, -handle),
			p3: next.point,
		}
	})
}

/**
 * Lowers live profiles to ordinary cubic points. Adjacent requests are scaled
 * proportionally per span, then each corner uses the smaller of its two span
 * allowances. This deterministic, monotone rule prevents trims from crossing.
 */
export function lowerCornerProfiles<Id extends string>(
	contour: CornerContour<Id>,
	options: LowerCornerProfilesOptions<Id> = {},
): LoweredCornerContour<Id> {
	const tolerances = resolveGeometryTolerances(options.tolerances)
	const exponent = options.squircleExponent ?? 4
	const subdivisions = options.squircleSubdivisions ?? 4
	const circularSubdivisions = options.circularSubdivisions
	if (!Number.isFinite(exponent) || exponent <= 1) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Squircle exponent must be finite and greater than 1.",
			{ exponent },
		)
	}
	if (
		!Number.isInteger(subdivisions) ||
		subdivisions < 1 ||
		subdivisions > 64
	) {
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Squircle subdivisions must be an integer from 1 through 64.",
			{ subdivisions },
		)
	}
	if (
		circularSubdivisions !== undefined &&
		(!Number.isInteger(circularSubdivisions) ||
			circularSubdivisions < 1 ||
			circularSubdivisions > 64)
	)
		throw new GeometryError(
			"INVALID_ARGUMENT",
			"Circular subdivisions must be an integer from 1 through 64.",
			{ circularSubdivisions },
		)
	const requestedId =
		options.createId ??
		((sourceId: Id, part: string) => `${sourceId}::corner:${part}`)
	const ids = new Set<string>()
	for (const [index, point] of contour.points.entries()) {
		assertFinitePoint(point.point, `contour.points[${index}].point`)
		if (point.incoming !== undefined)
			assertFinitePoint(point.incoming, `contour.points[${index}].incoming`)
		if (point.outgoing !== undefined)
			assertFinitePoint(point.outgoing, `contour.points[${index}].outgoing`)
		if (ids.has(point.id))
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"Corner contour point IDs must be unique.",
				{ pointId: point.id },
			)
		ids.add(point.id)
	}
	const allocatedIds = new Set(ids)
	const createId = (
		sourceId: Id,
		part: "entry" | "exit" | `circular:${number}` | `squircle:${number}`,
	): string => {
		const base = requestedId(sourceId, part)
		let candidate = base
		let suffix = 1
		while (allocatedIds.has(candidate)) {
			candidate = `${base}::derived:${suffix}`
			suffix += 1
		}
		allocatedIds.add(candidate)
		return candidate
	}
	const pointCount = contour.points.length
	const segmentCount = Math.max(0, pointCount - (contour.closed ? 0 : 1))
	const segments = Array.from({ length: segmentCount }, (_, index) => {
		const start = contour.points[index]!
		const end = contour.points[(index + 1) % pointCount]!
		return makeLookup(
			segmentCubic(start, end),
			start.outgoing === undefined && end.incoming === undefined,
			tolerances,
		)
	})
	const eligibility = contour.points.map((_, index) =>
		cornerProfileEligibility(contour, index, tolerances),
	)
	const requested = contour.points.map((point, index) =>
		eligibility[index]!.eligible ? (point.corner?.amount ?? 0) : 0,
	)
	const applied = [...requested]
	const spanCaps = [...requested]
	for (let index = 0; index < segments.length; index += 1) {
		const nextIndex = (index + 1) % pointCount
		const total = requested[index]! + requested[nextIndex]!
		const usable = Math.max(
			0,
			segments[index]!.length - 2 * tolerances.distance,
		)
		if (total > usable && total > 0) {
			spanCaps[index] = Math.min(
				spanCaps[index]!,
				(requested[index]! * usable) / total,
			)
			spanCaps[nextIndex] = Math.min(
				spanCaps[nextIndex]!,
				(requested[nextIndex]! * usable) / total,
			)
		}
	}
	for (let index = 0; index < pointCount; index += 1)
		applied[index] = spanCaps[index]!
	// A corner has one scalar amount; take the smaller allowance produced by its
	// two incidents. Decreasing it cannot invalidate another span's constraint.
	for (let index = 0; index < pointCount; index += 1) {
		if (!contour.closed && (index === 0 || index === pointCount - 1)) continue
		const previousIndex = (index - 1 + pointCount) % pointCount
		const previous = segments[previousIndex]
		const next = segments[index]
		if (previous === undefined || next === undefined) applied[index] = 0
		else
			applied[index] = Math.min(applied[index]!, previous.length, next.length)
	}
	const parameters = segments.map((segment, index) => ({
		start: parameterAtLength(segment, applied[index]!),
		end: parameterAtLength(
			segment,
			segment.length - applied[(index + 1) % pointCount]!,
		),
	}))
	const expanded: MutablePoint[][] = contour.points.map((source, index) => {
		const amount = applied[index]!
		if (amount <= tolerances.distance)
			return [{ id: source.id, point: source.point }]
		const previousIndex = (index - 1 + segmentCount) % segmentCount
		const previous = segments[previousIndex]!
		const next = segments[index]!
		const previousParameter = parameters[previousIndex]!.end
		const nextParameter = parameters[index]!.start
		const entry = subCubic(previous.cubic, 0, previousParameter).p3
		const exit = subCubic(next.cubic, nextParameter, 1).p0
		const startTangent = stableTangent(
			previous.cubic,
			previousParameter,
			subtract(source.point, entry),
		)
		const endTangent = stableTangent(
			next.cubic,
			nextParameter,
			subtract(exit, source.point),
		)
		const profile = source.corner!.profile
		const cubics =
			profile === "circular"
				? circularCubics(
						entry,
						exit,
						startTangent,
						endTangent,
						previous.linear && next.linear,
						circularSubdivisions,
					)
				: squircleCubics(
						source.point,
						entry,
						exit,
						startTangent,
						endTangent,
						exponent,
						subdivisions,
					)
		const points: MutablePoint[] = [
			{ id: createId(source.id, "entry"), point: entry },
		]
		for (let cubicIndex = 0; cubicIndex < cubics.length; cubicIndex += 1) {
			const cubic = cubics[cubicIndex]!
			const last = points.at(-1)!
			const isLast = cubicIndex === cubics.length - 1
			const part =
				profile === "circular"
					? (`circular:${cubicIndex + 1}` as const)
					: (`squircle:${cubicIndex + 1}` as const)
			const endPoint: MutablePoint = {
				id: isLast ? createId(source.id, "exit") : createId(source.id, part),
				point: cubic.p3,
			}
			assignCubic(last, endPoint, cubic)
			points.push(endPoint)
		}
		return points
	})
	for (let index = 0; index < segments.length; index += 1) {
		const start = expanded[index]!.at(-1)!
		const end = expanded[(index + 1) % pointCount]![0]!
		const segment = segments[index]!
		if (!segment.linear)
			assignCubic(
				start,
				end,
				subCubic(
					segment.cubic,
					parameters[index]!.start,
					parameters[index]!.end,
				),
			)
	}
	const loweredIds = new Set<string>()
	for (const point of expanded.flat()) {
		if (loweredIds.has(point.id)) {
			throw new GeometryError(
				"INVALID_ARGUMENT",
				"Lowered corner point IDs must be unique.",
				{ pointId: point.id },
			)
		}
		loweredIds.add(point.id)
	}
	return {
		closed: contour.closed,
		points: expanded.flat(),
		sourcePointIds: expanded.flatMap((points, index) =>
			points.map(() => contour.points[index]!.id),
		),
		corners: contour.points.map((point, index) => {
			const setting = point.corner ?? { profile: "sharp", amount: 0 }
			return {
				pointId: point.id,
				setting,
				eligibility: eligibility[index]!,
				requestedAmount: requested[index]!,
				appliedAmount: applied[index]!,
				clamped: applied[index]! < requested[index]! - tolerances.distance,
			}
		}),
	}
}
