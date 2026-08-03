import type { ContourId, EditorLayerNode, MasterId } from "@create-font/states"
import type * as React from "react"
import { useMemo, useRef, useState } from "react"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { editorContourToPath } from "./geometry.ts"
import { contourSelectionTargets, selectionKey } from "./outline-selection.ts"
import { useI, useO, useOptionalOF } from "./state-hooks.ts"
import { compatibilityPathColor } from "./visual-debug.ts"
import css from "./CompatibilityTile.module.css"

export interface CompatibilityTileProps {
	readonly workspace: EditorWorkspace
}

const OFFSET_MIN = -96
const OFFSET_MAX = 96

interface ContourThumbnailGeometry {
	readonly viewBox: string
	readonly transform: string
}

function contourThumbnailGeometry(
	nodes: readonly EditorLayerNode[],
): ContourThumbnailGeometry {
	if (nodes.length === 0) {
		return { viewBox: "0 0 1 1", transform: "translate(0 1) scale(1 -1)" }
	}
	const xs = nodes.flatMap((node) => [
		node.x,
		...(node.incoming === undefined ? [] : [node.x + node.incoming.x]),
		...(node.outgoing === undefined ? [] : [node.x + node.outgoing.x]),
	])
	const ys = nodes.flatMap((node) => [
		node.y,
		...(node.incoming === undefined ? [] : [node.y + node.incoming.y]),
		...(node.outgoing === undefined ? [] : [node.y + node.outgoing.y]),
	])
	const minX = Math.min(...xs)
	const maxX = Math.max(...xs)
	const minY = Math.min(...ys)
	const maxY = Math.max(...ys)
	const padding = Math.max(maxX - minX, maxY - minY, 1) * 0.12
	return {
		viewBox: `${minX - padding} ${minY - padding} ${Math.max(maxX - minX + padding * 2, 1)} ${Math.max(maxY - minY + padding * 2, 1)}`,
		transform: `translate(0 ${minY + maxY}) scale(1 -1)`,
	}
}

