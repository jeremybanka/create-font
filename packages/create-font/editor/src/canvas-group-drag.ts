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

export interface GroupDragPreview<Target extends GroupDragPositionTarget> {
	readonly targetX: number
	readonly targetY: number
	readonly node: Target
	lastRawDelta: Readonly<{ x: number; y: number }> | null
	joinCandidate: unknown | null
}

/** Recognizes native cancellation events that Konva may forward as dragend. */
export function isCancelledGroupDragEnd(event: unknown): boolean {
	if (typeof event !== "object" || event === null || !("type" in event))
		return false
	const type = event.type
	return typeof type === "string" && type.toLowerCase().endsWith("cancel")
}

/** Clears a group preview and optionally restores its live Konva target. */
export function finalizeGroupDragPreview(
	drag: GroupDragPreview<GroupDragPositionTarget>,
	restoreTarget: boolean,
): void {
	if (restoreTarget) drag.node.position({ x: drag.targetX, y: drag.targetY })
	drag.lastRawDelta = null
	drag.joinCandidate = null
}
