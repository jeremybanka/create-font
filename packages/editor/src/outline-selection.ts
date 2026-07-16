import type {
	EditorHandleKind,
	EditorLayerNode,
	PointId,
} from "@create-font/states"

export type EditorSelectionTarget =
	| { readonly kind: "node"; readonly pointId: PointId }
	| {
			readonly kind: "handle"
			readonly pointId: PointId
			readonly handle: EditorHandleKind
	  }

export interface SelectionBounds {
	readonly minX: number
	readonly minY: number
	readonly maxX: number
	readonly maxY: number
}

export const selectionKey = (target: EditorSelectionTarget): string =>
	target.kind === "node"
		? `node/${target.pointId}`
		: `handle/${target.pointId}/${target.handle}`

export const canStartBoxSelectionOn = (targetName: string): boolean =>
	targetName === "canvas-background" || targetName === "typed-glyph"

/** Returns every visible node or handle endpoint enclosed by a marquee. */
export function controlsInsideBounds(
	nodes: readonly EditorLayerNode[],
	bounds: SelectionBounds,
): readonly EditorSelectionTarget[] {
	const inside = (x: number, y: number): boolean =>
		x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
	const targets: EditorSelectionTarget[] = []
	for (const point of nodes) {
		if (inside(point.x, point.y)) {
			targets.push({ kind: "node", pointId: point.pointId })
		}
		if (
			point.incoming !== undefined &&
			inside(point.x + point.incoming.x, point.y + point.incoming.y)
		) {
			targets.push({
				kind: "handle",
				pointId: point.pointId,
				handle: "incoming",
			})
		}
		if (
			point.outgoing !== undefined &&
			inside(point.x + point.outgoing.x, point.y + point.outgoing.y)
		) {
			targets.push({
				kind: "handle",
				pointId: point.pointId,
				handle: "outgoing",
			})
		}
	}
	return targets
}
