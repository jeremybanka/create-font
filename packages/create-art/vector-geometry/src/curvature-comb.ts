/**
 * Curvature-comb geometry inspired by Yanone's Speed Punk.
 *
 * Speed Punk is Apache-2.0 licensed. This application-neutral implementation
 * was rewritten in TypeScript for relative-handle cubic contours.
 * https://github.com/yanone/speedpunk
 */

import type { Cubic, Point } from "./types.ts"

export type CurvatureNormalDirection = "left" | "right" | "curvature"

export interface CurvatureNode extends Point {
	readonly incoming?: Point
	readonly outgoing?: Point
}

export interface CurvatureContour {
	readonly closed: boolean
	readonly nodes: readonly CurvatureNode[]
}

export interface CurvatureSample {
	readonly point: Point
	readonly tangent: Point
	readonly curvature: number
}

export interface CurvatureCombCell {
	readonly color: string
	readonly curvature: number
	readonly path: string
}

export interface CurvatureCombOptions {
	readonly gain: number
	/**
	 * Chooses the normal independently from any product winding convention.
	 * A resolver may return null when a sampled segment has no meaningful side.
	 */
	readonly normalDirection: CurvatureNormalDirection | CurvatureNormalResolver
	/** Product-space reference length, such as font UPM or artboard extent. */
	readonly referenceUnits: number
}

export interface CurvatureSampleLocation {
	readonly contour: CurvatureContour
	readonly contourIndex: number
	readonly segmentIndex: number
	readonly t: number
}

export type CurvatureNormalResolver = (
	sample: CurvatureSample,
	location: CurvatureSampleLocation,
) => CurvatureNormalDirection | null

const TOTAL_SUBDIVISIONS = 400
const MIN_SUBDIVISIONS = 4
const SPEED_EPSILON = 1e-9
const DRAW_FACTOR = 0.01

const COLORS = [
	[0x8b, 0x93, 0x9c],
	[0xf2, 0x94, 0x00],
	[0xe3, 0x00, 0x4f],
] as const

const format = (value: number): string =>
	Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString()

/** Evaluates a cubic's point, tangent, and signed curvature at t. */
export function sampleCubicCurvature(
	cubic: Cubic,
	t: number,
): CurvatureSample | null {
	const amount = Math.max(0, Math.min(1, t))
	const inverse = 1 - amount
	const point = {
		x:
			inverse ** 3 * cubic.p0.x +
			3 * inverse ** 2 * amount * cubic.c1.x +
			3 * inverse * amount ** 2 * cubic.c2.x +
			amount ** 3 * cubic.p3.x,
		y:
			inverse ** 3 * cubic.p0.y +
			3 * inverse ** 2 * amount * cubic.c1.y +
			3 * inverse * amount ** 2 * cubic.c2.y +
			amount ** 3 * cubic.p3.y,
	}
	const tangent = {
		x:
			3 * inverse ** 2 * (cubic.c1.x - cubic.p0.x) +
			6 * inverse * amount * (cubic.c2.x - cubic.c1.x) +
			3 * amount ** 2 * (cubic.p3.x - cubic.c2.x),
		y:
			3 * inverse ** 2 * (cubic.c1.y - cubic.p0.y) +
			6 * inverse * amount * (cubic.c2.y - cubic.c1.y) +
			3 * amount ** 2 * (cubic.p3.y - cubic.c2.y),
	}
	const secondDerivative = {
		x:
			6 * inverse * (cubic.c2.x - 2 * cubic.c1.x + cubic.p0.x) +
			6 * amount * (cubic.p3.x - 2 * cubic.c2.x + cubic.c1.x),
		y:
			6 * inverse * (cubic.c2.y - 2 * cubic.c1.y + cubic.p0.y) +
			6 * amount * (cubic.p3.y - 2 * cubic.c2.y + cubic.c1.y),
	}
	const speedSquared = tangent.x ** 2 + tangent.y ** 2
	if (!Number.isFinite(speedSquared) || speedSquared <= SPEED_EPSILON)
		return null
	const curvature =
		(tangent.x * secondDerivative.y - tangent.y * secondDerivative.x) /
		speedSquared ** 1.5
	if (!Number.isFinite(curvature)) return null
	return { point, tangent, curvature }
}

