import type { EditorRuleSource } from "@create-font/states"

import { editorSegmentCubic, type EditorOutlineNode } from "./geometry.ts"

const EPSILON = 1e-7
export const RULE_ANGLE_SNAP_DEGREES = 15

export function constrainRulePointToAngle(
	origin: Readonly<{ x: number; y: number }>,
	target: Readonly<{ x: number; y: number }>,
	constrained: boolean,
): Readonly<{ x: number; y: number }> {
	if (!constrained) return target
	const x = target.x - origin.x
	const y = target.y - origin.y
	const length = Math.hypot(x, y)
	if (!Number.isFinite(length) || length <= EPSILON) return target
	const step = (RULE_ANGLE_SNAP_DEGREES * Math.PI) / 180
	const angle = Math.round(Math.atan2(y, x) / step) * step
	return {
		x: origin.x + Math.cos(angle) * length,
		y: origin.y + Math.sin(angle) * length,
	}
}

export interface RuleContour {
	readonly closed: boolean
	readonly nodes: readonly EditorOutlineNode[]
}

export interface RuleEvent {
	readonly distance: number
	readonly x: number
	readonly y: number
	readonly kind: "entry" | "exit"
}

export interface RuleMeasure {
	readonly from: RuleEvent
	readonly to: RuleEvent
	readonly length: number
	readonly label: string
}

export interface RuleMeasurement {
	readonly events: readonly RuleEvent[]
	readonly measures: readonly RuleMeasure[]
}

function cubicScalar(
	p0: number,
	p1: number,
	p2: number,
	p3: number,
	t: number,
): number {
	const u = 1 - t
	return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3
}

/** Finds all distinct roots of one cubic Bézier scalar on its half-open span. */
function cubicRoots(p0: number, p1: number, p2: number, p3: number): number[] {
	const a = -p0 + 3 * p1 - 3 * p2 + p3
	const b = 3 * p0 - 6 * p1 + 3 * p2
	const c = -3 * p0 + 3 * p1
	const discriminant = 4 * b * b - 12 * a * c
	const boundaries = [0, 1]
	if (Math.abs(a) > EPSILON && discriminant >= 0) {
		const root = Math.sqrt(discriminant)
		for (const critical of [
			(-2 * b - root) / (6 * a),
			(-2 * b + root) / (6 * a),
		])
			if (critical > EPSILON && critical < 1 - EPSILON)
				boundaries.push(critical)
	} else if (Math.abs(b) > EPSILON) {
		const critical = -c / (2 * b)
		if (critical > EPSILON && critical < 1 - EPSILON) boundaries.push(critical)
	}
	boundaries.sort((left, right) => left - right)
	const roots: number[] = []
	const value = (t: number): number => cubicScalar(p0, p1, p2, p3, t)
	for (const boundary of boundaries) {
		if (Math.abs(value(boundary)) <= EPSILON) roots.push(boundary)
	}
	for (let index = 0; index + 1 < boundaries.length; index += 1) {
		let low = boundaries[index]!
		let high = boundaries[index + 1]!
		let lowValue = value(low)
		const highValue = value(high)
		if (lowValue * highValue >= 0) continue
		for (let iteration = 0; iteration < 55; iteration += 1) {
			const middle = (low + high) / 2
			const middleValue = value(middle)
			if (lowValue * middleValue <= 0) high = middle
			else {
				low = middle
				lowValue = middleValue
			}
		}
		roots.push((low + high) / 2)
	}
	return roots
		.filter((root) => root >= -EPSILON && root < 1 - EPSILON)
		.map((root) => Math.max(0, root))
		.sort((left, right) => left - right)
		.filter(
			(root, index, values) => index === 0 || root - values[index - 1]! > 1e-6,
		)
}

function flattenedContour(
	contour: RuleContour,
): readonly { x: number; y: number }[] {
	const points: { x: number; y: number }[] = []
	for (let index = 0; index < contour.nodes.length; index += 1) {
		const cubic = editorSegmentCubic(contour.nodes, index, true)
		if (cubic === null) continue
		const straight =
			contour.nodes[index]?.outgoing === undefined &&
			contour.nodes[(index + 1) % contour.nodes.length]?.incoming === undefined
		const samples = straight ? 1 : 32
		for (let sample = 0; sample < samples; sample += 1) {
			const t = sample / samples
			points.push({
				x: cubicScalar(cubic.p0.x, cubic.c1.x, cubic.c2.x, cubic.p3.x, t),
				y: cubicScalar(cubic.p0.y, cubic.c1.y, cubic.c2.y, cubic.p3.y, t),
			})
		}
	}
	return points
}

