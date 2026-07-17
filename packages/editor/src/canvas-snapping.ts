import type { PointId, VerticalMetricLine } from "@create-font/states"

import type { SelectionBounds } from "./outline-selection.ts"

export interface SnapNode {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

export interface ActiveAxisSnap {
	readonly axis: "x" | "y"
	readonly kind: "node" | "metric"
	readonly id: string
	readonly label: string
	readonly value: number
	readonly anchor?: "min" | "center" | "max"
}

export interface SnappedGroupTranslation {
	readonly deltaX: number
	readonly deltaY: number
	readonly snaps: readonly ActiveSnap[]
}

export interface SegmentProjectionCandidate {
	readonly id: string
	readonly label: string
	readonly origin: Readonly<{ x: number; y: number }>
	readonly neighbor: Readonly<{ x: number; y: number }>
}

export interface ActiveProjectionSnap extends SegmentProjectionCandidate {
	readonly axis: "projection"
	readonly kind: "segment-projection"
	readonly amount: number
}

export type ActiveSnap = ActiveAxisSnap | ActiveProjectionSnap

export interface SnappedPoint {
	readonly x: number
	readonly y: number
	readonly snaps: readonly ActiveSnap[]
}

export interface DragPositionTarget {
	x(): number
	y(): number
	position(position: Readonly<{ x: number; y: number }>): unknown
}

export interface DraggedPointSnapContext {
	readonly pointId: PointId
	readonly nodes: readonly SnapNode[]
	readonly metrics: readonly VerticalMetricLine[]
	readonly worldScale: number
	readonly thresholdPixels?: number
	readonly projectionCandidates?: readonly SegmentProjectionCandidate[]
	/** Explicit gesture constraints such as Shift take precedence over automatic snaps. */
	readonly explicitConstraint?: (
		point: Readonly<{ x: number; y: number }>,
	) => SnappedPoint | null
}

export interface ProjectionContourNode extends SnapNode {
	readonly incoming?: unknown
	readonly outgoing?: unknown
}

export interface ProjectionContour {
	readonly id: string
	readonly closed: boolean
	readonly nodes: readonly ProjectionContourNode[]
}

interface Candidate {
	readonly kind: ActiveAxisSnap["kind"]
	readonly id: string
	readonly label: string
	readonly value: number
}

interface ProjectedCandidate {
	readonly candidate: SegmentProjectionCandidate
	readonly x: number
	readonly y: number
	readonly amount: number
	readonly distance: number
}

function projectToCandidate(
	point: Readonly<{ x: number; y: number }>,
	candidate: SegmentProjectionCandidate,
): ProjectedCandidate | null {
	const dx = candidate.neighbor.x - candidate.origin.x
	const dy = candidate.neighbor.y - candidate.origin.y
	const denominator = dx * dx + dy * dy
	if (denominator === 0) return null
	const amount =
		((point.x - candidate.origin.x) * dx +
			(point.y - candidate.origin.y) * dy) /
		denominator
	const x = candidate.origin.x + dx * amount
	const y = candidate.origin.y + dy * amount
	return {
		candidate,
		x,
		y,
		amount,
		distance: Math.hypot(point.x - x, point.y - y),
	}
}

/** Snapshots non-degenerate straight segments incident to one point. */
export function incidentStraightProjectionCandidates(
	contours: readonly ProjectionContour[],
	pointId: PointId,
): readonly SegmentProjectionCandidate[] {
	const candidates: SegmentProjectionCandidate[] = []
	for (const contour of contours) {
		const segmentCount = Math.max(
			0,
			contour.nodes.length - (contour.closed ? 0 : 1),
		)
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
			const start = contour.nodes[segmentIndex]
			const end = contour.nodes[(segmentIndex + 1) % contour.nodes.length]
			if (
				start === undefined ||
				end === undefined ||
				(start.pointId !== pointId && end.pointId !== pointId) ||
				start.outgoing !== undefined ||
				end.incoming !== undefined
			) {
				continue
			}
			const dragged = start.pointId === pointId ? start : end
			const neighbor = start.pointId === pointId ? end : start
			if (dragged.x === neighbor.x && dragged.y === neighbor.y) continue
			candidates.push({
				id: `${contour.id}/${segmentIndex}`,
				label: "Straight segment projection",
				origin: { x: dragged.x, y: dragged.y },
				neighbor: { x: neighbor.x, y: neighbor.y },
			})
		}
	}
	return Object.freeze(candidates)
}

