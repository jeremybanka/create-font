import type {
	ContourId,
	EditorHandleKind,
	EditorLayerNode,
	GlyphId,
	MasterId,
	PointId,
	RuleId,
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
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "preact/hooks"

import {
	finalizeGroupDragPreview,
	isCancelledGroupDragEnd,
	restoreCancelledGroupDragTarget,
	type CancelledGroupDrag,
} from "./canvas-group-drag.ts"
import {
	createAnimationFramePublisher,
	type AnimationFramePublisher,
} from "./animation-frame-publisher.ts"
import { transformHandleCursor, type TransformHandle } from "./canvas-cursor.ts"
import {
	circularHitRegion,
	CONTROL_HIT_RADIUS_PX,
	editorControlHitCandidates,
	editorControlHitRadii,
	nearestEditorControlHit,
	resolveEditorCanvasHit,
	selectionOwnsEditorSegment,
	SEGMENT_HIT_RADIUS_PX,
} from "./canvas-hit-testing.ts"
import {
	BASE_CANVAS_SCALE,
	initializeCanvasView,
	zoomCanvasView,
} from "./canvas-view.ts"
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
	previewHandleDrag,
	resolveHandleEdit,
	segmentPointerAction,
	shouldActivateEditorControl,
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
	editorContourPaintPaths,
	nearestEditorSegment,
} from "./geometry.ts"
import css from "./GlyphCanvas.module.css"
import { IS_MAC_LIKE } from "./editor-tools-and-hotkeys.ts"
import { keyboardStepMultiplier } from "./keyboard-step.ts"
import {
	canStartBoxSelectionOn,
	boundsOfControls,
	combineMarqueeSelection,
	contourSelectionTargets,
	controlsInsideBounds,
	marqueeSelectionMode,
	resolveSelectionControls,
	rotateSelectionControls,
	scaleSelectionControls,
	selectionForRigidTranslation,
	selectionKey,
	translateSelectionControls,
	type EditorSelectionTarget,
	type ResolvedSelectionControl,
	type SelectionBounds,
	type MarqueeSelectionMode,
	type SelectionTransformResult,
} from "./outline-selection.ts"
import {
	directDragOwnsPointer,
	planFixedHandleNodeMove,
	planControlledSelectionDrag,
	planSelectedHardNodeNudge,
	planSelectionNudge,
	projectSelectionTransformPreview,
	rememberedTangentDirection,
	resolveTangentSlide,
	selectedTangentSlideConstraint,
	tangentSlideConstraint,
	type TangentSlideConstraint,
	type TangentDirectionMemory,
	type TangentSlideResolution,
} from "./select-editing.ts"
import {
	penEndpointHandleBeingReplaced,
	penDraggedHandle,
	penGestureHandles,
	penLayerCoordinates,
	penPointerAction,
	resolvePenEndpoint,
	resolvePenEndpointSide,
	resolvePenGesture,
	type PenEndpointResolution,
	type PenEndpointSide,
	type PenGestureResolution,
	type PenHandleKind,
	type PenPoint,
} from "./pen-gesture.ts"
import {
	resolveShapeGesture,
	shapeGeometry,
	shapeLayerCoordinates,
	shapeSnapsForDisplay,
	type ShapeDragDirection,
	type ShapeGestureResolution,
	type ShapeToolKind,
} from "./shape-gesture.ts"
import {
	resolveTransformResize,
	resolveTransformRotation,
	TRANSFORM_ROTATION_SNAP_DEGREES,
} from "./transform-gesture.ts"
import {
	finalizePointDragPreview,
	hasSelectedCoincidentEndpointPeer,
	resolveMovedEndpointJoin,
	resolveOpenEndpointTarget,
	type EndpointJoinCandidate,
	type OpenEndpointTarget,
} from "./topology-tools.ts"
import {
	isEditablePreviewTarget,
	isMomentaryPreviewKey,
	shouldStartMomentaryPreview,
} from "./momentary-preview.ts"
import { useI, useO, useOF, useOptionalOF } from "./state-hooks.ts"
import { useCanvasTheme } from "./use-canvas-theme.ts"
import { useElementSize } from "./use-element-size.ts"
import {
	activeTextareaSelectionIndex,
	moveTextareaSelectionVertically,
	normalizedTextareaSelection,
	observeTextareaSelection,
} from "./textarea-selection.ts"
import {
	layoutTextRun,
	nearestCaretIndex,
	textSelectionRects,
} from "./text-layout.ts"
import {
	OUTLINE_CLIPBOARD_MIME,
	outlinePasteSelectionTargets,
	parseOutlineClipboard,
	prepareOutlinePaste,
	prepareOutlineClipboardCopy,
	writeOutlineClipboard,
} from "./outline-clipboard.ts"
import {
	createRuleClipboardPayload,
	parseRuleClipboard,
	pastedRules,
	RULE_CLIPBOARD_MIME,
} from "./rule-clipboard.ts"
import { measureRule, ruleViewportEndpoints } from "./rule-geometry.ts"
import {
	compatibilityNodeTraceStyle,
	compatibilityPathColor,
	visualDebugControlRegions,
} from "./visual-debug.ts"
import type { EditorVersionControl } from "./version-control.ts"

export interface GlyphCanvasProps {
	readonly workspace: EditorWorkspace
	readonly disabled?: boolean
	readonly diffView?: boolean
	readonly versionControl?: EditorVersionControl
}

interface DraggedPoint {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

interface PointDrag {
	readonly pointerId: number | null
	readonly captureTarget: HTMLCanvasElement | null
	readonly captureCancelListener: ((event: PointerEvent) => void) | null
	readonly glyphId: GlyphId
	readonly masterId: MasterId
	readonly pointId: PointId
	readonly contourId: ContourId
	readonly joinEligible: boolean
	readonly fixedHandleNode: EditorLayerNode | null
	readonly origin: Readonly<{ x: number; y: number }>
	readonly startPointer: Readonly<{ x: number; y: number }>
	readonly projectionCandidates: readonly SegmentProjectionCandidate[]
	readonly target: DragPositionTarget & {
		getLayer(): Readonly<{ batchDraw(): unknown }> | null
	}
	readonly tangentEligible: boolean
	readonly tangentConstraint: TangentSlideConstraint | null
	lastRawPoint: Readonly<{ x: number; y: number }> | null
	joinTarget: OpenEndpointTarget | null
}

interface DraggedHandle {
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	readonly storageVector: Readonly<{ x: number; y: number }>
	readonly vector: Readonly<{ x: number; y: number }>
}

interface HandleDrag {
	readonly pointerId: number | null
	readonly captureTarget: HTMLCanvasElement | null
	readonly captureCancelListener: ((event: PointerEvent) => void) | null
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	readonly node: EditorLayerNode
	readonly startPointer: Readonly<{ x: number; y: number }>
	readonly startEndpoint: Readonly<{ x: number; y: number }>
	readonly target: DragPositionTarget
	lastRawEndpoint: Readonly<{ x: number; y: number }> | null
}

type PointDragResolution =
	| Readonly<{ kind: "point"; point: DraggedPoint }>
	| Readonly<{
			kind: "fixed-handles"
			resolution: SelectionTransformResult
	  }>
	| Readonly<{ kind: "tangent"; resolution: TangentSlideResolution }>
	| Readonly<{ kind: "blocked" }>

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

interface PenHoverPreview {
	readonly pointer: PenPoint
	shiftKey: boolean
	altKey: boolean
}

interface ShapeDragSession {
	readonly pointerId: number
	readonly kind: ShapeToolKind
	readonly anchor: PenPoint
	readonly downScreen: PenPoint
	readonly captureTarget: HTMLCanvasElement | null
	readonly captureCancelListener: ((event: PointerEvent) => void) | null
	rawCandidate: PenPoint
	snappedCandidate: PenPoint
	snaps: readonly ActiveSnap[]
	currentScreen: PenPoint
	direction: ShapeDragDirection
	shiftKey: boolean
	altKey: boolean
}

type PenPreviewFrame =
	| Readonly<{ kind: "hover"; preview: PenHoverPreview }>
	| Readonly<{ kind: "gesture"; gesture: PenPlacementGesture }>

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
	readonly mode: MarqueeSelectionMode
}

interface TransformDrag {
	readonly handle: TransformHandle
	readonly controls: readonly ResolvedSelectionControl[]
	readonly bounds: SelectionBounds
	readonly startX: number
	readonly startY: number
	targetX: number
	targetY: number
	shiftKey: boolean
	altKey: boolean
}

