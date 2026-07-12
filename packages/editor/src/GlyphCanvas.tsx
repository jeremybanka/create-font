import type { EditorHandleKind, PointId } from "@trigraph/states"
import type { KonvaEventObject } from "konva/lib/Node"
import type { JSX } from "preact"
import { useMemo, useState } from "preact/hooks"

import { previewHandleDrag } from "./curve-editing.ts"
import type { EditorWorkspace } from "./editor-workspace.ts"
import { contourStartDirection, editorContoursToPath } from "./geometry.ts"
import css from "./GlyphCanvas.module.css"
import { Circle, Group, Layer, Line, Path, Rect, Stage } from "./react-konva.ts"
import { useI, useO } from "./state-hooks.ts"
import { useCanvasTheme } from "./use-canvas-theme.ts"
import { useElementSize } from "./use-element-size.ts"

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

export function GlyphCanvas({ workspace }: GlyphCanvasProps) {
	const palette = useCanvasTheme()
	const source = workspace.document
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const layer = useO(workspace.ui.activeLayer)
	const selectedPointId = useO(workspace.ui.selectedPointId)
	const setSelectedPointId = useI(workspace.ui.selectedPointId)
	const showNodes = useO(workspace.ui.showNodes)
	const setShowNodes = useI(workspace.ui.showNodes)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const [draggedHandle, setDraggedHandle] = useState<DraggedHandle | null>(null)
	const { ref, width, height } = useElementSize<HTMLElement>()
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
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
	const designBottom = metrics.descender
	const designTop = metrics.ascender
	const designHeight = designTop - designBottom
	const advanceWidth = layer?.advanceWidth ?? 1_000
	const scale = Math.min(
		Math.max(0.01, (width - 88) / Math.max(1, advanceWidth)),
		Math.max(0.01, (height - 68) / Math.max(1, designHeight)),
	)
	const originX = Math.max(44, (width - advanceWidth * scale) / 2)
	const top = Math.max(34, (height - designHeight * scale) / 2)
	const baseline = top + designTop * scale
	const inverseScale = 1 / scale

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

	return (
		<glyph-canvas
			className={css.class}
			role="application"
			aria-label={`Outline editor for ${glyph?.name ?? "glyph"}`}
			aria-describedby="canvas-instructions"
			aria-keyshortcuts="BracketLeft BracketRight ArrowUp ArrowDown ArrowLeft ArrowRight"
			tabIndex={0}
			onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
				if ((event.key === "[" || event.key === "]") && allPoints.length > 0) {
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
				const delta = ARROW_DELTAS[event.key]
				if (delta === undefined || selectedPoint === undefined) return
				event.preventDefault()
				const multiplier = event.shiftKey ? 10 : 1
				commitPoint({
					pointId: selectedPoint.pointId,
					x: selectedPoint.x + delta[0] * multiplier,
					y: selectedPoint.y + delta[1] * multiplier,
				})
			}}
		>
			<canvas-toolbar>
				<canvas-title>
					<strong>{glyph?.name ?? "No glyph"}</strong>
					<span>{master?.name ?? "No master"} layer</span>
				</canvas-title>
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
			</canvas-toolbar>
			<canvas-surface ref={ref}>
				<Stage
					width={width}
					height={height}
					onMouseDown={(event: KonvaEventObject<MouseEvent>) => {
						if (
							event.target.name() !== "outline-point" &&
							event.target.name() !== "bezier-handle"
						) {
							setSelectedPointId(null)
						}
					}}
					onTouchStart={(event: KonvaEventObject<TouchEvent>) => {
						if (
							event.target.name() !== "outline-point" &&
							event.target.name() !== "bezier-handle"
						) {
							setSelectedPointId(null)
						}
					}}
				>
					<Layer>
						<Rect width={width} height={height} fill={palette.surface} />
						<Group x={originX} y={baseline} scaleX={scale} scaleY={-scale}>
							{[
								{ y: 0, color: palette.guideStrong, width: 1.1 },
								{ y: metrics.xHeight, color: palette.guideSoft, width: 1 },
								{ y: metrics.capHeight, color: palette.guideMid, width: 1 },
							].map((guide) => (
								<Line
									key={guide.y}
									points={[-1_000, guide.y, advanceWidth + 1_000, guide.y]}
									stroke={guide.color}
									strokeWidth={guide.width * inverseScale}
									listening={false}
								/>
							))}
							{[0, advanceWidth].map((x) => (
								<Line
									key={x}
									points={[x, designBottom, x, designTop]}
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
														onDragStart: selectPoint,
														onDragMove: (event: KonvaEventObject<DragEvent>) =>
															setDraggedPoint(dragPoint(event)),
														onDragEnd: (event: KonvaEventObject<DragEvent>) => {
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
																		commitHandle(dragHandle("incoming", event))
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
																		commitHandle(dragHandle("outgoing", event))
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
																	x={point.x}
																	y={point.y}
																	points={[
																		6 * inverseScale,
																		0,
																		-5 * inverseScale,
																		4.5 * inverseScale,
																		-5 * inverseScale,
																		-4.5 * inverseScale,
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
					</Layer>
				</Stage>
			</canvas-surface>
			<p id="canvas-instructions">
				Drag nodes or their Bézier handles. Bracket keys traverse nodes. Arrow
				keys nudge; hold Shift for 10 units.
			</p>
			<output role="status" aria-live="polite">
				{selectedPoint === undefined
					? "No outline node selected."
					: `${selectedPoint.mode === "soft" ? "Soft" : "Hard"} node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`}
			</output>
		</glyph-canvas>
	)
}
