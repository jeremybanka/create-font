import type {
	VectorContour,
	VectorHandleKind,
	VectorNode,
	VectorPoint,
} from "./vector-editing.ts"

export interface VectorControlSelection {
	readonly nodes: ReadonlySet<string>
	readonly handles: ReadonlySet<string>
}

export interface VectorControlEditPlan {
	readonly contours: readonly VectorContour[]
	readonly controllerDelta?: VectorPoint
}

export const vectorHandleSelectionKey = (
	pointId: string,
	handle: VectorHandleKind,
): string => `${pointId}\0${handle}`

const finitePoint = (point: VectorPoint): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y)

const samePoint = (left: VectorPoint, right: VectorPoint): boolean =>
	left.x === right.x && left.y === right.y

const magnitude = (point: VectorPoint): number => Math.hypot(point.x, point.y)

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

const withLengthAlong = (
	direction: VectorPoint,
	length: number,
): VectorPoint | null => {
	const directionLength = magnitude(direction)
	if (directionLength === 0 || !Number.isFinite(length)) return null
	return {
		x: canonicalZero((direction.x * length) / directionLength),
		y: canonicalZero((direction.y * length) / directionLength),
	}
}

const oppositeOnSameLine = (
	moved: VectorPoint,
	opposite: VectorPoint,
): VectorPoint => {
	const movedLength = magnitude(moved)
	const oppositeLength = magnitude(opposite)
	if (movedLength === 0 || oppositeLength === 0) return opposite
	return {
		x: canonicalZero((-moved.x * oppositeLength) / movedLength),
		y: canonicalZero((-moved.y * oppositeLength) / movedLength),
	}
}

const absoluteHandle = (
	node: VectorNode,
	handle: VectorHandleKind,
): VectorPoint | null => {
	const vector = node[handle]
	return vector === undefined
		? null
		: { x: node.x + vector.x, y: node.y + vector.y }
}

/**
 * Moves one authored handle vector while preserving the node-mode invariant.
 * A two-sided soft node keeps its opposite handle on the opposite ray and at
 * its previous length. A one-sided soft handle remains on its authored ray and
 * uses pointer travel only to change length.
 */
export function editVectorHandle(
	node: VectorNode,
	handle: VectorHandleKind,
	rawVector: VectorPoint,
): VectorNode | null {
	if (!finitePoint(rawVector) || node[handle] === undefined) return null
	if (node.mode === "hard") return { ...node, [handle]: rawVector }
	const oppositeKind = handle === "incoming" ? "outgoing" : "incoming"
	const opposite = node[oppositeKind]
	if (opposite === undefined) {
		const current = node[handle]!
		const vector =
			withLengthAlong(current, magnitude(rawVector)) ??
			(rawVector.x === 0 && rawVector.y === 0 ? current : rawVector)
		return { ...node, [handle]: vector }
	}
	return {
		...node,
		[handle]: rawVector,
		[oppositeKind]: oppositeOnSameLine(rawVector, opposite),
	}
}

const selectedHandles = (
	node: VectorNode,
	selection: VectorControlSelection,
): readonly VectorHandleKind[] =>
	(["incoming", "outgoing"] as const).filter(
		(handle) =>
			node[handle] !== undefined &&
			selection.handles.has(vectorHandleSelectionKey(node.id, handle)),
	)

/**
 * Rigidly translates selected nodes and independently edits selected handles.
 * Selecting both handles of a soft node implicitly translates their owner so
 * the three controls remain a valid rigid soft-node unit.
 */
export function translateVectorControls(
	contours: readonly VectorContour[],
	selection: VectorControlSelection,
	delta: VectorPoint,
): VectorControlEditPlan | null {
	if (!finitePoint(delta)) return null
	let changed = false
	const nextContours = contours.map((contour) => {
		let contourChanged = false
		const nodes = contour.nodes.map((node) => {
			const nodeSelected = selection.nodes.has(node.id)
			const handles = selectedHandles(node, selection)
			const implicitSoftOwner =
				!nodeSelected &&
				node.mode === "soft" &&
				node.incoming !== undefined &&
				node.outgoing !== undefined &&
				handles.length === 2
			if (nodeSelected || implicitSoftOwner) {
				contourChanged = true
				return { ...node, x: node.x + delta.x, y: node.y + delta.y }
			}
			let edited = node
			for (const handle of handles) {
				const current = edited[handle]
				if (current === undefined) return node
				const resolved = editVectorHandle(edited, handle, {
					x: current.x + delta.x,
					y: current.y + delta.y,
				})
				if (resolved === null) return node
				edited = resolved
			}
			if (edited !== node) contourChanged = true
			return edited
		})
		if (!contourChanged) return contour
		changed = true
		return { ...contour, nodes }
	})
	return changed ? { contours: nextContours } : null
}

