import type {
	EditorHandleKind,
	EditorLayerNode,
	GlyphId,
	MasterId,
	PointId,
} from "@create-font/states"

import {
	deriveOneSidedSoftHandles,
	previewHandleDrag,
	resolveHandleEdit,
} from "./curve-editing.ts"
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

export interface TangentDirectionMemory {
	readonly glyphId: GlyphId
	readonly masterId: MasterId
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	readonly anchor: Readonly<{ x: number; y: number }>
	readonly direction: Readonly<{ x: number; y: number }>
}

export interface ControlledSelectionDragPlan {
	readonly result: SelectionTransformResult
	/** The controller's actual movement after its tangent constraint is applied. */
	readonly controllerDelta: Readonly<{ x: number; y: number }>
}

/** Projects pending absolute controls from authored geometry exactly once. */
export function projectSelectionTransformPreview(
	authoredNodes: readonly EditorLayerNode[],
	closed: boolean,
	preview: SelectionTransformResult,
): readonly EditorLayerNode[] {
	const points = new Map(preview.points.map((point) => [point.pointId, point]))
	const handles = new Map(
		preview.handles.map((handle) => [
			`${handle.pointId}/${handle.handle}`,
			handle,
		]),
	)
	const transformed = authoredNodes.map((node) => {
		const point = points.get(node.pointId)
		const x = point?.x ?? node.x
		const y = point?.y ?? node.y
		const incoming = handles.get(`${node.pointId}/incoming`)
		const outgoing = handles.get(`${node.pointId}/outgoing`)
		let next: EditorLayerNode = {
			...node,
			x,
			y,
			...(incoming === undefined
				? {}
				: { incoming: { x: incoming.x - x, y: incoming.y - y } }),
			...(outgoing === undefined
				? {}
				: { outgoing: { x: outgoing.x - x, y: outgoing.y - y } }),
		}
		if (
			next.mode === "soft" &&
			incoming !== undefined &&
			next.incoming !== undefined
		) {
			next = previewHandleDrag(next, "incoming", next.incoming)
		} else if (
			next.mode === "soft" &&
			outgoing !== undefined &&
			next.outgoing !== undefined
		) {
			next = previewHandleDrag(next, "outgoing", next.outgoing)
		}
		return next
	})
	return deriveOneSidedSoftHandles(transformed, closed)
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

/** Reuses a zero-endpoint ray only while its glyph, layer, point, and anchor match. */
export function rememberedTangentDirection(
	memory: TangentDirectionMemory | null,
	scope: Readonly<{ glyphId: GlyphId; masterId: MasterId }>,
	node: EditorLayerNode,
): Readonly<{ x: number; y: number }> | undefined {
	const soleHandle =
		node.incoming !== undefined && node.outgoing === undefined
			? "incoming"
			: node.outgoing !== undefined && node.incoming === undefined
				? "outgoing"
				: null
	if (
		memory === null ||
		memory.glyphId !== scope.glyphId ||
		memory.masterId !== scope.masterId ||
		memory.pointId !== node.pointId ||
		memory.handle !== soleHandle ||
		!samePoint(memory.anchor, node) ||
		!finitePoint(memory.direction) ||
		(memory.direction.x === 0 && memory.direction.y === 0)
	)
		return undefined
	return memory.direction
}

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
	tangentNodes: readonly EditorLayerNode[] = nodes,
): TangentSlideConstraint | null {
	const node = nodes[pointIndex]
	if (node === undefined || node.mode !== "soft") return null
	if (tangentNodes[pointIndex]?.pointId !== node.pointId) return null
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
	const reference = neighborTangentReference(
		tangentNodes,
		pointIndex,
		closed,
		handle,
	)
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

/** Moves one hard node while preserving every authored absolute handle endpoint. */
export function planFixedHandleNodeMove(
	node: EditorLayerNode,
	candidate: Readonly<{ x: number; y: number }>,
): SelectionTransformResult | null {
	if (node.mode !== "hard" || !finitePoint(candidate)) return null
	const handles = (["incoming", "outgoing"] as const).flatMap((handle) => {
		const endpoint = absoluteHandle(node, handle)
		return endpoint === null
			? []
			: [{ pointId: node.pointId, handle, ...endpoint }]
	})
	if (handles.length === 0 || handles.some((handle) => !finitePoint(handle)))
		return null
	return {
		points: [{ pointId: node.pointId, x: candidate.x, y: candidate.y }],
		handles,
	}
}

const projectToLine = (
	candidate: Readonly<{ x: number; y: number }>,
	anchor: Readonly<{ x: number; y: number }>,
	direction: Readonly<{ x: number; y: number }>,
	minimum: number | null,
	maximum: number | null,
): Readonly<{ x: number; y: number }> | null => {
	const denominator = direction.x ** 2 + direction.y ** 2
	if (
		!finitePoint(candidate) ||
		!Number.isFinite(denominator) ||
		denominator === 0
	)
		return null
	let amount =
		((candidate.x - anchor.x) * direction.x +
			(candidate.y - anchor.y) * direction.y) /
		denominator
	if (minimum !== null) amount = Math.max(minimum, amount)
	if (maximum !== null) amount = Math.min(maximum, amount)
	return {
		x: anchor.x + direction.x * amount,
		y: anchor.y + direction.y * amount,
	}
}

/**
 * Plans an Alt/Option drag that starts from one selected node. The controller's
 * constrained displacement is mapped to every selected node, then each soft
 * node resolves that candidate against its own tangent. Unselected authored
 * endpoints are included in the result so preview and the atomic state commit
 * share exactly the same geometry.
 */
export function planControlledSelectionDrag(
	contours: readonly Readonly<{
		closed: boolean
		nodes: readonly EditorLayerNode[]
		tangentNodes?: readonly EditorLayerNode[]
	}>[],
	selection: readonly EditorSelectionTarget[],
	controllerPointId: PointId,
	rawDelta: Readonly<{ x: number; y: number }>,
): ControlledSelectionDragPlan | null {
	if (!finitePoint(rawDelta)) return null
	const nodes = contours.flatMap((contour) => contour.nodes)
	const byId = new Map(nodes.map((node) => [node.pointId, node]))
	const controller = byId.get(controllerPointId)
	if (controller === undefined) return null
	const selected = new Set(selection.map(selectionKey))
	if (!selected.has(`node/${controllerPointId}`)) return null

	const locate = (pointId: PointId) => {
		for (const contour of contours) {
			const index = contour.nodes.findIndex((node) => node.pointId === pointId)
			if (index !== -1) return { contour, index }
		}
		return null
	}
	const endpoint = (node: EditorLayerNode, handle: EditorHandleKind) => {
		const vector = node[handle]
		return vector === undefined
			? null
			: { x: node.x + vector.x, y: node.y + vector.y }
	}
	const selectedHandles = (node: EditorLayerNode) =>
		(["incoming", "outgoing"] as const).filter(
			(handle) =>
				node[handle] !== undefined &&
				selected.has(`handle/${node.pointId}/${handle}`),
		)
	const resolveSoftPosition = (
		node: EditorLayerNode,
		candidate: Readonly<{ x: number; y: number }>,
	): Readonly<{ x: number; y: number }> | null => {
		const location = locate(node.pointId)
		if (location === null) return null
		const authoredHandles = (["incoming", "outgoing"] as const).filter(
			(handle) => node[handle] !== undefined,
		)
		const moving = selectedHandles(node)
		if (moving.length === 0) {
			const constraint = tangentSlideConstraint(
				location.contour.nodes,
				location.index,
				location.contour.closed,
				undefined,
				location.contour.tangentNodes,
			)
			return constraint === null
				? null
				: (resolveTangentSlide(constraint, candidate)?.points[0] ?? null)
		}
		const fixed = authoredHandles.find((handle) => !moving.includes(handle))
		if (fixed !== undefined) {
			const anchor = endpoint(node, fixed)
			if (anchor === null) return null
			return projectToLine(
				candidate,
				anchor,
				{ x: node.x - anchor.x, y: node.y - anchor.y },
				0,
				null,
			)
		}
		const authored = authoredHandles
			.map((handle) => endpoint(node, handle))
			.find((value) => value !== null)
		if (authored === undefined) return null
		return projectToLine(
			candidate,
			{ x: node.x, y: node.y },
			{ x: node.x - authored.x, y: node.y - authored.y },
			null,
			null,
		)
	}
	const controllerCandidate = {
		x: controller.x + rawDelta.x,
		y: controller.y + rawDelta.y,
	}
	const controllerPosition =
		controller.mode === "soft"
			? resolveSoftPosition(controller, controllerCandidate)
			: controllerCandidate
	if (controllerPosition === null) return null
	const controllerDelta = {
		x: controllerPosition.x - controller.x,
		y: controllerPosition.y - controller.y,
	}

	const points: SelectionTransformResult["points"][number][] = []
	const handles: SelectionTransformResult["handles"][number][] = []
	for (const node of nodes) {
		if (!selected.has(`node/${node.pointId}`)) continue
		const candidate = {
			x: node.x + controllerDelta.x,
			y: node.y + controllerDelta.y,
		}
		const position =
			node.mode === "soft" ? resolveSoftPosition(node, candidate) : candidate
		if (position === null) return null
		points.push({ pointId: node.pointId, ...position })
		const delta = { x: position.x - node.x, y: position.y - node.y }
		const moving = selectedHandles(node)
		for (const handle of ["incoming", "outgoing"] as const) {
			const original = endpoint(node, handle)
			if (original === null) continue
			if (moving.includes(handle)) {
				if (node.mode === "soft" && moving.length === 1) {
					const oppositeKind = handle === "incoming" ? "outgoing" : "incoming"
					const opposite = endpoint(node, oppositeKind)
					if (opposite !== null) {
						const length = Math.hypot(original.x - node.x, original.y - node.y)
						const away = {
							x: position.x - opposite.x,
							y: position.y - opposite.y,
						}
						const magnitude = Math.hypot(away.x, away.y)
						if (magnitude === 0) return null
						handles.push({
							pointId: node.pointId,
							handle,
							x: position.x + (away.x / magnitude) * length,
							y: position.y + (away.y / magnitude) * length,
						})
						continue
					}
				}
				handles.push({
					pointId: node.pointId,
					handle,
					x: original.x + delta.x,
					y: original.y + delta.y,
				})
			} else {
				handles.push({ pointId: node.pointId, handle, ...original })
			}
		}
	}
	if (points.length < 2) return null
	return { result: { points, handles }, controllerDelta }
}

/** Selects fixed-handle nudging only for one hard node and no handle controls. */
export function planSelectedHardNodeNudge(
	nodes: readonly EditorLayerNode[],
	selection: readonly EditorSelectionTarget[],
	deltaX: number,
	deltaY: number,
): SelectionTransformResult | null {
	if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null
	const unique = new Map(
		selection.map((target) => [selectionKey(target), target]),
	)
	if (unique.size !== 1) return null
	const target = unique.values().next().value
	if (target?.kind !== "node") return null
	const node = nodes.find((candidate) => candidate.pointId === target.pointId)
	return node === undefined
		? null
		: planFixedHandleNodeMove(node, {
				x: node.x + deltaX,
				y: node.y + deltaY,
			})
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
		tangentNodes?: readonly EditorLayerNode[]
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
					contour.tangentNodes,
				),
			}
		}
	}
	return null
}
