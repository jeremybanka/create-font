import type { PointId } from "@trigraph/states"
import type { KonvaEventObject } from "konva/lib/Node"
import type { JSX } from "preact"
import { useMemo, useState } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { contoursToPath, type OutlinePoint } from "./geometry.ts"
import css from "./GlyphCanvas.module.css"
import { Circle, Group, Layer, Line, Path, Rect, Stage } from "./react-konva.ts"
import { useI, useO } from "./state-hooks.ts"
import { useElementSize } from "./use-element-size.ts"

export interface GlyphCanvasProps {
	readonly workspace: EditorWorkspace
}

interface DraggedPoint {
	readonly id: PointId
	readonly x: number
	readonly y: number
}

interface CanvasPoint extends OutlinePoint {
	readonly id: PointId
}

const ARROW_DELTAS: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, 1],
	ArrowDown: [0, -1],
}

export function GlyphCanvas({ workspace }: GlyphCanvasProps) {
	const source = workspace.document
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const layer = useO(workspace.ui.activeLayer)
	const selectedPointId = useO(workspace.ui.selectedPointId)
	const setSelectedPointId = useI(workspace.ui.selectedPointId)
	const showNodes = useO(workspace.ui.showNodes)
	const setShowNodes = useI(workspace.ui.showNodes)
	const [draggedPoint, setDraggedPoint] = useState<DraggedPoint | null>(null)
	const { ref, width, height } = useElementSize<HTMLElement>()
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	const contours = useMemo<readonly (readonly CanvasPoint[])[]>(() => {
		if (!layer.ok || glyph === undefined) return []
		return layer.value.contours.map((contour, contourIndex) => {
			const topology = glyph.contours[contourIndex]
			return contour.flatMap((point, pointIndex) => {
				const id = topology?.points[pointIndex]?.id
				if (id === undefined) return []
				return [{ ...point, id }]
			})
		})
	}, [glyph, layer])
	const visibleContours = useMemo(
		() =>
			contours.map((contour) =>
				contour.map((point) =>
					point.id === draggedPoint?.id
						? { ...point, x: draggedPoint.x, y: draggedPoint.y }
						: point,
				),
			),
		[contours, draggedPoint],
	)
	const allPoints = visibleContours.flat()
	const selectedPoint = allPoints.find((point) => point.id === selectedPointId)
	const metrics = source.metrics
	const designBottom = metrics.descender
	const designTop = metrics.ascender
	const designHeight = designTop - designBottom
	const advanceWidth = layer.ok ? layer.value.advanceWidth : 1_000
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
			points: [{ pointId: point.id, x: point.x, y: point.y }],
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
						(point) => point.id === selectedPointId,
					)
					const direction = event.key === "]" ? 1 : -1
					const nextIndex =
						currentIndex === -1
							? direction === 1
								? 0
								: allPoints.length - 1
							: (currentIndex + direction + allPoints.length) % allPoints.length
					setSelectedPointId(allPoints[nextIndex]?.id ?? null)
					setShowNodes(true)
					return
				}
				const delta = ARROW_DELTAS[event.key]
				if (delta === undefined || selectedPoint === undefined) return
				event.preventDefault()
				const multiplier = event.shiftKey ? 10 : 1
				commitPoint({
					id: selectedPoint.id,
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
						if (event.target.name() !== "outline-point") {
							setSelectedPointId(null)
						}
					}}
					onTouchStart={(event: KonvaEventObject<TouchEvent>) => {
						if (event.target.name() !== "outline-point") {
							setSelectedPointId(null)
						}
					}}
				>
					<Layer>
						<Rect width={width} height={height} fill="#f8f7f3" />
						<Group x={originX} y={baseline} scaleX={scale} scaleY={-scale}>
							{[
								{ y: 0, color: "#9e9a91", width: 1.1 },
								{ y: metrics.xHeight, color: "#ddd9d1", width: 1 },
								{ y: metrics.capHeight, color: "#cfcac1", width: 1 },
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
									stroke="#e3dfd7"
									strokeWidth={inverseScale}
									listening={false}
								/>
							))}
							<Path
								data={contoursToPath(visibleContours)}
								fill="#191814"
								fillRule="evenodd"
								stroke="#191814"
								strokeWidth={1.25 * inverseScale}
								listening={false}
							/>
							{showNodes
								? visibleContours.map((contour, contourIndex) => (
										<Group key={`handles:${contourIndex}`}>
											<Line
												points={contour.flatMap((point) => [point.x, point.y])}
												closed
												stroke="#b9b4aa"
												strokeWidth={inverseScale}
												dash={[4 * inverseScale, 4 * inverseScale]}
												listening={false}
											/>
											{contour.map((point) => (
												<Group key={point.id}>
													{point.id === selectedPointId ? (
														<Circle
															x={point.x}
															y={point.y}
															radius={10 * inverseScale}
															stroke="#ce5d3d"
															strokeWidth={2 * inverseScale}
															listening={false}
														/>
													) : null}
													<Circle
														name="outline-point"
														x={point.x}
														y={point.y}
														radius={(point.onCurve ? 5 : 4) * inverseScale}
														fill={point.onCurve ? "#faf9f5" : "#ce5d3d"}
														stroke="#171713"
														strokeWidth={1.25 * inverseScale}
														draggable
														onMouseDown={() => setSelectedPointId(point.id)}
														onTap={() => setSelectedPointId(point.id)}
														onDragStart={() => setSelectedPointId(point.id)}
														onDragMove={(
															event: KonvaEventObject<DragEvent>,
														) => {
															setDraggedPoint({
																id: point.id,
																x: Math.round(event.target.x()),
																y: Math.round(event.target.y()),
															})
														}}
														onDragEnd={(event: KonvaEventObject<DragEvent>) => {
															const next = {
																id: point.id,
																x: Math.round(event.target.x()),
																y: Math.round(event.target.y()),
															}
															commitPoint(next)
															setDraggedPoint(null)
														}}
													/>
												</Group>
											))}
										</Group>
									))
								: null}
						</Group>
					</Layer>
				</Stage>
			</canvas-surface>
			<p id="canvas-instructions">
				Select and drag a node. Bracket keys traverse nodes. Arrow keys nudge;
				hold Shift for 10 units.
			</p>
			<output role="status" aria-live="polite">
				{selectedPoint === undefined
					? "No outline node selected."
					: `Node ${allPoints.indexOf(selectedPoint) + 1} selected at ${selectedPoint.x}, ${selectedPoint.y}.`}
			</output>
		</glyph-canvas>
	)
}