function signedArea(points: readonly { x: number; y: number }[]): number {
	let twiceArea = 0
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index]!
		const next = points[(index + 1) % points.length]!
		twiceArea += current.x * next.y - next.x * current.y
	}
	return twiceArea / 2
}

function contains(
	points: readonly { x: number; y: number }[],
	point: Readonly<{ x: number; y: number }>,
): boolean {
	let inside = false
	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index++
	) {
		const a = points[index]!
		const b = points[previous]!
		if (
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
		)
			inside = !inside
	}
	return inside
}

/**
 * Measures in font coordinates. Negative signed area is clockwise (a form);
 * positive area is counterclockwise (an explicitly subtractive counterform).
 */
export function measureRule(
	rule: EditorRuleSource,
	contours: readonly RuleContour[],
): RuleMeasurement {
	const length = Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y)
	if (!Number.isFinite(length) || length <= 1e-6)
		return { events: [], measures: [] }
	const direction = {
		x: (rule.b.x - rule.a.x) / length,
		y: (rule.b.y - rule.a.y) / length,
	}
	const normal = { x: -direction.y, y: direction.x }
	const candidates: number[] = []
	const usable = contours
		.filter((contour) => contour.closed && contour.nodes.length >= 2)
		.map((contour) => ({ points: flattenedContour(contour), contour }))
		.filter(({ points }) => Math.abs(signedArea(points)) > EPSILON)
	for (const { contour } of usable) {
		for (let index = 0; index < contour.nodes.length; index += 1) {
			const cubic = editorSegmentCubic(contour.nodes, index, true)
			if (cubic === null) continue
			const cross = (point: Readonly<{ x: number; y: number }>): number =>
				(point.x - rule.a.x) * normal.x + (point.y - rule.a.y) * normal.y
			for (const root of cubicRoots(
				cross(cubic.p0),
				cross(cubic.c1),
				cross(cubic.c2),
				cross(cubic.p3),
			)) {
				const x = cubicScalar(
					cubic.p0.x,
					cubic.c1.x,
					cubic.c2.x,
					cubic.p3.x,
					root,
				)
				const y = cubicScalar(
					cubic.p0.y,
					cubic.c1.y,
					cubic.c2.y,
					cubic.p3.y,
					root,
				)
				candidates.push(
					(x - rule.a.x) * direction.x + (y - rule.a.y) * direction.y,
				)
			}
		}
	}
	candidates.sort((left, right) => left - right)
	const grouped = candidates.filter(
		(value, index) => index === 0 || value - candidates[index - 1]! > 1e-5,
	)
	const occupied = (distance: number): boolean => {
		const point = {
			x: rule.a.x + direction.x * distance,
			y: rule.a.y + direction.y * distance,
		}
		let form = false
		let counter = false
		for (const { points } of usable) {
			if (!contains(points, point)) continue
			if (signedArea(points) < 0) form = true
			else counter = true
		}
		return form && !counter
	}
	const events: RuleEvent[] = []
	for (let index = 0; index < grouped.length; index += 1) {
		const distance = grouped[index]!
		const previous = grouped[index - 1]
		const next = grouped[index + 1]
		const delta = Math.max(
			1e-4,
			Math.min(
				(previous === undefined ? 1 : distance - previous) / 4,
				(next === undefined ? 1 : next - distance) / 4,
			),
		)
		const before = occupied(distance - delta)
		const after = occupied(distance + delta)
		if (before === after) continue
		events.push({
			distance,
			x: rule.a.x + direction.x * distance,
			y: rule.a.y + direction.y * distance,
			kind: after ? "entry" : "exit",
		})
	}
	const measures = events.slice(1).flatMap((to, index) => {
		const from = events[index]!
		const measuredLength = to.distance - from.distance
		return measuredLength <= 1e-5
			? []
			: [{ from, to, length: measuredLength, label: measuredLength.toFixed(1) }]
	})
	return { events, measures }
}

export function ruleViewportEndpoints(
	rule: EditorRuleSource,
	radius: number,
): readonly [number, number, number, number] {
	const length = Math.hypot(rule.b.x - rule.a.x, rule.b.y - rule.a.y)
	const x = (rule.b.x - rule.a.x) / length
	const y = (rule.b.y - rule.a.y) / length
	return [
		rule.a.x - x * radius,
		rule.a.y - y * radius,
		rule.a.x + x * radius,
		rule.a.y + y * radius,
	]
}
