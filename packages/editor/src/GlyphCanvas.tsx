import type {
	ContourId,
	EditorHandleKind,
	GlyphId,
	PointId,
} from "@create-font/states"
import {
	resolveVerticalMetricAlignment,
	resolveVerticalMetricGuides,
	resolveVerticalOvershootBandSegments,
	type VerticalMetricLine,
} from "@create-font/states"
import {
	Circle,
	Group,
	type KonvaEventObject,
	Layer,
	Line,
	Path,
	Rect,
	Stage,
	Text,
} from "@create-font/preact-konva"
import type { JSX } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import {
	restoreCancelledGroupDragTarget,
	type CancelledGroupDrag,
} from "./canvas-group-drag.ts"
import { transformHandleCursor, type TransformHandle } from "./canvas-cursor.ts"
import {
	circularHitRegion,
	CONTROL_HIT_RADIUS_PX,
	editorControlHitCandidates,
	editorControlHitRadii,
	nearestEditorControlHit,
	resolveEditorCanvasHit,
	SEGMENT_HIT_RADIUS_PX,
} from "./canvas-hit-testing.ts"
import { BASE_CANVAS_SCALE, zoomCanvasView } from "./canvas-view.ts"
import { hasWheelZoomModifier } from "./canvas-wheel.ts"
import {
	incidentStraightProjectionCandidates,
	orthogonalConstraint,
	projectionGuidePoints,
	resolveGesturePoint,
	snapGroupTranslation,
	type ActiveSnap,
	type DragPositionTarget,
	type SegmentProjectionCandidate,
	type SnappedPoint,
} from "./canvas-snapping.ts"
import {
	deriveOneSidedSoftHandles,
	previewHandleDrag,
	segmentPointerAction,
	shouldSelectContourOnSegmentDoubleClick,
	toggledNodeMode,
} from "./curve-editing.ts"
import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	combinedEditorPathPreview,
	contourEndpointNormal,
	contoursToPath,
	contourStartDirection,
	editorContourToPath,
	editorContoursToPath,
	nearestEditorSegment,
} from "./geometry.ts"
import css from "./GlyphCanvas.module.css"
import { IS_MAC_LIKE } from "./editor-tools-and-hotkeys.ts"
import { keyboardStepMultiplier } from "./keyboard-step.ts"
import {
	canStartBoxSelectionOn,
	boundsOfControls,
	contourSelectionTargets,
	controlsInsideBounds,
	resolveSelectionControls,
	scaleSelectionControls,
	selectionForRigidTranslation,
	selectionKey,
	translateSelectionControls,
	type EditorSelectionTarget,
	type ResolvedSelectionControl,
	type SelectionBounds,
	type SelectionTransformResult,
} from "./outline-selection.ts"
import {
	penLayerCoordinates,
	penPointerAction,
	resolvePenEndpoint,
	resolvePenGesture,
	type PenEndpointResolution,
	type PenEndpointSide,
	type PenGestureResolution,
	type PenPoint,
} from "./pen-gesture.ts"
import {
	isEditablePreviewTarget,
	isMomentaryPreviewKey,
	shouldStartMomentaryPreview,
} from "./momentary-preview.ts"
import { useI, useO, useOF } from "./state-hooks.ts"
import { useCanvasTheme } from "./use-canvas-theme.ts"
import { useElementSize } from "./use-element-size.ts"
import {
	activeTextareaSelectionIndex,
	observeTextareaSelection,
} from "./textarea-selection.ts"
import { layoutTextRun, nearestCaretIndex } from "./text-layout.ts"
import {
	copyOutlineSelection,
	OUTLINE_CLIPBOARD_MIME,
	outlineClipboardPlainText,
	parseOutlineClipboard,
	prepareOutlinePaste,
	serializeOutlineClipboard,
} from "./outline-clipboard.ts"
import { visualDebugControlRegions } from "./visual-debug.ts"

export interface GlyphCanvasProps {
	readonly workspace: EditorWorkspace
	readonly disabled?: boolean
}

interface DraggedPoint {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

interface PointDrag {
	readonly pointId: PointId
	readonly origin: Readonly<{ x: number; y: number }>
	readonly startPointer: Readonly<{ x: number; y: number }>
	readonly projectionCandidates: readonly SegmentProjectionCandidate[]
	readonly target: DragPositionTarget
	lastRawPoint: Readonly<{ x: number; y: number }> | null
}

interface DraggedHandle {
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	readonly vector: Readonly<{ x: number; y: number }>
}

interface PenPlacementGesture {
	readonly pointerId: number
	readonly point: PenPoint
	readonly snaps: readonly ActiveSnap[]
	readonly downScreen: PenPoint
	readonly closingPointId: PointId | null
	readonly endpoint: PenEndpointTarget | null
	readonly captureTarget: HTMLCanvasElement | null
	readonly captureCancelListener: ((event: PointerEvent) => void) | null
	currentScreen: PenPoint
	shiftKey: boolean
	altKey: boolean
}

interface PenEndpointTarget {
	readonly contourId: ContourId
	readonly pointId: PointId
	readonly x: number
	readonly y: number
	readonly side: PenEndpointSide
	readonly mode: "soft" | "hard"
	readonly incoming?: PenPoint
	readonly outgoing?: PenPoint
}

interface SelectionBox {
	readonly startX: number
	readonly startY: number
	readonly endX: number
	readonly endY: number
	readonly additive: boolean
}

interface TransformDrag {
	readonly handle: TransformHandle
	readonly controls: readonly ResolvedSelectionControl[]
	readonly bounds: SelectionBounds
}

interface GroupDrag {
	readonly target: EditorSelectionTarget
	readonly targetX: number
	readonly targetY: number
	readonly node: LiveGroupDragTarget["node"]
	readonly controls: readonly ResolvedSelectionControl[]
	readonly bounds: SelectionBounds
	readonly selectedPointIds: ReadonlySet<PointId>
	lastRawDelta: Readonly<{ x: number; y: number }> | null
}

interface LiveGroupDragTarget {
	readonly selection: EditorSelectionTarget
	readonly node: {
		position(position: Readonly<{ x: number; y: number }>): unknown
		getLayer(): { batchDraw(): unknown } | null
	}
}

const ARROW_DELTAS: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, 1],
	ArrowDown: [0, -1],
}

