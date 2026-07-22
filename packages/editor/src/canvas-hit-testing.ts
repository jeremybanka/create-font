import type { EditorCanvasContour } from "./editor-workspace.ts"
import { nearestEditorSegment } from "./geometry.ts"
import {
	selectionKey,
	type EditorSelectionTarget,
} from "./outline-selection.ts"

/** Maximum screen-space radius for node and handle convenience targets. */
export const CONTROL_HIT_RADIUS_PX = 10
/** Maximum screen-space radius for thin outline segment convenience targets. */
export const SEGMENT_HIT_RADIUS_PX = 24

interface CircularHitContext<Shape> {
	beginPath(): void
	arc(
		x: number,
		y: number,
		radius: number,
		startAngle: number,
		endAngle: number,
	): void
	closePath(): void
	fillStrokeShape(shape: Shape): void
}

/** Creates a Konva-compatible circular hit region without visual geometry. */
export function circularHitRegion(
	radius: number,
	center: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
) {
	return <Shape>(context: CircularHitContext<Shape>, shape: Shape): void => {
		context.beginPath()
		context.arc(center.x, center.y, radius, 0, Math.PI * 2)
		context.closePath()
		context.fillStrokeShape(shape)
	}
}

export interface EditorControlHitCandidate {
	readonly target: EditorSelectionTarget
	readonly x: number
	readonly y: number
}

export interface EditorControlHit extends EditorControlHitCandidate {
	readonly kind: "control"
	readonly distancePx: number
}

export interface EditorSegmentHit {
	readonly kind: "segment"
	readonly contourId: EditorCanvasContour["id"]
	readonly segmentIndex: number
	readonly amount: number
	readonly distancePx: number
}

/** A path segment belongs to a selection only when both endpoint nodes do. */
export function selectionOwnsEditorSegment(
	contour: Pick<EditorCanvasContour, "closed" | "nodes">,
	segmentIndex: number,
	selection: readonly EditorSelectionTarget[],
): boolean {
	const segmentCount = contour.closed
		? contour.nodes.length
		: Math.max(0, contour.nodes.length - 1)
	if (
		!Number.isInteger(segmentIndex) ||
		segmentIndex < 0 ||
		segmentIndex >= segmentCount
	)
		return false
	const from = contour.nodes[segmentIndex]
	const to = contour.nodes[(segmentIndex + 1) % contour.nodes.length]
	if (from === undefined || to === undefined) return false
	const selectedNodes = new Set(
		selection.flatMap((target) =>
			target.kind === "node" ? [target.pointId] : [],
		),
	)
	return selectedNodes.has(from.pointId) && selectedNodes.has(to.pointId)
}

export type EditorCanvasHit = EditorControlHit | EditorSegmentHit

const squaredDistance = (
	left: Readonly<{ x: number; y: number }>,
	right: Readonly<{ x: number; y: number }>,
): number => (left.x - right.x) ** 2 + (left.y - right.y) ** 2

export function editorControlHitCandidates(
	contours: readonly EditorCanvasContour[],
): readonly EditorControlHitCandidate[] {
	return contours.flatMap((contour) =>
		contour.nodes.flatMap((node): EditorControlHitCandidate[] => [
			{
				target: { kind: "node", pointId: node.pointId },
				x: node.x,
				y: node.y,
			},
			...(node.incoming === undefined
				? []
				: [
						{
							target: {
								kind: "handle" as const,
								pointId: node.pointId,
								handle: "incoming" as const,
							},
							x: node.x + node.incoming.x,
							y: node.y + node.incoming.y,
						},
					]),
			...(node.outgoing === undefined
				? []
				: [
						{
							target: {
								kind: "handle" as const,
								pointId: node.pointId,
								handle: "outgoing" as const,
							},
							x: node.x + node.outgoing.x,
							y: node.y + node.outgoing.y,
						},
					]),
		]),
	)
}

