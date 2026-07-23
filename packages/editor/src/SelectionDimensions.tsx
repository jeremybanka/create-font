import type { JSX } from "preact"
import { useId, useState } from "preact/hooks"

import type { EditorWorkspace } from "./editor-workspace.ts"
import { EditorIcon } from "./EditorIcon.tsx"
import { NumericInput } from "./NumericInput.tsx"
import {
	boundsOfControls,
	resolveSelectionControls,
	scaleSelectionControls,
	SELECTION_ORIGINS,
	selectionOriginPosition,
	selectionScaleForDimension,
	translateSelectionControls,
	type SelectionOrigin,
	type SelectionTransformResult,
} from "./outline-selection.ts"
import css from "./SelectionDimensions.module.css"
import { useO } from "./state-hooks.ts"
import { TooltipButton } from "./TooltipButton.tsx"

export interface SelectionDimensionsProps {
	readonly workspace: EditorWorkspace
}

const ORIGIN_LABELS: Readonly<Record<SelectionOrigin, string>> = {
	"top-left": "Top left",
	"top-center": "Top center",
	"top-right": "Top right",
	"middle-left": "Middle left",
	center: "Center",
	"middle-right": "Middle right",
	"bottom-left": "Bottom left",
	"bottom-center": "Bottom center",
	"bottom-right": "Bottom right",
}

function roundedTransform(
	result: SelectionTransformResult,
): SelectionTransformResult {
	return {
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
	}
}