export function projectionGuidePoints(
	snap: ActiveProjectionSnap,
	extent: number,
): [number, number, number, number] {
	const dx = snap.neighbor.x - snap.origin.x
	const dy = snap.neighbor.y - snap.origin.y
	const length = Math.hypot(dx, dy)
	if (length === 0) {
		return [snap.origin.x, snap.origin.y, snap.origin.x, snap.origin.y]
	}
	const scale = extent / length
	return [
		snap.origin.x - dx * scale,
		snap.origin.y - dy * scale,
		snap.origin.x + dx * scale,
		snap.origin.y + dy * scale,
	]
}

interface GroupCandidate extends Candidate {
	readonly anchor: "min" | "center" | "max"
	readonly adjustment: number
}

function nearest(
	value: number,
	candidates: readonly Candidate[],
	threshold: number,
): Candidate | null {
	return (
		candidates
			.filter((candidate) => Math.abs(candidate.value - value) <= threshold)
			.toSorted(
				(left, right) =>
					Math.abs(left.value - value) - Math.abs(right.value - value) ||
					left.kind.localeCompare(right.kind) ||
					left.id.localeCompare(right.id),
			)[0] ?? null
	)
}

function nearestGroupCandidate(
	anchors: readonly {
		readonly anchor: GroupCandidate["anchor"]
		readonly value: number
	}[],
	candidates: readonly Candidate[],
	threshold: number,
): GroupCandidate | null {
	return (
		anchors
			.flatMap(({ anchor, value }) =>
				candidates.map((candidate) => ({
					...candidate,
					anchor,
					adjustment: candidate.value - value,
				})),
			)
			.filter((candidate) => Math.abs(candidate.adjustment) <= threshold)
			.toSorted(
				(left, right) =>
					Math.abs(left.adjustment) - Math.abs(right.adjustment) ||
					["min", "center", "max"].indexOf(left.anchor) -
						["min", "center", "max"].indexOf(right.anchor) ||
					left.kind.localeCompare(right.kind) ||
					left.id.localeCompare(right.id),
			)[0] ?? null
	)
}

/** Resolves explicit, projected-line, then independent axis constraints. */
export function snapDraggedPoint(
	input: {
		readonly x: number
		readonly y: number
	} & DraggedPointSnapContext,
): SnappedPoint {
	const threshold = (input.thresholdPixels ?? 7) / input.worldScale
	const explicit = input.explicitConstraint?.({ x: input.x, y: input.y })
	if (explicit !== undefined && explicit !== null) return explicit
	const projection = (input.projectionCandidates ?? [])
		.map((candidate) => projectToCandidate(input, candidate))
		.filter(
			(candidate): candidate is ProjectedCandidate =>
				candidate !== null && candidate.distance <= threshold,
		)
		.toSorted(
			(left, right) =>
				left.distance - right.distance ||
				left.candidate.id.localeCompare(right.candidate.id),
		)[0]
	if (projection !== undefined) {
		const snap: ActiveProjectionSnap = {
			...projection.candidate,
			axis: "projection",
			kind: "segment-projection",
			amount: projection.amount,
		}
		return Object.freeze({
			x: projection.x,
			y: projection.y,
			snaps: Object.freeze([snap]),
		})
	}
	const otherNodes = input.nodes.filter(
		(node) => node.pointId !== input.pointId,
	)
	const xCandidate = nearest(
		input.x,
		otherNodes.map((node) => ({
			kind: "node",
			id: node.pointId,
			label: "Node x",
			value: node.x,
		})),
		threshold,
	)
	const yCandidate = nearest(
		input.y,
		[
			...otherNodes.map((node) => ({
				kind: "node" as const,
				id: node.pointId,
				label: "Node y",
				value: node.y,
			})),
			...input.metrics.map((metric) => ({
				kind: "metric" as const,
				id: metric.id,
				label: metric.label,
				value: metric.y,
			})),
		],
		threshold,
	)
	const snaps: ActiveSnap[] = []
	if (xCandidate !== null) snaps.push({ axis: "x", ...xCandidate })
	if (yCandidate !== null) snaps.push({ axis: "y", ...yCandidate })
	return Object.freeze({
		x: xCandidate?.value ?? input.x,
		y: yCandidate?.value ?? input.y,
		snaps: Object.freeze(snaps),
	})
}