interface TangentConstraint {
	readonly start: VectorPoint
	readonly end: VectorPoint | null
	readonly direction: VectorPoint | null
}

const neighborTangentReference = (
	contour: VectorContour,
	index: number,
	handle: VectorHandleKind,
): VectorPoint | null => {
	const node = contour.nodes[index]
	if (node === undefined) return null
	const neighbor =
		handle === "incoming"
			? (contour.nodes[index + 1] ??
				(contour.closed ? contour.nodes[0] : undefined))
			: (contour.nodes[index - 1] ??
				(contour.closed ? contour.nodes.at(-1) : undefined))
	if (neighbor === undefined) return null
	const neighborHandle =
		handle === "incoming" ? neighbor.incoming : neighbor.outgoing
	let reference = {
		x: neighbor.x + (neighborHandle?.x ?? 0),
		y: neighbor.y + (neighborHandle?.y ?? 0),
	}
	if (samePoint(reference, node)) reference = { x: neighbor.x, y: neighbor.y }
	return samePoint(reference, node) ? null : reference
}

const tangentConstraint = (
	contour: VectorContour,
	index: number,
): TangentConstraint | null => {
	const node = contour.nodes[index]
	if (node === undefined || node.mode !== "soft") return null
	const incoming = absoluteHandle(node, "incoming")
	const outgoing = absoluteHandle(node, "outgoing")
	if (incoming !== null && outgoing !== null) {
		if (samePoint(incoming, outgoing)) return null
		return { start: incoming, end: outgoing, direction: null }
	}
	const authored = incoming ?? outgoing
	if (authored === null) return null
	const handle = incoming === null ? "outgoing" : "incoming"
	const reference = neighborTangentReference(contour, index, handle)
	if (reference !== null && !samePoint(reference, authored))
		return { start: authored, end: reference, direction: null }
	const direction = { x: node.x - authored.x, y: node.y - authored.y }
	return direction.x === 0 && direction.y === 0
		? null
		: { start: authored, end: null, direction }
}

