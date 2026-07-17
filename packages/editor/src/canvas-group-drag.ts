export interface GroupDragPositionTarget {
	position(position: Readonly<{ x: number; y: number }>): unknown
}

export interface CancelledGroupDrag<
	Target extends GroupDragPositionTarget = GroupDragPositionTarget,
> {
	readonly target: Target
	readonly x: number
	readonly y: number
}

/** Keeps a cancelled live canvas target at its pre-drag position. */
export function restoreCancelledGroupDragTarget(
	cancellation: CancelledGroupDrag,
	target: GroupDragPositionTarget,
): boolean {
	if (cancellation.target !== target) return false
	target.position({ x: cancellation.x, y: cancellation.y })
	return true
}
