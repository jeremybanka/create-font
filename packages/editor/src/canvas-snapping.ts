import type { PointId, VerticalMetricLine } from "@create-font/states"

export interface SnapNode {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

export interface ActiveSnap {
	readonly axis: "x" | "y"
	readonly kind: "node" | "metric"
	readonly id: string
	readonly label: string
	readonly value: number
}

export interface SnappedPoint {
	readonly x: number
	readonly y: number
	readonly snaps: readonly ActiveSnap[]
}

interface Candidate {
	readonly kind: ActiveSnap["kind"]
	readonly id: string
	readonly label: string
	readonly value: number
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

/** Resolves independent, zoom-stable x/y snapping for one dragged node. */
export function snapDraggedPoint(input: {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	readonly nodes: readonly SnapNode[]
	readonly metrics: readonly VerticalMetricLine[]
	readonly worldScale: number
	readonly thresholdPixels?: number
}): SnappedPoint {
	const threshold = (input.thresholdPixels ?? 7) / input.worldScale
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
