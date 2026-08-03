import { DotsHorizontalIcon, MinusIcon, PlusIcon } from "@radix-ui/react-icons"
import { useId } from "react"

import { zoomCanvasView } from "./canvas-view.ts"
import css from "./CanvasToolbar.module.css"
import type { EditorWorkspace } from "./editor-workspace.ts"
import { useI, useO, useOptionalOF } from "./state-hooks.ts"

const svg = {
	DotsHorizontal: DotsHorizontalIcon,
	Minus: MinusIcon,
	Plus: PlusIcon,
}

export interface CanvasToolbarProps {
	readonly workspace: EditorWorkspace
}

export function CanvasToolbar({ workspace }: CanvasToolbarProps) {
	const instanceId = useId()
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const activeTool = useO(workspace.ui.activeTool)
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const glyph = useOptionalOF(
		workspace.font.selectors.editorGlyphSource,
		activeGlyphId,
		workspace.initialGlyphId,
	)
	const master = useO(workspace.font.atoms.master, activeMasterId)
	const axes = useO(workspace.font.selectors.editorAxesSource) ?? []
	const location = useO(workspace.ui.previewLocation)
	const showNodes = useO(workspace.ui.showNodes)
	const showMeasures = useO(workspace.ui.showMeasures)
	const fontFeaturesEnabled = useO(workspace.ui.fontFeaturesEnabled)
	const setShowNodes = useI(workspace.ui.showNodes)
	const setShowMeasures = useI(workspace.ui.showMeasures)
	const view = useO(workspace.ui.canvasView)
	const setView = useI(workspace.ui.canvasView)
	const viewport = useO(workspace.ui.canvasViewport)
	const zoom = (nextZoom: number): void => {
		const focal = {
			x: viewport.width > 0 ? viewport.width / 2 : 400,
			y: viewport.height > 0 ? viewport.height / 2 : 300,
		}
		setView((current) => zoomCanvasView(current, nextZoom, focal))
	}

	return (
		<canvas-toolbar className={css.class}>
			<toolbar-context>
				<strong>
					{editingTextIndex === null
						? "Text canvas"
						: `Editing ${glyph?.name ?? "glyph"}`}
				</strong>
				<span>
					{editingTextIndex === null
						? "Double-click a glyph to edit its outline."
						: activeTool === "pen"
							? "Pen · click for a corner · drag for a curve."
							: activeTool === "rect"
								? "Rect · drag a box · hold Shift for a square."
								: activeTool === "ellipse"
									? "Ellipse · drag an oval · hold Shift for a circle."
									: activeTool === "knife"
										? "Knife · click a path to break it open."
										: activeTool === "rule"
											? "Rule · click A, then click B to measure."
											: `${master?.name ?? "No master"} layer · Escape returns to typing.`}
				</span>
			</toolbar-context>

			{axes.length === 0 ? null : (
				<toolbar-section>
					<h2>Design space</h2>
					{axes.map((axis) => {
						const coordinate = location[axis.id] ?? axis.default
						return (
							<axis-control key={axis.id}>
								<label htmlFor={`${instanceId}:${axis.id}`}>
									<span>{axis.name}</span>
									<small>{axis.tag}</small>
								</label>
								<input
									id={`${instanceId}:${axis.id}`}
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
							</axis-control>
						)
					})}
				</toolbar-section>
			)}

			<toolbar-section>
				<h2>View</h2>
				{editingTextIndex === null ? (
					<button
						type="button"
						data-features
						aria-label="Toggle font features"
						aria-pressed={fontFeaturesEnabled}
						onClick={workspace.actions.toggleFontFeatures}
					>
						<span>Features</span>
						<small>{fontFeaturesEnabled ? "On" : "Off"}</small>
					</button>
				) : null}
				<zoom-controls aria-label="Canvas zoom">
					<button
						type="button"
						aria-label="Zoom out"
						onClick={() => zoom(view.zoom / 1.2)}
					>
						<svg.Minus aria-hidden="true" />
					</button>
					<button
						type="button"
						aria-label="Reset canvas view"
						onClick={() => setView({ x: 72, y: 72, zoom: 1 })}
					>
						{Math.round(view.zoom * 100)}%
					</button>
					<button
						type="button"
						aria-label="Zoom in"
						onClick={() => zoom(view.zoom * 1.2)}
					>
						<svg.Plus aria-hidden="true" />
					</button>
				</zoom-controls>
				{editingTextIndex === null ? null : (
					<button
						type="button"
						data-nodes
						aria-pressed={showNodes}
						onClick={() => setShowNodes((visible) => !visible)}
					>
						<svg.DotsHorizontal aria-hidden="true" />
						Nodes
					</button>
				)}
				{editingTextIndex === null ? null : (
					<button
						type="button"
						data-measures
						aria-label="Toggle measures"
						aria-pressed={showMeasures}
						onClick={() => setShowMeasures((visible) => !visible)}
					>
						Measures
						<small>{showMeasures ? "On" : "Off"}</small>
					</button>
				)}
			</toolbar-section>
		</canvas-toolbar>
	)
}
