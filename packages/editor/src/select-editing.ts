import type {
	EditorHandleKind,
	EditorLayerNode,
	PointId,
} from "@create-font/states"

import { resolveHandleEdit } from "./curve-editing.ts"
import {
	resolveSelectionControls,
	selectionForRigidTranslation,
	selectionKey,
	type EditorSelectionTarget,
	type SelectionTransformResult,
} from "./outline-selection.ts"

export interface TangentSlideConstraint {
	readonly pointId: PointId
	readonly origin: Readonly<{ x: number; y: number }>
	readonly handles: readonly {
		readonly handle: EditorHandleKind
		readonly x: number
		readonly y: number
	}[]
	readonly start: Readonly<{ x: number; y: number }>
	readonly end: Readonly<{ x: number; y: number }> | null
	/** For an unbounded endpoint, motion starts here and follows `direction`. */
	readonly direction: Readonly<{ x: number; y: number }> | null
}

export interface TangentSlideResolution extends SelectionTransformResult {
	readonly constraint: TangentSlideConstraint
}

export interface TangentSlideSelection {
	readonly pointId: PointId
	/** Null means the selection is eligible but its tangent is currently degenerate. */
	readonly constraint: TangentSlideConstraint | null
}

const finitePoint = (point: Readonly<{ x: number; y: number }>): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y)

/** Prevents an unrelated pointer from cancelling the active direct gesture. */
export const directDragOwnsPointer = (
	dragPointerId: number | null,
	eventPointerId: number,
): boolean => dragPointerId === eventPointerId

const samePoint = (
	left: Readonly<{ x: number; y: number }>,
	right: Readonly<{ x: number; y: number }>,
): boolean => left.x === right.x && left.y === right.y

const absoluteHandle = (
	node: EditorLayerNode,
	handle: EditorHandleKind,
): Readonly<{ x: number; y: number }> | null => {
	const vector = node[handle]
	return vector === undefined
		? null
		: { x: node.x + vector.x, y: node.y + vector.y }
}

function neighborTangentReference(
	nodes: readonly EditorLayerNode[],
	index: number,
	closed: boolean,
	handle: EditorHandleKind,
): Readonly<{ x: number; y: number }> | null {
	const node = nodes[index]
	if (node === undefined) return null
	const neighbor =
		handle === "incoming"
			? (nodes[index + 1] ?? (closed ? nodes[0] : undefined))
			: (nodes[index - 1] ?? (closed ? nodes.at(-1) : undefined))
	if (neighbor === undefined) return null
	const neighborHandle =
		handle === "incoming" ? neighbor.incoming : neighbor.outgoing
	let reference = {
		x: neighbor.x + (neighborHandle?.x ?? 0),
		y: neighbor.y + (neighborHandle?.y ?? 0),
	}
	if (samePoint(reference, node)) {
		reference = { x: neighbor.x, y: neighbor.y }
	}
	return samePoint(reference, node) ? null : reference
}

/** Captures the immutable endpoint/range geometry for a soft-node slide. */
export function tangentSlideConstraint(
	nodes: readonly EditorLayerNode[],
	pointIndex: number,
	closed: boolean,
	unboundedDirection?: Readonly<{ x: number; y: number }>,
): TangentSlideConstraint | null {
	const node = nodes[pointIndex]
	if (node === undefined || node.mode !== "soft") return null
	const incoming = absoluteHandle(node, "incoming")
	const outgoing = absoluteHandle(node, "outgoing")
	if (incoming === null && outgoing === null) return null
	const handles = [
		...(incoming === null
			? []
			: [{ handle: "incoming" as const, ...incoming }]),
		...(outgoing === null
			? []
			: [{ handle: "outgoing" as const, ...outgoing }]),
	]
	if (incoming !== null && outgoing !== null) {
		if (samePoint(incoming, outgoing)) return null
		return {
			pointId: node.pointId,
			origin: { x: node.x, y: node.y },
			handles,
			start: incoming,
			end: outgoing,
			direction: null,
		}
	}
	const authored = incoming ?? outgoing
	if (authored === null) return null
	const handle = incoming === null ? "outgoing" : "incoming"
	const reference = neighborTangentReference(nodes, pointIndex, closed, handle)
	if (reference !== null && !samePoint(reference, authored)) {
		return {
			pointId: node.pointId,
			origin: { x: node.x, y: node.y },
			handles,
			start: authored,
			end: reference,
			direction: null,
		}
	}
	const direction = samePoint(authored, node)
		? unboundedDirection
		: { x: node.x - authored.x, y: node.y - authored.y }
	if (
		direction === undefined ||
		!finitePoint(direction) ||
		(direction.x === 0 && direction.y === 0)
	)
		return null
	return {
		pointId: node.pointId,
		origin: { x: node.x, y: node.y },
		handles,
		start: authored,
		end: null,
		direction,
	}
}