function interpolateColor(amount: number): string {
	const position = Math.max(0, Math.min(1, amount)) * (COLORS.length - 1)
	const index = Math.min(Math.floor(position), COLORS.length - 2)
	const local = position - index
	const from = COLORS[index]
	const to = COLORS[index + 1]
	if (from === undefined || to === undefined) return "#8b939c"
	const channels = from.map((channel, channelIndex) =>
		Math.round(channel + ((to[channelIndex] ?? channel) - channel) * local),
	)
	return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

function tip(
	sample: CurvatureSample,
	scale: number,
	direction: CurvatureNormalDirection,
): Point {
	const speed = Math.hypot(sample.tangent.x, sample.tangent.y)
	const signedCurvature =
		direction === "curvature"
			? sample.curvature
			: Math.abs(sample.curvature) * (direction === "right" ? 1 : -1)
	const length = signedCurvature * scale
	return {
		x: sample.point.x + (sample.tangent.y / speed) * length,
		y: sample.point.y - (sample.tangent.x / speed) * length,
	}
}

interface LocatedCubic {
	readonly contour: CurvatureContour
	readonly contourIndex: number
	readonly cubic: Cubic
	readonly segmentIndex: number
}

function contourCubics(
	contour: CurvatureContour,
	contourIndex: number,
): readonly LocatedCubic[] {
	const segmentCount = Math.max(
		0,
		contour.nodes.length - (contour.closed ? 0 : 1),
	)
	return Array.from({ length: segmentCount }, (_, segmentIndex) => {
		const from = contour.nodes[segmentIndex]
		const to = contour.nodes[(segmentIndex + 1) % contour.nodes.length]
		if (
			from === undefined ||
			to === undefined ||
			(from.outgoing === undefined && to.incoming === undefined)
		)
			return null
		return {
			contour,
			contourIndex,
			segmentIndex,
			cubic: {
				p0: { x: from.x, y: from.y },
				c1: {
					x: from.x + (from.outgoing?.x ?? 0),
					y: from.y + (from.outgoing?.y ?? 0),
				},
				c2: {
					x: to.x + (to.incoming?.x ?? 0),
					y: to.y + (to.incoming?.y ?? 0),
				},
				p3: { x: to.x, y: to.y },
			},
		}
	}).filter((entry): entry is LocatedCubic => entry !== null)
}

/** Builds colored perpendicular cells for every usable cubic segment. */
export function createCurvatureComb(
	contours: readonly CurvatureContour[],
	options: CurvatureCombOptions,
): readonly CurvatureCombCell[] {
	if (
		!Number.isFinite(options.referenceUnits) ||
		options.referenceUnits <= 0 ||
		!Number.isFinite(options.gain) ||
		options.gain <= 0
	)
		return []

	const cubics = contours.flatMap((contour, contourIndex) =>
		contourCubics(contour, contourIndex),
	)
	if (cubics.length === 0) return []
	const subdivisions = Math.max(
		MIN_SUBDIVISIONS,
		Math.floor(TOTAL_SUBDIVISIONS / cubics.length),
	)
	const sampled = cubics.map((entry) =>
		Array.from({ length: subdivisions + 1 }, (_, index) => {
			const t = index / subdivisions
			const sample = sampleCubicCurvature(entry.cubic, t)
			if (sample === null) return null
			const location = {
				contour: entry.contour,
				contourIndex: entry.contourIndex,
				segmentIndex: entry.segmentIndex,
				t,
			}
			const direction =
				typeof options.normalDirection === "function"
					? options.normalDirection(sample, location)
					: options.normalDirection
			return direction === null ? null : { direction, sample }
		}),
	)
	const magnitudes = sampled.flatMap((samples) =>
		samples.flatMap((resolved) =>
			resolved === null
				? []
				: [Math.abs(resolved.sample.curvature) * DRAW_FACTOR],
		),
	)
	if (magnitudes.length === 0) return []
	const min = Math.min(...magnitudes)
	const max = Math.max(...magnitudes)
	const range = max - min
	const scale =
		DRAW_FACTOR * options.gain * options.referenceUnits * options.referenceUnits

	return sampled.flatMap((samples) =>
		samples.slice(1).flatMap((current, index) => {
			const previous = samples[index]
			if (previous === undefined || previous === null || current === null)
				return []
			const previousTip = tip(previous.sample, scale, previous.direction)
			const currentTip = tip(current.sample, scale, current.direction)
			const magnitude =
				((Math.abs(previous.sample.curvature) +
					Math.abs(current.sample.curvature)) /
					2) *
				DRAW_FACTOR
			const colorPosition =
				range <= SPEED_EPSILON ? 0.5 : (magnitude - min) / range
			return [
				{
					color: interpolateColor(colorPosition),
					curvature: magnitude,
					path: `M${format(previous.sample.point.x)} ${format(previous.sample.point.y)}L${format(current.sample.point.x)} ${format(current.sample.point.y)}L${format(currentTip.x)} ${format(currentTip.y)}L${format(previousTip.x)} ${format(previousTip.y)}Z`,
				},
			]
		}),
	)
}
