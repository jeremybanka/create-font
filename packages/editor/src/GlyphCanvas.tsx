import type {
	ContourId,
	EditorHandleKind,
	GlyphId,
	PointId,
} from "@create-font/states"
import {
	matchingVerticalMetrics,
	resolveVerticalMetricGuides,
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
import { DotsHorizontalIcon, MinusIcon, PlusIcon } from "@radix-ui/react-icons"
import type { JSX } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import { hasWheelZoomModifier } from "./canvas-wheel.ts"
import { snapDraggedPoint, type ActiveSnap } from "./canvas-snapping.ts"
import {
	deriveOneSidedSoftHandles,
	previewHandleDrag,
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
import {
	canStartBoxSelectionOn,
	boundsOfControls,
	contourSelectionTargets,
	controlsInsideBounds,
	resolveSelectionControls,
	scaleSelectionControls,
	selectionKey,
	translateSelectionControls,
	type EditorSelectionTarget,
	type ResolvedSelectionControl,
	type SelectionBounds,
	type SelectionTransformResult,
} from "./outline-selection.ts"
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
import { TooltipButton } from "./TooltipButton.tsx"

export interface GlyphCanvasProps {
	readonly workspace: EditorWorkspace
}

interface DraggedPoint {
	readonly pointId: PointId
	readonly x: number
	readonly y: number
}

interface DraggedHandle {
	readonly pointId: PointId
	readonly handle: EditorHandleKind
	readonly vector: Readonly<{ x: number; y: number }>
}

interface SelectionBox {
	readonly startX: number
	readonly startY: number
	readonly endX: number
	readonly endY: number
	readonly additive: boolean
}

type TransformHandle =
	| "inside"
	| "north"
	| "north-east"
	| "east"
	| "south-east"
	| "south"
	| "south-west"
	| "west"
	| "north-west"

interface TransformDrag {
	readonly handle: TransformHandle
	readonly controls: readonly ResolvedSelectionControl[]
	readonly bounds: SelectionBounds
}

const ARROW_DELTAS: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, 1],
	ArrowDown: [0, -1],
}

const BASE_CANVAS_SCALE = 0.18
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

interface CanvasView {
	readonly x: number
	readonly y: number
	readonly zoom: number
}

