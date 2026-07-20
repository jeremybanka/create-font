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

export interface ResolvedSelectionControl {
	readonly target: EditorSelectionTarget
	readonly x: number
	readonly y: number
}

export interface SelectionTransformResult {
	readonly points: readonly {
		readonly pointId: PointId
		readonly x: number
		readonly y: number
	}[]
	/** Final absolute handle endpoint positions, not relative vectors. */
	readonly handles: readonly {
		readonly pointId: PointId
		readonly handle: EditorHandleKind
		readonly x: number
		readonly y: number
	}[]
}

export interface SelectionScale {
	readonly anchorX: number
	readonly anchorY: number
	readonly scaleX: number
	readonly scaleY: number
}

export const SELECTION_ORIGINS = [
	"top-left",
	"top-center",
	"top-right",
	"middle-left",
	"center",
	"middle-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
] as const

export type SelectionOrigin = (typeof SELECTION_ORIGINS)[number]

export interface SelectionOriginPosition {
	readonly x: number
	readonly y: number
}

const SELECTION_ORIGIN_FACTORS: Readonly<
	Record<SelectionOrigin, SelectionOriginPosition>
> = {
	"top-left": { x: 0, y: 1 },
	"top-center": { x: 0.5, y: 1 },
	"top-right": { x: 1, y: 1 },
	"middle-left": { x: 0, y: 0.5 },
	center: { x: 0.5, y: 0.5 },
	"middle-right": { x: 1, y: 0.5 },
	"bottom-left": { x: 0, y: 0 },
	"bottom-center": { x: 0.5, y: 0 },
	"bottom-right": { x: 1, y: 0 },
}

export function selectionOriginPosition(
	bounds: SelectionBounds,
	origin: SelectionOrigin,
): SelectionOriginPosition {
	const factor = SELECTION_ORIGIN_FACTORS[origin]
	return {
		x: bounds.minX + (bounds.maxX - bounds.minX) * factor.x,
		y: bounds.minY + (bounds.maxY - bounds.minY) * factor.y,
	}
}

export function selectionScaleForDimension(
	bounds: SelectionBounds,
	origin: SelectionOrigin,
	dimension: "width" | "height",
	nextDimension: number,
	constrainProportions = false,
): SelectionScale | null {
	if (!Number.isFinite(nextDimension) || nextDimension < 0) return null
	const width = bounds.maxX - bounds.minX
	const height = bounds.maxY - bounds.minY
	const sourceDimension = dimension === "width" ? width : height
	if (sourceDimension === 0) return null
	if (constrainProportions && (width === 0 || height === 0)) return null
	const anchor = selectionOriginPosition(bounds, origin)
	const factor = nextDimension / sourceDimension
	return {
		anchorX: anchor.x,
		anchorY: anchor.y,
		scaleX: constrainProportions || dimension === "width" ? factor : 1,
		scaleY: constrainProportions || dimension === "height" ? factor : 1,
	}
}

export interface AlignmentPlan extends SelectionTransformResult {
	readonly axis: "vertical" | "horizontal"
	readonly coordinate: number
	readonly cost: number
}

export const selectionKey = (target: EditorSelectionTarget): string =>
	target.kind === "node"
		? `node/${target.pointId}`
		: `handle/${target.pointId}/${target.handle}`

export type MarqueeSelectionMode = "replace" | "add" | "subtract"

export function marqueeSelectionMode(modifiers: {
	readonly shiftKey: boolean
	readonly metaKey: boolean
	readonly ctrlKey: boolean
}): MarqueeSelectionMode {
	if (modifiers.shiftKey) return "subtract"
	if (modifiers.metaKey || modifiers.ctrlKey) return "add"
	return "replace"
}

/** Combines a completed marquee with the authoritative workspace selection. */
export function combineMarqueeSelection(
	current: readonly EditorSelectionTarget[],
	boxed: readonly EditorSelectionTarget[],
	mode: MarqueeSelectionMode,
): readonly EditorSelectionTarget[] {
	if (mode === "replace") {
		return Object.freeze([
			...new Map(
				boxed.map((target) => [selectionKey(target), target]),
			).values(),
		])
	}
	const next = new Map(current.map((target) => [selectionKey(target), target]))
	for (const target of boxed) {
		const key = selectionKey(target)
		if (mode === "subtract") next.delete(key)
		else next.set(key, target)
	}
	return Object.freeze([...next.values()])
}

/** Keeps a selected geometric handle attached when path direction is reversed. */
export function reverseSelectionHandles(
	selection: readonly EditorSelectionTarget[],
): readonly EditorSelectionTarget[] {
	return Object.freeze(
		selection.map((target) =>
			target.kind === "node"
				? target
				: ({
						...target,
						handle: target.handle === "incoming" ? "outgoing" : "incoming",
					} as const),
		),
	)
}

export const canStartBoxSelectionOn = (targetName: string): boolean =>
	targetName === "canvas-background" || targetName === "typed-glyph"

