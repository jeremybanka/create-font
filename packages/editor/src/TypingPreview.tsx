import type { EditorWorkspace } from "./editor-workspace.ts"
import { contoursToPath } from "./geometry.ts"
import { Group, Layer, Line, Path, Stage } from "./react-konva.ts"
import { useI, useO } from "./state-hooks.ts"
import css from "./TypingPreview.module.css"
import { useCanvasTheme } from "./use-canvas-theme.ts"
import { useElementSize } from "./use-element-size.ts"

export interface TypingPreviewProps {
	readonly workspace: EditorWorkspace
}

export function TypingPreview({ workspace }: TypingPreviewProps) {
	const source = workspace.document
	const text = useO(workspace.ui.previewText)
	const setText = useI(workspace.ui.previewText)
	const run = useO(workspace.ui.previewRun)
	const location = useO(workspace.ui.previewLocation)
	const theme = useCanvasTheme()
	const { ref, width, height } = useElementSize<HTMLElement>()
	const totalAdvance = Math.max(
		1,
		run.reduce((sum, item) => sum + (item.glyph?.advanceWidth ?? 1_000), 0),
	)
	const designHeight = source.metrics.ascender - source.metrics.descender
	const scale = Math.min(
		Math.max(0.01, (width - 48) / totalAdvance),
		Math.max(0.01, (height - 32) / designHeight),
	)
	const runWidth = totalAdvance * scale
	const originX = Math.max(24, (width - runWidth) / 2)
	const top = Math.max(16, (height - designHeight * scale) / 2)
	const baseline = top + source.metrics.ascender * scale
	let cursor = 0

	return (
		<typing-preview className={css.class} aria-labelledby="preview-heading">
			<preview-controls>
				<label>
					<span id="preview-heading">Typing preview</span>
					<input
						type="text"
						value={text}
						spellcheck={false}
						aria-label="Preview text"
						onInput={(event) => setText(event.currentTarget.value)}
					/>
				</label>
				{source.axes.map((axis) => {
					const coordinate = location[axis.id] ?? axis.default
					return (
						<label key={axis.id}>
							<axis-label>
								<span>{axis.name}</span>
								<output>{Math.round(coordinate)}</output>
							</axis-label>
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
						</label>
					)
				})}
			</preview-controls>
			<preview-stage ref={ref} aria-hidden="true">
				<Stage width={width} height={height} listening={false}>
					<Layer>
						<Line
							points={[20, baseline, width - 20, baseline]}
							stroke={theme.previewGuide}
							strokeWidth={1}
						/>
						<Group x={originX} y={baseline} scaleX={scale} scaleY={-scale}>
							{run.map((item, index) => {
								const x = cursor
								cursor += item.glyph?.advanceWidth ?? 1_000
								return item.glyph === null ? null : (
									<Path
										key={`${index}:${item.character}`}
										x={x}
										data={contoursToPath(item.glyph.contours)}
										fill={theme.previewInk}
									/>
								)
							})}
						</Group>
					</Layer>
				</Stage>
			</preview-stage>
		</typing-preview>
	)
}