/** Projects a raw candidate onto a bounded tangent segment or endpoint ray. */
export function resolveTangentSlide(
	constraint: TangentSlideConstraint,
	candidate: Readonly<{ x: number; y: number }>,
): TangentSlideResolution | null {
	if (!finitePoint(candidate)) return null
	const direction =
		constraint.end === null
			? constraint.direction
			: {
					x: constraint.end.x - constraint.start.x,
					y: constraint.end.y - constraint.start.y,
				}
	if (direction === null) return null
	const denominator = direction.x ** 2 + direction.y ** 2
	if (!Number.isFinite(denominator) || denominator === 0) return null
	const rawAmount =
		((candidate.x - constraint.start.x) * direction.x +
			(candidate.y - constraint.start.y) * direction.y) /
		denominator
	const amount =
		constraint.end === null
			? Math.max(0, rawAmount)
			: Math.max(0, Math.min(1, rawAmount))
	const point = {
		pointId: constraint.pointId,
		x: constraint.start.x + direction.x * amount,
		y: constraint.start.y + direction.y * amount,
	}
	return {
		constraint,
		points: [point],
		handles: constraint.handles.map((handle) => ({
			pointId: constraint.pointId,
			...handle,
		})),
	}
}

export interface SelectionNudgePlan {
	readonly selection: readonly EditorSelectionTarget[]
	readonly result: SelectionTransformResult
}

/** Plans one atomic node/handle keyboard translation. */
export function planSelectionNudge(
	nodes: readonly EditorLayerNode[],
	selection: readonly EditorSelectionTarget[],
	deltaX: number,
	deltaY: number,
): SelectionNudgePlan | null {
	if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null
	const deduplicated = [
		...new Map(
			selection.map((target) => [selectionKey(target), target]),
		).values(),
	].sort((left, right) => selectionKey(left).localeCompare(selectionKey(right)))
	const rigidSelection = [
		...new Map(
			selectionForRigidTranslation(nodes, deduplicated).map((target) => [
				selectionKey(target),
				target,
			]),
		).values(),
	].sort((left, right) => selectionKey(left).localeCompare(selectionKey(right)))
	const controls = resolveSelectionControls(nodes, rigidSelection)
	const expectedKeys = new Set(rigidSelection.map(selectionKey))
	if (controls.length === 0 || controls.length !== expectedKeys.size)
		return null
	const byId = new Map(nodes.map((node) => [node.pointId, node]))
	const selectedNodes = new Set(
		controls
			.filter((control) => control.target.kind === "node")
			.map((control) => control.target.pointId),
	)
	const points: SelectionTransformResult["points"][number][] = []
	const handles: SelectionTransformResult["handles"][number][] = []
	for (const control of controls) {
		if (control.target.kind === "node") {
			points.push({
				pointId: control.target.pointId,
				x: control.x + deltaX,
				y: control.y + deltaY,
			})
			continue
		}
		const node = byId.get(control.target.pointId)
		if (node === undefined) return null
		if (selectedNodes.has(node.pointId)) {
			handles.push({
				pointId: node.pointId,
				handle: control.target.handle,
				x: control.x + deltaX,
				y: control.y + deltaY,
			})
			continue
		}
		const resolved = resolveHandleEdit(node, control.target.handle, {
			x: control.x + deltaX - node.x,
			y: control.y + deltaY - node.y,
		})
		if (resolved === null) return null
		handles.push({
			pointId: node.pointId,
			handle: control.target.handle,
			x: node.x + resolved.storageVector.x,
			y: node.y + resolved.storageVector.y,
		})
	}
	return { selection: rigidSelection, result: { points, handles } }
}

/** Selects the tangent-slide path only for one node and no handle controls. */
export function selectedTangentSlideConstraint(
	contours: readonly Readonly<{
		closed: boolean
		nodes: readonly EditorLayerNode[]
	}>[],
	selection: readonly EditorSelectionTarget[],
	unboundedDirection?: Readonly<{ pointId: PointId; x: number; y: number }>,
): TangentSlideSelection | null {
	const unique = new Map(
		selection.map((target) => [selectionKey(target), target]),
	)
	if (unique.size !== 1) return null
	const target = unique.values().next().value
	if (target?.kind !== "node") return null
	for (const contour of contours) {
		const index = contour.nodes.findIndex(
			(node) => node.pointId === target.pointId,
		)
		if (index !== -1) {
			const node = contour.nodes[index]
			if (
				node === undefined ||
				node.mode !== "soft" ||
				(node.incoming === undefined && node.outgoing === undefined)
			)
				return null
			return {
				pointId: node.pointId,
				constraint: tangentSlideConstraint(
					contour.nodes,
					index,
					contour.closed,
					unboundedDirection?.pointId === node.pointId
						? unboundedDirection
						: undefined,
				),
			}
		}
	}
	return null
}