export function nearestEditorControlHit(
	candidates: readonly EditorControlHitCandidate[],
	pointer: Readonly<{ x: number; y: number }>,
	worldScale: number,
	maxDistancePx = CONTROL_HIT_RADIUS_PX,
): EditorControlHit | null {
	if (!(worldScale > 0) || !(maxDistancePx >= 0)) return null
	const maximumSquared = (maxDistancePx / worldScale) ** 2
	let nearest: EditorControlHitCandidate | null = null
	let nearestSquared = Number.POSITIVE_INFINITY
	let nearestKey = ""
	for (const candidate of candidates) {
		const distance = squaredDistance(candidate, pointer)
		if (distance > maximumSquared) continue
		const key = selectionKey(candidate.target)
		if (
			distance < nearestSquared ||
			(distance === nearestSquared && (nearest === null || key < nearestKey))
		) {
			nearest = candidate
			nearestSquared = distance
			nearestKey = key
		}
	}
	return nearest === null
		? null
		: {
				kind: "control",
				...nearest,
				distancePx: Math.sqrt(nearestSquared) * worldScale,
			}
}

/**
 * Caps each interactive control shape at its nearest-neighbor bisector.
 * Distinct enlarged targets therefore never overlap and cannot shadow one
 * another through Konva draw order. An exact-coincident group gives its stable
 * lowest-key control the group's draggable region and leaves the remaining
 * shapes at zero radius, matching the deterministic stage-level resolver.
 */
export function editorControlHitRadii(
	candidates: readonly EditorControlHitCandidate[],
	worldScale: number,
	maximumRadiusPx = CONTROL_HIT_RADIUS_PX,
): ReadonlyMap<string, number> {
	const radii = new Map<string, number>()
	for (const candidate of candidates) {
		const key = selectionKey(candidate.target)
		const coincidentOwnerKey = candidates.reduce((ownerKey, other) => {
			if (squaredDistance(candidate, other) !== 0) return ownerKey
			const otherKey = selectionKey(other.target)
			return otherKey < ownerKey ? otherKey : ownerKey
		}, key)
		if (key !== coincidentOwnerKey) {
			radii.set(key, 0)
			continue
		}
		let nearestSquared = Number.POSITIVE_INFINITY
		for (const other of candidates) {
			if (other === candidate) continue
			const distance = squaredDistance(candidate, other)
			if (distance > 0) nearestSquared = Math.min(nearestSquared, distance)
		}
		const nearestRadiusPx =
			Math.sqrt(nearestSquared) * Math.max(0, worldScale) * 0.5
		radii.set(key, Math.min(maximumRadiusPx, nearestRadiusPx))
	}
	return radii
}

export function nearestEditorSegmentHit(
	contours: readonly EditorCanvasContour[],
	pointer: Readonly<{ x: number; y: number }>,
	worldScale: number,
	maxDistancePx = SEGMENT_HIT_RADIUS_PX,
): EditorSegmentHit | null {
	if (!(worldScale > 0) || !(maxDistancePx >= 0)) return null
	let nearest: EditorSegmentHit | null = null
	for (const contour of contours) {
		const segment = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (segment === null) continue
		const distancePx = segment.distance * worldScale
		if (distancePx > maxDistancePx) continue
		if (
			nearest === null ||
			distancePx < nearest.distancePx ||
			(distancePx === nearest.distancePx && contour.id < nearest.contourId)
		) {
			nearest = {
				kind: "segment",
				contourId: contour.id,
				segmentIndex: segment.segmentIndex,
				amount: segment.amount,
				distancePx,
			}
		}
	}
	return nearest
}

/** Resolves controls before paths even when the path is geometrically nearer. */
export function resolveEditorCanvasHit(input: {
	readonly controls: readonly EditorControlHitCandidate[]
	readonly contours: readonly EditorCanvasContour[]
	readonly pointer: Readonly<{ x: number; y: number }>
	readonly worldScale: number
}): EditorCanvasHit | null {
	return (
		nearestEditorControlHit(input.controls, input.pointer, input.worldScale) ??
		nearestEditorSegmentHit(input.contours, input.pointer, input.worldScale)
	)
}