export function GlyphCanvas({ workspace }: GlyphCanvasProps) {
	const palette = useCanvasTheme()
	const text = useO(workspace.ui.previewText)
	const setText = useI(workspace.ui.previewText)
	const caretIndex = useO(workspace.ui.caretIndex)
	const setCaretIndex = useI(workspace.ui.caretIndex)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const activeTool = useO(workspace.ui.activeTool)
	const run = useO(workspace.ui.previewRun)
	const location = useO(workspace.ui.previewLocation)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const glyph = useOF(workspace.font.selectors.editorGlyphSource, activeGlyphId)
	const master = useOF(workspace.font.atoms.master, activeMasterId)
	const metrics =
		useO(workspace.font.atoms.metrics) ?? workspace.document.metrics
	const metadata =
		useO(workspace.font.atoms.metadata) ?? workspace.document.metadata
	const axes = useO(workspace.font.selectors.editorAxesSource) ?? []
	const masterIds = useO(workspace.font.atoms.masterIds)
	const layer = useO(workspace.ui.activeLayer)
	const selection = useO(workspace.ui.selection)
	const setSelection = useI(workspace.ui.selection)
	const showNodes = useO(workspace.ui.showNodes)
	const setShowNodes = useI(workspace.ui.showNodes)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const [draggedHandle, setDraggedHandle] = useState<DraggedHandle | null>(null)
	const [activeSnaps, setActiveSnaps] = useState<readonly ActiveSnap[]>([])
	const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
	const [transformDrag, setTransformDrag] = useState<TransformDrag | null>(null)
	const [transformPreview, setTransformPreview] =
		useState<SelectionTransformResult | null>(null)
	const [penContourId, setPenContourId] = useState<ContourId | null>(null)
	const penEntitySequence = useRef(0)
	const clipboardEntitySequence = useRef(0)
	const [clipboardStatus, setClipboardStatus] = useState<string | null>(null)
	const [view, setView] = useState<CanvasView>({ x: 72, y: 72, zoom: 1 })
	const rootRef = useRef<HTMLElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const { ref, width, height } = useElementSize<HTMLElement>()
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
	const worldScale = BASE_CANVAS_SCALE * view.zoom
	const inverseScale = 1 / worldScale
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
		event: KonvaEventObject<MouseEvent>,
	): Readonly<{ x: number; y: number }> | null => {
		if (editingPosition === undefined) return null
		const pointer = event.target.getStage()?.getPointerPosition() ?? {
			x: event.evt.offsetX,
			y: event.evt.offsetY,
		}
		return {
			x: (pointer.x - view.x) / worldScale - editingPosition.x,
			y: editingPosition.baseline - (pointer.y - view.y) / worldScale,
		}
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
		setPenContourId(null)
		setActiveSnaps([])
	}, [activeGlyphId, activeMasterId, activeTool, editingTextIndex])

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
	const penCoordinates = (x: number, y: number) =>
		masterIds.map((sourceMasterId) => ({
			masterId: sourceMasterId,
			x:
				sourceMasterId === activeMasterId
					? x
					: Math.round(
							500 + (x - 500) * (master?.kind === "default" ? 0.94 : 1 / 0.94),
						),
			y,
		}))
	const addPenPoint = (x: number, y: number): void => {
		const roundedX = Math.round(x)
		const roundedY = Math.round(y)
		const currentContour = contours.find(
			(contour) => contour.id === penContourId,
		)
		const firstPoint = currentContour?.nodes[0]
		if (
			penContourId !== null &&
			currentContour !== undefined &&
			currentContour.nodes.length >= 3 &&
			firstPoint !== undefined &&
			Math.hypot(firstPoint.x - roundedX, firstPoint.y - roundedY) <= 40
		) {
			workspace.font.actions.setContourClosed({
				glyphId: activeGlyphId,
				contourId: penContourId,
				closed: true,
			})
			setPenContourId(null)
			return
		}
		const pointId = nextPenEntityId("point") as PointId
		if (penContourId === null) {
			const contourId = nextPenEntityId("contour") as ContourId
			workspace.font.actions.createContour({
				glyphId: activeGlyphId,
				contourId,
				point: { id: pointId, mode: "hard" },
				coordinates: penCoordinates(roundedX, roundedY),
			})
			setPenContourId(contourId)
		} else {
			workspace.font.actions.insertPoint({
				glyphId: activeGlyphId,
				contourId: penContourId,
				point: { id: pointId, mode: "hard" },
				coordinates: penCoordinates(roundedX, roundedY),
			})
		}
		setSelection(Object.freeze([{ kind: "node", pointId }]))
		setShowNodes(true)
	}
	const closePenContour = (contourId: ContourId): void => {
		workspace.font.actions.setContourClosed({
			glyphId: activeGlyphId,
			contourId,
			closed: true,
		})
		setPenContourId(null)
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
		event: MouseEvent,
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
	const splitContourSegment = (
		contour: (typeof visibleContours)[number],
		event: KonvaEventObject<MouseEvent>,
	): void => {
		const pointer = pointerInEditingGlyph(event)
		if (pointer === null) return
		const nearest = nearestEditorSegment(contour.nodes, contour.closed, pointer)
		if (nearest === null || nearest.amount <= 0.001 || nearest.amount >= 0.999)
			return
		event.cancelBubble = true
		const pointId = nextPenEntityId("point") as PointId
		workspace.font.actions.splitSegment({
			glyphId: activeGlyphId,
			contourId: contour.id,
			segmentIndex: nearest.segmentIndex,
			pointId,
			amount: nearest.amount,
		})
		setPenContourId(null)
		setSelection(Object.freeze([{ kind: "node", pointId }]))
		setShowNodes(true)
	}
	const zoomCanvas = (
		nextZoom: number,
		focalX = width / 2,
		focalY = height / 2,
	): void => {
		setView((current) => {
			const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
			const oldScale = BASE_CANVAS_SCALE * current.zoom
			const nextScale = BASE_CANVAS_SCALE * zoom
			const worldX = (focalX - current.x) / oldScale
			const worldY = (focalY - current.y) / oldScale
			return {
				x: focalX - worldX * nextScale,
				y: focalY - worldY * nextScale,
				zoom,
			}
		})
	}

	return (
		<glyph-canvas
			ref={rootRef}
			className={css.class}
			role="application"
			aria-label="Text layout and outline editor"
			aria-describedby="canvas-instructions"
			aria-keyshortcuts="Escape BracketLeft BracketRight Enter Delete Backspace Alt+Delete Alt+Backspace Meta+A Control+A Meta+C Control+C Meta+V Control+V Shift+A ArrowUp ArrowDown ArrowLeft ArrowRight"
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
				if (event.key === "Escape" && transformDrag !== null) {
					event.preventDefault()
					setTransformDrag(null)
					setTransformPreview(null)
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
				const multiplier = event.shiftKey ? 10 : 1
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
			<canvas-toolbar>
				<canvas-title>
					<strong>
						{editingTextIndex === null
							? "Text canvas"
							: `Editing ${glyph?.name ?? "glyph"}`}
					</strong>
					<span>
						{editingTextIndex === null
							? `${layout.lineCount} line${layout.lineCount === 1 ? "" : "s"} · double-click a glyph to edit`
							: activeTool === "pen"
								? penContourId === null
									? "Pen · click to start a contour"
									: "Pen · click the first point to close"
								: `${master?.name ?? "No master"} layer · Escape returns to typing`}
					</span>
				</canvas-title>
				<canvas-controls>
					{axes.map((axis) => {
						const coordinate = location[axis.id] ?? axis.default
						return (
							<label key={axis.id}>
								<span>{axis.tag}</span>
								<input
									type="range"
									min={axis.min}
									max={axis.max}
									step={1}
									value={coordinate}
									aria-label={`${axis.name} coordinate`}
									onInput={(event) =>
										workspace.actions.setPreviewCoordinate(
											axis.id,
											event.currentTarget.valueAsNumber,
										)
									}
								/>
								<output>{Math.round(coordinate)}</output>
							</label>
						)
					})}
					<zoom-controls aria-label="Canvas zoom">
						<TooltipButton
							label="Zoom out"
							description="Reduce the canvas magnification."
							placement="bottom"
							onClick={() => zoomCanvas(view.zoom / 1.2)}
						>
							<MinusIcon aria-hidden="true" />
						</TooltipButton>
						<TooltipButton
							label="Reset canvas view"
							description="Return to 100% zoom and reset the canvas pan."
							placement="bottom"
							onClick={() => setView({ x: 72, y: 72, zoom: 1 })}
						>
							{Math.round(view.zoom * 100)}%
						</TooltipButton>
						<TooltipButton
							label="Zoom in"
							description="Increase the canvas magnification."
							placement="bottom"
							onClick={() => zoomCanvas(view.zoom * 1.2)}
						>
							<PlusIcon aria-hidden="true" />
						</TooltipButton>
					</zoom-controls>
					{editingTextIndex === null ? null : (
						<button
							type="button"
							aria-pressed={showNodes}
							onClick={() => setShowNodes((visible) => !visible)}
						>
							<DotsHorizontalIcon aria-hidden="true" />
							Nodes
						</button>
					)}
				</canvas-controls>
			</canvas-toolbar>
			<canvas-surface ref={ref} data-tool={activeTool}>
				<Stage
					width={width}
					height={height}
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
						if (editingTextIndex !== null) {
							if (activeTool === "pen") {
								const point = pointerInEditingGlyph(event)
								if (point !== null) addPenPoint(point.x, point.y)
								return
							}
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
						if (selectionBox === null) return
						const point = pointerInEditingGlyph(event)
						if (point === null) return
						setSelectionBox((current) =>
							current === null
								? null
								: { ...current, endX: point.x, endY: point.y },
						)
					}}
					onMouseUp={() => {
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
							onMouseDown={(event: KonvaEventObject<MouseEvent>) => {
								if (editingTextIndex === null || activeTool !== "pen") return
								event.cancelBubble = true
								const point = pointerInEditingGlyph(event)
								if (point !== null) addPenPoint(point.x, point.y)
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
							{editingPosition === undefined || layer === null ? null : (
								<Group
									x={editingPosition.x}
									y={editingPosition.baseline}
									scaleY={-1}
								>
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
									{activeSnaps.map((snap) => (
										<Line
											key={`active-snap:${snap.axis}:${snap.kind}:${snap.id}`}
											points={
												snap.axis === "x"
													? [
															snap.value,
															metrics.descender - 100,
															snap.value,
															metrics.ascender + metrics.lineGap + 100,
														]
													: [-200, snap.value, advanceWidth + 200, snap.value]
											}
											stroke={palette.accent}
											strokeWidth={1.5 * inverseScale}
											dash={[7 * inverseScale, 4 * inverseScale]}
											listening={false}
										/>
									))}
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
									{visibleContours.map((contour) => (
										<Path
											key={`segment-hit:${contour.id}`}
											name="outline-segment"
											data={editorContourToPath(contour.nodes, contour.closed)}
											fillEnabled={false}
											stroke="rgb(0 0 0 / 0.001)"
											strokeWidth={inverseScale}
											hitStrokeWidth={14 * inverseScale}
											listening={
												activeTool === "select" || activeTool === "pen"
											}
											onMouseDown={(event) => {
												if (activeTool === "pen")
													splitContourSegment(contour, event)
											}}
											onDblClick={(event) => {
												if (activeTool !== "select") return
												event.cancelBubble = true
												selectWholeContour(contour, event.evt)
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
															const metricMatches = matchingVerticalMetrics(
																point.y,
																metricGuides,
															)
															const nodeTarget: EditorSelectionTarget = {
																kind: "node",
																pointId: point.pointId,
															}
															const selectPoint = (
																event?: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															): void => {
																if (
																	activeTool === "pen" &&
																	contour.id === penContourId &&
																	pointIndex === 0 &&
																	contour.nodes.length >= 3
																) {
																	if (event !== undefined)
																		event.cancelBubble = true
																	closePenContour(contour.id)
																	return
																}
																selectTarget(nodeTarget, event?.evt)
															}
															const selectHandle = (
																handle: EditorHandleKind,
																event?: KonvaEventObject<
																	MouseEvent | TouchEvent
																>,
															): void =>
																selectTarget(
																	{
																		kind: "handle",
																		pointId: point.pointId,
																		handle,
																	},
																	event?.evt,
																)
															const togglePointMode = (): void => {
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
															const dragPoint = (
																event: KonvaEventObject<DragEvent>,
															) => {
																const snapped = snapDraggedPoint({
																	pointId: point.pointId,
																	x: Math.round(event.target.x()),
																	y: Math.round(event.target.y()),
																	nodes: allPoints,
																	metrics: metricLines,
																	worldScale,
																})
																return {
																	point: {
																		pointId: point.pointId,
																		x: snapped.x,
																		y: snapped.y,
																	},
																	snaps: snapped.snaps,
																}
															}
															const nodeProps = {
																name: "outline-point",
																x: point.x,
																y: point.y,
																fill: palette.nodeFill,
																stroke: palette.nodeStroke,
																strokeWidth: 1.25 * inverseScale,
																draggable: activeTool === "select",
																onMouseDown: selectPoint,
																onTouchStart: selectPoint,
																onTap: selectPoint,
																onDblClick: togglePointMode,
																onDblTap: togglePointMode,
																onDragStart: selectPoint,
																onDragMove: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	const dragged = dragPoint(event)
																	setDraggedPoint(dragged.point)
																	setActiveSnaps(dragged.snaps)
																},
																onDragEnd: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	const dragged = dragPoint(event)
																	commitPoint(dragged.point)
																	setDraggedPoint(null)
																	setActiveSnaps([])
																},
															}
															return (
																<Group key={`node:${point.pointId}`}>
																	{metricMatches.length === 0 ? null : (
																		<Rect
																			name={metricMatches
																				.map((match) => `metric-${match.id}`)
																				.join(" ")}
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
																	)}
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
																				draggable
																				onMouseDown={(
																					event: KonvaEventObject<MouseEvent>,
																				) => selectHandle("incoming", event)}
																				onTouchStart={(
																					event: KonvaEventObject<TouchEvent>,
																				) => selectHandle("incoming", event)}
																				onTap={(
																					event: KonvaEventObject<
																						MouseEvent | TouchEvent
																					>,
																				) => selectHandle("incoming", event)}
																				onDragStart={() =>
																					selectHandle("incoming")
																				}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) =>
																					setDraggedHandle(
																						dragHandle("incoming", event),
																					)
																				}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
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
																				draggable
																				onMouseDown={(
																					event: KonvaEventObject<MouseEvent>,
																				) => selectHandle("outgoing", event)}
																				onTouchStart={(
																					event: KonvaEventObject<TouchEvent>,
																				) => selectHandle("outgoing", event)}
																				onTap={(
																					event: KonvaEventObject<
																						MouseEvent | TouchEvent
																					>,
																				) => selectHandle("outgoing", event)}
																				onDragStart={() =>
																					selectHandle("outgoing")
																				}
																				onDragMove={(
																					event: KonvaEventObject<DragEvent>,
																				) =>
																					setDraggedHandle(
																						dragHandle("outgoing", event),
																					)
																				}
																				onDragEnd={(
																					event: KonvaEventObject<DragEvent>,
																				) => {
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
																			hitStrokeWidth={12 * inverseScale}
																			lineCap="round"
																		/>
																	) : point.mode === "soft" ? (
																		<Circle
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			radius={5 * inverseScale}
																		/>
																	) : (
																		<Rect
																			key={`point:${point.pointId}`}
																			{...nodeProps}
																			width={9 * inverseScale}
																			height={9 * inverseScale}
																			offsetX={4.5 * inverseScale}
																			offsetY={4.5 * inverseScale}
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
													onDragStart={() => beginTransform(handle)}
													onDragMove={previewTransformDrag}
													onDragEnd={commitTransform}
												/>
											))}
										</Group>
									)}
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
				Tool on a segment to insert a point. Press Escape to return to typing or
				cancel a transform. Drag an empty area to box-select controls; press
				Command or Control+A to select all, Shift+A to align, and Delete to
				remove the selection. Use Command or Control+C and V to copy and paste
				outline selections. Hold Option or Alt while deleting nodes to break
				paths open, or while deleting a handle to remove its adjoining segment.
			</p>
			<output role="status" aria-live="polite">
				{clipboardStatus ??
					(editingTextIndex === null
						? `Typing mode at text position ${caretIndex}.`
						: selection.length === 0
							? `Editing ${glyph?.name ?? "glyph"}; no outline controls selected.`
							: selection.length === 1 && selectedPoint !== undefined
								? `${selectedPoint.mode === "soft" ? "Soft" : "Hard"} node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`
								: `${selection.length} outline controls selected.`)}
			</output>
		</glyph-canvas>
	)
}