export function SelectionDimensions({ workspace }: SelectionDimensionsProps) {
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const layer = useO(workspace.ui.activeLayer)
	const selection = useO(workspace.ui.selection)
	const constrainProportions = useO(workspace.ui.constrainProportions)
	const constraintStatusId = useId()
	const [origin, setOrigin] = useState<SelectionOrigin>("center")
	const nodes = layer?.contours.flatMap((contour) => contour.nodes) ?? []
	const controls = resolveSelectionControls(nodes, selection)
	const bounds = boundsOfControls(controls)
	const position =
		bounds === null ? null : selectionOriginPosition(bounds, origin)
	const width = bounds === null ? 0 : bounds.maxX - bounds.minX
	const height = bounds === null ? 0 : bounds.maxY - bounds.minY
	const proportionsAvailable = bounds !== null && width > 0 && height > 0
	const commit = (result: SelectionTransformResult): void => {
		if (
			activeGlyphId === null ||
			(result.points.length === 0 && result.handles.length === 0)
		)
			return
		workspace.font.actions.transformControls({
			masterId: activeMasterId,
			glyphId: activeGlyphId,
			...roundedTransform(result),
		})
	}
	const moveOrigin = (axis: "x" | "y", value: number): void => {
		if (position === null) return
		commit(
			translateSelectionControls(
				controls,
				axis === "x" ? value - position.x : 0,
				axis === "y" ? value - position.y : 0,
			),
		)
	}
	const resize = (dimension: "width" | "height", value: number): void => {
		if (bounds === null) return
		const scale = selectionScaleForDimension(
			bounds,
			origin,
			dimension,
			value,
			constrainProportions && proportionsAvailable,
		)
		if (scale !== null) commit(scaleSelectionControls(controls, scale))
	}
	const movePickerFocus = (
		event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
	): void => {
		const index = SELECTION_ORIGINS.indexOf(origin)
		const row = Math.floor(index / 3)
		const column = index % 3
		let nextRow = row
		let nextColumn = column
		if (event.key === "ArrowLeft") nextColumn = Math.max(0, column - 1)
		else if (event.key === "ArrowRight") nextColumn = Math.min(2, column + 1)
		else if (event.key === "ArrowUp") nextRow = Math.max(0, row - 1)
		else if (event.key === "ArrowDown") nextRow = Math.min(2, row + 1)
		else if (event.key === "Home") nextColumn = 0
		else if (event.key === "End") nextColumn = 2
		else return
		event.preventDefault()
		const next = SELECTION_ORIGINS[nextRow * 3 + nextColumn]
		if (next === undefined) return
		setOrigin(next)
		const picker = event.currentTarget.closest("selection-origin-picker")
		picker
			?.querySelector<HTMLButtonElement>(`button[data-origin="${next}"]`)
			?.focus()
	}
	const constraintControl = (
		<selection-constraint>
			<TooltipButton
				label="Constrain proportions"
				description={
					proportionsAvailable
						? "Scale width and height together from the selected origin."
						: "Set the proportional-scaling preference; it applies when both dimensions are nonzero."
				}
				placement="top"
				aria-pressed={constrainProportions}
				aria-describedby={constraintStatusId}
				onClick={workspace.actions.toggleConstrainProportions}
			>
				<EditorIcon
					name={constrainProportions ? "Link1Icon" : "LinkBreak1Icon"}
				/>
			</TooltipButton>
			<small id={constraintStatusId} aria-live="polite">
				{!proportionsAvailable
					? constrainProportions
						? "Linked; proportional scaling resumes for a nondegenerate selection."
						: "Unlinked; proportional scaling is unavailable for this selection."
					: constrainProportions
						? `Width and height scale together from the ${ORIGIN_LABELS[origin].toLowerCase()} origin.`
						: "Width and height scale independently."}
			</small>
		</selection-constraint>
	)

	return (
		<selection-dimensions className={css.class}>
			{bounds === null || position === null ? (
				<>
					<selection-empty>
						<strong>No outline selection</strong>
						<span>Select nodes or handles to inspect and transform them.</span>
					</selection-empty>
					<selection-fields data-empty="true">
						{(["X", "Y", "W", "H"] as const).map((field) => (
							<label key={field}>
								<span>{field}</span>
								<NumericInput
									aria-label={`Selection ${field}`}
									appearance="strong"
									value={0}
									min={-65_535}
									max={65_535}
									disabled
									onCommit={() => undefined}
								/>
							</label>
						))}
					</selection-fields>
					{constraintControl}
				</>
			) : (
				<>
					<selection-origin-picker
						role="radiogroup"
						aria-label="Transform origin"
					>
						{SELECTION_ORIGINS.map((item) => (
							<button
								key={item}
								type="button"
								role="radio"
								data-origin={item}
								aria-label={ORIGIN_LABELS[item]}
								aria-checked={origin === item}
								tabIndex={origin === item ? 0 : -1}
								onClick={() => setOrigin(item)}
								onKeyDown={movePickerFocus}
							>
								<i />
							</button>
						))}
					</selection-origin-picker>
					<selection-origin-status aria-live="polite">
						{ORIGIN_LABELS[origin]} origin
					</selection-origin-status>
					<selection-fields>
						<label>
							<span>X</span>
							<NumericInput
								aria-label="Selection origin X"
								appearance="strong"
								value={position.x}
								step="any"
								min={-65_535}
								max={65_535}
								onCommit={(value) => moveOrigin("x", value)}
							/>
						</label>
						<label>
							<span>Y</span>
							<NumericInput
								aria-label="Selection origin Y"
								appearance="strong"
								value={position.y}
								step="any"
								min={-65_535}
								max={65_535}
								onCommit={(value) => moveOrigin("y", value)}
							/>
						</label>
						<label>
							<span>W</span>
							<NumericInput
								aria-label="Selection width"
								appearance="strong"
								value={width}
								min={0}
								max={65_535}
								disabled={width === 0}
								onCommit={(value) => resize("width", value)}
							/>
						</label>
						<label>
							<span>H</span>
							<NumericInput
								aria-label="Selection height"
								appearance="strong"
								value={height}
								min={0}
								max={65_535}
								disabled={height === 0}
								onCommit={(value) => resize("height", value)}
							/>
						</label>
					</selection-fields>
					{constraintControl}
					{width === 0 || height === 0 ? (
						<selection-degenerate role="status">
							Zero dimensions cannot be expanded numerically; position and the
							other dimension remain editable.
						</selection-degenerate>
					) : null}
				</>
			)}
		</selection-dimensions>
	)
}