interface GroupDrag {
	readonly pointerId: number | null
	readonly captureTarget: HTMLCanvasElement | null
	readonly captureCancelListener: ((event: PointerEvent) => void) | null
	readonly glyphId: GlyphId
	readonly masterId: MasterId
	readonly targetX: number
	readonly targetY: number
	readonly node: LiveGroupDragTarget["node"]
	readonly controls: readonly ResolvedSelectionControl[]
	readonly selection: readonly EditorSelectionTarget[]
	readonly bounds: SelectionBounds
	readonly selectedPointIds: ReadonlySet<PointId>
	readonly controllerPointId: PointId | null
	readonly tangentDirections: ReadonlyMap<
		PointId,
		Readonly<{ x: number; y: number }>
	>
	readonly restoreTargetAfterCommit: boolean
	lastRawDelta: Readonly<{ x: number; y: number }> | null
	joinCandidate: EndpointJoinCandidate | null
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

export function GlyphCanvas({
	workspace,
	disabled = false,
	diffView = false,
	versionControl,
}: GlyphCanvasProps) {
	const palette = useCanvasTheme()
	const text = useO(workspace.ui.previewText)
	const setText = useI(workspace.ui.previewText)
	const caretIndex = useO(workspace.ui.caretIndex)
	const setCaretIndex = useI(workspace.ui.caretIndex)
	const setTextSelectionCollapsed = useI(workspace.ui.textSelectionCollapsed)
	const textSelectionRange = useO(workspace.ui.textSelectionRange)
	const setTextSelectionRange = useI(workspace.ui.textSelectionRange)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const activeTool = useO(workspace.ui.activeTool)
	const run = useO(workspace.ui.previewRun)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const comparisonMasterId = useO(workspace.ui.comparisonMasterId)
	const glyph = useOptionalOF(
		workspace.font.selectors.editorGlyphSource,
		activeGlyphId,
	)
	const compatibilityKey = useMemo(
		() =>
			activeGlyphId === null
				? null
				: ([comparisonMasterId, activeMasterId, activeGlyphId] as const),
		[activeGlyphId, activeMasterId, comparisonMasterId],
	)
	const compatibility = useOptionalOF(
		workspace.font.selectors.glyphCompatibility,
		compatibilityKey,
	)
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
	const showMeasures = useO(workspace.ui.showMeasures)
	const selectedRuleIds = useO(workspace.ui.selectedRuleIds)
	const setSelectedRuleIds = useI(workspace.ui.selectedRuleIds)
	const visualDebug = useO(workspace.ui.visualDebug)
	const compatibilityOffsetPixels = useO(workspace.ui.compatibilityGhostOffset)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const [draggedHandle, setDraggedHandle] = useState<DraggedHandle | null>(null)
	const [activeSnaps, setActiveSnaps] = useState<readonly ActiveSnap[]>([])
	const [joinTarget, setJoinTarget] = useState<OpenEndpointTarget | null>(null)
	const [shiftHeld, setShiftHeld] = useState(false)
	const [textareaFocused, setTextareaFocused] = useState(false)
	const [altHeld, setAltHeld] = useState(false)
	const [handleConstraintGuide, setHandleConstraintGuide] = useState<Readonly<{
		x: number
		y: number
		vector: Readonly<{ x: number; y: number }>
	}> | null>(null)
	const [tangentGuide, setTangentGuide] =
		useState<TangentSlideConstraint | null>(null)
	const [penPointer, setPenPointer] = useState<Readonly<{
		x: number
		y: number
	}> | null>(null)
	const [penGesture, setPenGesture] = useState<PenPlacementGesture | null>(null)
	const [shapeGesture, setShapeGesture] = useState<ShapeDragSession | null>(
		null,
	)
	const [shapeHoverSnaps, setShapeHoverSnaps] = useState<readonly ActiveSnap[]>(
		[],
	)
	const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
	const [transformDrag, setTransformDrag] = useState<TransformDrag | null>(null)
	const transformDragRef = useRef<TransformDrag | null>(null)
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
	const shapeEntitySequence = useRef(0)
	const clipboardEntitySequence = useRef(0)
	const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
	const [pendingRulePoint, setPendingRulePoint] = useState<Readonly<{
		x: number
		y: number
	}> | null>(null)
	const penContourResumeRef = useRef<ContourId | null>(null)
	const penGestureRef = useRef<PenPlacementGesture | null>(null)
	const penHoverRef = useRef<PenHoverPreview | null>(null)
	const penPreviewPublisherRef =
		useRef<AnimationFramePublisher<PenPreviewFrame> | null>(null)
	if (penPreviewPublisherRef.current === null) {
		penPreviewPublisherRef.current = createAnimationFramePublisher((frame) => {
			if (frame.kind === "gesture") {
				if (penGestureRef.current?.pointerId !== frame.gesture.pointerId) return
				setPenGesture(frame.gesture)
				return
			}
			if (penGestureRef.current !== null || penHoverRef.current === null) return
			setShiftHeld(frame.preview.shiftKey)
			setPenPointer(frame.preview.pointer)
		})
	}
	const penPreviewPublisher = penPreviewPublisherRef.current
	const shapeGestureRef = useRef<ShapeDragSession | null>(null)
	const shapePreviewPublisherRef =
		useRef<AnimationFramePublisher<ShapeDragSession> | null>(null)
	if (shapePreviewPublisherRef.current === null) {
		shapePreviewPublisherRef.current = createAnimationFramePublisher(
			(gesture) => {
				if (shapeGestureRef.current?.pointerId !== gesture.pointerId) return
				setShapeGesture(gesture)
			},
		)
	}
	const shapePreviewPublisher = shapePreviewPublisherRef.current
	const shapeHoverPublisherRef = useRef<AnimationFramePublisher<
		readonly ActiveSnap[]
	> | null>(null)
	if (shapeHoverPublisherRef.current === null) {
		shapeHoverPublisherRef.current = createAnimationFramePublisher((snaps) => {
			if (shapeGestureRef.current !== null) return
			setShapeHoverSnaps(snaps)
		})
	}
	const shapeHoverPublisher = shapeHoverPublisherRef.current
	const clearShapeHoverGuides = (): void => {
		shapeHoverPublisher.cancel()
		setShapeHoverSnaps([])
	}
	const schedulePenGesturePreview = (gesture: PenPlacementGesture): void => {
		penPreviewPublisher.schedule({ kind: "gesture", gesture: { ...gesture } })
	}
	const clearPenHoverPreview = (): void => {
		penPreviewPublisher.cancel()
		penHoverRef.current = null
		setPenPointer(null)
	}
	const pointDragRef = useRef<PointDrag | null>(null)
	const handleDragRef = useRef<HandleDrag | null>(null)
	const directDragPointerRef = useRef<number | null>(null)
	const directDragCaptureTargetRef = useRef<HTMLCanvasElement | null>(null)
	const tangentDirectionRef = useRef<TangentDirectionMemory | null>(null)
	const cancelledGroupDrag = useRef<CancelledGroupDrag<
		LiveGroupDragTarget["node"]
	> | null>(null)
	const view = useO(workspace.ui.canvasView)
	const setView = useI(workspace.ui.canvasView)
	const canvasViewport = useO(workspace.ui.canvasViewport)
	const setCanvasViewport = useI(workspace.ui.canvasViewport)
	const rootRef = useRef<HTMLElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const preferredCaretXRef = useRef<number | null>(null)
	const {
		ref,
		width,
		height,
		usable: hasUsableCanvasSize,
	} = useElementSize<HTMLElement>()
	useEffect(() => {
		if (!hasUsableCanvasSize) return
		const nextViewport = { width, height }
		setView((current) =>
			initializeCanvasView(current, canvasViewport, nextViewport),
		)
		setCanvasViewport((current) =>
			current.width === width && current.height === height
				? current
				: nextViewport,
		)
	}, [
		canvasViewport,
		hasUsableCanvasSize,
		height,
		setCanvasViewport,
		setView,
		width,
	])
	const layout = useMemo(
		() => layoutTextRun(run, metrics, metadata.unitsPerEm),
		[run, metadata.unitsPerEm, metrics],
	)
	const editingPosition = layout.glyphs.find(
		(position) => position.item.textStart === editingTextIndex,
	)
	const contours = layer?.contours ?? []
	const comparisonContours = useMemo(() => {
		const sourceLayer = glyph?.layers.find(
			(candidate) => candidate.masterId === comparisonMasterId,
		)
		return (
			sourceLayer?.contours.map((contour) => ({
				id: contour.id,
				closed: contour.closed,
				nodes: contour.points.map((point) => ({
					pointId: point.id,
					mode: point.mode,
					x: point.x,
					y: point.y,
					...(point.incoming === undefined ? {} : { incoming: point.incoming }),
					...(point.outgoing === undefined ? {} : { outgoing: point.outgoing }),
				})),
			})) ?? []
		)
	}, [comparisonMasterId, glyph])
	const diffBaselineContours = useMemo(() => {
		if (!diffView || activeGlyphId === null) return []
		const baseline = versionControl?.comparison?.base.source
		if (baseline === undefined) return []
		const baselineGlyph = baseline.glyphs.find(
			(candidate) => candidate.id === activeGlyphId,
		)
		const baselineMasterId = baseline.masters.some(
			(candidate) => candidate.id === activeMasterId,
		)
			? activeMasterId
			: baseline.defaultMasterId
		return (
			baselineGlyph?.layers
				.find((candidate) => candidate.masterId === baselineMasterId)
				?.contours.map((contour) => ({
					id: contour.id,
					closed: contour.closed,
					nodes: contour.points.map((point) => ({
						pointId: point.id,
						mode: point.mode,
						x: point.x,
						y: point.y,
						...(point.incoming === undefined
							? {}
							: { incoming: point.incoming }),
						...(point.outgoing === undefined
							? {}
							: { outgoing: point.outgoing }),
					})),
				})) ?? []
		)
	}, [activeGlyphId, activeMasterId, diffView, versionControl])
	const diffTargetContours = useMemo(() => {
		if (!diffView || activeGlyphId === null) return []
		const target = versionControl?.comparison?.target.source
		if (target === undefined) return []
		const targetGlyph = target.glyphs.find(
			(candidate) => candidate.id === activeGlyphId,
		)
		const targetMasterId = target.masters.some(
			(candidate) => candidate.id === activeMasterId,
		)
			? activeMasterId
			: target.defaultMasterId
		return (
			targetGlyph?.layers
				.find((candidate) => candidate.masterId === targetMasterId)
				?.contours.map((contour) => ({
					id: contour.id,
					closed: contour.closed,
					nodes: contour.points.map((point) => ({
						pointId: point.id,
						mode: point.mode,
						x: point.x,
						y: point.y,
						...(point.incoming === undefined
							? {}
							: { incoming: point.incoming }),
						...(point.outgoing === undefined
							? {}
							: { outgoing: point.outgoing }),
					})),
				})) ?? []
		)
	}, [activeGlyphId, activeMasterId, diffView, versionControl])
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
				const projectedTransformNodes =
					transformPreview === null || contour.tangentNodes === undefined
						? null
						: new Map(
								projectSelectionTransformPreview(
									contour.tangentNodes,
									contour.closed,
									transformPreview,
								).map((node) => [node.pointId, node]),
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
					const projected = projectedTransformNodes?.get(point.pointId)
					if (
						next.mode === "soft" &&
						next.incoming !== undefined &&
						next.outgoing === undefined &&
						projected?.incoming !== undefined
					) {
						next = { ...next, incoming: projected.incoming }
					} else if (
						next.mode === "soft" &&
						next.outgoing !== undefined &&
						next.incoming === undefined &&
						projected?.outgoing !== undefined
					) {
						next = { ...next, outgoing: projected.outgoing }
					} else if (
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
					...(contour.tangentNodes === undefined
						? {}
						: { tangentNodes: contour.tangentNodes }),
					nodes: positionedNodes.map((point) =>
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
	const tangentSelectionIdentity = [...new Set(selection.map(selectionKey))]
		.sort()
		.join("|")
	const transformBounds = boundsOfControls(selectedControls)
	const combinedPreview = combinedEditorPathPreview(visibleContours)
	const contourPaintPaths = editorContourPaintPaths(visibleContours)
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
	const rules = glyph?.rules ?? []
	const ruleMeasurements = useMemo(
		() =>
			rules.map((rule) => ({
				rule,
				measurement: measureRule(rule, visibleContours),
			})),
		[rules, visibleContours],
	)
	const ruleExtent =
		Math.hypot(width, height) / Math.max(worldScale, 1e-6) +
		Math.max(advanceWidth, metrics.ascender - metrics.descender) * 2
	const activeRotation =
		transformDrag?.handle === "rotation"
			? resolveTransformRotation({
					bounds: transformDrag.bounds,
					startX: transformDrag.startX,
					startY: transformDrag.startY,
					targetX: transformDrag.targetX,
					targetY: transformDrag.targetY,
					shiftKey: transformDrag.shiftKey,
				})
			: null
	const rotationAngleDegrees =
		activeRotation === null
			? null
			: Math.round((activeRotation.angleRadians * 180) / Math.PI)
	const rotationHandlePosition =
		transformBounds === null
			? null
			: transformDrag?.handle === "rotation"
				? { x: transformDrag.targetX, y: transformDrag.targetY }
				: {
						x: (transformBounds.minX + transformBounds.maxX) / 2,
						y: transformBounds.maxY + 28 * inverseScale,
					}
	const hasRotationAffordance =
		transformBounds !== null &&
		(transformBounds.maxX > transformBounds.minX ||
			transformBounds.maxY > transformBounds.minY)
	const compatibilityGhostOffset = {
		x: compatibilityOffsetPixels.x * inverseScale,
		y: compatibilityOffsetPixels.y * inverseScale,
	}
	const diffGhostOffset = {
		x: 44 * inverseScale,
		y: 28 * inverseScale,
	}
	const compatibilityTraceStyle = compatibilityNodeTraceStyle(inverseScale)
	const activeCompatibilityPoints = new Map(
		visibleContours.flatMap((contour) =>
			contour.nodes.map((point) => [point.pointId, point] as const),
		),
	)
	const comparisonCompatibilityPoints = new Map(
		comparisonContours.flatMap((contour) =>
			contour.nodes.map((point) => [point.pointId, point] as const),
		),
	)
	const incompatibleActivePaths = new Set(
		compatibility?.diagnostics.map(
			(diagnostic) => diagnostic.comparison.pathIndex,
		) ?? [],
	)
	const incompatibleComparisonPaths = new Set(
		compatibility?.diagnostics.map(
			(diagnostic) => diagnostic.reference.pathIndex,
		) ?? [],
	)
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
	const selectionRects = useMemo(
		() =>
			textSelectionRects(
				layout,
				metrics,
				textSelectionRange.selectionStart,
				textSelectionRange.selectionEnd,
			),
		[layout, metrics, textSelectionRange],
	)
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
	const replacedPenEndpointHandle = penEndpointHandleBeingReplaced(
		penGesture?.endpoint,
		penGestureResolution,
	)
	const penAuthoringContext =
		penGesture?.endpoint !== null && penGesture?.endpoint !== undefined
			? ({ kind: "endpoint", side: penGesture.endpoint.side } as const)
			: penGesture?.closingPointId !== null &&
				  penGesture?.closingPointId !== undefined
				? ({ kind: "closure", direction: penDirection } as const)
				: ({ kind: "point", direction: penDirection } as const)
	const penPlacementDraggedHandle = penDraggedHandle(penAuthoringContext)
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
			? penGestureHandles(penGestureResolution, penPlacementDraggedHandle)
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
	const activeShapeKind: ShapeToolKind | null =
		activeTool === "rect" || activeTool === "ellipse" ? activeTool : null
	const resolveLiveShape = (
		gesture: ShapeDragSession,
	): ShapeGestureResolution =>
		resolveShapeGesture({
			anchor: gesture.anchor,
			rawCandidate: gesture.rawCandidate,
			snappedCandidate: gesture.snappedCandidate,
			downScreen: gesture.downScreen,
			currentScreen: gesture.currentScreen,
			previousDirection: gesture.direction,
			shiftKey: gesture.shiftKey,
			altKey: gesture.altKey,
		})
	const shapeGestureResolution =
		shapeGesture === null ? null : resolveLiveShape(shapeGesture)
	const shapePreviewGeometry =
		shapeGestureResolution === null
			? []
			: shapeGeometry(
					shapeGesture?.kind ?? "rect",
					shapeGestureResolution.bounds,
				)
	const shapePreviewPath = editorContourToPath(
		shapePreviewGeometry.map((point, index) => ({
			...point,
			pointId: `point:shape-preview:${index}` as PointId,
		})),
		true,
	)
	const visibleSnaps =
		activeTool === "pen"
			? (penPlacement?.snaps ?? [])
			: activeShapeKind !== null
				? shapeSnapsForDisplay(shapeGesture, shapeHoverSnaps)
				: activeSnaps
	const rememberTangentDirection = (
		constraint: TangentSlideConstraint,
	): void => {
		if (
			activeGlyphId !== null &&
			constraint.end === null &&
			constraint.direction !== null &&
			(constraint.direction.x !== 0 || constraint.direction.y !== 0)
		) {
			const handle = constraint.handles[0]?.handle
			if (handle === undefined) return
			tangentDirectionRef.current = {
				glyphId: activeGlyphId,
				masterId: activeMasterId,
				pointId: constraint.pointId,
				handle,
				anchor: constraint.start,
				direction: constraint.direction,
			}
		}
	}
	const tangentDirectionFor = (
		node: EditorLayerNode,
	): Readonly<{ pointId: PointId; x: number; y: number }> | undefined => {
		if (activeGlyphId === null) return undefined
		const direction = rememberedTangentDirection(
			tangentDirectionRef.current,
			{ glyphId: activeGlyphId, masterId: activeMasterId },
			node,
		)
		return direction === undefined
			? undefined
			: { pointId: node.pointId, ...direction }
	}
	const applyPointDrag = (
		drag: PointDrag,
		rawPoint: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
		altKey: boolean,
	): PointDragResolution => {
		drag.lastRawPoint = rawPoint
		if (altKey && drag.tangentEligible) {
			drag.joinTarget = null
			setJoinTarget(null)
			if (drag.tangentConstraint !== null) {
				rememberTangentDirection(drag.tangentConstraint)
				const resolution = resolveTangentSlide(drag.tangentConstraint, rawPoint)
				const point = resolution?.points[0]
				if (resolution !== null && point !== undefined) {
					drag.target.position({ x: point.x, y: point.y })
					setDraggedPoint(null)
					setTransformPreview(resolution)
					setTangentGuide(drag.tangentConstraint)
					setActiveSnaps([])
					return { kind: "tangent", resolution }
				}
			}
			drag.target.position(drag.origin)
			setDraggedPoint(null)
			setTransformPreview(null)
			setTangentGuide(null)
			setActiveSnaps([])
			return { kind: "blocked" }
		}
		const snapped = resolveCanvasGesturePoint(
			drag.pointId,
			drag.origin,
			rawPoint,
			shiftKey,
			drag.projectionCandidates,
		)
		if (altKey && drag.fixedHandleNode !== null) {
			const resolution = planFixedHandleNodeMove(drag.fixedHandleNode, snapped)
			const point = resolution?.points[0]
			if (resolution !== null && point !== undefined) {
				drag.joinTarget = null
				setJoinTarget(null)
				drag.target.position({ x: point.x, y: point.y })
				setDraggedPoint(null)
				setTransformPreview(resolution)
				setTangentGuide(null)
				setActiveSnaps(snapped.snaps)
				return { kind: "fixed-handles", resolution }
			}
		}
		const candidate = drag.joinEligible
			? resolveOpenEndpointTarget(
					visibleContours,
					drag.contourId,
					drag.pointId,
					snapped,
					worldScale,
				)
			: null
		drag.joinTarget = candidate
		setJoinTarget(candidate)
		const point = {
			pointId: drag.pointId,
			x: candidate?.x ?? snapped.x,
			y: candidate?.y ?? snapped.y,
		}
		drag.target.position({ x: point.x, y: point.y })
		setTransformPreview(null)
		setTangentGuide(null)
		setDraggedPoint(point)
		setActiveSnaps(snapped.snaps)
		return { kind: "point", point }
	}
	const applyHandleDrag = (
		drag: HandleDrag,
		rawEndpoint: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
	): DraggedHandle | null => {
		drag.lastRawEndpoint = rawEndpoint
		const rawVector = {
			x: rawEndpoint.x - drag.node.x,
			y: rawEndpoint.y - drag.node.y,
		}
		const resolution = resolveHandleEdit(
			drag.node,
			drag.handle,
			rawVector,
			shiftKey,
		)
		if (resolution === null) return null
		const vector = resolution.previewVector
		const handle = {
			pointId: drag.pointId,
			handle: drag.handle,
			storageVector: resolution.storageVector,
			vector,
		}
		drag.target.position({
			x: drag.node.x + vector.x,
			y: drag.node.y + vector.y,
		})
		setDraggedHandle(handle)
		setHandleConstraintGuide(
			resolution.constrainedToEightRays && (vector.x !== 0 || vector.y !== 0)
				? { x: drag.node.x, y: drag.node.y, vector }
				: null,
		)
		return handle
	}
	const isCommittableHandle = (
		handle: DraggedHandle | null,
	): handle is DraggedHandle =>
		handle !== null && (handle.vector.x !== 0 || handle.vector.y !== 0)
	const finishCancelledTarget = (
		target: DragPositionTarget,
		position: Readonly<{ x: number; y: number }>,
	): void => {
		target.position(position)
		const live = target as DragPositionTarget & {
			stopDrag?: () => unknown
			getLayer?: () => { batchDraw(): unknown } | null
		}
		live.stopDrag?.()
		live.getLayer?.()?.batchDraw()
	}
	const releaseDirectDragCapture = (
		drag: Pick<
			PointDrag | HandleDrag,
			"captureTarget" | "captureCancelListener"
		>,
	): void => {
		if (drag.captureTarget === null || drag.captureCancelListener === null)
			return
		drag.captureTarget.removeEventListener(
			"pointercancel",
			drag.captureCancelListener,
			true,
		)
		drag.captureTarget.removeEventListener(
			"lostpointercapture",
			drag.captureCancelListener,
			true,
		)
	}
	const cancelPointDrag = (pointerId?: number): boolean => {
		const drag = pointDragRef.current
		if (
			drag === null ||
			(pointerId !== undefined &&
				!directDragOwnsPointer(drag.pointerId, pointerId))
		) {
			return false
		}
		finalizePointDrag(drag, { restoreTarget: true })
		return true
	}
	const cancelHandleDrag = (pointerId?: number): boolean => {
		const drag = handleDragRef.current
		if (
			drag === null ||
			(pointerId !== undefined &&
				!directDragOwnsPointer(drag.pointerId, pointerId))
		) {
			return false
		}
		releaseDirectDragCapture(drag)
		handleDragRef.current = null
		directDragPointerRef.current = null
		directDragCaptureTargetRef.current = null
		setDraggedHandle(null)
		setHandleConstraintGuide(null)
		finishCancelledTarget(drag.target, drag.startEndpoint)
		return true
	}
	const cancelDirectDrag = (pointerId?: number): boolean =>
		cancelPointDrag(pointerId) || cancelHandleDrag(pointerId)
	const reportGeometryCommitError = (error: unknown): void => {
		setClipboardStatus(
			error instanceof Error
				? error.message
				: "The outline edit could not be committed.",
		)
	}
	const rememberDirectDragPointer = (
		event: KonvaEventObject<PointerEvent>,
	): void => {
		if (
			activeTool === "select" &&
			event.evt.button === 0 &&
			event.evt.isPrimary
		) {
			directDragPointerRef.current = event.evt.pointerId
			directDragCaptureTargetRef.current =
				event.evt.target instanceof HTMLCanvasElement ? event.evt.target : null
		}
	}
	const directDragCapture = (): Pick<
		PointDrag,
		"pointerId" | "captureTarget" | "captureCancelListener"
	> => {
		const pointerId = directDragPointerRef.current
		const captureTarget = directDragCaptureTargetRef.current
		const captureCancelListener =
			pointerId === null || captureTarget === null
				? null
				: (event: PointerEvent): void => {
						cancelDirectDrag(event.pointerId)
					}
		if (captureCancelListener !== null) {
			captureTarget?.addEventListener("pointercancel", captureCancelListener, {
				capture: true,
			})
			captureTarget?.addEventListener(
				"lostpointercapture",
				captureCancelListener,
				{ capture: true },
			)
		}
		return { pointerId, captureTarget, captureCancelListener }
	}
	const finalizePointDrag = (
		drag: PointDrag,
		options: Readonly<{ restoreTarget: boolean }>,
	): void => {
		if (pointDragRef.current !== drag) return
		releaseDirectDragCapture(drag)
		if (options.restoreTarget) finishCancelledTarget(drag.target, drag.origin)
		finalizePointDragPreview(drag, false)
		pointDragRef.current = null
		directDragPointerRef.current = null
		directDragCaptureTargetRef.current = null
		setDraggedPoint(null)
		setTransformPreview(null)
		setTangentGuide(null)
		setJoinTarget(null)
		setActiveSnaps([])
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
		if (caretIndex <= text.length) return
		preferredCaretXRef.current = null
		setCaretIndex(text.length)
	}, [caretIndex, setCaretIndex, text.length])

	useEffect(() => {
		const textarea = textareaRef.current
		if (textarea === null) return
		const synchronizeSelection = (): void => {
			const range = normalizedTextareaSelection(textarea)
			setCaretIndex(activeTextareaSelectionIndex(textarea))
			setTextSelectionRange(range)
			setTextSelectionCollapsed(range.selectionStart === range.selectionEnd)
		}
		return observeTextareaSelection(textarea, synchronizeSelection)
	}, [setCaretIndex, setTextSelectionCollapsed, setTextSelectionRange])

	useEffect(
		() =>
			workspace.actions.registerTextCanvasFocusRestorer(() => {
				const textarea = textareaRef.current
				if (textarea === null || textarea.disabled) return
				const start = textarea.selectionStart
				const end = textarea.selectionEnd
				const direction = textarea.selectionDirection
				textarea.focus({ preventScroll: true })
				if (start !== null && end !== null)
					textarea.setSelectionRange(start, end, direction)
			}),
		[workspace],
	)

	useEffect(() => {
		const updateModifier = (event: KeyboardEvent): void => {
			if (event.key !== "Shift" && event.key !== "Alt") return
			const shape = shapeGestureRef.current
			if (shape !== null) {
				shape.shiftKey = event.shiftKey
				shape.altKey = event.altKey
				shapePreviewPublisher.schedule({ ...shape })
				return
			}
			const transform = transformDragRef.current
			if (transform !== null && transform.handle !== "inside") {
				transform.shiftKey = event.shiftKey
				transform.altKey = event.altKey
				setTransformPreview(resolveTransformPreview(transform))
				return
			}
			const gesture = penGestureRef.current
			if (gesture !== null) {
				gesture.shiftKey = event.shiftKey
				gesture.altKey = event.altKey
				schedulePenGesturePreview(gesture)
				return
			}
			const hover = penHoverRef.current
			if (hover !== null) {
				hover.shiftKey = event.shiftKey
				hover.altKey = event.altKey
				penPreviewPublisher.schedule({
					kind: "hover",
					preview: { ...hover },
				})
				return
			}
			setShiftHeld(event.shiftKey)
			setAltHeld(event.altKey)
		}
		const resetModifiers = (): void => {
			setShiftHeld(false)
			setAltHeld(false)
			if (shapeGestureRef.current !== null) {
				cancelShapeGesture()
				return
			}
			if (penGestureRef.current !== null) {
				cancelPenGesture()
				return
			}
			clearPenHoverPreview()
			clearShapeHoverGuides()
			cancelPointDrag()
			cancelHandleDrag()
		}
		window.addEventListener("keydown", updateModifier)
		window.addEventListener("keyup", updateModifier)
		window.addEventListener("blur", resetModifiers)
		return () => {
			window.removeEventListener("keydown", updateModifier)
			window.removeEventListener("keyup", updateModifier)
			window.removeEventListener("blur", resetModifiers)
			penPreviewPublisher.cancel()
			shapePreviewPublisher.cancel()
			shapeHoverPublisher.cancel()
			penHoverRef.current = null
			const shape = shapeGestureRef.current
			shapeGestureRef.current = null
			if (shape !== null) releaseShapeCapture(shape)
			const gesture = penGestureRef.current
			penGestureRef.current = null
			if (gesture !== null) releasePenCapture(gesture)
			cancelDirectDrag()
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
				shapeGestureRef.current !== null ||
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

	useLayoutEffect(() => {
		tangentDirectionRef.current = null
		penPreviewPublisher.cancel()
		shapePreviewPublisher.cancel()
		shapeHoverPublisher.cancel()
		penHoverRef.current = null
		const shape = shapeGestureRef.current
		shapeGestureRef.current = null
		if (
			shape !== null &&
			shape.captureTarget !== null &&
			shape.captureCancelListener !== null
		) {
			shape.captureTarget.removeEventListener(
				"pointercancel",
				shape.captureCancelListener,
			)
			shape.captureTarget.removeEventListener(
				"lostpointercapture",
				shape.captureCancelListener,
			)
		}
		if (shape?.captureTarget?.hasPointerCapture(shape.pointerId)) {
			shape.captureTarget.releasePointerCapture(shape.pointerId)
		}
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
		setShapeGesture(null)
		setShapeHoverSnaps([])
		penContourResumeRef.current = null
		setActiveSnaps([])
		cancelPointDrag()
		cancelHandleDrag()
		cancelGroupDrag()
		setDraggedHandle(null)
		setTransformPreview(null)
		setJoinTarget(null)
		setTransformCursor(null)
		setMomentaryPreview(false)
		setPendingRulePoint(null)
		cancelledGroupDrag.current = null
	}, [activeGlyphId, activeMasterId, activeTool, editingTextIndex])

	useEffect(() => {
		tangentDirectionRef.current = null
	}, [tangentSelectionIdentity])

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
		if (drag?.lastRawPoint !== null && drag?.lastRawPoint !== undefined) {
			applyPointDrag(drag, drag.lastRawPoint, shiftHeld, altHeld)
		}
		const handleDrag = handleDragRef.current
		if (
			handleDrag?.lastRawEndpoint !== null &&
			handleDrag?.lastRawEndpoint !== undefined
		) {
			applyHandleDrag(handleDrag, handleDrag.lastRawEndpoint, shiftHeld)
		}
	}, [altHeld, shiftHeld])

	const commitTangentSlide = (resolution: TangentSlideResolution): void => {
		if (activeGlyphId === null) return
		const point = resolution.points[0]
		if (point === undefined) return
		workspace.font.actions.slideSoftNode({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointId: point.pointId,
			x: point.x,
			y: point.y,
			handles: resolution.handles.map(({ handle, x, y }) => ({
				handle,
				x,
				y,
			})),
			...(resolution.constraint.end === null &&
			resolution.constraint.direction !== null
				? { unboundedDirection: resolution.constraint.direction }
				: {}),
		})
	}
	const commitPointOrJoin = (drag: PointDrag, point: DraggedPoint): void => {
		if (
			activeGlyphId !== drag.glyphId ||
			activeMasterId !== drag.masterId ||
			activeTool !== "select"
		)
			throw new TypeError("The point drag no longer belongs to this canvas.")
		if (drag.joinTarget === null) {
			workspace.font.actions.movePoints({
				masterId: drag.masterId,
				glyphId: drag.glyphId,
				points: [{ pointId: point.pointId, x: point.x, y: point.y }],
			})
			return
		}
		workspace.font.actions.joinOpenContours({
			masterId: drag.masterId,
			glyphId: drag.glyphId,
			draggedContourId: drag.contourId,
			draggedPointId: drag.pointId,
			targetContourId: drag.joinTarget.contourId,
			targetPointId: drag.joinTarget.pointId,
		})
		setSelection(
			Object.freeze([{ kind: "node", pointId: drag.joinTarget.pointId }]),
		)
	}
	const commitFixedHandleMove = (
		drag: PointDrag,
		resolution: SelectionTransformResult,
	): void => {
		if (
			activeGlyphId !== drag.glyphId ||
			activeMasterId !== drag.masterId ||
			activeTool !== "select"
		)
			throw new TypeError("The point drag no longer belongs to this canvas.")
		workspace.font.actions.transformControls({
			masterId: drag.masterId,
			glyphId: drag.glyphId,
			...resolution,
		})
	}
	const commitHandle = (handle: DraggedHandle): void => {
		if (activeGlyphId === null) return
		workspace.font.actions.moveHandle({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointId: handle.pointId,
			handle: handle.handle,
			vector: handle.storageVector,
		})
	}
	const toggleNodeMode = (pointId: PointId, mode: "soft" | "hard"): void => {
		if (activeGlyphId === null) return
		workspace.font.actions.setNodeMode({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointId,
			mode: toggledNodeMode(mode),
		})
	}
	const toggleSelectedNodeModes = (): void => {
		if (activeGlyphId === null) return
		const pointIds = selection.flatMap((target) =>
			target.kind === "node" ? [target.pointId] : [],
		)
		const result = workspace.font.actions.toggleNodeModes({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			pointIds,
		})
		if (result.toggled === 0) return
		setClipboardStatus(
			`Toggled ${result.toggled} node${result.toggled === 1 ? "" : "s"}${result.skipped === 0 ? "." : `; skipped ${result.skipped}.`}`,
		)
	}
	const focusTypingAt = (index: number): void => {
		const next = Math.max(0, Math.min(text.length, index))
		preferredCaretXRef.current = null
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
		if (selectedRuleIds.length > 0 && activeGlyphId !== null) {
			workspace.font.actions.setGlyphRules({
				glyphId: activeGlyphId,
				rules: rules.filter((rule) => !selectedRuleIds.includes(rule.id)),
			})
			setSelectedRuleIds(Object.freeze([]))
			return
		}
		if (selection.length === 0 || activeGlyphId === null) return
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
	const nextRuleId = (): RuleId => {
		const occupied = new Set(rules.map((rule) => rule.id))
		while (true) {
			const sequence = clipboardEntitySequence.current++
			const id = `rule:${activeGlyphId}:${sequence}` as RuleId
			if (!occupied.has(id)) return id
		}
	}
	const plotRulePoint = (event: KonvaEventObject<PointerEvent>): void => {
		if (activeTool !== "rule" || activeGlyphId === null) return
		const point = pointerInEditingGlyph(event)
		if (point === null) return
		event.cancelBubble = true
		if (pendingRulePoint === null) {
			setPendingRulePoint(point)
			setClipboardStatus(
				`Rule point A at ${point.x.toFixed(1)}, ${point.y.toFixed(1)}.`,
			)
			return
		}
		if (
			Math.hypot(point.x - pendingRulePoint.x, point.y - pendingRulePoint.y) <=
			1e-6
		) {
			setClipboardStatus("Rule points A and B must be distinct.")
			return
		}
		const id = nextRuleId()
		workspace.font.actions.setGlyphRules({
			glyphId: activeGlyphId,
			rules: [...rules, { id, a: pendingRulePoint, b: point }],
		})
		setPendingRulePoint(null)
		setSelection(Object.freeze([]))
		setSelectedRuleIds(Object.freeze([id]))
		setClipboardStatus("Created measuring rule.")
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
	const nextShapeEntityId = (
		kind: "contour" | "point",
		shapeKind: ShapeToolKind,
	) => {
		const occupied = new Set<string>([
			...contours.map((contour) => contour.id),
			...allPoints.map((point) => point.pointId),
		])
		while (true) {
			const sequence = shapeEntitySequence.current
			shapeEntitySequence.current += 1
			const id = `${kind}:${activeGlyphId}:${shapeKind}:${sequence}`
			if (!occupied.has(id)) {
				return kind === "contour" ? (id as ContourId) : (id as PointId)
			}
		}
	}
	const nextClipboardEntityId = (kind: "contour" | "point") => {
		const source = workspace.font.read.editorSource()
		const occupied = new Set<string>(
			(source?.glyphs ?? []).flatMap((sourceGlyph) => [
				...(
					sourceGlyph.layers.find((layer) => layer.masterId === activeMasterId)
						?.contours ?? []
				).map((contour) => contour.id),
				...(
					sourceGlyph.layers.find((layer) => layer.masterId === activeMasterId)
						?.contours ?? []
				).flatMap((contour) => contour.points.map((point) => point.id)),
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
	const authoringLayerTransforms = masterIds.map((sourceMasterId) => ({
		masterId: sourceMasterId,
		xScale:
			sourceMasterId === activeMasterId
				? 1
				: master?.kind === "default"
					? 0.94
					: 1 / 0.94,
	}))
	const penCoordinates = (
		point: PenPoint,
		gesture: PenGestureResolution,
		draggedHandle: PenHandleKind,
	) =>
		penLayerCoordinates(point, gesture, authoringLayerTransforms, draggedHandle)
	const commitPenPoint = (
		point: PenPoint,
		gesture: PenGestureResolution,
	): void => {
		if (activeGlyphId === null) return
		const draggedHandle = penDraggedHandle({
			kind: "point",
			direction: penDirection,
		})
		const pointId = nextPenEntityId("point") as PointId
		if (penContourId === null) {
			const contourId = nextPenEntityId("contour") as ContourId
			workspace.font.actions.createContour({
				masterId: activeMasterId,
				glyphId: activeGlyphId,
				contourId,
				point: { id: pointId, mode: gesture.mode },
				coordinates: penCoordinates(point, gesture, draggedHandle),
			})
			penContourResumeRef.current = contourId
			setPenContourId(contourId)
		} else {
			workspace.font.actions.insertPoint({
				masterId: activeMasterId,
				glyphId: activeGlyphId,
				contourId: penContourId,
				...(penDirection === "prepend" ? { at: 0 } : {}),
				point: { id: pointId, mode: gesture.mode },
				coordinates: penCoordinates(point, gesture, draggedHandle),
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
		if (activeGlyphId === null) return
		const resolution = resolvePenEndpoint({
			side: target.side,
			mode: target.mode,
			...(target.incoming === undefined ? {} : { incoming: target.incoming }),
			...(target.outgoing === undefined ? {} : { outgoing: target.outgoing }),
			gesture,
			altKey,
		})
		const forwardHandle = penDraggedHandle({
			kind: "endpoint",
			side: target.side,
		})
		if (!(target.mode === "hard" && gesture.kind === "click")) {
			workspace.font.actions.authorPenEndpoint({
				masterId: activeMasterId,
				glyphId: activeGlyphId,
				contourId: target.contourId,
				pointId: target.pointId,
				forwardHandle,
				mode: resolution.mode,
				coordinates: penCoordinates(target, gesture, forwardHandle).map(
					(coordinate) => ({
						masterId: coordinate.masterId,
						forward:
							gesture.kind === "click" ? null : coordinate[forwardHandle]!,
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
			activeGlyphId === null ||
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
		const draggedHandle = penDraggedHandle({
			kind: "closure",
			direction: penDirection,
		})
		penContourResumeRef.current = penContourId
		workspace.font.actions.closeContour({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			contourId: penContourId,
			...(gesture.handles === null
				? {}
				: {
						[penDirection === "prepend" ? "lastPoint" : "firstPoint"]: {
							pointId: closurePoint.pointId,
							mode: "soft" as const,
							coordinates: penCoordinates(
								closurePoint,
								gesture,
								draggedHandle,
							).map(({ masterId, incoming, outgoing }) => ({
								masterId,
								incoming: incoming!,
								outgoing: outgoing!,
							})),
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
		penPreviewPublisher.cancel()
		penHoverRef.current = null
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
		penPreviewPublisher.cancel()
		penHoverRef.current = null
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
			schedulePenGesturePreview(gesture)
			return
		}
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) {
			clearPenHoverPreview()
			return
		}
		const preview: PenHoverPreview = {
			pointer,
			shiftKey: event.evt.shiftKey,
			altKey: event.evt.altKey,
		}
		penHoverRef.current = preview
		penPreviewPublisher.schedule({ kind: "hover", preview })
	}
	const finishPenGesture = (event: KonvaEventObject<PointerEvent>): void => {
		const gesture = penGestureRef.current
		if (gesture === null || gesture.pointerId !== event.evt.pointerId) return
		gesture.currentScreen = pointerOnCanvas(event)
		gesture.shiftKey = event.evt.shiftKey
		gesture.altKey = event.evt.altKey
		schedulePenGesturePreview(gesture)
		const pending = penPreviewPublisher.consume()
		const latestGesture =
			pending?.kind === "gesture" ? pending.gesture : { ...gesture }
		const resolution = resolvePenGesture({
			downScreen: latestGesture.downScreen,
			currentScreen: latestGesture.currentScreen,
			worldScale,
			shiftKey: latestGesture.shiftKey,
		})
		penGestureRef.current = null
		setPenGesture(null)
		if (latestGesture.endpoint !== null) {
			commitPenEndpoint(
				latestGesture.endpoint,
				resolution,
				latestGesture.altKey,
			)
		} else if (latestGesture.closingPointId === null) {
			commitPenPoint(latestGesture.point, resolution)
		} else {
			commitPenClosure(resolution)
		}
		releasePenCapture(gesture)
	}
	const releaseShapeCapture = (gesture: ShapeDragSession): void => {
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
	const cancelShapeGesture = (): void => {
		shapePreviewPublisher.cancel()
		const gesture = shapeGestureRef.current
		shapeGestureRef.current = null
		setShapeGesture(null)
		setShapeHoverSnaps([])
		if (gesture !== null) releaseShapeCapture(gesture)
	}
	const beginShapeGesture = (event: KonvaEventObject<PointerEvent>): void => {
		if (editingTextIndex === null || activeShapeKind === null) return
		if (shapeGestureRef.current !== null) return
		if (event.evt.button !== 0 || !event.evt.isPrimary) return
		const rawPoint = pointerInEditingGlyph(event)
		if (rawPoint === null) return
		event.cancelBubble = true
		event.evt.preventDefault()
		const placement = resolveCanvasGesturePoint(
			"point:shape-placement-preview" as PointId,
			null,
			rawPoint,
			false,
		)
		const anchor = { x: placement.x, y: placement.y }
		clearShapeHoverGuides()
		const nativeTarget =
			event.evt.target instanceof HTMLCanvasElement ? event.evt.target : null
		const captureCancelListener = (nativeEvent: PointerEvent): void => {
			if (nativeEvent.pointerId === event.evt.pointerId) cancelShapeGesture()
		}
		const screen = pointerOnCanvas(event)
		const gesture: ShapeDragSession = {
			pointerId: event.evt.pointerId,
			kind: activeShapeKind,
			anchor,
			downScreen: screen,
			captureTarget: nativeTarget,
			captureCancelListener,
			rawCandidate: anchor,
			snappedCandidate: anchor,
			snaps: placement.snaps,
			currentScreen: screen,
			direction: { x: null, y: null },
			shiftKey: event.evt.shiftKey,
			altKey: event.evt.altKey,
		}
		shapeGestureRef.current = gesture
		nativeTarget?.addEventListener("pointercancel", captureCancelListener)
		nativeTarget?.addEventListener("lostpointercapture", captureCancelListener)
		nativeTarget?.setPointerCapture(event.evt.pointerId)
		setShapeGesture(gesture)
	}
	const updateShapePointer = (
		event: KonvaEventObject<PointerEvent>,
	): ShapeDragSession | null => {
		const gesture = shapeGestureRef.current
		const rawPoint = pointerInEditingGlyph(event)
		if (rawPoint === null) {
			if (gesture === null) clearShapeHoverGuides()
			return null
		}
		const snapped = resolveCanvasGesturePoint(
			"point:shape-placement-preview" as PointId,
			null,
			rawPoint,
			false,
		)
		if (gesture === null) {
			shapeHoverPublisher.schedule(snapped.snaps)
			return null
		}
		if (gesture.pointerId !== event.evt.pointerId) return null
		gesture.rawCandidate = rawPoint
		gesture.snappedCandidate = { x: snapped.x, y: snapped.y }
		gesture.snaps = snapped.snaps
		gesture.currentScreen = pointerOnCanvas(event)
		gesture.shiftKey = event.evt.shiftKey
		gesture.altKey = event.evt.altKey
		gesture.direction = resolveLiveShape(gesture).direction
		shapePreviewPublisher.schedule({ ...gesture })
		return gesture
	}
	const finishShapeGesture = (event: KonvaEventObject<PointerEvent>): void => {
		const liveGesture = updateShapePointer(event)
		if (liveGesture === null) return
		const pending = shapePreviewPublisher.consume()
		const gesture = pending ?? { ...liveGesture }
		const resolution = resolveLiveShape(gesture)
		shapeGestureRef.current = null
		setShapeGesture(null)
		shapeHoverPublisher.schedule(
			resolveCanvasGesturePoint(
				"point:shape-placement-preview" as PointId,
				null,
				gesture.rawCandidate,
				false,
			).snaps,
		)
		releaseShapeCapture(liveGesture)
		if (!resolution.valid || activeGlyphId === null) return

		const geometry = shapeGeometry(gesture.kind, resolution.bounds)
		if (geometry.length === 0) return
		const contourId = nextShapeEntityId("contour", gesture.kind) as ContourId
		const pointIds = geometry.map(
			() => nextShapeEntityId("point", gesture.kind) as PointId,
		)
		workspace.font.actions.createCompleteContour({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			contour: {
				id: contourId,
				closed: true,
				points: geometry.map((point, index) => ({
					id: pointIds[index]!,
					mode: point.mode,
				})),
			},
			layers: shapeLayerCoordinates(
				geometry,
				pointIds,
				authoringLayerTransforms,
			),
		})
		setSelection(
			Object.freeze(
				pointIds.map((pointId) => ({ kind: "node" as const, pointId })),
			),
		)
		setShowNodes(true)
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
	const releaseGroupDragCapture = (drag: GroupDrag): void => {
		if (drag.captureTarget === null || drag.captureCancelListener === null)
			return
		drag.captureTarget.removeEventListener(
			"pointercancel",
			drag.captureCancelListener,
			true,
		)
		drag.captureTarget.removeEventListener(
			"lostpointercapture",
			drag.captureCancelListener,
			true,
		)
	}
	const cancelGroupDrag = (pointerId?: number): boolean => {
		const drag = groupDragRef.current
		if (
			drag === null ||
			(pointerId !== undefined &&
				!directDragOwnsPointer(drag.pointerId, pointerId))
		)
			return false
		releaseGroupDragCapture(drag)
		finalizeGroupDragPreview(drag, true)
		drag.node.getLayer()?.batchDraw()
		groupDragRef.current = null
		directDragPointerRef.current = null
		directDragCaptureTargetRef.current = null
		setTransformPreview(null)
		setDraggedPoint(null)
		setDraggedHandle(null)
		setJoinTarget(null)
		setActiveSnaps([])
		return true
	}
	const groupDragCapture = (): Pick<
		GroupDrag,
		"pointerId" | "captureTarget" | "captureCancelListener"
	> => {
		const pointerId = directDragPointerRef.current
		const captureTarget = directDragCaptureTargetRef.current
		const captureCancelListener =
			pointerId === null || captureTarget === null
				? null
				: (event: PointerEvent): void => {
						cancelGroupDrag(event.pointerId)
					}
		if (captureCancelListener !== null) {
			captureTarget?.addEventListener("pointercancel", captureCancelListener, {
				capture: true,
			})
			captureTarget?.addEventListener(
				"lostpointercapture",
				captureCancelListener,
				{ capture: true },
			)
		}
		return { pointerId, captureTarget, captureCancelListener }
	}
	const beginGroupDrag = (
		target: EditorSelectionTarget,
		targetX: number,
		targetY: number,
		node: LiveGroupDragTarget["node"],
	): boolean => {
		if (!isSelected(target) || activeGlyphId === null) return false
		if (
			target.kind === "node" &&
			hasSelectedCoincidentEndpointPeer(
				contours,
				target.pointId,
				new Set(
					selection
						.filter((item) => item.kind === "node")
						.map((item) => item.pointId),
				),
			)
		)
			return false
		const rigidSelection = selectionForRigidTranslation(allPoints, selection)
		const controls = resolveSelectionControls(allPoints, rigidSelection)
		const bounds = boundsOfControls(controls)
		if (controls.length < 2 || bounds === null) return false
		if (rigidSelection.length !== selection.length) {
			setSelection(rigidSelection)
		}
		const nextGroupDrag = {
			...groupDragCapture(),
			glyphId: activeGlyphId,
			masterId: activeMasterId,
			targetX,
			targetY,
			node,
			controls,
			selection: rigidSelection,
			bounds,
			selectedPointIds: new Set(rigidSelection.map((item) => item.pointId)),
			controllerPointId: target.kind === "node" ? target.pointId : null,
			tangentDirections: new Map(
				rigidSelection.flatMap((item) => {
					if (item.kind !== "node") return []
					const point = allPoints.find(
						(candidate) => candidate.pointId === item.pointId,
					)
					if (point === undefined) return []
					const direction = tangentDirectionFor(point)
					return direction === undefined
						? []
						: ([[item.pointId, { x: direction.x, y: direction.y }]] as const)
				}),
			),
			restoreTargetAfterCommit: false,
			lastRawDelta: null,
			joinCandidate: null,
		}
		groupDragRef.current = nextGroupDrag
		return true
	}
	const beginSegmentGroupDrag = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<DragEvent>,
	): boolean => {
		if (event.evt.altKey || activeGlyphId === null) return false
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return false
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (
			nearest === null ||
			!selectionOwnsEditorSegment(contour, nearest.segmentIndex, selection)
		)
			return false
		const rigidSelection = selectionForRigidTranslation(allPoints, selection)
		const controls = resolveSelectionControls(allPoints, rigidSelection)
		const bounds = boundsOfControls(controls)
		if (controls.length < 2 || bounds === null) return false
		if (rigidSelection.length !== selection.length) setSelection(rigidSelection)
		groupDragRef.current = {
			...groupDragCapture(),
			glyphId: activeGlyphId,
			masterId: activeMasterId,
			targetX: 0,
			targetY: 0,
			node: event.target,
			controls,
			selection: rigidSelection,
			bounds,
			selectedPointIds: new Set(rigidSelection.map((item) => item.pointId)),
			controllerPointId: null,
			tangentDirections: new Map(),
			restoreTargetAfterCommit: true,
			lastRawDelta: null,
			joinCandidate: null,
		}
		return true
	}
	const applyGroupDrag = (
		currentGroupDrag: GroupDrag,
		rawDelta: Readonly<{ x: number; y: number }>,
		shiftKey: boolean,
		altKey: boolean,
	): Readonly<{
		preview: SelectionTransformResult
		snaps: readonly ActiveSnap[]
	}> => {
		if (altKey && currentGroupDrag.controllerPointId !== null) {
			const constrained = orthogonalConstraint(
				{ x: 0, y: 0 },
				rawDelta,
				shiftKey,
			)
			const gestureDelta = {
				x: constrained?.axis === "x" ? constrained.value : rawDelta.x,
				y: constrained?.axis === "y" ? constrained.value : rawDelta.y,
			}
			const controlled = planControlledSelectionDrag(
				contours,
				currentGroupDrag.selection,
				currentGroupDrag.controllerPointId,
				gestureDelta,
				currentGroupDrag.tangentDirections,
			)
			currentGroupDrag.joinCandidate = null
			setJoinTarget(null)
			const preview =
				controlled?.result ??
				translateSelectionControls(currentGroupDrag.controls, 0, 0)
			const delta = controlled?.controllerDelta ?? { x: 0, y: 0 }
			currentGroupDrag.node.position({
				x: currentGroupDrag.targetX + delta.x,
				y: currentGroupDrag.targetY + delta.y,
			})
			return { preview, snaps: [] }
		}
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
		let deltaX = snapped.deltaX
		let deltaY = snapped.deltaY
		let preview = translateSelectionControls(
			currentGroupDrag.controls,
			deltaX,
			deltaY,
		)
		const candidate = resolveMovedEndpointJoin(
			contours,
			preview.points,
			worldScale,
		)
		if (candidate !== null) {
			deltaX += candidate.target.x - candidate.sourceX
			deltaY += candidate.target.y - candidate.sourceY
			preview = translateSelectionControls(
				currentGroupDrag.controls,
				deltaX,
				deltaY,
			)
		}
		currentGroupDrag.joinCandidate = candidate
		setJoinTarget(candidate?.target ?? null)
		currentGroupDrag.node.position({
			x: currentGroupDrag.targetX + deltaX,
			y: currentGroupDrag.targetY + deltaY,
		})
		return {
			preview,
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
		return applyGroupDrag(
			currentGroupDrag,
			rawDelta,
			event.evt.shiftKey,
			event.evt.altKey,
		)
	}
	useEffect(() => {
		const currentGroupDrag = groupDragRef.current
		if (currentGroupDrag?.lastRawDelta === null || currentGroupDrag === null)
			return
		const resolved = applyGroupDrag(
			currentGroupDrag,
			currentGroupDrag.lastRawDelta,
			shiftHeld,
			altHeld,
		)
		setTransformPreview(resolved.preview)
		setActiveSnaps(resolved.snaps)
		currentGroupDrag.node.getLayer()?.batchDraw()
	}, [altHeld, shiftHeld])
	const previewGroupDrag = (event: KonvaEventObject<DragEvent>): boolean => {
		const cancellation = cancelledGroupDrag.current
		if (
			cancellation !== null &&
			restoreCancelledGroupDragTarget(cancellation, event.target)
		) {
			event.target.getLayer()?.batchDraw()
			setJoinTarget(null)
			return true
		}
		const resolved = resolveGroupDrag(event)
		if (resolved === null) return false
		setTransformPreview(resolved.preview)
		setActiveSnaps(resolved.snaps)
		return true
	}
	const commitGroupDrag = (event: KonvaEventObject<DragEvent>): boolean => {
		if (isCancelledGroupDragEnd(event.evt) && cancelGroupDrag()) return true
		const cancellation = cancelledGroupDrag.current
		if (
			cancellation !== null &&
			restoreCancelledGroupDragTarget(cancellation, event.target)
		) {
			cancelledGroupDrag.current = null
			setDraggedPoint(null)
			setDraggedHandle(null)
			setJoinTarget(null)
			event.target.getLayer()?.batchDraw()
			return true
		}
		const currentGroupDrag = groupDragRef.current
		if (
			currentGroupDrag !== null &&
			(activeGlyphId !== currentGroupDrag.glyphId ||
				activeMasterId !== currentGroupDrag.masterId ||
				activeTool !== "select")
		) {
			releaseGroupDragCapture(currentGroupDrag)
			directDragPointerRef.current = null
			directDragCaptureTargetRef.current = null
			currentGroupDrag.node.position({
				x: currentGroupDrag.targetX,
				y: currentGroupDrag.targetY,
			})
			groupDragRef.current = null
			setTransformPreview(null)
			setJoinTarget(null)
			setActiveSnaps([])
			return true
		}
		const resolved = resolveGroupDrag(event)
		if (
			resolved === null ||
			currentGroupDrag === null ||
			activeGlyphId === null
		)
			return false
		const candidate = currentGroupDrag.joinCandidate
		let didCommit = false
		try {
			if (candidate === null) {
				workspace.font.actions.transformControls({
					masterId: currentGroupDrag.masterId,
					glyphId: currentGroupDrag.glyphId,
					...resolved.preview,
				})
			} else {
				workspace.font.actions.joinOpenContours({
					masterId: currentGroupDrag.masterId,
					glyphId: currentGroupDrag.glyphId,
					draggedContourId: candidate.sourceContourId,
					draggedPointId: candidate.sourcePointId,
					targetContourId: candidate.target.contourId,
					targetPointId: candidate.target.pointId,
					transform: {
						masterId: currentGroupDrag.masterId,
						glyphId: currentGroupDrag.glyphId,
						...resolved.preview,
					},
				})
				setSelection(
					Object.freeze([{ kind: "node", pointId: candidate.target.pointId }]),
				)
			}
			didCommit = true
		} catch (error) {
			reportGeometryCommitError(error)
		} finally {
			releaseGroupDragCapture(currentGroupDrag)
			directDragPointerRef.current = null
			directDragCaptureTargetRef.current = null
			if (currentGroupDrag.restoreTargetAfterCommit || !didCommit) {
				currentGroupDrag.node.position({
					x: currentGroupDrag.targetX,
					y: currentGroupDrag.targetY,
				})
				currentGroupDrag.node.getLayer()?.batchDraw()
			}
			groupDragRef.current = null
			setTransformPreview(null)
			setDraggedPoint(null)
			setDraggedHandle(null)
			setJoinTarget(null)
			setActiveSnaps([])
			cancelledGroupDrag.current = null
		}
		return true
	}
	const cancelTransform = (): boolean => {
		if (transformDragRef.current === null) return false
		transformDragRef.current = null
		setTransformDrag(null)
		setTransformPreview(null)
		setTransformCursor(null)
		return true
	}
	const beginTransform = (
		handle: TransformHandle,
		initialTarget?: Readonly<{ x: number; y: number }>,
	): void => {
		const controls = resolveSelectionControls(allPoints, selection)
		const bounds = boundsOfControls(controls)
		if (bounds === null) return
		const targetX =
			initialTarget?.x ?? (handle.includes("west") ? bounds.minX : bounds.maxX)
		const targetY =
			initialTarget?.y ?? (handle.includes("south") ? bounds.minY : bounds.maxY)
		const drag = {
			handle,
			controls,
			bounds,
			startX: targetX,
			startY: targetY,
			targetX,
			targetY,
			shiftKey: false,
			altKey: false,
		}
		transformDragRef.current = drag
		setTransformDrag(drag)
	}
	const resolveTransformPreview = (
		drag: TransformDrag,
	): SelectionTransformResult => {
		if (drag.handle === "inside") {
			return roundedTransform(
				translateSelectionControls(
					drag.controls,
					drag.targetX - drag.bounds.minX,
					drag.targetY - drag.bounds.minY,
				),
			)
		}
		if (drag.handle === "rotation") {
			return roundedTransform(
				rotateSelectionControls(
					drag.controls,
					resolveTransformRotation({
						bounds: drag.bounds,
						startX: drag.startX,
						startY: drag.startY,
						targetX: drag.targetX,
						targetY: drag.targetY,
						shiftKey: drag.shiftKey,
					}),
				),
			)
		}
		return roundedTransform(
			scaleSelectionControls(
				drag.controls,
				resolveTransformResize({
					bounds: drag.bounds,
					handle: drag.handle,
					targetX: drag.targetX,
					targetY: drag.targetY,
					shiftKey: drag.shiftKey,
					altKey: drag.altKey,
				}),
			),
		)
	}
	const previewTransformDrag = (event: KonvaEventObject<DragEvent>): void => {
		const drag = transformDragRef.current
		if (drag === null) return
		drag.targetX = event.target.x()
		drag.targetY = event.target.y()
		drag.shiftKey = event.evt.shiftKey
		drag.altKey = event.evt.altKey
		setTransformPreview(resolveTransformPreview(drag))
	}
	const commitTransform = (event?: KonvaEventObject<DragEvent>): void => {
		const drag = transformDragRef.current
		if (drag === null) return
		if (event !== undefined && isCancelledGroupDragEnd(event.evt)) {
			cancelTransform()
			return
		}
		if (event !== undefined) {
			drag.targetX = event.target.x()
			drag.targetY = event.target.y()
			drag.shiftKey = event.evt.shiftKey
			drag.altKey = event.evt.altKey
		}
		const finalPreview = resolveTransformPreview(drag)
		if (activeGlyphId !== null) {
			workspace.font.actions.transformControls({
				masterId: activeMasterId,
				glyphId: activeGlyphId,
				...finalPreview,
			})
		}
		setTransformPreview(null)
		transformDragRef.current = null
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
		if (
			editingTextIndex === null ||
			activeTool === "pen" ||
			activeTool === "rect" ||
			activeTool === "ellipse" ||
			activeTool === "knife"
		)
			return
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
		if (
			editingTextIndex === null ||
			activeTool === "pen" ||
			activeTool === "rect" ||
			activeTool === "ellipse" ||
			activeTool === "knife"
		)
			return
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
		if (activeGlyphId === null) return
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (nearest === null || nearest.amount <= 0.001 || nearest.amount >= 0.999)
			return
		const pointId = nextPenEntityId("point") as PointId
		workspace.font.actions.splitSegment({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			contourId: contour.id,
			segmentIndex: nearest.segmentIndex,
			pointId,
			amount: nearest.amount,
		})
		penContourResumeRef.current = null
		setPenContourId(null)
		clearPenHoverPreview()
		setSelection(Object.freeze([{ kind: "node", pointId }]))
		setShowNodes(true)
	}
	const cutContourSegment = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<MouseEvent | TouchEvent>,
	): void => {
		if (activeGlyphId === null) return
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (nearest === null || nearest.amount <= 0.001 || nearest.amount >= 0.999)
			return
		const leftPointId = nextPenEntityId("point") as PointId
		const rightPointId = nextPenEntityId("point") as PointId
		const rightContourId = contour.closed
			? undefined
			: (nextPenEntityId("contour") as ContourId)
		workspace.font.actions.cutSegment({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			contourId: contour.id,
			segmentIndex: nearest.segmentIndex,
			leftPointId,
			rightPointId,
			...(rightContourId === undefined ? {} : { rightContourId }),
			amount: nearest.amount,
		})
		setSelection(
			Object.freeze([
				{ kind: "node", pointId: leftPointId },
				{ kind: "node", pointId: rightPointId },
			]),
		)
		setShowNodes(true)
	}
	const addHandlesToSegment = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<MouseEvent>,
	): void => {
		if (activeGlyphId === null) return
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
			masterId: activeMasterId,
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
			aria-keyshortcuts="Escape BracketLeft BracketRight Enter Delete Backspace Alt+Delete Alt+Backspace Meta+A Control+A Meta+C Control+C Meta+X Control+X Meta+V Control+V Shift+A E ArrowUp ArrowDown ArrowLeft ArrowRight"
			tabIndex={0}
			onContextMenu={(event: JSX.TargetedMouseEvent<HTMLElement>) => {
				if (cancelDirectDrag()) event.preventDefault()
			}}
			onCopy={(event: JSX.TargetedClipboardEvent<HTMLElement>) => {
				if (
					editingTextIndex === null ||
					activeGlyphId === null ||
					event.target instanceof HTMLInputElement ||
					event.target instanceof HTMLTextAreaElement ||
					(event.target instanceof HTMLElement &&
						event.target.isContentEditable)
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
				if (selectedRuleIds.length > 0) {
					const selectedRules = rules.filter((rule) =>
						selectedRuleIds.includes(rule.id),
					)
					const payload = createRuleClipboardPayload(selectedRules)
					const serialized = JSON.stringify(payload)
					try {
						clipboard.setData(RULE_CLIPBOARD_MIME, serialized)
						clipboard.setData("text/plain", serialized)
					} catch {
						setClipboardStatus(
							"The rules could not be written to the clipboard.",
						)
						return
					}
					event.preventDefault()
					setClipboardStatus(
						`Copied ${selectedRules.length} rule${selectedRules.length === 1 ? "" : "s"}.`,
					)
					return
				}
				const copied = prepareOutlineClipboardCopy(
					glyph,
					activeMasterId,
					selection,
				)
				if (!copied.ok) {
					setClipboardStatus(copied.error)
					return
				}
				const written = writeOutlineClipboard(clipboard, copied.value.payload)
				if (!written.ok) {
					setClipboardStatus(written.error)
					return
				}
				event.preventDefault()
				const pointCount = copied.value.selectedPointIds.length
				setClipboardStatus(
					`Copied ${pointCount} outline node${pointCount === 1 ? "" : "s"}.`,
				)
			}}
			onCut={(event: JSX.TargetedClipboardEvent<HTMLElement>) => {
				if (
					editingTextIndex === null ||
					activeGlyphId === null ||
					event.target instanceof HTMLInputElement ||
					event.target instanceof HTMLTextAreaElement ||
					(event.target instanceof HTMLElement &&
						event.target.isContentEditable)
				)
					return
				const clipboard = event.clipboardData
				if (clipboard === null) {
					setClipboardStatus("The system clipboard is unavailable.")
					return
				}
				if (glyph === null) {
					setClipboardStatus("The active glyph is unavailable for cutting.")
					return
				}
				if (selectedRuleIds.length > 0) {
					const selectedRules = rules.filter((rule) =>
						selectedRuleIds.includes(rule.id),
					)
					const payload = createRuleClipboardPayload(selectedRules)
					const serialized = JSON.stringify(payload)
					try {
						clipboard.setData(RULE_CLIPBOARD_MIME, serialized)
						clipboard.setData("text/plain", serialized)
					} catch {
						setClipboardStatus(
							"The rules could not be written to the clipboard.",
						)
						return
					}
					event.preventDefault()
					workspace.font.actions.setGlyphRules({
						glyphId: activeGlyphId,
						rules: rules.filter((rule) => !selectedRuleIds.includes(rule.id)),
					})
					setSelectedRuleIds(Object.freeze([]))
					setClipboardStatus(
						`Cut ${selectedRules.length} rule${selectedRules.length === 1 ? "" : "s"}.`,
					)
					return
				}
				const copied = prepareOutlineClipboardCopy(
					glyph,
					activeMasterId,
					selection,
				)
				if (!copied.ok) {
					setClipboardStatus(copied.error)
					return
				}
				const written = writeOutlineClipboard(clipboard, copied.value.payload)
				if (!written.ok) {
					setClipboardStatus(written.error)
					return
				}
				event.preventDefault()
				workspace.font.actions.deleteSelection({
					masterId: activeMasterId,
					glyphId: activeGlyphId,
					pointIds: copied.value.selectedPointIds,
					handles: [],
					breakPaths: false,
				})
				setSelection(Object.freeze([]))
				const pointCount = copied.value.selectedPointIds.length
				setClipboardStatus(
					`Cut ${pointCount} outline node${pointCount === 1 ? "" : "s"}.`,
				)
			}}
			onPaste={(event: JSX.TargetedClipboardEvent<HTMLElement>) => {
				if (momentaryPreview) {
					event.preventDefault()
					return
				}
				if (
					editingTextIndex === null ||
					activeGlyphId === null ||
					event.target instanceof HTMLInputElement ||
					event.target instanceof HTMLTextAreaElement ||
					(event.target instanceof HTMLElement &&
						event.target.isContentEditable)
				)
					return
				const clipboard = event.clipboardData
				if (clipboard === null) {
					setClipboardStatus("The system clipboard is unavailable.")
					return
				}
				const serialized =
					clipboard.getData(RULE_CLIPBOARD_MIME) ||
					clipboard.getData(OUTLINE_CLIPBOARD_MIME) ||
					clipboard.getData("text/plain")
				if (serialized.length === 0) {
					setClipboardStatus(
						"The clipboard does not contain create-font outlines.",
					)
					return
				}
				if (serialized.includes('"create-font.rules"')) {
					const parsedRules = parseRuleClipboard(serialized)
					if (!parsedRules.ok) {
						setClipboardStatus(parsedRules.error)
						return
					}
					const additions = pastedRules(parsedRules.value, () => nextRuleId())
					workspace.font.actions.setGlyphRules({
						glyphId: activeGlyphId,
						rules: [...rules, ...additions],
					})
					event.preventDefault()
					setSelection(Object.freeze([]))
					setSelectedRuleIds(Object.freeze(additions.map((rule) => rule.id)))
					setClipboardStatus(
						`Pasted ${additions.length} rule${additions.length === 1 ? "" : "s"}.`,
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
					activeMasterId,
					activeGlyphId,
					[activeMasterId],
					nextClipboardEntityId,
					masterIds,
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
				setSelection(outlinePasteSelectionTargets(paste.value.selectedPointIds))
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
				if (
					event.key === "Escape" &&
					(cancelPointDrag() || cancelHandleDrag())
				) {
					event.preventDefault()
					return
				}
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
					releaseGroupDragCapture(currentGroupDrag)
					directDragPointerRef.current = null
					directDragCaptureTargetRef.current = null
					currentGroupDrag.node.getLayer()?.batchDraw()
					groupDragRef.current = null
					setTransformPreview(null)
					setDraggedPoint(null)
					setDraggedHandle(null)
					setJoinTarget(null)
					setActiveSnaps([])
					return
				}
				if (event.key === "Escape" && cancelPointDrag()) {
					event.preventDefault()
					return
				}
				if (event.key === "Escape" && penGestureRef.current !== null) {
					event.preventDefault()
					cancelPenGesture()
					return
				}
				if (event.key === "Escape" && shapeGestureRef.current !== null) {
					event.preventDefault()
					cancelShapeGesture()
					return
				}
				if (event.key === "Escape" && pendingRulePoint !== null) {
					event.preventDefault()
					setPendingRulePoint(null)
					setClipboardStatus("Canceled rule.")
					return
				}
				if (event.key === "Escape" && cancelTransform()) {
					event.preventDefault()
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
				if (event.isComposing) return
				if (
					editingTextIndex !== null &&
					(event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "a"
				) {
					event.preventDefault()
					if (activeTool === "rule") {
						setSelection(Object.freeze([]))
						setSelectedRuleIds(Object.freeze(rules.map((rule) => rule.id)))
						return
					}
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
					(selection.length > 0 || selectedRuleIds.length > 0)
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
					!event.repeat &&
					!event.altKey &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.shiftKey &&
					selection.some((target) => target.kind === "node")
				) {
					event.preventDefault()
					toggleSelectedNodeModes()
					return
				}
				const delta = ARROW_DELTAS[event.key]
				if (
					editingTextIndex === null ||
					activeGlyphId === null ||
					delta === undefined ||
					selection.length === 0
				)
					return
				const multiplier = keyboardStepMultiplier(event, IS_MAC_LIKE)
				const committedPoints =
					workspace.font.silo
						.getState(workspace.ui.activeLayer)
						?.contours.flatMap((contour) => contour.nodes) ?? allPoints
				if (event.altKey) {
					const tangentSelection = selectedTangentSlideConstraint(
						visibleContours,
						selection,
						selectedPoint === undefined
							? undefined
							: tangentDirectionFor(selectedPoint),
					)
					if (tangentSelection !== null) {
						event.preventDefault()
						const constraint = tangentSelection.constraint
						if (constraint === null) return
						rememberTangentDirection(constraint)
						const resolution = resolveTangentSlide(constraint, {
							x: constraint.origin.x + delta[0] * multiplier,
							y: constraint.origin.y + delta[1] * multiplier,
						})
						const point = resolution?.points[0]
						if (resolution !== null && point !== undefined) {
							if (
								point.x !== constraint.origin.x ||
								point.y !== constraint.origin.y
							) {
								commitTangentSlide(resolution)
							}
							return
						}
						return
					}
					const fixedHandlePlan = planSelectedHardNodeNudge(
						committedPoints,
						selection,
						delta[0] * multiplier,
						delta[1] * multiplier,
					)
					if (fixedHandlePlan !== null) {
						event.preventDefault()
						workspace.font.actions.transformControls({
							masterId: activeMasterId,
							glyphId: activeGlyphId,
							...fixedHandlePlan,
						})
						return
					}
				}
				const plan = planSelectionNudge(
					committedPoints,
					selection,
					delta[0] * multiplier,
					delta[1] * multiplier,
				)
				if (plan === null) return
				event.preventDefault()
				const currentKeys = new Set(selection.map(selectionKey))
				if (
					plan.selection.length !== currentKeys.size ||
					plan.selection.some(
						(target) => !currentKeys.has(selectionKey(target)),
					)
				) {
					setSelection(plan.selection)
				}
				workspace.font.actions.transformControls({
					masterId: activeMasterId,
					glyphId: activeGlyphId,
					...plan.result,
				})
			}}
		>
			<textarea
				ref={textareaRef}
				value={text}
				disabled={disabled}
				spellcheck={false}
				aria-label="Text canvas contents"
				onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
					if (
						event.altKey &&
						(event.key === "ArrowLeft" || event.key === "ArrowRight")
					) {
						const pair = workspace.font.silo.getState(
							workspace.ui.activeKerningPair,
						)
						if (pair !== null) {
							event.preventDefault()
							const step =
								event.metaKey || event.ctrlKey ? 100 : event.shiftKey ? 10 : 1
							workspace.actions.setActiveKerning(
								(pair.value ?? 0) + (event.key === "ArrowLeft" ? -step : step),
							)
							return
						}
					}
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
						if (
							event.key !== "Shift" &&
							event.key !== "Control" &&
							event.key !== "Alt" &&
							event.key !== "Meta"
						) {
							preferredCaretXRef.current = null
						}
						return
					}
					if (event.metaKey || event.ctrlKey || event.altKey) {
						preferredCaretXRef.current = null
						return
					}
					const movement = moveTextareaSelectionVertically(
						event.currentTarget,
						layout.carets,
						event.key === "ArrowUp" ? -1 : 1,
						{
							extend: event.shiftKey,
							preferredX: preferredCaretXRef.current,
						},
					)
					if (movement === null) return
					event.preventDefault()
					preferredCaretXRef.current = movement.preferredX
					event.currentTarget.setSelectionRange(
						movement.selectionStart,
						movement.selectionEnd,
						movement.selectionDirection,
					)
					setCaretIndex(movement.focus)
					setTextSelectionRange(
						Object.freeze({
							selectionStart: movement.selectionStart,
							selectionEnd: movement.selectionEnd,
							selectionDirection: movement.selectionDirection,
						}),
					)
					setTextSelectionCollapsed(
						movement.selectionStart === movement.selectionEnd,
					)
				}}
				onInput={(event: JSX.TargetedInputEvent<HTMLTextAreaElement>) => {
					const textarea = event.currentTarget
					const range = normalizedTextareaSelection(textarea)
					preferredCaretXRef.current = null
					setText(textarea.value)
					setCaretIndex(activeTextareaSelectionIndex(textarea))
					setTextSelectionRange(range)
					setTextSelectionCollapsed(range.selectionStart === range.selectionEnd)
				}}
				onSelect={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => {
					const textarea = event.currentTarget
					const range = normalizedTextareaSelection(textarea)
					setCaretIndex(activeTextareaSelectionIndex(textarea))
					setTextSelectionRange(range)
					setTextSelectionCollapsed(range.selectionStart === range.selectionEnd)
				}}
				onFocus={() => setTextareaFocused(true)}
				onBlur={() => setTextareaFocused(false)}
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
					onPointerDown={(event: KonvaEventObject<PointerEvent>) => {
						if (momentaryPreview) return
						if (activeTool === "rule") {
							plotRulePoint(event)
							return
						}
						if (activeShapeKind !== null) beginShapeGesture(event)
					}}
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
							if (activeTool === "pen" || activeShapeKind !== null) return
							if (!canStartBoxSelectionOn(event.target.name())) return
							const point = pointerInEditingGlyph(event)
							if (point === null) return
							setSelectionBox({
								startX: point.x,
								startY: point.y,
								endX: point.x,
								endY: point.y,
								mode: marqueeSelectionMode(event.evt),
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
						if (
							editingTextIndex !== null &&
							(activeTool === "pen" || activeShapeKind !== null)
						)
							return
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
							clearPenHoverPreview()
						if (activeShapeKind !== null && shapeGestureRef.current === null)
							clearShapeHoverGuides()
					}}
					onPointerMove={(event: KonvaEventObject<PointerEvent>) => {
						if (momentaryPreview) return
						if (editingTextIndex !== null && activeTool === "pen")
							updatePenPointer(event)
						else if (editingTextIndex !== null && activeShapeKind !== null)
							updateShapePointer(event)
					}}
					onPointerUp={(event: KonvaEventObject<PointerEvent>) => {
						if (momentaryPreview) return
						if (activeTool === "pen") finishPenGesture(event)
						else if (activeShapeKind !== null) finishShapeGesture(event)
					}}
					onPointerCancel={(event: KonvaEventObject<PointerEvent>) => {
						if (penGestureRef.current?.pointerId === event.evt.pointerId)
							cancelPenGesture()
						if (shapeGestureRef.current?.pointerId === event.evt.pointerId)
							cancelShapeGesture()
						cancelTransform()
						cancelDirectDrag(event.evt.pointerId)
					}}
					onLostPointerCapture={(event: KonvaEventObject<PointerEvent>) => {
						if (penGestureRef.current?.pointerId === event.evt.pointerId)
							cancelPenGesture()
						if (shapeGestureRef.current?.pointerId === event.evt.pointerId)
							cancelShapeGesture()
						cancelTransform()
						cancelDirectDrag(event.evt.pointerId)
					}}
					onMouseUp={() => {
						if (momentaryPreview) return
						if (selectionBox === null) return
						const boxed = targetsInside(selectionBox)
						setSelection((current) =>
							combineMarqueeSelection(current, boxed, selectionBox.mode),
						)
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
								if (editingTextIndex !== null && activeTool === "rule") {
									plotRulePoint(event)
									return
								}
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
							{editingTextIndex === null
								? selectionRects.map((selectionRect, index) => (
										<Rect
											key={`typing-selection:${index}`}
											name="typing-selection"
											x={selectionRect.x}
											y={selectionRect.y}
											width={selectionRect.width}
											height={selectionRect.height}
											fill={palette.accent}
											opacity={textareaFocused ? 0.3 : 0.18}
											listening={false}
										/>
									))
								: null}
							{layout.glyphs.map((position) => {
								const isEditing = position.item.textStart === editingTextIndex
								const typingFillPath =
									position.item.glyph === null
										? (position.item.sourcePreview?.path ?? "")
										: contoursToPath(position.item.glyph.contours)
								const typingOpenPath =
									position.item.sourcePreview?.openPath ?? ""
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
										{isEditing ? null : (
											<>
												<Path
													name="typing-glyph-fill"
													data={typingFillPath}
													fill={palette.previewInk}
													opacity={editingTextIndex === null ? 1 : 0.42}
													listening={false}
												/>
												<Path
													name="typing-open-contour-stroke"
													data={typingOpenPath}
													fillEnabled={false}
													stroke={palette.outline}
													strokeWidth={1.25 * inverseScale}
													opacity={editingTextIndex === null ? 1 : 0.42}
													listening={false}
												/>
											</>
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
									<Path
										name="momentary-open-contour-stroke"
										data={contourPaintPaths.openPath}
										fillEnabled={false}
										stroke={palette.outline}
										strokeWidth={1.25 * inverseScale}
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
									{ruleMeasurements.map(({ rule, measurement }) => {
										const selected = selectedRuleIds.includes(rule.id)
										return (
											<Group key={rule.id} name="glyph-rule">
												<Line
													name="glyph-rule-line"
													points={[...ruleViewportEndpoints(rule, ruleExtent)]}
													stroke={palette.accent}
													opacity={selected ? 1 : 0.72}
													strokeWidth={(selected ? 2 : 1.25) * inverseScale}
													hitStrokeWidth={12 * inverseScale}
													onPointerDown={(event) => {
														if (
															activeTool !== "select" &&
															activeTool !== "rule"
														)
															return
														event.cancelBubble = true
														setSelection(Object.freeze([]))
														setSelectedRuleIds(
															Object.freeze(
																event.evt.shiftKey
																	? selected
																		? selectedRuleIds.filter(
																				(id) => id !== rule.id,
																			)
																		: [...selectedRuleIds, rule.id]
																	: [rule.id],
															),
														)
													}}
												/>
												{showMeasures
													? measurement.measures.map((measure, index) => (
															<Group
																key={`${rule.id}:measure:${index}`}
																listening={false}
															>
																<Line
																	name="rule-measure"
																	points={[
																		measure.from.x,
																		measure.from.y,
																		measure.to.x,
																		measure.to.y,
																	]}
																	stroke={palette.guideStrong}
																	strokeWidth={3 * inverseScale}
																	opacity={0.85}
																/>
																<Text
																	name="rule-measure-label"
																	x={(measure.from.x + measure.to.x) / 2}
																	y={(measure.from.y + measure.to.y) / 2}
																	offsetX={
																		measure.label.length * 3 * inverseScale
																	}
																	offsetY={-6 * inverseScale}
																	scaleY={-1}
																	text={measure.label}
																	fontSize={11 * inverseScale}
																	fill={palette.guideStrong}
																/>
															</Group>
														))
													: null}
												{showMeasures
													? measurement.events.map((event, index) => (
															<Circle
																key={`${rule.id}:event:${index}`}
																name={`rule-${event.kind}`}
																x={event.x}
																y={event.y}
																radius={3.5 * inverseScale}
																fill={
																	event.kind === "entry"
																		? palette.accent
																		: palette.surface
																}
																stroke={palette.accent}
																strokeWidth={inverseScale}
																listening={false}
															/>
														))
													: null}
												{selected || activeTool === "rule" ? (
													<>
														<Circle
															name="rule-point-a"
															x={rule.a.x}
															y={rule.a.y}
															radius={4 * inverseScale}
															fill={palette.surface}
															stroke={palette.accent}
															strokeWidth={1.5 * inverseScale}
															listening={false}
														/>
														<Circle
															name="rule-point-b"
															x={rule.b.x}
															y={rule.b.y}
															radius={4 * inverseScale}
															fill={palette.accent}
															stroke={palette.surface}
															strokeWidth={inverseScale}
															listening={false}
														/>
													</>
												) : null}
											</Group>
										)
									})}
									{pendingRulePoint === null ? null : (
										<Circle
											name="rule-pending-point-a"
											x={pendingRulePoint.x}
											y={pendingRulePoint.y}
											radius={5 * inverseScale}
											fill={palette.surface}
											stroke={palette.accent}
											strokeWidth={1.5 * inverseScale}
											listening={false}
										/>
									)}
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
									{handleConstraintGuide === null ? null : (
										<Line
											name="handle-constraint-guide"
											points={(() => {
												const length = Math.hypot(
													handleConstraintGuide.vector.x,
													handleConstraintGuide.vector.y,
												)
												return [
													handleConstraintGuide.x,
													handleConstraintGuide.y,
													handleConstraintGuide.x +
														(handleConstraintGuide.vector.x / length) *
															activeSnapGuideExtent,
													handleConstraintGuide.y +
														(handleConstraintGuide.vector.y / length) *
															activeSnapGuideExtent,
												]
											})()}
											stroke={palette.accent}
											strokeWidth={1.5 * inverseScale}
											dash={[7 * inverseScale, 4 * inverseScale]}
											listening={false}
										/>
									)}
									{tangentGuide === null ? null : (
										<Line
											name="tangent-slide-guide"
											points={(() => {
												if (tangentGuide.end !== null) {
													return [
														tangentGuide.start.x,
														tangentGuide.start.y,
														tangentGuide.end.x,
														tangentGuide.end.y,
													]
												}
												const direction = tangentGuide.direction
												if (direction === null) return []
												const length = Math.hypot(direction.x, direction.y)
												return [
													tangentGuide.start.x,
													tangentGuide.start.y,
													tangentGuide.start.x +
														(direction.x / length) * activeSnapGuideExtent,
													tangentGuide.start.y +
														(direction.y / length) * activeSnapGuideExtent,
												]
											})()}
											stroke={palette.accent}
											strokeWidth={1.5 * inverseScale}
											dash={[7 * inverseScale, 4 * inverseScale]}
											listening={false}
										/>
									)}
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
									{!diffView ? null : (
										<Group name="version-control-diff" listening={false}>
											<Group x={diffGhostOffset.x} y={diffGhostOffset.y}>
												{diffBaselineContours.map((contour) => (
													<Path
														key={`diff-baseline:${contour.id}`}
														name="diff-baseline-path"
														data={editorContourToPath(
															contour.nodes,
															contour.closed,
														)}
														fill="#c43d4d"
														fillEnabled={contour.closed}
														opacity={0.16}
														stroke="#c43d4d"
														strokeWidth={1.75 * inverseScale}
														dash={[6 * inverseScale, 4 * inverseScale]}
													/>
												))}
												<Text
													x={0}
													y={metrics.ascender + 18 * inverseScale}
													scaleY={-1}
													text={`Reference · ${versionControl?.comparison?.base.label ?? "ref"}`}
													fontSize={10 * inverseScale}
													fill="#c43d4d"
												/>
											</Group>
											{diffTargetContours.map((contour) => (
												<Path
													key={`diff-current:${contour.id}`}
													name="diff-current-path"
													data={editorContourToPath(
														contour.nodes,
														contour.closed,
													)}
													fill="#16834b"
													fillEnabled={contour.closed}
													opacity={0.08}
													stroke="#16834b"
													strokeWidth={1.5 * inverseScale}
												/>
											))}
										</Group>
									)}
									{!visualDebug.compatibility ||
									compatibility === null ? null : (
										<Group name="master-compatibility" listening={false}>
											{comparisonContours.map((contour, pathIndex) => (
												<Path
													key={`compatibility-ghost:${contour.id}`}
													name="compatibility-ghost-path"
													x={compatibilityGhostOffset.x}
													y={compatibilityGhostOffset.y}
													data={editorContourToPath(
														contour.nodes,
														contour.closed,
													)}
													fill={compatibilityPathColor(pathIndex)}
													fillEnabled={contour.closed}
													opacity={0.24}
													stroke={
														incompatibleComparisonPaths.has(pathIndex)
															? "#ef4444"
															: compatibilityPathColor(pathIndex)
													}
													strokeWidth={
														(incompatibleComparisonPaths.has(pathIndex)
															? 3
															: 1.5) * inverseScale
													}
													dash={[5 * inverseScale, 4 * inverseScale]}
												/>
											))}
											{compatibility.paths.flatMap((path) =>
												path.nodes.map((node) => {
													const reference = comparisonCompatibilityPoints.get(
														node.referencePointId,
													)
													const active = activeCompatibilityPoints.get(
														node.comparisonPointId,
													)
													if (reference === undefined || active === undefined)
														return null
													const points = [
														reference.x + compatibilityGhostOffset.x,
														reference.y + compatibilityGhostOffset.y,
														active.x,
														active.y,
													]
													return (
														<Group
															key={`compatibility-map:${path.pathIndex}:${node.nodeIndex}`}
															name="compatibility-node-trace"
														>
															<Line
																name="compatibility-node-mapping-halo"
																points={points}
																stroke={palette.surface}
																strokeWidth={compatibilityTraceStyle.haloWidth}
																dash={compatibilityTraceStyle.dash}
																lineCap="round"
																opacity={0.95}
															/>
															<Line
																name="compatibility-node-mapping"
																points={points}
																stroke={compatibilityPathColor(path.pathIndex)}
																strokeWidth={
																	compatibilityTraceStyle.strokeWidth
																}
																dash={compatibilityTraceStyle.dash}
																lineCap="round"
																opacity={0.95}
															/>
														</Group>
													)
												}),
											)}
											{visibleContours.map((contour, pathIndex) => (
												<Path
													key={`compatibility-active:${contour.id}`}
													name="compatibility-active-path"
													data={editorContourToPath(
														contour.nodes,
														contour.closed,
													)}
													fill={compatibilityPathColor(pathIndex)}
													fillEnabled={contour.closed}
													opacity={0.2}
													stroke={
														incompatibleActivePaths.has(pathIndex)
															? "#ef4444"
															: compatibilityPathColor(pathIndex)
													}
													strokeWidth={
														(incompatibleActivePaths.has(pathIndex) ? 3 : 1.5) *
														inverseScale
													}
												/>
											))}
											{compatibility.diagnostics.flatMap(
												(diagnostic, index) => {
													const referenceContour =
														comparisonContours[diagnostic.reference.pathIndex]
													const activeContour =
														visibleContours[diagnostic.comparison.pathIndex]
													const reference = referenceContour?.nodes[0]
													const active = activeContour?.nodes[0]
													return [
														reference === undefined ? null : (
															<Circle
																key={`compatibility-error-reference:${index}`}
																x={reference.x + compatibilityGhostOffset.x}
																y={reference.y + compatibilityGhostOffset.y}
																radius={6 * inverseScale}
																fill="#ef4444"
																stroke="#ffffff"
																strokeWidth={1.5 * inverseScale}
															/>
														),
														active === undefined ? null : (
															<Circle
																key={`compatibility-error-active:${index}`}
																x={active.x}
																y={active.y}
																radius={6 * inverseScale}
																fill="#ef4444"
																stroke="#ffffff"
																strokeWidth={1.5 * inverseScale}
															/>
														),
													]
												},
											)}
										</Group>
									)}
									<Path
										data={combinedPreview.path}
										fill={palette.previewInk}
										opacity={0.1}
										listening={false}
									/>
									<Path
										name="closed-contour-outline"
										data={contourPaintPaths.closedPath}
										fillEnabled={false}
										stroke={palette.outline}
										strokeWidth={1.25 * inverseScale}
										listening={false}
									/>
									<Path
										name="open-contour-stroke"
										data={contourPaintPaths.openPath}
										fillEnabled={false}
										stroke={palette.outline}
										strokeWidth={1.25 * inverseScale}
										listening={false}
									/>
									{shapePreviewPath === "" ? null : (
										<Path
											name="shape-placement-preview"
											data={shapePreviewPath}
											fill={palette.accent}
											opacity={0.12}
											stroke={palette.accent}
											strokeWidth={1.5 * inverseScale}
											dash={[5 * inverseScale, 4 * inverseScale]}
											listening={false}
										/>
									)}
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
											name="outline-segment-helper"
											data={editorContourToPath(contour.nodes, contour.closed)}
											fillEnabled={false}
											stroke="rgb(0 0 0 / 0.001)"
											strokeWidth={inverseScale}
											hitStrokeWidth={SEGMENT_HIT_RADIUS_PX * 2 * inverseScale}
											listening={
												activeTool === "select" ||
												activeTool === "pen" ||
												activeTool === "knife"
											}
											onPointerDown={(event) => {
												if (activeTool !== "pen") return
												event.cancelBubble = true
												if (penPointerAction("segment") === "split")
													splitContourSegment(contour, event)
											}}
											onClick={(event) => {
												if (activeTool !== "knife") return
												event.cancelBubble = true
												cutContourSegment(contour, event)
											}}
											onTap={(event) => {
												if (activeTool !== "knife") return
												event.cancelBubble = true
												cutContourSegment(contour, event)
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
									{visibleContours.map((contour) => (
										<Path
											key={`segment-direct:${contour.id}`}
											name="outline-segment"
											data={editorContourToPath(contour.nodes, contour.closed)}
											fillEnabled={false}
											stroke="rgb(0 0 0 / 0.001)"
											strokeWidth={inverseScale}
											hitStrokeWidth={2.5 * inverseScale}
											listening={
												activeTool === "select" ||
												activeTool === "pen" ||
												activeTool === "knife"
											}
											draggable={activeTool === "select"}
											onPointerDown={(event) => {
												rememberDirectDragPointer(event)
												if (activeTool !== "pen") return
												event.cancelBubble = true
												if (penPointerAction("segment") === "split")
													splitContourSegment(contour, event)
											}}
											onClick={(event) => {
												if (activeTool !== "knife") return
												event.cancelBubble = true
												cutContourSegment(contour, event)
											}}
											onTap={(event) => {
												if (activeTool !== "knife") return
												event.cancelBubble = true
												cutContourSegment(contour, event)
											}}
											onMouseDown={(event) => {
												if (activeTool !== "select") return
												const action = segmentPointerAction(
													activeTool,
													event.evt,
												)
												if (action === "add-handles")
													addHandlesToSegment(contour, event)
											}}
											onDragStart={(event) => {
												if (
													activeTool !== "select" ||
													!beginSegmentGroupDrag(contour, event)
												) {
													event.target.stopDrag()
													event.target.position({ x: 0, y: 0 })
												}
											}}
											onDragMove={(event) => {
												previewGroupDrag(event)
											}}
											onDragEnd={(event) => {
												commitGroupDrag(event)
											}}
										/>
									))}
									{joinTarget === null ? null : (
										<Circle
											name="endpoint-join-candidate"
											x={joinTarget.x}
											y={joinTarget.y}
											radius={10 * inverseScale}
											fill="rgb(0 0 0 / 0)"
											stroke={palette.accent}
											strokeWidth={2 * inverseScale}
											listening={false}
										/>
									)}
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
																		opacity={
																			replacedPenEndpointHandle?.pointId ===
																				point.pointId &&
																			replacedPenEndpointHandle.handle ===
																				"incoming"
																				? 0.42
																				: 1
																		}
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
																		opacity={
																			replacedPenEndpointHandle?.pointId ===
																				point.pointId &&
																			replacedPenEndpointHandle.handle ===
																				"outgoing"
																				? 0.42
																				: 1
																		}
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
																if (!shouldActivateEditorControl(activeTool)) {
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
																if (!shouldActivateEditorControl(activeTool)) {
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
																if (!shouldActivateEditorControl(activeTool))
																	return
																setSelection(Object.freeze([nodeTarget]))
																toggleNodeMode(point.pointId, point.mode)
															}
															const rawHandleEndpoint = (
																drag: HandleDrag,
																event: KonvaEventObject<DragEvent>,
															): Readonly<{ x: number; y: number }> => {
																const pointer = pointerInEditingGlyph(event)
																return pointer === null
																	? { x: event.target.x(), y: event.target.y() }
																	: {
																			x:
																				drag.startEndpoint.x +
																				(pointer.x - drag.startPointer.x),
																			y:
																				drag.startEndpoint.y +
																				(pointer.y - drag.startPointer.y),
																		}
															}
															const beginHandleDrag = (
																handle: EditorHandleKind,
																vector: Readonly<{ x: number; y: number }>,
																event: KonvaEventObject<DragEvent>,
															): void => {
																selectHandle(handle, event)
																const startEndpoint = {
																	x: point.x + vector.x,
																	y: point.y + vector.y,
																}
																const capture = directDragCapture()
																handleDragRef.current = {
																	...capture,
																	pointId: point.pointId,
																	handle,
																	node: point,
																	startEndpoint,
																	startPointer:
																		pointerInEditingGlyph(event) ??
																		startEndpoint,
																	target: event.target,
																	lastRawEndpoint: null,
																}
																setShiftHeld(event.evt.shiftKey)
															}
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
																if (activeGlyphId === null) {
																	event.target.stopDrag()
																	return
																}
																selectPoint(event)
																const startPointer = pointerInEditingGlyph(
																	event,
																) ?? {
																	x: point.x,
																	y: point.y,
																}
																const capture = directDragCapture()
																pointDragRef.current = {
																	...capture,
																	glyphId: activeGlyphId,
																	masterId: activeMasterId,
																	pointId: point.pointId,
																	contourId: contour.id,
																	joinEligible: isPathEndpoint,
																	fixedHandleNode:
																		point.mode === "hard" &&
																		(point.incoming !== undefined ||
																			point.outgoing !== undefined)
																			? point
																			: null,
																	origin: { x: point.x, y: point.y },
																	startPointer,
																	projectionCandidates:
																		incidentStraightProjectionCandidates(
																			contours,
																			point.pointId,
																		),
																	target: event.target,
																	tangentEligible:
																		point.mode === "soft" &&
																		(point.incoming !== undefined ||
																			point.outgoing !== undefined),
																	tangentConstraint: tangentSlideConstraint(
																		contour.nodes,
																		pointIndex,
																		contour.closed,
																		tangentDirectionFor(point),
																		contour.tangentNodes,
																	),
																	lastRawPoint: null,
																	joinTarget: null,
																}
																setShiftHeld(event.evt.shiftKey)
																setAltHeld(event.evt.altKey)
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
																	rememberDirectDragPointer(event)
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
																			side: resolvePenEndpointSide({
																				pointIndex,
																				pointCount: contour.nodes.length,
																				direction: penDirection,
																			}),
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
																		event.evt.altKey,
																	)
																},
																onDragEnd: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	if (commitGroupDrag(event)) return
																	const drag = pointDragRef.current
																	if (drag?.pointId !== point.pointId) return
																	if (
																		event.evt === undefined ||
																		activeGlyphId !== drag.glyphId ||
																		activeMasterId !== drag.masterId ||
																		activeTool !== "select"
																	) {
																		finalizePointDrag(drag, {
																			restoreTarget: true,
																		})
																		return
																	}
																	let didCommit = false
																	try {
																		const committed = applyPointDrag(
																			drag,
																			rawPointForDrag(drag, event),
																			event.evt.shiftKey,
																			event.evt.altKey,
																		)
																		if (committed.kind === "tangent") {
																			commitTangentSlide(committed.resolution)
																			didCommit = true
																		} else if (
																			committed.kind === "fixed-handles"
																		) {
																			commitFixedHandleMove(
																				drag,
																				committed.resolution,
																			)
																			didCommit = true
																		} else if (committed.kind === "point") {
																			commitPointOrJoin(drag, committed.point)
																			didCommit = true
																		}
																	} catch (error) {
																		reportGeometryCommitError(error)
																	} finally {
																		finalizePointDrag(drag, {
																			restoreTarget: !didCommit,
																		})
																	}
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
																				name="outline-control-helper"
																				x={point.x + point.incoming.x}
																				y={point.y + point.incoming.y}
																				radius={controlHitRadius(
																					{
																						kind: "handle",
																						pointId: point.pointId,
																						handle: "incoming",
																					},
																					3.5,
																				)}
																				fill="rgb(0 0 0 / 0.001)"
																				listening={activeTool === "select"}
																			/>
																			<Circle
																				key={`incoming-handle:${point.pointId}`}
																				name="bezier-handle"
																				x={point.x + point.incoming.x}
																				y={point.y + point.incoming.y}
																				radius={3.5 * inverseScale}
																				fill={
																					replacedPenEndpointHandle?.pointId ===
																						point.pointId &&
																					replacedPenEndpointHandle.handle ===
																						"incoming"
																						? palette.handleLine
																						: palette.accent
																				}
																				opacity={
																					replacedPenEndpointHandle?.pointId ===
																						point.pointId &&
																					replacedPenEndpointHandle.handle ===
																						"incoming"
																						? 0.55
																						: 1
																				}
																				stroke={palette.nodeStroke}
																				strokeWidth={inverseScale}
																				{...(activeTool === "select"
																					? {}
																					: {
																							hitFunc: circularHitRegion(
																								controlHitRadius(
																									{
																										kind: "handle",
																										pointId: point.pointId,
																										handle: "incoming",
																									},
																									3.5,
																								),
																							),
																						})}
																				draggable={activeTool === "select"}
																				onPointerDown={(
																					event: KonvaEventObject<PointerEvent>,
																				) => {
																					rememberDirectDragPointer(event)
																					if (activeTool === "pen")
																						selectHandle("incoming", event)
																				}}
																				onDblClick={(event) => {
																					event.cancelBubble = true
																					if (activeTool === "select")
																						selectHandle("incoming", event)
																				}}
																				onDblTap={(event) => {
																					event.cancelBubble = true
																					if (activeTool === "select")
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
																						beginHandleDrag(
																							"incoming",
																							incoming,
																							event,
																						)
																				}}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (previewGroupDrag(event)) return
																					const drag = handleDragRef.current
																					if (
																						drag?.pointId !== point.pointId ||
																						drag.handle !== "incoming"
																					)
																						return
																					applyHandleDrag(
																						drag,
																						rawHandleEndpoint(drag, event),
																						event.evt.shiftKey,
																					)
																				}}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (commitGroupDrag(event)) return
																					const drag = handleDragRef.current
																					if (
																						drag?.pointId !== point.pointId ||
																						drag.handle !== "incoming"
																					)
																						return
																					let committedSuccessfully = false
																					try {
																						const committed = applyHandleDrag(
																							drag,
																							rawHandleEndpoint(drag, event),
																							event.evt.shiftKey,
																						)
																						if (isCommittableHandle(committed))
																							commitHandle(committed)
																						committedSuccessfully =
																							isCommittableHandle(committed)
																					} catch (error) {
																						reportGeometryCommitError(error)
																					} finally {
																						releaseDirectDragCapture(drag)
																						handleDragRef.current = null
																						directDragPointerRef.current = null
																						directDragCaptureTargetRef.current =
																							null
																						setDraggedHandle(null)
																						setHandleConstraintGuide(null)
																						if (!committedSuccessfully) {
																							finishCancelledTarget(
																								drag.target,
																								drag.startEndpoint,
																							)
																						}
																					}
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
																				name="outline-control-helper"
																				x={point.x + point.outgoing.x}
																				y={point.y + point.outgoing.y}
																				radius={controlHitRadius(
																					{
																						kind: "handle",
																						pointId: point.pointId,
																						handle: "outgoing",
																					},
																					3.5,
																				)}
																				fill="rgb(0 0 0 / 0.001)"
																				listening={activeTool === "select"}
																			/>
																			<Circle
																				key={`outgoing-handle:${point.pointId}`}
																				name="bezier-handle"
																				x={point.x + point.outgoing.x}
																				y={point.y + point.outgoing.y}
																				radius={3.5 * inverseScale}
																				fill={
																					replacedPenEndpointHandle?.pointId ===
																						point.pointId &&
																					replacedPenEndpointHandle.handle ===
																						"outgoing"
																						? palette.handleLine
																						: palette.accent
																				}
																				opacity={
																					replacedPenEndpointHandle?.pointId ===
																						point.pointId &&
																					replacedPenEndpointHandle.handle ===
																						"outgoing"
																						? 0.55
																						: 1
																				}
																				stroke={palette.nodeStroke}
																				strokeWidth={inverseScale}
																				{...(activeTool === "select"
																					? {}
																					: {
																							hitFunc: circularHitRegion(
																								controlHitRadius(
																									{
																										kind: "handle",
																										pointId: point.pointId,
																										handle: "outgoing",
																									},
																									3.5,
																								),
																							),
																						})}
																				draggable={activeTool === "select"}
																				onPointerDown={(
																					event: KonvaEventObject<PointerEvent>,
																				) => {
																					rememberDirectDragPointer(event)
																					if (activeTool === "pen")
																						selectHandle("outgoing", event)
																				}}
																				onDblClick={(event) => {
																					event.cancelBubble = true
																					if (activeTool === "select")
																						selectHandle("outgoing", event)
																				}}
																				onDblTap={(event) => {
																					event.cancelBubble = true
																					if (activeTool === "select")
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
																						beginHandleDrag(
																							"outgoing",
																							outgoing,
																							event,
																						)
																				}}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (previewGroupDrag(event)) return
																					const drag = handleDragRef.current
																					if (
																						drag?.pointId !== point.pointId ||
																						drag.handle !== "outgoing"
																					)
																						return
																					applyHandleDrag(
																						drag,
																						rawHandleEndpoint(drag, event),
																						event.evt.shiftKey,
																					)
																				}}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
																					if (commitGroupDrag(event)) return
																					const drag = handleDragRef.current
																					if (
																						drag?.pointId !== point.pointId ||
																						drag.handle !== "outgoing"
																					)
																						return
																					let committedSuccessfully = false
																					try {
																						const committed = applyHandleDrag(
																							drag,
																							rawHandleEndpoint(drag, event),
																							event.evt.shiftKey,
																						)
																						if (isCommittableHandle(committed))
																							commitHandle(committed)
																						committedSuccessfully =
																							isCommittableHandle(committed)
																					} catch (error) {
																						reportGeometryCommitError(error)
																					} finally {
																						releaseDirectDragCapture(drag)
																						handleDragRef.current = null
																						directDragPointerRef.current = null
																						directDragCaptureTargetRef.current =
																							null
																						setDraggedHandle(null)
																						setHandleConstraintGuide(null)
																						if (!committedSuccessfully) {
																							finishCancelledTarget(
																								drag.target,
																								drag.startEndpoint,
																							)
																						}
																					}
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
																	<Circle
																		name="outline-control-helper"
																		x={point.x}
																		y={point.y}
																		radius={controlHitRadius(nodeTarget, 6.5)}
																		fill="rgb(0 0 0 / 0.001)"
																		listening={activeTool === "select"}
																	/>
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
																			{...(activeTool === "select"
																				? {}
																				: {
																						hitFunc: circularHitRegion(
																							controlHitRadius(nodeTarget, 6),
																						),
																					})}
																			lineCap="round"
																		/>
																	) : point.mode === "soft" ? (
																		<Circle
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			radius={5 * inverseScale}
																			{...(activeTool === "select"
																				? {}
																				: {
																						hitFunc: circularHitRegion(
																							controlHitRadius(nodeTarget, 5),
																						),
																					})}
																		/>
																	) : (
																		<Rect
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			width={9 * inverseScale}
																			height={9 * inverseScale}
																			offsetX={4.5 * inverseScale}
																			offsetY={4.5 * inverseScale}
																			{...(activeTool === "select"
																				? {}
																				: {
																						hitFunc: circularHitRegion(
																							controlHitRadius(nodeTarget, 6.5),
																							{
																								x: 4.5 * inverseScale,
																								y: 4.5 * inverseScale,
																							},
																						),
																					})}
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
												onDragEnd={(event) => commitTransform(event)}
											/>
											{!hasRotationAffordance ||
											rotationHandlePosition === null ? null : (
												<>
													<Line
														name="transform-rotation-stem"
														points={[
															(transformBounds.minX + transformBounds.maxX) / 2,
															transformBounds.maxY,
															rotationHandlePosition.x,
															rotationHandlePosition.y,
														]}
														stroke={palette.accent}
														strokeWidth={1.5 * inverseScale}
														listening={false}
													/>
													<Circle
														name="transform-rotation"
														x={rotationHandlePosition.x}
														y={rotationHandlePosition.y}
														radius={8 * inverseScale}
														fill={palette.surface}
														stroke={palette.accent}
														strokeWidth={1.5 * inverseScale}
														hitStrokeWidth={12 * inverseScale}
														draggable
														onDragStart={(event) => {
															setTransformCursor("grabbing")
															beginTransform(
																"rotation",
																event.target.position(),
															)
														}}
														onDragMove={previewTransformDrag}
														onDragEnd={(event) => {
															commitTransform(event)
															setTransformCursor(null)
														}}
														onMouseEnter={() => setTransformCursor("grab")}
														onMouseLeave={() => {
															if (transformDrag === null)
																setTransformCursor(null)
														}}
													/>
													<Text
														name="transform-rotation-icon"
														x={rotationHandlePosition.x}
														y={rotationHandlePosition.y}
														text="↻"
														fontSize={12 * inverseScale}
														fill={palette.accent}
														offsetX={6 * inverseScale}
														offsetY={6 * inverseScale}
														scaleY={-1}
														listening={false}
													/>
													{rotationAngleDegrees === null ? null : (
														<Text
															name="transform-rotation-angle"
															x={rotationHandlePosition.x + 12 * inverseScale}
															y={rotationHandlePosition.y + 6 * inverseScale}
															text={`${rotationAngleDegrees}°${transformDrag?.shiftKey ? " · snapped" : ""}`}
															fontSize={11 * inverseScale}
															fill={palette.accent}
															scaleY={-1}
															listening={false}
														/>
													)}
												</>
											)}
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
													onDragEnd={(event) => {
														commitTransform(event)
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
			{activeTool === "transform" && hasRotationAffordance ? (
				<span
					className="sr-only"
					tabIndex={0}
					aria-label={`Rotation handle. Drag the circular handle above the selection to rotate around its center. Hold Shift to snap to ${TRANSFORM_ROTATION_SNAP_DEGREES} degree increments.`}
				>
					Rotation handle
				</span>
			) : null}
			{ruleMeasurements.map(({ rule, measurement }, ruleIndex) => (
				<span
					key={`accessible:${rule.id}`}
					className="sr-only"
					data-rule-summary={rule.id}
				>
					Rule {ruleIndex + 1}, A {rule.a.x.toFixed(1)}, {rule.a.y.toFixed(1)}{" "}
					to B {rule.b.x.toFixed(1)}, {rule.b.y.toFixed(1)}.
					{showMeasures
						? ` Measures: ${measurement.measures.map((measure) => `${measure.label} units`).join(", ") || "none"}.`
						: " Measures hidden."}
				</span>
			))}
			<p id="canvas-instructions">
				Type and add line breaks normally. Scroll to pan; use Command, Control,
				Option, or Alt with the wheel to zoom. Double-click a glyph to edit its
				outline. Double-click an outline segment to select its path; use the
				Knife Tool to break a path at a clicked point, or use the Pen Tool on a
				segment to insert a point, or Option/Alt-click a straight segment to add
				curve handles. Click with the Pen for a corner or press and drag for
				opposite Bézier handles. Drag one loose endpoint onto another path's
				loose endpoint to join them. Hold Shift to constrain node drags, Pen
				placement, or Pen and Select handles; click or drag a loose endpoint to
				resume its path, and Option/Alt-drag to break its tangent. Hold E for a
				clean glyph preview. Use Rect or Ellipse to drag a complete shape, and
				hold Shift for a square or circle. In the Transform tool, drag the
				circular rotation handle above the selection to rotate around its
				center; hold Shift to snap to {TRANSFORM_ROTATION_SNAP_DEGREES} degree
				increments. Press Escape to cancel a Pen or shape gesture, return to
				typing, or cancel a transform. Drag an empty area to box-select
				controls; hold Command or Control to add, or Shift to subtract
				(including when combined with Command or Control). Press Command or
				Control+A to select all, Shift+A to align, and Delete to remove the
				selection. Arrow keys nudge selected nodes and handles; Shift uses 10
				units and Command or Control uses 100. Option or Alt-drag or nudge one
				soft node to slide it between its fixed handles, or one hard node to
				move it without moving its handles. Use Command or Control+C, X, and V
				to copy, cut, and paste outline selections. Hold Option or Alt while
				deleting nodes to break paths open, or while deleting a handle to remove
				its adjoining segment. Use the Rule tool to click points A and B; rules
				persist with the glyph and can be selected, copied, cut, pasted,
				deleted, undone, and redone. The View Measures control hides derived
				intersections and one-decimal labels without hiding rules.
			</p>
			<output role="status" aria-live="polite">
				{clipboardStatus ??
					(momentaryPreview
						? `Momentary preview of ${glyph?.name ?? "glyph"}.`
						: editingTextIndex === null
							? textSelectionRange.selectionStart ===
								textSelectionRange.selectionEnd
								? `Typing mode at text position ${caretIndex}.`
								: `Typing mode with text positions ${textSelectionRange.selectionStart} through ${textSelectionRange.selectionEnd} selected; focus at ${caretIndex}.`
							: joinTarget !== null
								? `Release to join endpoint ${joinTarget.pointId}.`
								: activeTool === "pen" && penPlacement !== null
									? `Pen ${penGestureResolution?.kind === "curve" ? "curve " : ""}preview at ${penPlacement.x}, ${penPlacement.y}.`
									: shapeGestureResolution !== null && shapeGesture !== null
										? `${shapeGesture.kind === "rect" ? "Rect" : "Ellipse"} preview from ${shapeGestureResolution.bounds.minX}, ${shapeGestureResolution.bounds.minY} to ${shapeGestureResolution.bounds.maxX}, ${shapeGestureResolution.bounds.maxY}.`
										: rotationAngleDegrees !== null
											? `Rotation preview ${rotationAngleDegrees} degrees${transformDrag?.shiftKey ? `, snapped to ${TRANSFORM_ROTATION_SNAP_DEGREES} degree increments` : ""}.`
											: selection.length === 0
												? `Editing ${glyph?.name ?? "glyph"}; no outline controls selected.`
												: selection.length === 1 && selectedPoint !== undefined
													? `${selectedPoint.mode === "soft" ? "Soft" : "Hard"} node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`
													: `${selection.length} outline controls selected.`)}
			</output>
		</glyph-canvas>
	)
}
