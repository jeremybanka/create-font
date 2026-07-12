import type { EditorHandleKind, EditorLayerNode } from "@trigraph/states"

const magnitude = (vector: Readonly<{ x: number; y: number }>): number =>
	Math.hypot(vector.x, vector.y)

const canonicalZero = (value: number): number =>
	Object.is(value, -0) ? 0 : value

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

/** Mirrors the state transaction's soft-handle constraint during a drag. */
export function previewHandleDrag(
	node: EditorLayerNode,
	handle: EditorHandleKind,
	vector: Readonly<{ x: number; y: number }>,
): EditorLayerNode {
	if (handle === "incoming") {
		return {
			...node,
			incoming: vector,
			...(node.mode === "soft" && node.outgoing !== undefined
				? { outgoing: oppositeOnSameLine(vector, node.outgoing) }
				: {}),
		}
	}
	return {
		...node,
		outgoing: vector,
		...(node.mode === "soft" && node.incoming !== undefined
			? { incoming: oppositeOnSameLine(vector, node.incoming) }
			: {}),
	}
}