export function CompatibilityTile({ workspace }: CompatibilityTileProps) {
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const comparisonMasterId = useO(workspace.ui.comparisonMasterId)
	const masterIds = useO(workspace.font.atoms.masterIds)
	const layer = useO(workspace.ui.activeLayer)
	const visualDebug = useO(workspace.ui.visualDebug)
	const offset = useO(workspace.ui.compatibilityGhostOffset)
	const setOffset = useI(workspace.ui.compatibilityGhostOffset)
	const selection = useO(workspace.ui.selection)
	const setSelection = useI(workspace.ui.selection)
	const setShowNodes = useI(workspace.ui.showNodes)
	const [draggedContourId, setDraggedContourId] = useState<ContourId | null>(
		null,
	)
	const suppressDragClick = useRef(false)
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
		[comparisonMasterId, activeMasterId, workspace.initialGlyphId],
	)
	const contours = layer?.contours ?? []
	const editing =
		editingTextIndex !== null && activeGlyphId !== null && layer !== null
	const comparisonMasterIds = masterIds.filter(
		(masterId) => masterId !== activeMasterId,
	)
	const setOffsetAxis = (axis: "x" | "y", value: number): void => {
		if (!Number.isFinite(value)) return
		setOffset((current) => ({ ...current, [axis]: value }))
	}
	const reorderContour = (contourId: ContourId, toIndex: number): void => {
		if (activeGlyphId === null || contours.length === 0) return
		workspace.font.actions.reorderContour({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			contourId,
			toIndex: Math.max(0, Math.min(contours.length - 1, toIndex)),
		})
	}
	const selectContour = (nodes: readonly EditorLayerNode[]): void => {
		setSelection(Object.freeze(contourSelectionTargets(nodes)))
		setShowNodes(true)
	}

	return (
		<compatibility-tile
			className={css.class}
			role="region"
			aria-label="Master compatibility and path order"
			onKeyDown={(event: React.KeyboardEvent<HTMLElement>) =>
				event.stopPropagation()
			}
		>
			<compatibility-controls>
				<label>
					<span>Compare with</span>
					<select
						aria-label="Comparison master"
						value={comparisonMasterId}
						disabled={comparisonMasterIds.length === 0}
						onChange={(event) =>
							workspace.actions.selectComparisonMaster(
								event.currentTarget.value as MasterId,
							)
						}
					>
						{comparisonMasterIds.map((masterId) => (
							<option key={masterId} value={masterId}>
								{workspace.document.masters.find(
									(master) => master.id === masterId,
								)?.name ?? masterId}
							</option>
						))}
					</select>
				</label>
				<label data-kind="toggle">
					<span>Show overlay</span>
					<input
						type="checkbox"
						checked={visualDebug.compatibility}
						onChange={(event) => {
							if (event.currentTarget.checked !== visualDebug.compatibility) {
								workspace.actions.toggleVisualDebug("compatibility")
							}
						}}
					/>
				</label>
			</compatibility-controls>

			<offset-controls>
				<h2>Overlay offset</h2>
				<label>
					<span>Horizontal</span>
					<input
						type="range"
						aria-label="Compatibility horizontal offset"
						min={OFFSET_MIN}
						max={OFFSET_MAX}
						step={1}
						value={offset.x}
						onInput={(event) =>
							setOffsetAxis("x", event.currentTarget.valueAsNumber)
						}
					/>
					<output>{offset.x}px</output>
				</label>
				<label>
					<span>Vertical</span>
					<input
						type="range"
						aria-label="Compatibility vertical offset"
						min={OFFSET_MIN}
						max={OFFSET_MAX}
						step={1}
						value={offset.y}
						onInput={(event) =>
							setOffsetAxis("y", event.currentTarget.valueAsNumber)
						}
					/>
					<output>{offset.y}px</output>
				</label>
			</offset-controls>

			{!editing ? (
				<compatibility-empty>
					<strong>Edit a glyph to compare masters.</strong>
					<span>Double-click a glyph on the canvas to inspect its paths.</span>
				</compatibility-empty>
			) : (
				<>
					<p
						data-state={compatibility?.compatible ? "ok" : "error"}
						role="status"
					>
						{compatibility === null
							? "Checking compatibility…"
							: compatibility.compatible
								? "Compatible by path and node order"
								: `${compatibility.diagnostics.length} compatibility issue${compatibility.diagnostics.length === 1 ? "" : "s"}`}
					</p>
					{compatibility?.diagnostics.length === 0 ? null : (
						<ul>
							{compatibility?.diagnostics.map((diagnostic, index) => (
								<li key={`${diagnostic.code}:${index}`}>
									{diagnostic.message}
								</li>
							))}
						</ul>
					)}
					<h2>Path order</h2>
					<ol role="listbox" aria-label="Path order">
						{contours.map((contour, pathIndex) => {
							const thumbnail = contourThumbnailGeometry(contour.nodes)
							const targets = contourSelectionTargets(contour.nodes)
							const selectedKeys = new Set(selection.map(selectionKey))
							const selected =
								selectedKeys.size === targets.length &&
								targets.every((target) =>
									selectedKeys.has(selectionKey(target)),
								)
							return (
								<li
									key={contour.id}
									role="option"
									aria-label={`Select path ${pathIndex + 1}`}
									aria-selected={selected}
									tabIndex={0}
									draggable
									onClick={(event) => {
										if (suppressDragClick.current) return
										if (
											event.target instanceof Element &&
											event.target.closest("button") !== null
										)
											return
										selectContour(contour.nodes)
									}}
									onDragStart={(event) => {
										suppressDragClick.current = true
										setDraggedContourId(contour.id)
										if (event.dataTransfer !== null) {
											event.dataTransfer.effectAllowed = "move"
										}
									}}
									onDragEnd={() => {
										setDraggedContourId(null)
										setTimeout(() => {
											suppressDragClick.current = false
										}, 0)
									}}
									onDragOver={(event) => {
										if (draggedContourId !== null) event.preventDefault()
									}}
									onDrop={(event) => {
										event.preventDefault()
										if (draggedContourId !== null) {
											reorderContour(draggedContourId, pathIndex)
										}
										setDraggedContourId(null)
									}}
									onKeyDown={(event) => {
										if (event.target !== event.currentTarget) return
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault()
											selectContour(contour.nodes)
											return
										}
										if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
											return
										event.preventDefault()
										reorderContour(
											contour.id,
											pathIndex + (event.key === "ArrowUp" ? -1 : 1),
										)
									}}
								>
									<path-ordinal
										style={{ background: compatibilityPathColor(pathIndex) }}
									>
										{pathIndex + 1}
									</path-ordinal>
									<svg viewBox={thumbnail.viewBox} aria-hidden="true">
										<g transform={thumbnail.transform}>
											<path
												d={editorContourToPath(contour.nodes, contour.closed)}
												fill={
													contour.closed
														? compatibilityPathColor(pathIndex)
														: "none"
												}
												stroke={compatibilityPathColor(pathIndex)}
												vectorEffect="non-scaling-stroke"
											/>
										</g>
									</svg>
									<path-name>Path {pathIndex + 1}</path-name>
									<path-buttons>
										<button
											type="button"
											disabled={pathIndex === 0}
											aria-label={`Move path ${pathIndex + 1} up`}
											onClick={() => reorderContour(contour.id, pathIndex - 1)}
										>
											↑
										</button>
										<button
											type="button"
											disabled={pathIndex === contours.length - 1}
											aria-label={`Move path ${pathIndex + 1} down`}
											onClick={() => reorderContour(contour.id, pathIndex + 1)}
										>
											↓
										</button>
									</path-buttons>
								</li>
							)
						})}
					</ol>
				</>
			)}
		</compatibility-tile>
	)
}
