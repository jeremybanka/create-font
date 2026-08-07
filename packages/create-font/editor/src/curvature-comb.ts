/**
 * Curvature-comb geometry inspired by Yanone's Speed Punk.
 *
 * Speed Punk is Apache-2.0 licensed. This implementation was rewritten in
 * TypeScript for create-font's cubic, relative-handle outline model.
 * https://github.com/yanone/speedpunk
 */

import { editorSegmentCubic, type EditorOutlineNode } from "./geometry.ts"

export type CurvatureSide = "outside" | "signed"

export interface CurvatureContour {
	readonly closed: boolean
	readonly nodes: readonly EditorOutlineNode[]
}

export interface CurvatureSample {
	readonly point: Readonly<{ x: number; y: number }>
	readonly tangent: Readonly<{ x: number; y: number }>
	readonly curvature: number
}

export interface CurvatureCombCell {
	readonly color: string
	readonly curvature: number
	readonly path: string
}

export interface CurvatureCombOptions {
	readonly gain: number
	readonly side: CurvatureSide
	readonly unitsPerEm: number
}

interface CurvatureShortcutEvent {
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly defaultPrevented?: boolean
	readonly key: string
	readonly metaKey: boolean
	readonly shiftKey: boolean
}

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

/** Matches Speed Punk's original platform-Mod+Shift+X shortcut. */
export function isCurvatureShortcut(
	event: CurvatureShortcutEvent,
	macLike: boolean,
): boolean {
	if (event.defaultPrevented || event.altKey || event.key.toLowerCase() !== "x")
		return false
	return (
		event.shiftKey &&
		(macLike
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey)
	)
}

/** Evaluates a cubic's point, tangent, and signed curvature at t. */
export function sampleCubicCurvature(
	cubic: Readonly<{
		p0: Readonly<{ x: number; y: number }>
		c1: Readonly<{ x: number; y: number }>
		c2: Readonly<{ x: number; y: number }>
		p3: Readonly<{ x: number; y: number }>
	}>,
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
	side: CurvatureSide,
): Readonly<{ x: number; y: number }> {
	const speed = Math.hypot(sample.tangent.x, sample.tangent.y)
	const signedCurvature =
		side === "outside" ? Math.abs(sample.curvature) : sample.curvature
	const length = signedCurvature * scale
	return {
		x: sample.point.x + (sample.tangent.y / speed) * length,
		y: sample.point.y - (sample.tangent.x / speed) * length,
	}
}

/**
 * Builds the colored perpendicular cells for all authored cubic segments.
 * Straight segments are intentionally omitted, matching Speed Punk's focus.
 */
export function createCurvatureComb(
	contours: readonly CurvatureContour[],
	options: CurvatureCombOptions,
): readonly CurvatureCombCell[] {
	if (
		!Number.isFinite(options.unitsPerEm) ||
		options.unitsPerEm <= 0 ||
		!Number.isFinite(options.gain) ||
		options.gain <= 0
	)
		return []

	const cubics = contours.flatMap((contour) => {
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
			return editorSegmentCubic(contour.nodes, segmentIndex, contour.closed)
		}).filter((cubic) => cubic !== null)
	})
	if (cubics.length === 0) return []

	const subdivisions = Math.max(
		MIN_SUBDIVISIONS,
		Math.floor(TOTAL_SUBDIVISIONS / cubics.length),
	)
	const sampled = cubics.map((cubic) =>
		Array.from({ length: subdivisions + 1 }, (_, index) =>
			sampleCubicCurvature(cubic, index / subdivisions),
		),
	)
	const magnitudes = sampled.flatMap((samples) =>
		samples.flatMap((sample) =>
			sample === null ? [] : [Math.abs(sample.curvature) * DRAW_FACTOR],
		),
	)
	if (magnitudes.length === 0) return []
	const min = Math.min(...magnitudes)
	const max = Math.max(...magnitudes)
	const range = max - min
	const scale =
		DRAW_FACTOR * options.gain * options.unitsPerEm * options.unitsPerEm

	return sampled.flatMap((samples) =>
		samples.slice(1).flatMap((current, index) => {
			const previous = samples[index]
			if (previous === undefined || previous === null || current === null)
				return []
			const previousTip = tip(previous, scale, options.side)
			const currentTip = tip(current, scale, options.side)
			const magnitude =
				((Math.abs(previous.curvature) + Math.abs(current.curvature)) / 2) *
				DRAW_FACTOR
			const colorPosition =
				range <= SPEED_EPSILON ? 0.5 : (magnitude - min) / range
			return [
				{
					color: interpolateColor(colorPosition),
					curvature: magnitude,
					path: `M${format(previous.point.x)} ${format(previous.point.y)}L${format(current.point.x)} ${format(current.point.y)}L${format(currentTip.x)} ${format(currentTip.y)}L${format(previousTip.x)} ${format(previousTip.y)}Z`,
				},
			]
		}),
	)
}