/** Resolves a raw drag position and keeps the imperative canvas node constrained. */
export function snapDraggedTarget(
	target: DragPositionTarget,
	context: DraggedPointSnapContext,
): SnappedPoint {
	const snapped = snapDraggedPoint({
		...context,
		x: Math.round(target.x()),
		y: Math.round(target.y()),
	})
	target.position({ x: snapped.x, y: snapped.y })
	return snapped
}

/** Snaps the translated edges and centers of a moving selection as a group. */
export function snapGroupTranslation(input: {
	readonly bounds: SelectionBounds
	readonly deltaX: number
	readonly deltaY: number
	readonly selectedPointIds: ReadonlySet<PointId>
	readonly nodes: readonly SnapNode[]
	readonly metrics: readonly VerticalMetricLine[]
	readonly worldScale: number
	readonly thresholdPixels?: number
}): SnappedGroupTranslation {
	const threshold = (input.thresholdPixels ?? 7) / input.worldScale
	const stationaryNodes = input.nodes.filter(
		(node) => !input.selectedPointIds.has(node.pointId),
	)
	const centerX = (input.bounds.minX + input.bounds.maxX) / 2
	const centerY = (input.bounds.minY + input.bounds.maxY) / 2
	const xCandidate = nearestGroupCandidate(
		[
			{ anchor: "min", value: input.bounds.minX + input.deltaX },
			{ anchor: "center", value: centerX + input.deltaX },
			{ anchor: "max", value: input.bounds.maxX + input.deltaX },
		],
		stationaryNodes.map((node) => ({
			kind: "node",
			id: node.pointId,
			label: "Node x",
			value: node.x,
		})),
		threshold,
	)
	const yCandidate = nearestGroupCandidate(
		[
			{ anchor: "min", value: input.bounds.minY + input.deltaY },
			{ anchor: "center", value: centerY + input.deltaY },
			{ anchor: "max", value: input.bounds.maxY + input.deltaY },
		],
		[
			...stationaryNodes.map((node) => ({
				kind: "node" as const,
				id: node.pointId,
				label: "Node y",
				value: node.y,
			})),
			...input.metrics.map((metric) => ({
				kind: "metric" as const,
				id: metric.id,
				label: metric.label,
				value: metric.y,
			})),
		],
		threshold,
	)
	const snaps: ActiveSnap[] = []
	if (xCandidate !== null) {
		snaps.push({
			axis: "x",
			kind: xCandidate.kind,
			id: xCandidate.id,
			label: xCandidate.label,
			value: xCandidate.value,
			anchor: xCandidate.anchor,
		})
	}
	if (yCandidate !== null) {
		snaps.push({
			axis: "y",
			kind: yCandidate.kind,
			id: yCandidate.id,
			label: yCandidate.label,
			value: yCandidate.value,
			anchor: yCandidate.anchor,
		})
	}
	return Object.freeze({
		deltaX: input.deltaX + (xCandidate?.adjustment ?? 0),
		deltaY: input.deltaY + (yCandidate?.adjustment ?? 0),
		snaps: Object.freeze(snaps),
	})
}
