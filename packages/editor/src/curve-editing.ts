import type {
	EditorHandleKind,
	EditorLayerNode,
	EditorNodeMode,
} from "@create-font/states"

import type { EditorToolId } from "./editor-workspace.ts"

export type SegmentPointerAction = "add-handles" | "split"

/** Resolves modifier/tool precedence for an authored segment press. */
export function segmentPointerAction(
	tool: EditorToolId,
	event: Readonly<{ altKey: boolean }>,
): SegmentPointerAction | null {
	if (tool === "pen") return "split"
	return tool === "select" && event.altKey ? "add-handles" : null
}

/** Keeps a modified double-click from also selecting the whole contour. */
export function shouldSelectContourOnSegmentDoubleClick(
	tool: EditorToolId,
	event: Readonly<{ altKey: boolean }>,
): boolean {
	return tool === "select" && !event.altKey
}

export function toggledNodeMode(mode: EditorNodeMode): EditorNodeMode {
	return mode === "soft" ? "hard" : "soft"
}

const magnitude = (vector: Readonly<{ x: number; y: number }>): number =>
	Math.hypot(vector.x, vector.y)

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

/** Quantizes a vector to the nearest cardinal or diagonal ray. */
export function constrainVectorToEightRays(
	vector: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	const length = magnitude(vector)
	if (length === 0) return { x: 0, y: 0 }
	const step = Math.PI / 4
	const angle = Math.atan2(vector.y, vector.x)
	const rayIndex = Math.floor(angle / step + 0.5)
	const octant = ((rayIndex % 8) + 8) % 8
	const diagonal = length / Math.SQRT2
	return (
		[
			{ x: length, y: 0 },
			{ x: diagonal, y: diagonal },
			{ x: 0, y: length },
			{ x: -diagonal, y: diagonal },
			{ x: -length, y: 0 },
			{ x: -diagonal, y: -diagonal },
			{ x: 0, y: -length },
			{ x: diagonal, y: -diagonal },
		] as const
	)[octant]!
}

function oppositeOnSameLine(
	moved: Readonly<{ x: number; y: number }>,
	opposite: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	const movedLength = magnitude(moved)
	const oppositeLength = magnitude(opposite)
	if (movedLength === 0 || oppositeLength === 0) return opposite
	return {
		x: canonicalZero((-moved.x * oppositeLength) / movedLength),
		y: canonicalZero((-moved.y * oppositeLength) / movedLength),
	}
}

function withLengthAlong(
	direction: Readonly<{ x: number; y: number }>,
	length: number,
): Readonly<{ x: number; y: number }> | null {
	const directionLength = magnitude(direction)
	if (directionLength === 0) return null
	return {
		x: canonicalZero((direction.x * length) / directionLength),
		y: canonicalZero((direction.y * length) / directionLength),
	}
}

export interface HandleEditResolution {
	/** Integer coordinate vector written to editor state. */
	readonly storageVector: Readonly<{ x: number; y: number }>
	/** Vector rendered by the canvas after one-sided tangent derivation. */
	readonly previewVector: Readonly<{ x: number; y: number }>
	/** One-sided soft handles are length-only and therefore have no ray guide. */
	readonly constrainedToEightRays: boolean
}

function roundVector(
	vector: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	return {
		x: canonicalZero(Math.round(vector.x)),
		y: canonicalZero(Math.round(vector.y)),
	}
}

/** Rounds a quantized vector without taking it off its cardinal/diagonal ray. */
function roundEightRayVector(
	vector: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
	if (vector.x === 0) return { x: 0, y: canonicalZero(Math.round(vector.y)) }
	if (vector.y === 0) return { x: canonicalZero(Math.round(vector.x)), y: 0 }
	const component = Math.round(Math.max(Math.abs(vector.x), Math.abs(vector.y)))
	return {
		x: canonicalZero(Math.sign(vector.x) * component),
		y: canonicalZero(Math.sign(vector.y) * component),
	}
}

/**
 * Resolves direct and keyboard handle movement without violating soft-node
 * invariants. One-sided soft handles retain their derived tangent and edit only
 * their authored length; all other handles may use the shared eight-ray rule.
 */