export function GlyphCanvas({ workspace, disabled = false }: GlyphCanvasProps) {
	const palette = useCanvasTheme()
	const text = useO(workspace.ui.previewText)
	const setText = useI(workspace.ui.previewText)
	const caretIndex = useO(workspace.ui.caretIndex)
	const setCaretIndex = useI(workspace.ui.caretIndex)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const activeTool = useO(workspace.ui.activeTool)
	const run = useO(workspace.ui.previewRun)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const glyph = useOF(workspace.font.selectors.editorGlyphSource, activeGlyphId)
	const master = useOF(workspace.font.atoms.master, activeMasterId)
	const metrics =
		useO(workspace.font.atoms.metrics) ?? workspace.document.metrics
	const metadata =
		useO(workspace.font.atoms.metadata) ?? workspace.document.metadata
	const masterIds = useO(workspace.font.atoms.masterIds)
	const layer = useO(workspace.ui.activeLayer)
	const selection = useO(workspace.ui.selection)
	const setSelection = useI(workspace.ui.selection)
	const showNodes = useO(workspace.ui.showNodes)
	const setShowNodes = useI(workspace.ui.showNodes)
	const visualDebug = useO(workspace.ui.visualDebug)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const [draggedHandle, setDraggedHandle] = useState<DraggedHandle | null>(null)
	const [activeSnaps, setActiveSnaps] = useState<readonly ActiveSnap[]>([])
	const [shiftHeld, setShiftHeld] = useState(false)
	const [penPointer, setPenPointer] = useState<Readonly<{
		x: number
		y: number
	}> | null>(null)
	const [penGesture, setPenGesture] = useState<PenPlacementGesture | null>(null)
	const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
	const [transformDrag, setTransformDrag] = useState<TransformDrag | null>(null)
	const [transformCursor, setTransformCursor] = useState<string | null>(null)
	const [momentaryPreview, setMomentaryPreview] = useState(false)
	const [transformPreview, setTransformPreview] =
		useState<SelectionTransformResult | null>(null)
	const groupDragRef = useRef<GroupDrag | null>(null)
	const [penContourId, setPenContourId] = useState<ContourId | null>(null)
	const [penDirection, setPenDirection] = useState<"append" | "prepend">(
		"append",
	)
	const penEntitySequence = useRef(0)
	const clipboardEntitySequence = useRef(0)
	const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
	const penContourResumeRef = useRef<ContourId | null>(null)
	const penGestureRef = useRef<PenPlacementGesture | null>(null)
	const pointDragRef = useRef<PointDrag | null>(null)
	const cancelledGroupDrag = useRef<CancelledGroupDrag<
		LiveGroupDragTarget["node"]
	> | null>(null)
	const view = useO(workspace.ui.canvasView)
	const setView = useI(workspace.ui.canvasView)
	const setCanvasViewport = useI(workspace.ui.canvasViewport)
	const rootRef = useRef<HTMLElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const { ref, width, height } = useElementSize<HTMLElement>()
	useEffect(() => {
		setCanvasViewport((current) =>
			current.width === width && current.height === height
				? current
				: { width, height },
		)
	}, [height, setCanvasViewport, width])
	const layout = useMemo(
		() => layoutTextRun(run, metrics, metadata.unitsPerEm),
		[run, metadata.unitsPerEm, metrics],
	)
	const editingPosition = layout.glyphs.find(
		(position) => position.item.textStart === editingTextIndex,
	)
	const contours = layer?.contours ?? []
	const visibleContours = useMemo(
		() =>
			contours.map((contour) => {
				const transformedPoints = new Map(
					(transformPreview?.points ?? []).map((point) => [
						point.pointId,
						point,
					]),
				)
				const transformedHandles = new Map(
					(transformPreview?.handles ?? []).map((handle) => [
						`${handle.pointId}/${handle.handle}`,
						handle,
					]),
				)
				const positionedNodes = contour.nodes.map((point) => {
					const transformed = transformedPoints.get(point.pointId)
					const x =
						transformed?.x ??
						(point.pointId === draggedPoint?.pointId ? draggedPoint.x : point.x)
					const y =
						transformed?.y ??
						(point.pointId === draggedPoint?.pointId ? draggedPoint.y : point.y)
					const incoming = transformedHandles.get(`${point.pointId}/incoming`)
					const outgoing = transformedHandles.get(`${point.pointId}/outgoing`)
					let next = {
						...point,
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
				return {
					id: contour.id,
					closed: contour.closed,
					nodes: deriveOneSidedSoftHandles(positionedNodes, contour.closed).map(
						(point) =>
							point.pointId === draggedHandle?.pointId
								? previewHandleDrag(
										point,
										draggedHandle.handle,
										draggedHandle.vector,
									)
								: point,
					),
				}
			}),
		[contours, draggedHandle, draggedPoint, transformPreview],
	)
	const allPoints = visibleContours.flatMap((contour) => contour.nodes)
	const selectedNodeIds = new Set(
		selection
			.filter((target) => target.kind === "node")
			.map((target) => target.pointId),
	)
	const selectedPoints = allPoints.filter((point) =>
		selectedNodeIds.has(point.pointId),
	)
	const selectedPoint = selectedPoints.at(-1)
	const selectedControls = resolveSelectionControls(allPoints, selection)
	const transformBounds = boundsOfControls(selectedControls)
	const combinedPreview = combinedEditorPathPreview(visibleContours)
	const metricGuides = useMemo(
		() => resolveVerticalMetricGuides(metrics),
		[metrics],
	)
	const metricLines = useMemo(
		() =>
			metricGuides.filter(
				(guide): guide is VerticalMetricLine => guide.kind === "line",
			),
		[metricGuides],
	)
	const overshootBandSegments = useMemo(
		() => resolveVerticalOvershootBandSegments(metricGuides),
		[metricGuides],
	)
	const groupedMetricLines = useMemo(() => {
		const groups = new Map<number, VerticalMetricLine[]>()
		for (const line of metricLines) {
			const group = groups.get(line.y) ?? []
			group.push(line)
			groups.set(line.y, group)
		}
		return [...groups.entries()].map(([y, lines]) => ({ y, lines }))
	}, [metricLines])
	const advanceWidth = layer?.advanceWidth ?? 1_000
	const activeSnapGuideExtent =
		Math.max(
			advanceWidth + 400,
			metrics.ascender - metrics.descender + metrics.lineGap + 400,
		) * 2
	const worldScale = BASE_CANVAS_SCALE * view.zoom
	const inverseScale = 1 / worldScale
	const hitControlCandidates = useMemo(
		() => (showNodes ? editorControlHitCandidates(visibleContours) : []),
		[showNodes, visibleContours],
	)
	const hitControlRadii = useMemo(
		() => editorControlHitRadii(hitControlCandidates, worldScale),
		[hitControlCandidates, worldScale],
	)
	const debugControlRegions = useMemo(
		() => visualDebugControlRegions(hitControlCandidates, hitControlRadii),
		[hitControlCandidates, hitControlRadii],
	)
	const caret =
		layout.carets.find((candidate) => candidate.textIndex === caretIndex) ??
		layout.carets.at(-1)
	const isSelected = (target: EditorSelectionTarget): boolean => {
		const key = selectionKey(target)
		return selection.some((candidate) => selectionKey(candidate) === key)
	}
	const selectTarget = (
		target: EditorSelectionTarget,
		event?: MouseEvent | TouchEvent,
	): void => {
		const additive =
			event instanceof MouseEvent &&
			(event.metaKey || event.ctrlKey || event.shiftKey)
		if (!additive) {
			setSelection(Object.freeze([target]))
			return
		}
		const key = selectionKey(target)
		setSelection((current) =>
			Object.freeze(
				current.some((candidate) => selectionKey(candidate) === key)
					? current.filter((candidate) => selectionKey(candidate) !== key)
					: [...current, target],
			),
		)
	}
	const pointerInEditingGlyph = (
		event: KonvaEventObject<MouseEvent | PointerEvent | DragEvent | TouchEvent>,
	): Readonly<{ x: number; y: number }> | null => {
		if (editingPosition === undefined) return null
		const stagePointer = event.target.getStage()?.getPointerPosition()
		const pointer =
			stagePointer ??
			("offsetX" in event.evt
				? { x: event.evt.offsetX, y: event.evt.offsetY }
				: null)
		if (pointer === null) return null
		return {
			x: (pointer.x - view.x) / worldScale - editingPosition.x,
			y: editingPosition.baseline - (pointer.y - view.y) / worldScale,
		}
	}
	const pointerOnCanvas = (
		event: KonvaEventObject<MouseEvent | PointerEvent | DragEvent>,
	): PenPoint =>
		event.target.getStage()?.getPointerPosition() ?? {
			x: event.evt.offsetX,
			y: event.evt.offsetY,
		}
	const currentPenContour =
		(penGesture?.endpoint?.contourId ?? penContourId) === null
			? undefined
			: visibleContours.find(
					(contour) =>
						contour.id === (penGesture?.endpoint?.contourId ?? penContourId),
				)
	const penAnchor =
		(penDirection === "prepend"
			? currentPenContour?.nodes[0]
			: currentPenContour?.nodes.at(-1)) ?? null
	const resolveCanvasGesturePoint = (
		pointId: PointId,
		anchor: Readonly<{ x: number; y: number }> | null,
		candidate: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
		projectionCandidates: readonly SegmentProjectionCandidate[] = [],
	): SnappedPoint =>
		resolveGesturePoint({
			pointId,
			anchor,
			candidate: {
				x: Math.round(candidate.x),
				y: Math.round(candidate.y),
			},
			shiftKey,
			nodes: allPoints,
			metrics: metricLines,
			worldScale,
			projectionCandidates,
		})
	const penGestureResolution =
		penGesture === null
			? null
			: resolvePenGesture({
					downScreen: penGesture.downScreen,
					currentScreen: penGesture.currentScreen,
					worldScale,
					shiftKey: penGesture.shiftKey,
				})
	const penEndpointResolution: PenEndpointResolution | null =
		penGesture?.endpoint === null ||
		penGesture?.endpoint === undefined ||
		penGestureResolution === null
			? null
			: resolvePenEndpoint({
					side: penGesture.endpoint.side,
					mode: penGesture.endpoint.mode,
					...(penGesture.endpoint.incoming === undefined
						? {}
						: { incoming: penGesture.endpoint.incoming }),
					...(penGesture.endpoint.outgoing === undefined
						? {}
						: { outgoing: penGesture.endpoint.outgoing }),
					gesture: penGestureResolution,
					altKey: penGesture.altKey,
				})
	const penPlacement =
		activeTool !== "pen" || editingTextIndex === null
			? null
			: penGesture !== null
				? {
						x: penGesture.point.x,
						y: penGesture.point.y,
						snaps: penGesture.snaps,
					}
				: penPointer === null
					? null
					: resolveCanvasGesturePoint(
							"point:pen-placement-preview" as PointId,
							penAnchor,
							penPointer,
							shiftHeld,
						)
	const penHandles =
		penEndpointResolution === null
			? (penGestureResolution?.handles ?? null)
			: {
					...(penEndpointResolution.incoming === undefined
						? {}
						: { incoming: penEndpointResolution.incoming }),
					...(penEndpointResolution.outgoing === undefined
						? {}
						: { outgoing: penEndpointResolution.outgoing }),
				}
	const penCandidateNode =
		penPlacement === null
			? null
			: {
					pointId:
						penGesture?.endpoint?.pointId ??
						penGesture?.closingPointId ??
						("point:pen-placement-preview" as PointId),
					x: penPlacement.x,
					y: penPlacement.y,
					mode:
						penEndpointResolution?.mode ??
						penGestureResolution?.mode ??
						("hard" as const),
					...(penHandles === null ? {} : penHandles),
				}
	let penPendingPath = ""
	if (penCandidateNode !== null && penAnchor !== null) {
		if (penGesture?.endpoint !== null && penGesture?.endpoint !== undefined) {
			penPendingPath = editorContourToPath(
				currentPenContour?.nodes.map((node) =>
					node.pointId === penGesture.endpoint?.pointId
						? { ...node, ...penCandidateNode }
						: node,
				) ?? [],
				false,
			)
		} else if (
			penGesture?.closingPointId !== null &&
			penGesture?.closingPointId !== undefined &&
			currentPenContour !== undefined
		) {
			penPendingPath = editorContourToPath(
				currentPenContour.nodes.map((node) =>
					node.pointId === penGesture.closingPointId
						? { ...node, ...penCandidateNode }
						: node,
				),
				true,
			)
		} else {
			penPendingPath = editorContourToPath(
				penDirection === "prepend"
					? [penCandidateNode, penAnchor]
					: [penAnchor, penCandidateNode],
				false,
			)
		}
	}
	const visibleSnaps =
		activeTool === "pen" ? (penPlacement?.snaps ?? []) : activeSnaps
	const applyPointDrag = (
		drag: PointDrag,
		rawPoint: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
	): DraggedPoint => {
		const snapped = resolveCanvasGesturePoint(
			drag.pointId,
			drag.origin,
			rawPoint,
			shiftKey,
			drag.projectionCandidates,
		)
		const point = {
			pointId: drag.pointId,
			x: snapped.x,
			y: snapped.y,
		}
		drag.target.position({ x: point.x, y: point.y })
		drag.lastRawPoint = rawPoint
		setDraggedPoint(point)
		setActiveSnaps(snapped.snaps)
		return point
	}
	const targetsInside = (
		box: SelectionBox,
	): readonly EditorSelectionTarget[] => {
		return controlsInsideBounds(allPoints, {
			minX: Math.min(box.startX, box.endX),
			maxX: Math.max(box.startX, box.endX),
			minY: Math.min(box.startY, box.endY),
			maxY: Math.max(box.startY, box.endY),
		})
	}

	useEffect(() => {
		if (editingTextIndex !== null) return
		const frame = requestAnimationFrame(() => textareaRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [editingTextIndex])

	useEffect(() => {
		const textarea = textareaRef.current
		if (textarea === null) return
		return observeTextareaSelection(textarea, setCaretIndex)
	}, [setCaretIndex])

	useEffect(() => {
		const updateModifier = (event: KeyboardEvent): void => {
			if (event.key === "Shift") setShiftHeld(event.type === "keydown")
			if (event.key !== "Shift" && event.key !== "Alt") return
			const gesture = penGestureRef.current
			if (gesture === null) return
			gesture.shiftKey = event.shiftKey
			gesture.altKey = event.altKey
			setPenGesture({ ...gesture })
		}
		const resetModifiers = (): void => {
			setShiftHeld(false)
			const gesture = penGestureRef.current
			if (gesture === null) return
			gesture.shiftKey = false
			gesture.altKey = false
			setPenGesture({ ...gesture })
		}
		window.addEventListener("keydown", updateModifier)
		window.addEventListener("keyup", updateModifier)
		window.addEventListener("blur", resetModifiers)
		return () => {
			window.removeEventListener("keydown", updateModifier)
			window.removeEventListener("keyup", updateModifier)
			window.removeEventListener("blur", resetModifiers)
		}
	}, [])

	useEffect(() => {
		const resetCursor = (): void => setTransformCursor(null)
		window.addEventListener("blur", resetCursor)
		return () => window.removeEventListener("blur", resetCursor)
	}, [])

	useEffect(() => {
		if (editingTextIndex === null) {
			setMomentaryPreview(false)
			return
		}
		const clear = (): void => setMomentaryPreview(false)
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (
				!shouldStartMomentaryPreview(event) ||
				isEditablePreviewTarget(event.target) ||
				groupDragRef.current !== null ||
				penGestureRef.current !== null ||
				pointDragRef.current !== null ||
				draggedHandle !== null ||
				transformDrag !== null ||
				selectionBox !== null
			)
				return
			event.preventDefault()
			setTransformCursor(null)
			setMomentaryPreview(true)
		}
		const handleKeyUp = (event: KeyboardEvent): void => {
			if (isMomentaryPreviewKey(event)) clear()
		}
		const handleVisibility = (): void => {
			if (document.visibilityState !== "visible") clear()
		}
		window.addEventListener("keydown", handleKeyDown)
		window.addEventListener("keyup", handleKeyUp)
		window.addEventListener("blur", clear)
		document.addEventListener("visibilitychange", handleVisibility)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
			window.removeEventListener("keyup", handleKeyUp)
			window.removeEventListener("blur", clear)
			document.removeEventListener("visibilitychange", handleVisibility)
		}
	}, [draggedHandle, editingTextIndex, selectionBox, transformDrag])

	useEffect(() => {
		if (activeTool !== "transform" || transformBounds === null)
			setTransformCursor(null)
	}, [activeTool, transformBounds === null])

	useEffect(() => {
		const gesture = penGestureRef.current
		penGestureRef.current = null
		if (
			gesture !== null &&
			gesture.captureTarget !== null &&
			gesture.captureCancelListener !== null
		) {
			gesture.captureTarget.removeEventListener(
				"pointercancel",
				gesture.captureCancelListener,
			)
			gesture.captureTarget.removeEventListener(
				"lostpointercapture",
				gesture.captureCancelListener,
			)
		}
		if (gesture?.captureTarget?.hasPointerCapture(gesture.pointerId)) {
			gesture.captureTarget.releasePointerCapture(gesture.pointerId)
		}
		setPenContourId(null)
		setPenDirection("append")
		setPenPointer(null)
		setPenGesture(null)
		penContourResumeRef.current = null
		setActiveSnaps([])
		pointDragRef.current = null
		groupDragRef.current = null
		setTransformPreview(null)
		setTransformCursor(null)
		setMomentaryPreview(false)
		cancelledGroupDrag.current = null
	}, [activeGlyphId, activeMasterId, activeTool, editingTextIndex])

	useEffect(() => {
		if (penContourId !== null) {
			const activeContour = contours.find(
				(contour) => contour.id === penContourId,
			)
			if (activeContour === undefined || activeContour.closed) {
				setPenContourId(null)
			} else {
				penContourResumeRef.current = penContourId
			}
			return
		}
		const resumable = contours.find(
			(contour) =>
				contour.id === penContourResumeRef.current && !contour.closed,
		)
		if (
			resumable !== undefined &&
			activeTool === "pen" &&
			editingTextIndex !== null
		) {
			setPenContourId(resumable.id)
		}
	}, [activeTool, contours, editingTextIndex, penContourId])

	useEffect(() => {
		const drag = pointDragRef.current
		if (drag?.lastRawPoint === null || drag?.lastRawPoint === undefined) return
		applyPointDrag(drag, drag.lastRawPoint, shiftHeld)
	}, [shiftHeld])

	const commitPoint = (point: DraggedPoint): void => {
		workspace.font.actions.movePoints({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			points: [{ pointId: point.pointId, x: point.x, y: point.y }],
		})
	}
	const commitHandle = (handle: DraggedHandle): void => {
		workspace.font.actions.moveHandle({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointId: handle.pointId,
			handle: handle.handle,
			vector: handle.vector,
		})
	}
	const toggleNodeMode = (pointId: PointId, mode: "soft" | "hard"): void => {
		workspace.font.actions.setNodeMode({
			glyphId: activeGlyphId,
			pointId,
			mode: toggledNodeMode(mode),
		})
	}
	const focusTypingAt = (index: number): void => {
		const next = Math.max(0, Math.min(text.length, index))
		setCaretIndex(next)
		requestAnimationFrame(() => {
			const textarea = textareaRef.current
			textarea?.focus()
			textarea?.setSelectionRange(next, next)
		})
	}
	const enterGlyphEdit = (textStart: number, glyphId: GlyphId): void => {
		workspace.actions.enterGlyphEdit(textStart, glyphId)
		requestAnimationFrame(() => rootRef.current?.focus())
	}
	const exitGlyphEdit = (): void => {
		const nextCaret = editingPosition?.item.textEnd ?? caretIndex
		workspace.actions.exitGlyphEdit()
		focusTypingAt(nextCaret)
	}
	const deleteSelected = (breakPaths: boolean): void => {
		if (selection.length === 0) return
		workspace.font.actions.deleteSelection({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointIds: selection
				.filter((target) => target.kind === "node")
				.map((target) => target.pointId),
			handles: selection
				.filter((target) => target.kind === "handle")
				.map((target) => ({
					pointId: target.pointId,
					handle: target.handle,
				})),
			breakPaths,
		})
		setSelection(Object.freeze([]))
	}
	const nextPenEntityId = (kind: "contour" | "point") => {
		const occupied = new Set<string>([
			...contours.map((contour) => contour.id),
			...allPoints.map((point) => point.pointId),
		])
		while (true) {
			const sequence = penEntitySequence.current
			penEntitySequence.current += 1
			const id = `${kind}:${activeGlyphId}:pen:${sequence}`
			if (!occupied.has(id)) {
				return kind === "contour" ? (id as ContourId) : (id as PointId)
			}
		}
	}
	const nextClipboardEntityId = (kind: "contour" | "point") => {
		const source = workspace.font.read.editorSource()
		const occupied = new Set<string>(
			(source?.glyphs ?? []).flatMap((sourceGlyph) => [
				...sourceGlyph.contours.map((contour) => contour.id),
				...sourceGlyph.contours.flatMap((contour) =>
					contour.points.map((point) => point.id),
				),
			]),
		)
		while (true) {
			const sequence = clipboardEntitySequence.current
			clipboardEntitySequence.current += 1
			const id = `${kind}:${activeGlyphId}:paste:${sequence}`
			if (!occupied.has(id)) {
				return kind === "contour" ? (id as ContourId) : (id as PointId)
			}
		}
	}
	const penLayerTransforms = masterIds.map((sourceMasterId) => ({
		masterId: sourceMasterId,
		xScale:
			sourceMasterId === activeMasterId
				? 1
				: master?.kind === "default"
					? 0.94
					: 1 / 0.94,
	}))
	const penCoordinates = (point: PenPoint, gesture: PenGestureResolution) =>
		penLayerCoordinates(point, gesture, penLayerTransforms)
	const commitPenPoint = (
		point: PenPoint,
		gesture: PenGestureResolution,
	): void => {
		const pointId = nextPenEntityId("point") as PointId
		if (penContourId === null) {
			const contourId = nextPenEntityId("contour") as ContourId
			workspace.font.actions.createContour({
				glyphId: activeGlyphId,
				contourId,
				point: { id: pointId, mode: gesture.mode },
				coordinates: penCoordinates(point, gesture),
			})
			penContourResumeRef.current = contourId
			setPenContourId(contourId)
		} else {
			workspace.font.actions.insertPoint({
				glyphId: activeGlyphId,
				contourId: penContourId,
				...(penDirection === "prepend" ? { at: 0 } : {}),
				point: { id: pointId, mode: gesture.mode },
				coordinates: penCoordinates(point, gesture),
			})
			penContourResumeRef.current = penContourId
		}
		setSelection(Object.freeze([{ kind: "node", pointId }]))
		setShowNodes(true)
		setPenPointer(null)
	}
	const commitPenEndpoint = (
		target: PenEndpointTarget,
		gesture: PenGestureResolution,
		altKey: boolean,
	): void => {
		const resolution = resolvePenEndpoint({
			side: target.side,
			mode: target.mode,
			...(target.incoming === undefined ? {} : { incoming: target.incoming }),
			...(target.outgoing === undefined ? {} : { outgoing: target.outgoing }),
			gesture,
			altKey,
		})
		if (!(target.mode === "hard" && gesture.kind === "click")) {
			workspace.font.actions.authorPenEndpoint({
				glyphId: activeGlyphId,
				contourId: target.contourId,
				pointId: target.pointId,
				forwardHandle: target.side === "first" ? "incoming" : "outgoing",
				mode: resolution.mode,
				coordinates: penCoordinates(target, gesture).map(
					({ masterId, outgoing }) => ({
						masterId,
						forward: gesture.kind === "click" ? null : outgoing!,
					}),
				),
			})
		}
		penContourResumeRef.current = target.contourId
		setPenContourId(target.contourId)
		setPenDirection(target.side === "first" ? "prepend" : "append")
		setSelection(Object.freeze([{ kind: "node", pointId: target.pointId }]))
		setShowNodes(true)
		setPenPointer(null)
	}
	const commitPenClosure = (gesture: PenGestureResolution): void => {
		if (
			penContourId === null ||
			currentPenContour === undefined ||
			currentPenContour.nodes.length < 3
		)
			return
		const closurePoint =
			penDirection === "prepend"
				? currentPenContour.nodes.at(-1)
				: currentPenContour.nodes[0]
		if (closurePoint === undefined) return
		penContourResumeRef.current = penContourId
		workspace.font.actions.closeContour({
			glyphId: activeGlyphId,
			contourId: penContourId,
			...(gesture.handles === null
				? {}
				: {
						[penDirection === "prepend" ? "lastPoint" : "firstPoint"]: {
							pointId: closurePoint.pointId,
							mode: "soft" as const,
							coordinates: penCoordinates(closurePoint, gesture).map(
								({ masterId, incoming, outgoing }) => ({
									masterId,
									incoming: incoming!,
									outgoing: outgoing!,
								}),
							),
						},
					}),
		})
		setPenContourId(null)
		setPenDirection("append")
		setPenPointer(null)
		setSelection(
			Object.freeze([{ kind: "node", pointId: closurePoint.pointId }]),
		)
		setShowNodes(true)
	}
	const releasePenCapture = (gesture: PenPlacementGesture): void => {
		if (
			gesture.captureTarget !== null &&
			gesture.captureCancelListener !== null
		) {
			gesture.captureTarget.removeEventListener(
				"pointercancel",
				gesture.captureCancelListener,
			)
			gesture.captureTarget.removeEventListener(
				"lostpointercapture",
				gesture.captureCancelListener,
			)
		}
		if (gesture.captureTarget?.hasPointerCapture(gesture.pointerId)) {
			gesture.captureTarget.releasePointerCapture(gesture.pointerId)
		}
	}
	const cancelPenGesture = (): void => {
		const gesture = penGestureRef.current
		penGestureRef.current = null
		setPenGesture(null)
		setPenPointer(null)
		if (gesture !== null) releasePenCapture(gesture)
	}
	const beginPenGesture = (
		event: KonvaEventObject<PointerEvent>,
		closingPoint?: Readonly<{ pointId: PointId; x: number; y: number }>,
		endpoint?: PenEndpointTarget,
	): void => {
		if (editingTextIndex === null || activeTool !== "pen") return
		if (penGestureRef.current !== null) return
		if (event.evt.button !== 0 || !event.evt.isPrimary) return
		event.cancelBubble = true
		const rawPoint = pointerInEditingGlyph(event)
		if (rawPoint === null) return
		const fixedPoint = endpoint ?? closingPoint
		const placement =
			fixedPoint === undefined
				? resolveCanvasGesturePoint(
						"point:pen-placement-preview" as PointId,
						penAnchor,
						rawPoint,
						event.evt.shiftKey,
					)
				: { x: fixedPoint.x, y: fixedPoint.y, snaps: [] }
		const nativeTarget =
			event.evt.target instanceof HTMLCanvasElement ? event.evt.target : null
		const captureCancelListener = (nativeEvent: PointerEvent): void => {
			if (nativeEvent.pointerId === event.evt.pointerId) cancelPenGesture()
		}
		const gesture: PenPlacementGesture = {
			pointerId: event.evt.pointerId,
			point: { x: placement.x, y: placement.y },
			snaps: placement.snaps,
			downScreen: pointerOnCanvas(event),
			currentScreen: pointerOnCanvas(event),
			closingPointId: closingPoint?.pointId ?? null,
			endpoint: endpoint ?? null,
			captureTarget: nativeTarget,
			captureCancelListener,
			shiftKey: event.evt.shiftKey,
			altKey: event.evt.altKey,
		}
		penGestureRef.current = gesture
		nativeTarget?.addEventListener("pointercancel", captureCancelListener)
		nativeTarget?.addEventListener("lostpointercapture", captureCancelListener)
		nativeTarget?.setPointerCapture(event.evt.pointerId)
		setPenGesture(gesture)
		setPenPointer(null)
	}
	const updatePenPointer = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = penGestureRef.current
		if (gesture !== null) {
			if (gesture.pointerId !== event.evt.pointerId) return
			gesture.currentScreen = pointerOnCanvas(event)
			gesture.shiftKey = event.evt.shiftKey
			gesture.altKey = event.evt.altKey
			setPenGesture({ ...gesture })
			return
		}
		setPenPointer(pointerInEditingGlyph(event))
		if (shiftHeld !== event.evt.shiftKey) setShiftHeld(event.evt.shiftKey)
	}
	const finishPenGesture = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = penGestureRef.current
		if (gesture === null || gesture.pointerId !== event.evt.pointerId) return
		gesture.currentScreen = pointerOnCanvas(event)
		const resolution = resolvePenGesture({
			downScreen: gesture.downScreen,
			currentScreen: gesture.currentScreen,
			worldScale,
			shiftKey: event.evt.shiftKey,
		})
		penGestureRef.current = null
		setPenGesture(null)
		if (gesture.endpoint !== null) {
			commitPenEndpoint(gesture.endpoint, resolution, event.evt.altKey)
		} else if (gesture.closingPointId === null) {
			commitPenPoint(gesture.point, resolution)
		} else {
			commitPenClosure(resolution)
		}
		releasePenCapture(gesture)
	}
	const roundedTransform = (
		result: SelectionTransformResult,
	): SelectionTransformResult => ({
		points: result.points.map((point) => ({
			...point,
			x: Math.round(point.x),
			y: Math.round(point.y),
		})),
		handles: result.handles.map((handle) => ({
			...handle,
			x: Math.round(handle.x),
			y: Math.round(handle.y),
		})),
	})
	const beginGroupDrag = (
		target: EditorSelectionTarget,
		targetX: number,
		targetY: number,
		node: LiveGroupDragTarget["node"],
	): boolean => {
		if (!isSelected(target)) return false
		const rigidSelection = selectionForRigidTranslation(allPoints, selection)
		const controls = resolveSelectionControls(allPoints, rigidSelection)
		const bounds = boundsOfControls(controls)
		if (controls.length < 2 || bounds === null) return false
		if (rigidSelection.length !== selection.length) {
			setSelection(rigidSelection)
		}
		const nextGroupDrag = {
			target,
			targetX,
			targetY,
			node,
			controls,
			bounds,
			selectedPointIds: new Set(rigidSelection.map((item) => item.pointId)),
			lastRawDelta: null,
		}
		groupDragRef.current = nextGroupDrag
		return true
	}
	const applyGroupDrag = (
		currentGroupDrag: GroupDrag,
		rawDelta: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
	): Readonly<{
		preview: SelectionTransformResult
		snaps: readonly ActiveSnap[]
	}> => {
		const deltaConstraint = orthogonalConstraint(
			{ x: 0, y: 0 },
			rawDelta,
			shiftKey,
		)
		const snapped = snapGroupTranslation({
			bounds: currentGroupDrag.bounds,
			deltaX: Math.round(rawDelta.x),
			deltaY: Math.round(rawDelta.y),
			selectedPointIds: currentGroupDrag.selectedPointIds,
			nodes: allPoints,
			metrics: metricLines,
			worldScale,
			axisConstraint:
				deltaConstraint === null
					? null
					: {
							axis: deltaConstraint.axis,
							value:
								deltaConstraint.axis === "x"
									? currentGroupDrag.targetX
									: currentGroupDrag.targetY,
						},
		})
		currentGroupDrag.node.position({
			x: currentGroupDrag.targetX + snapped.deltaX,
			y: currentGroupDrag.targetY + snapped.deltaY,
		})
		return {
			preview: translateSelectionControls(
				currentGroupDrag.controls,
				snapped.deltaX,
				snapped.deltaY,
			),
			snaps: snapped.snaps,
		}
	}
	const resolveGroupDrag = (
		event: KonvaEventObject<DragEvent>,
	): ReturnType<typeof applyGroupDrag> | null => {
		const currentGroupDrag = groupDragRef.current
		if (currentGroupDrag === null) return null
		const rawDelta = {
			x: event.target.x() - currentGroupDrag.targetX,
			y: event.target.y() - currentGroupDrag.targetY,
		}
		currentGroupDrag.lastRawDelta = rawDelta
		return applyGroupDrag(currentGroupDrag, rawDelta, event.evt.shiftKey)
	}
	useEffect(() => {
		const currentGroupDrag = groupDragRef.current
		if (currentGroupDrag?.lastRawDelta === null || currentGroupDrag === null)
			return
		const resolved = applyGroupDrag(
			currentGroupDrag,
			currentGroupDrag.lastRawDelta,
			shiftHeld,
		)
		setTransformPreview(resolved.preview)
		setActiveSnaps(resolved.snaps)
		currentGroupDrag.node.getLayer()?.batchDraw()
	}, [shiftHeld])
	const previewGroupDrag = (event: KonvaEventObject<DragEvent>): boolean => {
		const cancellation = cancelledGroupDrag.current
		if (
			cancellation !== null &&
			restoreCancelledGroupDragTarget(cancellation, event.target)
		) {
			event.target.getLayer()?.batchDraw()
			return true
		}
		const resolved = resolveGroupDrag(event)
		if (resolved === null) return false
		setTransformPreview(resolved.preview)
		setActiveSnaps(resolved.snaps)
		return true
	}
	const commitGroupDrag = (event: KonvaEventObject<DragEvent>): boolean => {
		const cancellation = cancelledGroupDrag.current
		if (
			cancellation !== null &&
			restoreCancelledGroupDragTarget(cancellation, event.target)
		) {
			cancelledGroupDrag.current = null
			setDraggedPoint(null)
			setDraggedHandle(null)
			event.target.getLayer()?.batchDraw()
			return true
		}
		const currentGroupDrag = groupDragRef.current
		const resolved = resolveGroupDrag(event)
		if (resolved === null || currentGroupDrag === null) return false
		workspace.font.actions.transformControls({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			...resolved.preview,
		})
		groupDragRef.current = null
		setTransformPreview(null)
		setDraggedPoint(null)
		setDraggedHandle(null)
		setActiveSnaps([])
		cancelledGroupDrag.current = null
		return true
	}
	const beginTransform = (handle: TransformHandle): void => {
		const controls = resolveSelectionControls(allPoints, selection)
		const bounds = boundsOfControls(controls)
		if (bounds === null) return
		setTransformDrag({ handle, controls, bounds })
	}
	const previewTransformDrag = (event: KonvaEventObject<DragEvent>): void => {
		if (transformDrag === null) return
		const { bounds, controls, handle } = transformDrag
		if (handle === "inside") {
			setTransformPreview(
				roundedTransform(
					translateSelectionControls(
						controls,
						event.target.x() - bounds.minX,
						event.target.y() - bounds.minY,
					),
				),
			)
			return
		}
		const movesWest = handle.includes("west")
		const movesEast = handle.includes("east")
		const movesNorth = handle.includes("north")
		const movesSouth = handle.includes("south")
		const anchorX = movesWest ? bounds.maxX : bounds.minX
		const anchorY = movesSouth ? bounds.maxY : bounds.minY
		const sourceX = movesWest ? bounds.minX : bounds.maxX
		const sourceY = movesSouth ? bounds.minY : bounds.maxY
		let scaleX =
			movesWest || movesEast
				? sourceX === anchorX
					? 1
					: (event.target.x() - anchorX) / (sourceX - anchorX)
				: 1
		let scaleY =
			movesNorth || movesSouth
				? sourceY === anchorY
					? 1
					: (event.target.y() - anchorY) / (sourceY - anchorY)
				: 1
		if (
			event.evt.shiftKey &&
			(movesWest || movesEast) &&
			(movesNorth || movesSouth)
		) {
			const uniform =
				Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
			scaleX = uniform
			scaleY = uniform
		}
		setTransformPreview(
			roundedTransform(
				scaleSelectionControls(controls, {
					anchorX,
					anchorY,
					scaleX,
					scaleY,
				}),
			),
		)
	}
	const commitTransform = (): void => {
		if (transformPreview !== null) {
			workspace.font.actions.transformControls({
				masterId: activeMasterId,
				glyphId: activeGlyphId,
				...transformPreview,
			})
		}
		setTransformPreview(null)
		setTransformDrag(null)
	}
	const selectWholeContour = (
		contour: (typeof visibleContours)[number],
		event: MouseEvent | TouchEvent,
	): void => {
		const targets = contourSelectionTargets(contour.nodes)
		const additive = event.metaKey || event.ctrlKey || event.shiftKey
		if (!additive) {
			setSelection(Object.freeze(targets))
		} else {
			setSelection((current) => {
				const next = new Map(
					current.map((target) => [selectionKey(target), target]),
				)
				const allSelected = targets.every((target) =>
					next.has(selectionKey(target)),
				)
				for (const target of targets) {
					if (allSelected) next.delete(selectionKey(target))
					else next.set(selectionKey(target), target)
				}
				return Object.freeze([...next.values()])
			})
		}
		setShowNodes(true)
	}
	const selectNearestCanvasControl = (
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	): void => {
		if (editingTextIndex === null || activeTool === "pen") return
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const hit = nearestEditorControlHit(
			hitControlCandidates,
			pointer,
			worldScale,
		)
		if (hit === null) return
		event.cancelBubble = true
		selectTarget(hit.target, event.evt)
	}
	const activateNearestCanvasDoubleClick = (
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	): void => {
		if (editingTextIndex === null || activeTool === "pen") return
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const hit = resolveEditorCanvasHit({
			controls: hitControlCandidates,
			contours: visibleContours,
			pointer,
			worldScale,
		})
		if (hit === null) return
		event.cancelBubble = true
		if (hit.kind === "control") {
			if (hit.target.kind === "handle") {
				selectTarget(hit.target, event.evt)
				return
			}
			const point = allPoints.find(
				(candidate) => candidate.pointId === hit.target.pointId,
			)
			if (point === undefined) return
			setSelection(Object.freeze([hit.target]))
			toggleNodeMode(point.pointId, point.mode)
			return
		}
		if (!shouldSelectContourOnSegmentDoubleClick(activeTool, event.evt)) return
		const contour = visibleContours.find(
			(candidate) => candidate.id === hit.contourId,
		)
		if (contour !== undefined) selectWholeContour(contour, event.evt)
	}
	const splitContourSegment = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<MouseEvent | PointerEvent>,
	): void => {
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (nearest === null || nearest.amount <= 0.001 || nearest.amount >= 0.999)
			return
		const pointId = nextPenEntityId("point") as PointId
		workspace.font.actions.splitSegment({
			glyphId: activeGlyphId,
			contourId: contour.id,
			segmentIndex: nearest.segmentIndex,
			pointId,
			amount: nearest.amount,
		})
		penContourResumeRef.current = null
		setPenContourId(null)
		setPenPointer(null)
		setSelection(Object.freeze([{ kind: "node", pointId }]))
		setShowNodes(true)
	}
	const addHandlesToSegment = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<MouseEvent>,
	): void => {
		event.cancelBubble = true
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (nearest === null) return
		const start = contour.nodes[nearest.segmentIndex]
		const end = contour.closed
			? contour.nodes[(nearest.segmentIndex + 1) % contour.nodes.length]
			: contour.nodes[nearest.segmentIndex + 1]
		if (start === undefined || end === undefined) return
		const changed = workspace.font.actions.addSegmentHandles({
			glyphId: activeGlyphId,
			contourId: contour.id,
			segmentIndex: nearest.segmentIndex,
		})
		if (!changed) return
		setSelection(
			Object.freeze([
				{
					kind: "handle" as const,
					pointId: start.pointId,
					handle: "outgoing" as const,
				},
				{
					kind: "handle" as const,
					pointId: end.pointId,
					handle: "incoming" as const,
				},
			]),
		)
		setShowNodes(true)
	}
	const zoomCanvas = (
		nextZoom: number,
		focalX = width / 2,
		focalY = height / 2,
	): void => {
		setView((current) =>
			zoomCanvasView(current, nextZoom, { x: focalX, y: focalY }),
		)
	}

	return (
		<glyph-canvas
			ref={rootRef}
			className={css.class}
			role="application"
			aria-label="Text layout and outline editor"
			aria-describedby="canvas-instructions"
			aria-keyshortcuts="Escape BracketLeft BracketRight Enter Delete Backspace Alt+Delete Alt+Backspace Meta+A Control+A Meta+C Control+C Meta+V Control+V Shift+A E ArrowUp ArrowDown ArrowLeft ArrowRight"
			tabIndex={0}
			onCopy={(event: JSX.TargetedClipboardEvent<HTMLElement>) => {
				if (
					editingTextIndex === null ||
					event.target instanceof HTMLTextAreaElement
				)
					return
				const clipboard = event.clipboardData
				if (clipboard === null) {
					setClipboardStatus("The system clipboard is unavailable.")
					return
				}
				if (glyph === null) {
					setClipboardStatus("The active glyph is unavailable for copying.")
					return
				}
				const copied = copyOutlineSelection(glyph, selection)
				if (!copied.ok) {
					setClipboardStatus(copied.error)
					return
				}
				event.preventDefault()
				clipboard.setData(
					OUTLINE_CLIPBOARD_MIME,
					serializeOutlineClipboard(copied.value),
				)
				clipboard.setData("text/plain", outlineClipboardPlainText(copied.value))
				const pointCount = copied.value.contours.reduce(
					(total, contour) => total + contour.points.length,
					0,
				)
				setClipboardStatus(
					`Copied ${pointCount} outline node${pointCount === 1 ? "" : "s"}.`,
				)
			}}
			onPaste={(event: JSX.TargetedClipboardEvent<HTMLElement>) => {
				if (momentaryPreview) {
					event.preventDefault()
					return
				}
				if (
					editingTextIndex === null ||
					event.target instanceof HTMLTextAreaElement
				)
					return
				const clipboard = event.clipboardData
				if (clipboard === null) {
					setClipboardStatus("The system clipboard is unavailable.")
					return
				}
				const serialized =
					clipboard.getData(OUTLINE_CLIPBOARD_MIME) ||
					clipboard.getData("text/plain")
				if (serialized.length === 0) {
					setClipboardStatus(
						"The clipboard does not contain create-font outlines.",
					)
					return
				}
				const parsed = parseOutlineClipboard(serialized)
				if (!parsed.ok) {
					setClipboardStatus(parsed.error)
					return
				}
				const paste = prepareOutlinePaste(
					parsed.value,
					activeGlyphId,
					masterIds,
					nextClipboardEntityId,
				)
				if (!paste.ok) {
					setClipboardStatus(paste.error)
					return
				}
				try {
					workspace.font.actions.pasteContours(paste.value)
				} catch (error) {
					setClipboardStatus(
						error instanceof Error
							? error.message
							: "The outlines could not be pasted.",
					)
					return
				}
				event.preventDefault()
				setSelection(
					Object.freeze(
						paste.value.selectedPointIds.map((pointId) => ({
							kind: "node" as const,
							pointId,
						})),
					),
				)
				setShowNodes(true)
				setClipboardStatus(
					`Pasted ${paste.value.selectedPointIds.length} outline node${paste.value.selectedPointIds.length === 1 ? "" : "s"}.`,
				)
			}}
			onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
				if (momentaryPreview) {
					event.preventDefault()
					return
				}
				const currentGroupDrag = groupDragRef.current
				if (event.key === "Escape" && currentGroupDrag !== null) {
					event.preventDefault()
					cancelledGroupDrag.current = {
						target: currentGroupDrag.node,
						x: currentGroupDrag.targetX,
						y: currentGroupDrag.targetY,
					}
					restoreCancelledGroupDragTarget(
						cancelledGroupDrag.current,
						currentGroupDrag.node,
					)
					currentGroupDrag.node.getLayer()?.batchDraw()
					groupDragRef.current = null
					setTransformPreview(null)
					setDraggedPoint(null)
					setDraggedHandle(null)
					setActiveSnaps([])
					return
				}
				if (event.key === "Escape" && penGestureRef.current !== null) {
					event.preventDefault()
					cancelPenGesture()
					return
				}
				if (event.key === "Escape" && transformDrag !== null) {
					event.preventDefault()
					setTransformDrag(null)
					setTransformPreview(null)
					setTransformCursor(null)
					return
				}
				if (event.key === "Escape" && editingTextIndex !== null) {
					event.preventDefault()
					exitGlyphEdit()
					return
				}
				if (
					event.target instanceof HTMLInputElement ||
					event.target instanceof HTMLTextAreaElement ||
					event.target instanceof HTMLButtonElement
				)
					return
				if (
					editingTextIndex !== null &&
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "a"
				) {
					event.preventDefault()
					setSelection(
						Object.freeze(
							allPoints.flatMap((point): EditorSelectionTarget[] => [
								{ kind: "node", pointId: point.pointId },
								...(point.incoming === undefined
									? []
									: [
											{
												kind: "handle" as const,
												pointId: point.pointId,
												handle: "incoming" as const,
											},
										]),
								...(point.outgoing === undefined
									? []
									: [
											{
												kind: "handle" as const,
												pointId: point.pointId,
												handle: "outgoing" as const,
											},
										]),
							]),
						),
					)
					setShowNodes(true)
					return
				}
				if (
					editingTextIndex !== null &&
					(event.key === "Delete" || event.key === "Backspace") &&
					selection.length > 0
				) {
					event.preventDefault()
					deleteSelected(event.altKey)
					return
				}
				if (
					editingTextIndex !== null &&
					(event.key === "[" || event.key === "]") &&
					allPoints.length > 0
				) {
					event.preventDefault()
					const currentIndex = allPoints.findIndex(
						(point) => point.pointId === selectedPoint?.pointId,
					)
					const direction = event.key === "]" ? 1 : -1
					const nextIndex =
						currentIndex === -1
							? direction === 1
								? 0
								: allPoints.length - 1
							: (currentIndex + direction + allPoints.length) % allPoints.length
					const nextPoint = allPoints[nextIndex]
					setSelection(
						nextPoint === undefined
							? Object.freeze([])
							: Object.freeze([{ kind: "node", pointId: nextPoint.pointId }]),
					)
					setShowNodes(true)
					return
				}
				if (
					editingTextIndex !== null &&
					event.key === "Enter" &&
					selectedPoint !== undefined
				) {
					event.preventDefault()
					toggleNodeMode(selectedPoint.pointId, selectedPoint.mode)
					return
				}
				const delta = ARROW_DELTAS[event.key]
				if (
					editingTextIndex === null ||
					delta === undefined ||
					selectedPoints.length === 0
				)
					return
				event.preventDefault()
				const multiplier = keyboardStepMultiplier(event, IS_MAC_LIKE)
				workspace.font.actions.movePoints({
					masterId: activeMasterId,
					glyphId: activeGlyphId,
					points: selectedPoints.map((point) => ({
						pointId: point.pointId,
						x: point.x + delta[0] * multiplier,
						y: point.y + delta[1] * multiplier,
					})),
				})
			}}
		>
			<textarea
				ref={textareaRef}
				value={text}
				disabled={disabled}
				spellcheck={false}
				aria-label="Text canvas contents"
				onInput={(event: JSX.TargetedInputEvent<HTMLTextAreaElement>) => {
					const textarea = event.currentTarget
					setText(textarea.value)
					setCaretIndex(activeTextareaSelectionIndex(textarea))
				}}
				onSelect={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) =>
					setCaretIndex(activeTextareaSelectionIndex(event.currentTarget))
				}
			/>
			<canvas-surface
				ref={ref}
				data-tool={activeTool}
				data-editing={editingTextIndex === null ? "false" : "true"}
				style={
					transformCursor === null ? undefined : { cursor: transformCursor }
				}
			>
				<Stage
					width={width}
					height={height}
					onClick={selectNearestCanvasControl}
					onTap={selectNearestCanvasControl}
					onDblClick={activateNearestCanvasDoubleClick}
					onDblTap={activateNearestCanvasDoubleClick}
					onWheel={(event: KonvaEventObject<WheelEvent>) => {
						event.evt.preventDefault()
						const pointer = event.target.getStage()?.getPointerPosition()
						if (
							pointer !== null &&
							pointer !== undefined &&
							hasWheelZoomModifier(event.evt)
						) {
							zoomCanvas(
								view.zoom * Math.exp(-event.evt.deltaY * 0.002),
								pointer.x,
								pointer.y,
							)
							return
						}
						setView((current) => ({
							...current,
							x:
								current.x -
								(event.evt.deltaX ||
									(event.evt.shiftKey ? event.evt.deltaY : 0)),
							y: current.y - (event.evt.shiftKey ? 0 : event.evt.deltaY),
						}))
					}}
					onMouseDown={(event: KonvaEventObject<MouseEvent>) => {
						if (momentaryPreview) return
						if (editingTextIndex !== null) {
							if (activeTool === "pen") return
							if (!canStartBoxSelectionOn(event.target.name())) return
							const point = pointerInEditingGlyph(event)
							if (point === null) return
							setSelectionBox({
								startX: point.x,
								startY: point.y,
								endX: point.x,
								endY: point.y,
								additive:
									event.evt.metaKey || event.evt.ctrlKey || event.evt.shiftKey,
							})
							return
						}
						if (event.target.name() !== "canvas-background") return
						const pointer = event.target.getStage()?.getPointerPosition()
						if (pointer === null || pointer === undefined) return
						focusTypingAt(
							nearestCaretIndex(
								layout.carets,
								(pointer.x - view.x) / worldScale,
								(pointer.y - view.y) / worldScale,
							),
						)
					}}
					onMouseMove={(event: KonvaEventObject<MouseEvent>) => {
						if (momentaryPreview) return
						if (editingTextIndex !== null && activeTool === "pen") return
						if (selectionBox === null) return
						const point = pointerInEditingGlyph(event)
						if (point === null) return
						setSelectionBox((current) =>
							current === null
								? null
								: { ...current, endX: point.x, endY: point.y },
						)
					}}
					onMouseLeave={() => {
						if (activeTool === "pen" && penGestureRef.current === null)
							setPenPointer(null)
					}}
					onPointerMove={(event: KonvaEventObject<PointerEvent>) => {
						if (momentaryPreview) return
						if (editingTextIndex !== null && activeTool === "pen")
							updatePenPointer(event)
					}}
					onPointerUp={(event: KonvaEventObject<PointerEvent>) => {
						if (momentaryPreview) return
						if (activeTool === "pen") finishPenGesture(event)
					}}
					onPointerCancel={(event: KonvaEventObject<PointerEvent>) => {
						if (penGestureRef.current?.pointerId === event.evt.pointerId)
							cancelPenGesture()
					}}
					onLostPointerCapture={(event: KonvaEventObject<PointerEvent>) => {
						if (penGestureRef.current?.pointerId === event.evt.pointerId)
							cancelPenGesture()
					}}
					onMouseUp={() => {
						if (momentaryPreview) return
						if (selectionBox === null) return
						const boxed = targetsInside(selectionBox)
						setSelection((current) => {
							if (!selectionBox.additive) return Object.freeze(boxed)
							const merged = new Map(
								current.map((target) => [selectionKey(target), target]),
							)
							for (const target of boxed)
								merged.set(selectionKey(target), target)
							return Object.freeze([...merged.values()])
						})
						setSelectionBox(null)
					}}
					onTouchStart={(event: KonvaEventObject<TouchEvent>) => {
						if (momentaryPreview) return
						if (
							editingTextIndex !== null &&
							event.target.name() === "canvas-background"
						)
							setSelection(Object.freeze([]))
					}}
				>
					<Layer>
						<Rect
							name="canvas-background"
							width={width}
							height={height}
							fill={palette.surface}
							onPointerDown={(event: KonvaEventObject<PointerEvent>) => {
								if (momentaryPreview) return
								if (editingTextIndex === null || activeTool !== "pen") return
								if (penPointerAction("background") === "place")
									beginPenGesture(event)
							}}
						/>
						<Group
							x={view.x}
							y={view.y}
							scaleX={worldScale}
							scaleY={worldScale}
						>
							{layout.glyphs.map((position) => {
								const isEditing = position.item.textStart === editingTextIndex
								const placeCaret = (
									event: KonvaEventObject<MouseEvent | TouchEvent>,
								): void => {
									if (editingTextIndex !== null) return
									const pointer = event.target.getStage()?.getPointerPosition()
									if (pointer === null || pointer === undefined) return
									const worldX = (pointer.x - view.x) / worldScale
									focusTypingAt(
										worldX < position.x + position.advance / 2
											? position.item.textStart
											: position.item.textEnd,
									)
								}
								return (
									<Group
										key={`glyph:${position.item.textStart}`}
										x={position.x}
										y={position.baseline}
										scaleY={-1}
									>
										{isEditing || position.item.glyph === null ? null : (
											<Path
												data={contoursToPath(position.item.glyph.contours)}
												fill={palette.previewInk}
												opacity={editingTextIndex === null ? 1 : 0.42}
												listening={false}
											/>
										)}
										{isEditing ? null : (
											<Rect
												name="typed-glyph"
												y={metrics.descender}
												width={position.advance}
												height={metrics.ascender - metrics.descender}
												fill="rgb(0 0 0 / 0.001)"
												onPointerDown={(
													event: KonvaEventObject<PointerEvent>,
												) => {
													if (
														editingTextIndex !== null &&
														activeTool === "pen" &&
														penPointerAction("typed-glyph") === "place"
													)
														beginPenGesture(event)
												}}
												onMouseDown={placeCaret}
												onTouchStart={placeCaret}
												onDblClick={() =>
													enterGlyphEdit(
														position.item.textStart,
														position.item.glyphId,
													)
												}
												onDblTap={() =>
													enterGlyphEdit(
														position.item.textStart,
														position.item.glyphId,
													)
												}
											/>
										)}
									</Group>
								)
							})}
							{editingTextIndex === null && caret !== undefined ? (
								<Line
									points={[
										caret.x,
										caret.baseline - metrics.ascender,
										caret.x,
										caret.baseline - metrics.descender,
									]}
									stroke={palette.accent}
									strokeWidth={2 * inverseScale}
									listening={false}
								/>
							) : null}
							{editingPosition === undefined ||
							layer === null ||
							!momentaryPreview ? null : (
								<Group
									x={editingPosition.x}
									y={editingPosition.baseline}
									scaleY={-1}
								>
									<Path
										name="momentary-glyph-preview"
										data={combinedPreview.path}
										fill={palette.previewInk}
										listening={false}
									/>
								</Group>
							)}
							{editingPosition === undefined ||
							layer === null ||
							momentaryPreview ? null : (
								<Group
									x={editingPosition.x}
									y={editingPosition.baseline}
									scaleY={-1}
								>
									{overshootBandSegments.map((segment) => {
										const metricIds = segment.lines.map((line) => line.id)
										return (
											<Rect
												key={`overshoot-band:${segment.minY}:${segment.maxY}:${metricIds.join(":")}`}
												name={`overshoot-band ${metricIds.map((id) => `overshoot-${id}`).join(" ")}`}
												x={-200}
												y={segment.minY}
												width={advanceWidth + 400}
												height={segment.maxY - segment.minY}
												fill={palette.accent}
												opacity={0.09}
												listening={false}
											/>
										)
									})}
									{metricGuides.flatMap((guide) =>
										guide.kind === "band"
											? [
													<Group key={`metric-band:${guide.id}`}>
														<Rect
															x={-200}
															y={guide.minY}
															width={advanceWidth + 400}
															height={Math.max(
																guide.maxY - guide.minY,
																inverseScale,
															)}
															fill={palette.guideSoft}
															opacity={0.12}
															listening={false}
														/>
														<Text
															x={advanceWidth + 12 * inverseScale}
															y={guide.maxY - 4 * inverseScale}
															scaleY={-1}
															text={guide.label}
															fontSize={9 * inverseScale}
															fill={palette.guideStrong}
															listening={false}
														/>
													</Group>,
												]
											: [],
									)}
									{groupedMetricLines.map(({ y, lines }) => {
										const isBaseline = lines.some(
											(line) => line.id === "baseline",
										)
										const isPrimary = lines.some(
											(line) =>
												line.id === "capHeight" || line.id === "xHeight",
										)
										return (
											<Group key={`metric-lines:${y}`}>
												<Line
													points={[-200, y, advanceWidth + 200, y]}
													stroke={
														isBaseline
															? palette.guideStrong
															: isPrimary
																? palette.guideMid
																: palette.guideSoft
													}
													strokeWidth={(isBaseline ? 1.2 : 1) * inverseScale}
													{...(isBaseline || isPrimary
														? {}
														: { dash: [5 * inverseScale, 4 * inverseScale] })}
													listening={false}
												/>
												<Text
													x={-195}
													y={y - 4 * inverseScale}
													scaleY={-1}
													text={lines.map((line) => line.label).join(" · ")}
													fontSize={10 * inverseScale}
													fill={palette.guideStrong}
													listening={false}
												/>
											</Group>
										)
									})}
									{[0, advanceWidth].map((x) => (
										<Line
											key={`vertical-guide:${x}`}
											points={[x, metrics.descender, x, metrics.ascender]}
											stroke={palette.guideSoft}
											strokeWidth={inverseScale}
											listening={false}
										/>
									))}
									{visibleSnaps.map((snap) => {
										const anchorLabel =
											snap.axis === "projection" || snap.anchor === undefined
												? snap.label
												: `Group ${
														snap.axis === "x"
															? snap.anchor === "min"
																? "left"
																: snap.anchor === "max"
																	? "right"
																	: "center"
															: snap.anchor === "min"
																? "bottom"
																: snap.anchor === "max"
																	? "top"
																	: "center"
													} → ${snap.label}`
										return (
											<Group
												key={`active-snap:${snap.axis}:${snap.kind}:${snap.id}`}
												name={`active-snap active-snap-${snap.axis}`}
											>
												<Line
													points={
														snap.axis === "projection"
															? projectionGuidePoints(
																	snap,
																	activeSnapGuideExtent,
																)
															: snap.axis === "x"
																? [
																		snap.value,
																		metrics.descender - 100,
																		snap.value,
																		metrics.ascender + metrics.lineGap + 100,
																	]
																: [
																		-200,
																		snap.value,
																		advanceWidth + 200,
																		snap.value,
																	]
													}
													stroke={palette.accent}
													strokeWidth={1.5 * inverseScale}
													dash={[7 * inverseScale, 4 * inverseScale]}
													listening={false}
												/>
												<Text
													x={
														snap.axis === "projection"
															? snap.origin.x + 5 * inverseScale
															: snap.axis === "x"
																? snap.value + 5 * inverseScale
																: -195
													}
													y={
														snap.axis === "projection"
															? snap.origin.y + 5 * inverseScale
															: snap.axis === "x"
																? metrics.ascender +
																	metrics.lineGap +
																	10 * inverseScale
																: snap.value + 5 * inverseScale
													}
													scaleY={-1}
													text={anchorLabel}
													fontSize={10 * inverseScale}
													fill={palette.accent}
													listening={false}
												/>
											</Group>
										)
									})}
									<Path
										data={combinedPreview.path}
										fill={palette.previewInk}
										opacity={0.1}
										listening={false}
									/>
									<Path
										data={editorContoursToPath(visibleContours)}
										fillEnabled={false}
										stroke={palette.outline}
										strokeWidth={1.25 * inverseScale}
										listening={false}
									/>
									{penCandidateNode === null ? null : (
										<Group listening={false}>
											{penPendingPath === "" ? null : (
												<Path
													name="pen-placement-segment"
													data={penPendingPath}
													fillEnabled={false}
													stroke={palette.accent}
													strokeWidth={1.5 * inverseScale}
													dash={[5 * inverseScale, 4 * inverseScale]}
												/>
											)}
											{penHandles === null
												? null
												: (["incoming", "outgoing"] as const).map((handle) => {
														const vector = penHandles[handle]
														if (vector === undefined) return null
														const endpoint = {
															x: penCandidateNode.x + vector.x,
															y: penCandidateNode.y + vector.y,
														}
														return (
															<Group key={`pen-${handle}`}>
																<Line
																	name={`pen-${handle}-line`}
																	points={[
																		penCandidateNode.x,
																		penCandidateNode.y,
																		endpoint.x,
																		endpoint.y,
																	]}
																	stroke={palette.handleLine}
																	strokeWidth={inverseScale}
																/>
																<Circle
																	name={`pen-${handle}-handle`}
																	x={endpoint.x}
																	y={endpoint.y}
																	radius={3.5 * inverseScale}
																	fill={palette.accent}
																	stroke={palette.nodeStroke}
																	strokeWidth={inverseScale}
																/>
															</Group>
														)
													})}
											<Circle
												name="pen-placement-preview"
												x={penCandidateNode.x}
												y={penCandidateNode.y}
												radius={5 * inverseScale}
												fill={palette.surface}
												stroke={palette.accent}
												strokeWidth={1.5 * inverseScale}
											/>
										</Group>
									)}
									{visibleContours.map((contour) => (
										<Path
											key={`segment-hit:${contour.id}`}
											name="outline-segment"
											data={editorContourToPath(contour.nodes, contour.closed)}
											fillEnabled={false}
											stroke="rgb(0 0 0 / 0.001)"
											strokeWidth={inverseScale}
											hitStrokeWidth={SEGMENT_HIT_RADIUS_PX * 2 * inverseScale}
											listening={
												activeTool === "select" || activeTool === "pen"
											}
											onPointerDown={(event) => {
												if (activeTool !== "pen") return
												event.cancelBubble = true
												if (penPointerAction("segment") === "split")
													splitContourSegment(contour, event)
											}}
											onMouseDown={(event) => {
												if (activeTool !== "select") return
												const action = segmentPointerAction(
													activeTool,
													event.evt,
												)
												if (action === "add-handles") {
													addHandlesToSegment(contour, event)
												}
											}}
										/>
									))}
									{showNodes
										? visibleContours.map((contour, contourIndex) => {
												const direction = contourStartDirection(contour.nodes)
												const directionRadians =
													((direction?.angle ?? 0) * Math.PI) / 180
												return (
													<Group key={`handles:${contourIndex}`}>
														{contour.nodes.map((point) => (
															<Group key={`controls:${point.pointId}`}>
																{point.incoming === undefined ? null : (
																	<Line
																		key={`incoming-line:${point.pointId}`}
																		points={[
																			point.x,
																			point.y,
																			point.x + point.incoming.x,
																			point.y + point.incoming.y,
																		]}
																		stroke={palette.handleLine}
																		strokeWidth={inverseScale}
																		listening={false}
																	/>
																)}
																{point.outgoing === undefined ? null : (
																	<Line
																		key={`outgoing-line:${point.pointId}`}
																		points={[
																			point.x,
																			point.y,
																			point.x + point.outgoing.x,
																			point.y + point.outgoing.y,
																		]}
																		stroke={palette.handleLine}
																		strokeWidth={inverseScale}
																		listening={false}
																	/>
																)}
															</Group>
														))}
														{contour.nodes.map((point, pointIndex) => {
															const sourcePoint =
																contours[contourIndex]?.nodes[pointIndex] ??
																point
															const isPathEndpoint =
																!contour.closed &&
																(pointIndex === 0 ||
																	pointIndex === contour.nodes.length - 1)
															const endpointNormal = isPathEndpoint
																? (contourEndpointNormal(
																		contour.nodes,
																		pointIndex,
																		contour.closed,
																	) ?? { x: 0, y: 1 })
																: null
															const metricAlignment =
																resolveVerticalMetricAlignment(
																	point.y,
																	metricGuides,
																)
															const nodeTarget: EditorSelectionTarget = {
																kind: "node",
																pointId: point.pointId,
															}
															const controlHitRadius = (
																target: EditorSelectionTarget,
																penRadiusPx: number,
															): number =>
																(activeTool === "pen"
																	? penRadiusPx
																	: (hitControlRadii.get(
																			selectionKey(target),
																		) ?? CONTROL_HIT_RADIUS_PX)) * inverseScale
															const selectPoint = (
																event?: KonvaEventObject<
																	MouseEvent | PointerEvent | TouchEvent
																>,
															): void => {
																if (activeTool === "pen") {
																	if (event !== undefined)
																		event.cancelBubble = true
																	return
																}
																selectTarget(nodeTarget, event?.evt)
															}
															const selectHandle = (
																handle: EditorHandleKind,
																event?: KonvaEventObject<
																	MouseEvent | PointerEvent | TouchEvent
																>,
															): void => {
																if (activeTool === "pen") {
																	if (event !== undefined)
																		event.cancelBubble = true
																	return
																}
																selectTarget(
																	{
																		kind: "handle",
																		pointId: point.pointId,
																		handle,
																	},
																	event?.evt,
																)
															}
															const togglePointMode = (
																event: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															): void => {
																event.cancelBubble = true
																setSelection(Object.freeze([nodeTarget]))
																toggleNodeMode(point.pointId, point.mode)
															}
															const dragHandle = (
																handle: EditorHandleKind,
																event: KonvaEventObject<DragEvent>,
															): DraggedHandle => ({
																pointId: point.pointId,
																handle,
																vector: {
																	x: Math.round(event.target.x() - point.x),
																	y: Math.round(event.target.y() - point.y),
																},
															})
															const rawPointForDrag = (
																drag: PointDrag,
																event: KonvaEventObject<DragEvent>,
															): Readonly<{ x: number; y: number }> => {
																const pointer = pointerInEditingGlyph(event)
																return pointer === null
																	? { x: event.target.x(), y: event.target.y() }
																	: {
																			x:
																				drag.origin.x +
																				(pointer.x - drag.startPointer.x),
																			y:
																				drag.origin.y +
																				(pointer.y - drag.startPointer.y),
																		}
															}
															const beginPointDrag = (
																event: KonvaEventObject<DragEvent>,
															): void => {
																selectPoint(event)
																const startPointer = pointerInEditingGlyph(
																	event,
																) ?? {
																	x: point.x,
																	y: point.y,
																}
																pointDragRef.current = {
																	pointId: point.pointId,
																	origin: { x: point.x, y: point.y },
																	startPointer,
																	projectionCandidates:
																		incidentStraightProjectionCandidates(
																			contours,
																			point.pointId,
																		),
																	target: event.target,
																	lastRawPoint: null,
																}
															}
															const nodeProps = {
																id: point.pointId,
																name: "outline-point",
																x: point.x,
																y: point.y,
																fill: palette.nodeFill,
																stroke: palette.nodeStroke,
																strokeWidth: 1.25 * inverseScale,
																draggable: activeTool === "select",
																onPointerDown: (
																	event: KonvaEventObject<PointerEvent>,
																) => {
																	if (activeTool !== "pen") return
																	event.cancelBubble = true
																	const isClosureTarget =
																		contour.id === penContourId &&
																		pointIndex ===
																			(penDirection === "prepend"
																				? contour.nodes.length - 1
																				: 0) &&
																		contour.nodes.length >= 3
																	const action = penPointerAction(
																		isClosureTarget
																			? "first-node"
																			: isPathEndpoint
																				? "open-endpoint"
																				: "control",
																	)
																	if (action === "close") {
																		beginPenGesture(event, {
																			pointId: point.pointId,
																			x: point.x,
																			y: point.y,
																		})
																	} else if (action === "resume") {
																		beginPenGesture(event, undefined, {
																			contourId: contour.id,
																			pointId: point.pointId,
																			x: point.x,
																			y: point.y,
																			side: pointIndex === 0 ? "first" : "last",
																			mode: sourcePoint.mode,
																			...(sourcePoint.incoming === undefined
																				? {}
																				: { incoming: sourcePoint.incoming }),
																			...(sourcePoint.outgoing === undefined
																				? {}
																				: { outgoing: sourcePoint.outgoing }),
																		})
																	}
																},
																onDblClick: togglePointMode,
																onDblTap: togglePointMode,
																onDragStart: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	if (
																		!beginGroupDrag(
																			nodeTarget,
																			point.x,
																			point.y,
																			event.target,
																		)
																	) {
																		beginPointDrag(event)
																	}
																},
																onDragMove: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	if (previewGroupDrag(event)) return
																	const drag = pointDragRef.current
																	if (drag?.pointId !== point.pointId) return
																	applyPointDrag(
																		drag,
																		rawPointForDrag(drag, event),
																		event.evt.shiftKey,
																	)
																},
																onDragEnd: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	if (commitGroupDrag(event)) return
																	const drag = pointDragRef.current
																	if (drag?.pointId !== point.pointId) return
																	const committed = applyPointDrag(
																		drag,
																		rawPointForDrag(drag, event),
																		event.evt.shiftKey,
																	)
																	event.target.position({
																		x: committed.x,
																		y: committed.y,
																	})
																	commitPoint(committed)
																	pointDragRef.current = null
																	setDraggedPoint(null)
																	setActiveSnaps([])
																},
															}
															return (
																<Group key={`node:${point.pointId}`}>
																	{metricAlignment?.kind === "line" ? (
																		<Rect
																			name={`metric-alignment metric-alignment-line ${metricAlignment.lines
																				.map((match) => `metric-${match.id}`)
																				.join(" ")}`}
																			x={point.x}
																			y={point.y}
																			width={14 * inverseScale}
																			height={14 * inverseScale}
																			offsetX={7 * inverseScale}
																			offsetY={7 * inverseScale}
																			rotation={45}
																			stroke={palette.accent}
																			strokeWidth={1.5 * inverseScale}
																			opacity={0.82}
																			listening={false}
																		/>
																	) : metricAlignment?.kind === "overshoot" ? (
																		<Circle
																			name={`metric-alignment metric-alignment-overshoot ${metricAlignment.lines
																				.map((match) => `metric-${match.id}`)
																				.join(" ")}`}
																			x={point.x}
																			y={point.y}
																			radius={7.5 * inverseScale}
																			stroke={palette.accent}
																			strokeWidth={1.5 * inverseScale}
																			opacity={0.82}
																			listening={false}
																		/>
																	) : null}
																	{point.incoming === undefined ? null : (
																		<Group
																			key={`incoming-control:${point.pointId}`}
																		>
																			<Circle
																				key={`incoming-handle:${point.pointId}`}
																				name="bezier-handle"
																				x={point.x + point.incoming.x}
																				y={point.y + point.incoming.y}
																				radius={3.5 * inverseScale}
																				fill={palette.accent}
																				stroke={palette.nodeStroke}
																				strokeWidth={inverseScale}
																				hitFunc={circularHitRegion(
																					controlHitRadius(
																						{
																							kind: "handle",
																							pointId: point.pointId,
																							handle: "incoming",
																						},
																						3.5,
																					),
																				)}
																				draggable={activeTool === "select"}
																				onPointerDown={(
																					event: KonvaEventObject<PointerEvent>,
																				) => {
																					if (activeTool === "pen")
																						selectHandle("incoming", event)
																				}}
																				onDblClick={(event) => {
																					event.cancelBubble = true
																					selectHandle("incoming", event)
																				}}
																				onDblTap={(event) => {
																					event.cancelBubble = true
																					selectHandle("incoming", event)
																				}}
																				onDragStart={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					const incoming = point.incoming
																					if (incoming === undefined) return
																					const startedGroup = beginGroupDrag(
																						{
																							kind: "handle",
																							pointId: point.pointId,
																							handle: "incoming",
																						},
																						point.x + incoming.x,
																						point.y + incoming.y,
																						event.target,
																					)
																					if (!startedGroup)
																						selectHandle("incoming", event)
																				}}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (previewGroupDrag(event)) return
																					setDraggedHandle(
																						dragHandle("incoming", event),
																					)
																				}}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (commitGroupDrag(event)) return
																					commitHandle(
																						dragHandle("incoming", event),
																					)
																					setDraggedHandle(null)
																				}}
																			/>
																			{isSelected({
																				kind: "handle",
																				pointId: point.pointId,
																				handle: "incoming",
																			}) ? (
																				<Circle
																					x={point.x + point.incoming.x}
																					y={point.y + point.incoming.y}
																					radius={8 * inverseScale}
																					stroke={palette.accent}
																					strokeWidth={2 * inverseScale}
																					listening={false}
																				/>
																			) : null}
																		</Group>
																	)}
																	{point.outgoing === undefined ? null : (
																		<Group
																			key={`outgoing-control:${point.pointId}`}
																		>
																			<Circle
																				key={`outgoing-handle:${point.pointId}`}
																				name="bezier-handle"
																				x={point.x + point.outgoing.x}
																				y={point.y + point.outgoing.y}
																				radius={3.5 * inverseScale}
																				fill={palette.accent}
																				stroke={palette.nodeStroke}
																				strokeWidth={inverseScale}
																				hitFunc={circularHitRegion(
																					controlHitRadius(
																						{
																							kind: "handle",
																							pointId: point.pointId,
																							handle: "outgoing",
																						},
																						3.5,
																					),
																				)}
																				draggable={activeTool === "select"}
																				onPointerDown={(
																					event: KonvaEventObject<PointerEvent>,
																				) => {
																					if (activeTool === "pen")
																						selectHandle("outgoing", event)
																				}}
																				onDblClick={(event) => {
																					event.cancelBubble = true
																					selectHandle("outgoing", event)
																				}}
																				onDblTap={(event) => {
																					event.cancelBubble = true
																					selectHandle("outgoing", event)
																				}}
																				onDragStart={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					const outgoing = point.outgoing
																					if (outgoing === undefined) return
																					const startedGroup = beginGroupDrag(
																						{
																							kind: "handle",
																							pointId: point.pointId,
																							handle: "outgoing",
																						},
																						point.x + outgoing.x,
																						point.y + outgoing.y,
																						event.target,
																					)
																					if (!startedGroup)
																						selectHandle("outgoing", event)
																				}}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (previewGroupDrag(event)) return
																					setDraggedHandle(
																						dragHandle("outgoing", event),
																					)
																				}}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (commitGroupDrag(event)) return
																					commitHandle(
																						dragHandle("outgoing", event),
																					)
																					setDraggedHandle(null)
																				}}
																			/>
																			{isSelected({
																				kind: "handle",
																				pointId: point.pointId,
																				handle: "outgoing",
																			}) ? (
																				<Circle
																					x={point.x + point.outgoing.x}
																					y={point.y + point.outgoing.y}
																					radius={8 * inverseScale}
																					stroke={palette.accent}
																					strokeWidth={2 * inverseScale}
																					listening={false}
																				/>
																			) : null}
																		</Group>
																	)}
																	{isSelected(nodeTarget) ? (
																		<Circle
																			key={`selection:${point.pointId}`}
																			x={point.x}
																			y={point.y}
																			radius={10 * inverseScale}
																			stroke={palette.accent}
																			strokeWidth={2 * inverseScale}
																			listening={false}
																		/>
																	) : null}
																	{endpointNormal !== null ? (
																		<Line
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			points={[
																				-endpointNormal.x * 6 * inverseScale,
																				-endpointNormal.y * 6 * inverseScale,
																				endpointNormal.x * 6 * inverseScale,
																				endpointNormal.y * 6 * inverseScale,
																			]}
																			strokeWidth={2 * inverseScale}
																			hitFunc={circularHitRegion(
																				controlHitRadius(nodeTarget, 6),
																			)}
																			lineCap="round"
																		/>
																	) : point.mode === "soft" ? (
																		<Circle
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			radius={5 * inverseScale}
																			hitFunc={circularHitRegion(
																				controlHitRadius(nodeTarget, 5),
																			)}
																		/>
																	) : (
																		<Rect
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			width={9 * inverseScale}
																			height={9 * inverseScale}
																			offsetX={4.5 * inverseScale}
																			offsetY={4.5 * inverseScale}
																			hitFunc={circularHitRegion(
																				controlHitRadius(nodeTarget, 6.5),
																				{
																					x: 4.5 * inverseScale,
																					y: 4.5 * inverseScale,
																				},
																			)}
																		/>
																	)}
																	{pointIndex === 0 && direction !== null ? (
																		<Line
																			key={`direction:${point.pointId}`}
																			x={
																				point.x +
																				Math.cos(directionRadians) *
																					9 *
																					inverseScale
																			}
																			y={
																				point.y +
																				Math.sin(directionRadians) *
																					9 *
																					inverseScale
																			}
																			points={[
																				4 * inverseScale,
																				0,
																				-3 * inverseScale,
																				3 * inverseScale,
																				-3 * inverseScale,
																				-3 * inverseScale,
																			]}
																			rotation={direction.angle}
																			closed
																			fill={palette.accent}
																			stroke={palette.nodeStroke}
																			strokeWidth={1.25 * inverseScale}
																			listening={false}
																		/>
																	) : null}
																</Group>
															)
														})}
													</Group>
												)
											})
										: null}
									{activeTool !== "transform" ||
									transformBounds === null ? null : (
										<Group>
											<Rect
												name="transform-selection-box"
												x={transformBounds.minX}
												y={transformBounds.minY}
												width={Math.max(
													transformBounds.maxX - transformBounds.minX,
													2 * inverseScale,
												)}
												height={Math.max(
													transformBounds.maxY - transformBounds.minY,
													2 * inverseScale,
												)}
												fill={palette.accent}
												opacity={0.06}
												stroke={palette.accent}
												strokeWidth={1.5 * inverseScale}
												draggable
												onDragStart={() => beginTransform("inside")}
												onDragMove={previewTransformDrag}
												onDragEnd={commitTransform}
											/>
											{(
												[
													[
														"north-west",
														transformBounds.minX,
														transformBounds.maxY,
													],
													[
														"north",
														(transformBounds.minX + transformBounds.maxX) / 2,
														transformBounds.maxY,
													],
													[
														"north-east",
														transformBounds.maxX,
														transformBounds.maxY,
													],
													[
														"east",
														transformBounds.maxX,
														(transformBounds.minY + transformBounds.maxY) / 2,
													],
													[
														"south-east",
														transformBounds.maxX,
														transformBounds.minY,
													],
													[
														"south",
														(transformBounds.minX + transformBounds.maxX) / 2,
														transformBounds.minY,
													],
													[
														"south-west",
														transformBounds.minX,
														transformBounds.minY,
													],
													[
														"west",
														transformBounds.minX,
														(transformBounds.minY + transformBounds.maxY) / 2,
													],
												] as const
											).map(([handle, x, y]) => (
												<Circle
													key={`transform:${handle}`}
													name={`transform-${handle}`}
													x={x}
													y={y}
													radius={5.5 * inverseScale}
													fill={palette.surface}
													stroke={palette.accent}
													strokeWidth={1.5 * inverseScale}
													hitStrokeWidth={12 * inverseScale}
													draggable
													onDragStart={() => {
														setTransformCursor(transformHandleCursor(handle))
														beginTransform(handle)
													}}
													onDragMove={previewTransformDrag}
													onDragEnd={() => {
														commitTransform()
														setTransformCursor(null)
													}}
													onMouseEnter={() =>
														setTransformCursor(transformHandleCursor(handle))
													}
													onMouseLeave={() => {
														if (transformDrag === null) setTransformCursor(null)
													}}
												/>
											))}
										</Group>
									)}
									{visualDebug["hit-targets"] && activeTool === "select" ? (
										<Group name="visual-debug-hit-targets" listening={false}>
											{visibleContours.map((contour) => (
												<Path
													key={`visual-debug-segment:${contour.id}`}
													name="visual-debug-segment-hit"
													data={editorContourToPath(
														contour.nodes,
														contour.closed,
													)}
													fillEnabled={false}
													stroke="#228b22"
													strokeWidth={SEGMENT_HIT_RADIUS_PX * 2 * inverseScale}
													opacity={0.12}
													listening={false}
												/>
											))}
											{debugControlRegions.flatMap((region) =>
												region.radiusPx === 0
													? []
													: [
															<Circle
																key={`visual-debug-control:${region.key}`}
																name="visual-debug-control-hit"
																x={region.x}
																y={region.y}
																radius={region.radiusPx * inverseScale}
																fill="#228b22"
																stroke="#166534"
																strokeWidth={inverseScale}
																opacity={0.18}
																listening={false}
															/>,
														],
											)}
										</Group>
									) : null}
									{selectionBox === null ? null : (
										<Rect
											x={Math.min(selectionBox.startX, selectionBox.endX)}
											y={Math.min(selectionBox.startY, selectionBox.endY)}
											width={Math.abs(selectionBox.endX - selectionBox.startX)}
											height={Math.abs(selectionBox.endY - selectionBox.startY)}
											fill={palette.accent}
											opacity={0.14}
											stroke={palette.accent}
											strokeWidth={inverseScale}
											listening={false}
										/>
									)}
								</Group>
							)}
						</Group>
					</Layer>
				</Stage>
			</canvas-surface>
			<p id="canvas-instructions">
				Type and add line breaks normally. Scroll to pan; use Command, Control,
				Option, or Alt with the wheel to zoom. Double-click a glyph to edit its
				outline. Double-click an outline segment to select its path; use the Pen
				Tool on a segment to insert a point, or Option/Alt-click a straight
				segment to add curve handles. Click with the Pen for a corner or press
				and drag for opposite Bézier handles. Hold Shift to constrain node
				drags, Pen placement, or Pen handles; click or drag a loose endpoint to
				resume its path, and Option/Alt-drag to break its tangent. Hold E for a
				clean glyph preview. Press Escape to cancel a Pen gesture, return to
				typing, or cancel a transform. Drag an empty area to box-select
				controls; press Command or Control+A to select all, Shift+A to align,
				and Delete to remove the selection. Use Command or Control+C and V to
				copy and paste outline selections. Hold Option or Alt while deleting
				nodes to break paths open, or while deleting a handle to remove its
				adjoining segment.
			</p>
			<output role="status" aria-live="polite">
				{clipboardStatus ??
					(momentaryPreview
						? `Momentary preview of ${glyph?.name ?? "glyph"}.`
						: editingTextIndex === null
							? `Typing mode at text position ${caretIndex}.`
							: activeTool === "pen" && penPlacement !== null
								? `Pen ${penGestureResolution?.kind === "curve" ? "curve " : ""}preview at ${penPlacement.x}, ${penPlacement.y}.`
								: selection.length === 0
									? `Editing ${glyph?.name ?? "glyph"}; no outline controls selected.`
									: selection.length === 1 && selectedPoint !== undefined
										? `${selectedPoint.mode === "soft" ? "Soft" : "Hard"} node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`
										: `${selection.length} outline controls selected.`)}
			</output>
		</glyph-canvas>
	)
}