/** Resolves nodes and relative handles to absolute font-unit positions. */
export function resolveSelectionControls(
	nodes: readonly EditorLayerNode[],
	selection: readonly EditorSelectionTarget[],
): readonly ResolvedSelectionControl[] {
	const byId = new Map(nodes.map((node) => [node.pointId, node]))
	const seen = new Set<string>()
	const controls: ResolvedSelectionControl[] = []
	for (const target of selection) {
		const key = selectionKey(target)
		if (seen.has(key)) continue
		seen.add(key)
		const node = byId.get(target.pointId)
		if (node === undefined) continue
		if (target.kind === "node") {
			controls.push({ target, x: node.x, y: node.y })
			continue
		}
		const vector = node[target.handle]
		if (vector === undefined) continue
		controls.push({
			target,
			x: node.x + vector.x,
			y: node.y + vector.y,
		})
	}
	return controls
}

/**
 * Adds the owner of a selected soft-handle pair so a rigid translation keeps
 * both endpoints exact without violating the soft node's collinear invariant.
 * The expanded selection also makes the implicit owner move visible in the UI.
 */
export function selectionForRigidTranslation(
	nodes: readonly EditorLayerNode[],
	selection: readonly EditorSelectionTarget[],
): readonly EditorSelectionTarget[] {
	const selected = new Set(selection.map(selectionKey))
	const expanded = [...selection]
	for (const node of nodes) {
		if (
			node.mode !== "soft" ||
			node.incoming === undefined ||
			node.outgoing === undefined ||
			!selected.has(`handle/${node.pointId}/incoming`) ||
			!selected.has(`handle/${node.pointId}/outgoing`)
		)
			continue
		const nodeTarget = { kind: "node", pointId: node.pointId } as const
		const key = selectionKey(nodeTarget)
		if (selected.has(key)) continue
		selected.add(key)
		expanded.push(nodeTarget)
	}
	return Object.freeze(expanded)
}

export function boundsOfControls(
	controls: readonly Pick<ResolvedSelectionControl, "x" | "y">[],
): SelectionBounds | null {
	if (controls.length === 0) return null
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY
	for (const control of controls) {
		minX = Math.min(minX, control.x)
		minY = Math.min(minY, control.y)
		maxX = Math.max(maxX, control.x)
		maxY = Math.max(maxY, control.y)
	}
	return { minX, minY, maxX, maxY }
}

function transformedResult(
	controls: readonly ResolvedSelectionControl[],
	transform: (
		control: ResolvedSelectionControl,
	) => Readonly<{ x: number; y: number }>,
): SelectionTransformResult {
	const points: SelectionTransformResult["points"][number][] = []
	const handles: SelectionTransformResult["handles"][number][] = []
	for (const control of controls) {
		const position = transform(control)
		if (control.target.kind === "node") {
			points.push({ pointId: control.target.pointId, ...position })
		} else {
			handles.push({
				pointId: control.target.pointId,
				handle: control.target.handle,
				...position,
			})
		}
	}
	return { points, handles }
}

export function translateSelectionControls(
	controls: readonly ResolvedSelectionControl[],
	deltaX: number,
	deltaY: number,
): SelectionTransformResult {
	return transformedResult(controls, ({ x, y }) => ({
		x: x + deltaX,
		y: y + deltaY,
	}))
}

export function scaleSelectionControls(
	controls: readonly ResolvedSelectionControl[],
	scale: SelectionScale,
): SelectionTransformResult {
	return transformedResult(controls, ({ x, y }) => ({
		x: scale.anchorX + (x - scale.anchorX) * scale.scaleX,
		y: scale.anchorY + (y - scale.anchorY) * scale.scaleY,
	}))
}

/**
 * Aligns to the lower-variance axis. A tie resolves vertically. The mean is
 * rounded once so selection order cannot affect the result.
 */
export function nearestAxisAlignment(
	controls: readonly ResolvedSelectionControl[],
): AlignmentPlan | null {
	if (controls.length < 2) return null
	const ordered = [...controls].sort((left, right) =>
		selectionKey(left.target).localeCompare(selectionKey(right.target)),
	)
	const meanX =
		ordered.reduce((sum, control) => sum + control.x, 0) / ordered.length
	const meanY =
		ordered.reduce((sum, control) => sum + control.y, 0) / ordered.length
	const verticalCost = ordered.reduce(
		(sum, control) => sum + (control.x - meanX) ** 2,
		0,
	)
	const horizontalCost = ordered.reduce(
		(sum, control) => sum + (control.y - meanY) ** 2,
		0,
	)
	const axis = verticalCost <= horizontalCost ? "vertical" : "horizontal"
	const coordinate = Math.round(axis === "vertical" ? meanX : meanY)
	return {
		axis,
		coordinate,
		cost: axis === "vertical" ? verticalCost : horizontalCost,
		...transformedResult(controls, (control) =>
			axis === "vertical"
				? { x: coordinate, y: control.y }
				: { x: control.x, y: coordinate },
		),
	}
}

/** Returns all selectable controls owned by a contour. */
export function contourSelectionTargets(
	nodes: readonly EditorLayerNode[],
): readonly EditorSelectionTarget[] {
	return nodes.flatMap((node): readonly EditorSelectionTarget[] => [
		{ kind: "node", pointId: node.pointId },
		...(node.incoming === undefined
			? []
			: [
					{
						kind: "handle",
						pointId: node.pointId,
						handle: "incoming",
					} as const,
				]),
		...(node.outgoing === undefined
			? []
			: [
					{
						kind: "handle",
						pointId: node.pointId,
						handle: "outgoing",
					} as const,
				]),
	])
}

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