export function resolveHandleEdit(
	node: EditorLayerNode,
	handle: EditorHandleKind,
	rawVector: Readonly<{ x: number; y: number }>,
	constrainToEightRays = false,
): HandleEditResolution | null {
	if (!Number.isFinite(rawVector.x) || !Number.isFinite(rawVector.y))
		return null
	const current = node[handle]
	if (current === undefined) return null
	const opposite = handle === "incoming" ? node.outgoing : node.incoming
	if (node.mode === "soft" && opposite === undefined) {
		const aligned = withLengthAlong(current, magnitude(rawVector)) ?? current
		const storageVector = roundVector(aligned)
		return {
			storageVector,
			previewVector:
				withLengthAlong(current, magnitude(storageVector)) ?? storageVector,
			constrainedToEightRays: false,
		}
	}
	const constrained = constrainToEightRays
		? constrainVectorToEightRays(rawVector)
		: rawVector
	const storageVector = constrainToEightRays
		? roundEightRayVector(constrained)
		: roundVector(constrained)
	return {
		storageVector,
		previewVector: storageVector,
		constrainedToEightRays: constrainToEightRays,
	}
}

/** Derives the angle of each one-handle soft node from its handleless side. */
export function deriveOneSidedSoftHandles(
	nodes: readonly EditorLayerNode[],
	closed: boolean,
): readonly EditorLayerNode[] {
	return nodes.map((node, index) => {
		if (node.mode !== "soft") return node
		if (node.incoming !== undefined && node.outgoing === undefined) {
			const next = nodes[index + 1] ?? (closed ? nodes[0] : undefined)
			if (next === undefined) return node
			let tangent = {
				x: next.x + (next.incoming?.x ?? 0),
				y: next.y + (next.incoming?.y ?? 0),
			}
			if (tangent.x === node.x && tangent.y === node.y) {
				tangent = { x: next.x, y: next.y }
			}
			const incoming = withLengthAlong(
				{ x: node.x - tangent.x, y: node.y - tangent.y },
				magnitude(node.incoming),
			)
			return incoming === null ? node : { ...node, incoming }
		}
		if (node.outgoing !== undefined && node.incoming === undefined) {
			const previous = nodes[index - 1] ?? (closed ? nodes.at(-1) : undefined)
			if (previous === undefined) return node
			let tangent = {
				x: previous.x + (previous.outgoing?.x ?? 0),
				y: previous.y + (previous.outgoing?.y ?? 0),
			}
			if (tangent.x === node.x && tangent.y === node.y) {
				tangent = { x: previous.x, y: previous.y }
			}
			const outgoing = withLengthAlong(
				{ x: node.x - tangent.x, y: node.y - tangent.y },
				magnitude(node.outgoing),
			)
			return outgoing === null ? node : { ...node, outgoing }
		}
		return node
	})
}

/** Mirrors the state transaction's soft-handle constraint during a drag. */
export function previewHandleDrag(
	node: EditorLayerNode,
	handle: EditorHandleKind,
	vector: Readonly<{ x: number; y: number }>,
): EditorLayerNode {
	if (handle === "incoming") {
		const incoming =
			node.mode === "soft" &&
			node.outgoing === undefined &&
			node.incoming !== undefined
				? (withLengthAlong(node.incoming, magnitude(vector)) ?? node.incoming)
				: vector
		return {
			...node,
			incoming,
			...(node.mode === "soft" && node.outgoing !== undefined
				? { outgoing: oppositeOnSameLine(incoming, node.outgoing) }
				: {}),
		}
	}
	const outgoing =
		node.mode === "soft" &&
		node.incoming === undefined &&
		node.outgoing !== undefined
			? (withLengthAlong(node.outgoing, magnitude(vector)) ?? node.outgoing)
			: vector
	return {
		...node,
		outgoing,
		...(node.mode === "soft" && node.incoming !== undefined
			? { incoming: oppositeOnSameLine(outgoing, node.incoming) }
			: {}),
	}
}
