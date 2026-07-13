import type { EditorHandleKind, GlyphId, PointId } from "@trigraph/states"
import type { KonvaEventObject } from "konva/lib/Node"
import type { JSX } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import { previewHandleDrag, toggledNodeMode } from "./curve-editing.ts"
import type { EditorWorkspace } from "./editor-workspace.ts"
import {
	contoursToPath,
	contourStartDirection,
	editorContoursToPath,
} from "./geometry.ts"
import css from "./GlyphCanvas.module.css"
import { Circle, Group, Layer, Line, Path, Rect, Stage } from "./react-konva.ts"
import { useI, useO } from "./state-hooks.ts"
import { useCanvasTheme } from "./use-canvas-theme.ts"
import { useElementSize } from "./use-element-size.ts"
import { layoutTextRun, nearestCaretIndex } from "./text-layout.ts"

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
	const source = workspace.document
	const text = useO(workspace.ui.previewText)
	const setText = useI(workspace.ui.previewText)
	const caretIndex = useO(workspace.ui.caretIndex)
	const setCaretIndex = useI(workspace.ui.caretIndex)
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const run = useO(workspace.ui.previewRun)
	const location = useO(workspace.ui.previewLocation)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const layer = useO(workspace.ui.activeLayer)
	const selectedPointId = useO(workspace.ui.selectedPointId)
	const setSelectedPointId = useI(workspace.ui.selectedPointId)
	const showNodes = useO(workspace.ui.showNodes)
	const setShowNodes = useI(workspace.ui.showNodes)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const [draggedHandle, setDraggedHandle] = useState<DraggedHandle | null>(null)
	const [view, setView] = useState<CanvasView>({ x: 72, y: 72, zoom: 1 })
	const rootRef = useRef<HTMLElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const { ref, width, height } = useElementSize<HTMLElement>()
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	const layout = useMemo(
		() => layoutTextRun(run, source.metrics, source.metadata.unitsPerEm),
		[run, source.metadata.unitsPerEm, source.metrics],
	)
	const editingPosition = layout.glyphs.find(
		(position) => position.item.textStart === editingTextIndex,
	)
	const contours = layer?.contours ?? []
	const visibleContours = useMemo(
		() =>
			contours.map((contour) =>
				contour.map((point) => {
					const movedPoint =
						point.pointId === draggedPoint?.pointId
							? { ...point, x: draggedPoint.x, y: draggedPoint.y }
							: point
					return movedPoint.pointId === draggedHandle?.pointId
						? previewHandleDrag(
								movedPoint,
								draggedHandle.handle,
								draggedHandle.vector,
							)
						: movedPoint
				}),
			),
		[contours, draggedHandle, draggedPoint],
	)
	const allPoints = visibleContours.flat()
	const selectedPoint = allPoints.find(
		(point) => point.pointId === selectedPointId,
	)
	const metrics = source.metrics
	const advanceWidth = layer?.advanceWidth ?? 1_000
	const worldScale = BASE_CANVAS_SCALE * view.zoom
	const inverseScale = 1 / worldScale
	const caret =
		layout.carets.find((candidate) => candidate.textIndex === caretIndex) ??
		layout.carets.at(-1)

	useEffect(() => {
		if (editingTextIndex !== null) return
		const frame = requestAnimationFrame(() => textareaRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [editingTextIndex])

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
			aria-keyshortcuts="Escape BracketLeft BracketRight Enter ArrowUp ArrowDown ArrowLeft ArrowRight"
			tabIndex={0}
			onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
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
					(event.key === "[" || event.key === "]") &&
					allPoints.length > 0
				) {
					event.preventDefault()
					const currentIndex = allPoints.findIndex(
						(point) => point.pointId === selectedPointId,
					)
					const direction = event.key === "]" ? 1 : -1
					const nextIndex =
						currentIndex === -1
							? direction === 1
								? 0
								: allPoints.length - 1
							: (currentIndex + direction + allPoints.length) % allPoints.length
					setSelectedPointId(allPoints[nextIndex]?.pointId ?? null)
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
					selectedPoint === undefined
				)
					return
				event.preventDefault()
				const multiplier = event.shiftKey ? 10 : 1
				commitPoint({
					pointId: selectedPoint.pointId,
					x: selectedPoint.x + delta[0] * multiplier,
					y: selectedPoint.y + delta[1] * multiplier,
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
					setCaretIndex(textarea.selectionStart ?? textarea.value.length)
				}}
				onSelect={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) =>
					setCaretIndex(event.currentTarget.selectionStart ?? 0)
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
							: `${master?.name ?? "No master"} layer · Escape returns to typing`}
					</span>
				</canvas-title>
				<canvas-controls>
					{source.axes.map((axis) => {
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
						<button
							type="button"
							aria-label="Zoom out"
							onClick={() => zoomCanvas(view.zoom / 1.2)}
						>
							−
						</button>
						<button
							type="button"
							title="Reset canvas view"
							onClick={() => setView({ x: 72, y: 72, zoom: 1 })}
						>
							{Math.round(view.zoom * 100)}%
						</button>
						<button
							type="button"
							aria-label="Zoom in"
							onClick={() => zoomCanvas(view.zoom * 1.2)}
						>
							+
						</button>
					</zoom-controls>
					{editingTextIndex === null ? null : (
						<button
							type="button"
							aria-pressed={showNodes}
							onClick={() => setShowNodes((visible) => !visible)}
						>
							<nodes-icon aria-hidden="true">
								<i />
								<i />
								<i />
							</nodes-icon>
							Nodes
						</button>
					)}
				</canvas-controls>
			</canvas-toolbar>
			<canvas-surface ref={ref}>
				<Stage
					width={width}
					height={height}
					onWheel={(event: KonvaEventObject<WheelEvent>) => {
						event.evt.preventDefault()
						const pointer = event.target.getStage()?.getPointerPosition()
						if (
							pointer !== null &&
							pointer !== undefined &&
							(event.evt.ctrlKey || event.evt.metaKey)
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
						if (event.target.name() !== "canvas-background") return
						if (editingTextIndex !== null) {
							setSelectedPointId(null)
							return
						}
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
					onTouchStart={(event: KonvaEventObject<TouchEvent>) => {
						if (
							editingTextIndex !== null &&
							event.target.name() === "canvas-background"
						)
							setSelectedPointId(null)
					}}
				>
					<Layer>
						<Rect
							name="canvas-background"
							width={width}
							height={height}
							fill={palette.surface}
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
									{[
										{ y: 0, color: palette.guideStrong, width: 1.1 },
										{ y: metrics.xHeight, color: palette.guideSoft, width: 1 },
										{ y: metrics.capHeight, color: palette.guideMid, width: 1 },
									].map((guide) => (
										<Line
											key={guide.y}
											points={[-200, guide.y, advanceWidth + 200, guide.y]}
											stroke={guide.color}
											strokeWidth={guide.width * inverseScale}
											listening={false}
										/>
									))}
									{[0, advanceWidth].map((x) => (
										<Line
											key={x}
											points={[x, metrics.descender, x, metrics.ascender]}
											stroke={palette.guideSoft}
											strokeWidth={inverseScale}
											listening={false}
										/>
									))}
									<Path
										data={editorContoursToPath(visibleContours)}
										fillEnabled={false}
										stroke={palette.outline}
										strokeWidth={1.25 * inverseScale}
										listening={false}
									/>
									{showNodes
										? visibleContours.map((contour, contourIndex) => {
												const direction = contourStartDirection(contour)
												const directionRadians =
													((direction?.angle ?? 0) * Math.PI) / 180
												return (
													<Group key={`handles:${contourIndex}`}>
														{contour.map((point) => (
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
														{contour.map((point, pointIndex) => {
															const selectPoint = (): void =>
																setSelectedPointId(point.pointId)
															const togglePointMode = (): void => {
																selectPoint()
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
															): DraggedPoint => ({
																pointId: point.pointId,
																x: Math.round(event.target.x()),
																y: Math.round(event.target.y()),
															})
															const nodeProps = {
																name: "outline-point",
																x: point.x,
																y: point.y,
																fill: palette.nodeFill,
																stroke: palette.nodeStroke,
																strokeWidth: 1.25 * inverseScale,
																draggable: true,
																onMouseDown: selectPoint,
																onTouchStart: selectPoint,
																onTap: selectPoint,
																onDblClick: togglePointMode,
																onDblTap: togglePointMode,
																onDragStart: selectPoint,
																onDragMove: (
																	event: KonvaEventObject<DragEvent>,
																) => setDraggedPoint(dragPoint(event)),
																onDragEnd: (
																	event: KonvaEventObject<DragEvent>,
																) => {
																	commitPoint(dragPoint(event))
																	setDraggedPoint(null)
																},
															}
															return (
																<Group key={`node:${point.pointId}`}>
																	{point.incoming === undefined ? null : (
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
																			onMouseDown={selectPoint}
																			onTouchStart={selectPoint}
																			onTap={selectPoint}
																			onDragStart={selectPoint}
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
																	)}
																	{point.outgoing === undefined ? null : (
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
																			onMouseDown={selectPoint}
																			onTouchStart={selectPoint}
																			onTap={selectPoint}
																			onDragStart={selectPoint}
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
																	)}
																	{point.pointId === selectedPointId ? (
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
																	{point.mode === "soft" ? (
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
								</Group>
							)}
						</Group>
					</Layer>
				</Stage>
			</canvas-surface>
			<p id="canvas-instructions">
				Type and add line breaks normally. Scroll to pan; use Command or Control
				with the wheel to zoom. Double-click a glyph to edit its outline. Press
				Escape to return to typing.
			</p>
			<output role="status" aria-live="polite">
				{editingTextIndex === null
					? `Typing mode at text position ${caretIndex}.`
					: selectedPoint === undefined
						? `Editing ${glyph?.name ?? "glyph"}; no outline node selected.`
						: `${selectedPoint.mode === "soft" ? "Soft" : "Hard"} node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`}
			</output>
		</glyph-canvas>
	)
}