const projectToLine = (
	candidate: VectorPoint,
	anchor: VectorPoint,
	direction: VectorPoint,
	minimum: number | null,
	maximum: number | null,
): VectorPoint | null => {
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

const projectToConstraint = (
	constraint: TangentConstraint,
	candidate: VectorPoint,
): VectorPoint | null => {
	const direction =
		constraint.end === null
			? constraint.direction
			: {
					x: constraint.end.x - constraint.start.x,
					y: constraint.end.y - constraint.start.y,
				}
	return direction === null
		? null
		: projectToLine(
				candidate,
				constraint.start,
				direction,
				0,
				constraint.end === null ? null : 1,
			)
}

const locateNode = (
	contours: readonly VectorContour[],
	pointId: string,
): Readonly<{
	contour: VectorContour
	index: number
	node: VectorNode
}> | null => {
	for (const contour of contours) {
		const index = contour.nodes.findIndex(({ id }) => id === pointId)
		const node = contour.nodes[index]
		if (node !== undefined) return { contour, index, node }
	}
	return null
}

const resolveSoftPosition = (
	contours: readonly VectorContour[],
	selection: VectorControlSelection,
	node: VectorNode,
	candidate: VectorPoint,
): VectorPoint | null => {
	const located = locateNode(contours, node.id)
	if (located === null) return null
	const authoredHandles = (["incoming", "outgoing"] as const).filter(
		(handle) => node[handle] !== undefined,
	)
	const moving = selectedHandles(node, selection)
	if (moving.length === 0) {
		const constraint = tangentConstraint(located.contour, located.index)
		return constraint === null
			? null
			: projectToConstraint(constraint, candidate)
	}
	const fixed = authoredHandles.find((handle) => !moving.includes(handle))
	if (fixed !== undefined) {
		const anchor = absoluteHandle(node, fixed)
		if (anchor === null) return null
		const fixedDirection = { x: node.x - anchor.x, y: node.y - anchor.y }
		const movingEndpoint = absoluteHandle(node, moving[0]!)
		const direction =
			fixedDirection.x !== 0 || fixedDirection.y !== 0
				? fixedDirection
				: movingEndpoint !== null && !samePoint(movingEndpoint, node)
					? {
							x: movingEndpoint.x - node.x,
							y: movingEndpoint.y - node.y,
						}
					: null
		return direction === null
			? null
			: projectToLine(candidate, anchor, direction, 0, null)
	}
	const authored = authoredHandles
		.map((handle) => absoluteHandle(node, handle))
		.find(
			(value): value is VectorPoint =>
				value !== null && !samePoint(value, node),
		)
	if (authored === undefined) return null
	return projectToLine(
		candidate,
		node,
		{ x: node.x - authored.x, y: node.y - authored.y },
		null,
		null,
	)
}

/**
 * Plans Alt/Option node dragging from immutable authored geometry. The node
 * where the drag began controls the effective displacement. Hard nodes keep
 * unselected absolute handle endpoints fixed; soft nodes resolve along their
 * tangents, and explicitly selected handles travel with their owners.
 */
export function dragVectorControlsWithFixedHandles(
	contours: readonly VectorContour[],
	selection: VectorControlSelection,
	controllerPointId: string,
	rawDelta: VectorPoint,
): VectorControlEditPlan | null {
	if (!finitePoint(rawDelta) || !selection.nodes.has(controllerPointId))
		return null
	const controller = locateNode(contours, controllerPointId)?.node
	if (controller === undefined) return null
	const controllerCandidate = {
		x: controller.x + rawDelta.x,
		y: controller.y + rawDelta.y,
	}
	const controllerPosition =
		controller.mode === "soft"
			? resolveSoftPosition(
					contours,
					selection,
					controller,
					controllerCandidate,
				)
			: controllerCandidate
	if (controllerPosition === null) return null
	const controllerDelta = {
		x: controllerPosition.x - controller.x,
		y: controllerPosition.y - controller.y,
	}
	const positions = new Map<string, VectorPoint>()
	const endpoints = new Map<string, VectorPoint>()
	for (const contour of contours) {
		for (const node of contour.nodes) {
			if (!selection.nodes.has(node.id)) continue
			const candidate = {
				x: node.x + controllerDelta.x,
				y: node.y + controllerDelta.y,
			}
			const position =
				node.mode === "soft"
					? resolveSoftPosition(contours, selection, node, candidate)
					: candidate
			if (position === null) return null
			positions.set(node.id, position)
			const delta = { x: position.x - node.x, y: position.y - node.y }
			const moving = selectedHandles(node, selection)
			for (const handle of ["incoming", "outgoing"] as const) {
				const original = absoluteHandle(node, handle)
				if (original === null) continue
				let endpoint = original
				if (moving.includes(handle)) {
					if (node.mode === "soft" && moving.length === 1) {
						const oppositeKind = handle === "incoming" ? "outgoing" : "incoming"
						const opposite = absoluteHandle(node, oppositeKind)
						if (opposite !== null) {
							const length = magnitude({
								x: original.x - node.x,
								y: original.y - node.y,
							})
							const away = {
								x: position.x - opposite.x,
								y: position.y - opposite.y,
							}
							const resolved = withLengthAlong(away, length)
							endpoint =
								resolved === null
									? original
									: {
											x: position.x + resolved.x,
											y: position.y + resolved.y,
										}
						} else
							endpoint = { x: original.x + delta.x, y: original.y + delta.y }
					} else endpoint = { x: original.x + delta.x, y: original.y + delta.y }
				}
				endpoints.set(vectorHandleSelectionKey(node.id, handle), endpoint)
			}
		}
	}
	if (positions.size === 0) return null
	const nextContours = contours.map((contour) => ({
		...contour,
		nodes: contour.nodes.map((node) => {
			const position = positions.get(node.id)
			if (position === undefined) return node
			const incoming = endpoints.get(
				vectorHandleSelectionKey(node.id, "incoming"),
			)
			const outgoing = endpoints.get(
				vectorHandleSelectionKey(node.id, "outgoing"),
			)
			return {
				...node,
				...position,
				...(incoming === undefined
					? {}
					: {
							incoming: {
								x: incoming.x - position.x,
								y: incoming.y - position.y,
							},
						}),
				...(outgoing === undefined
					? {}
					: {
							outgoing: {
								x: outgoing.x - position.x,
								y: outgoing.y - position.y,
							},
						}),
			}
		}),
	}))
	return { contours: nextContours, controllerDelta }
}
