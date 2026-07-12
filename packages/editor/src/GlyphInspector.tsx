import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./GlyphInspector.module.css"
import { useO } from "./state-hooks.ts"

export interface GlyphInspectorProps {
	readonly workspace: EditorWorkspace
}

export function GlyphInspector({ workspace }: GlyphInspectorProps) {
	const source = workspace.document
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const selectedPointId = useO(workspace.ui.selectedPointId)
	const layer = useO(workspace.ui.activeLayer)
	const compilation = useO(workspace.font.selectors.compilation)
	const location = useO(workspace.ui.previewLocation)
	const glyph = source.glyphs.find((item) => item.id === activeGlyphId)
	const master = source.masters.find((item) => item.id === activeMasterId)
	const pointIds =
		glyph?.contours.flatMap((contour) =>
			contour.points.map((point) => point.id),
		) ?? []
	const selectedIndex =
		selectedPointId === null ? -1 : pointIds.indexOf(selectedPointId)
	const selectedPoint =
		layer.ok && selectedIndex >= 0
			? layer.value.flattenedPoints[selectedIndex]
			: undefined
	const projectionIssueCount = compilation.ok
		? compilation.projectionWarnings.length +
			compilation.ingestionWarnings.length
		: compilation.stage === "projection-failed"
			? compilation.projectionErrors.length +
				compilation.projectionWarnings.length
			: compilation.projectionWarnings.length +
				compilation.ingestionErrors.length +
				compilation.ingestionWarnings.length

	return (
		<glyph-inspector className={css.class}>
			<inspector-heading>
				<span>Inspector</span>
				<status-dot data-state={compilation.ok ? "valid" : "invalid"} />
			</inspector-heading>

			<inspector-section>
				<h2>Layer</h2>
				<dl>
					<dt>Glyph</dt>
					<dd>{glyph?.name ?? "—"}</dd>
					<dt>Master</dt>
					<dd>{master?.name ?? "—"}</dd>
					<dt>Advance</dt>
					<dd>{layer.ok ? layer.value.advanceWidth : "—"}</dd>
					<dt>LSB</dt>
					<dd>{layer.ok ? layer.value.leftSideBearing : "—"}</dd>
					<dt>Contours</dt>
					<dd>{glyph?.contours.length ?? 0}</dd>
					<dt>Points</dt>
					<dd>{pointIds.length}</dd>
				</dl>
			</inspector-section>

			<inspector-section
				data-accent={selectedPoint === undefined ? "false" : "true"}
			>
				<h2>Selection</h2>
				{selectedPoint === undefined ? (
					<p>Select an outline node to inspect its coordinates.</p>
				) : (
					<dl>
						<dt>Node</dt>
						<dd>#{selectedIndex + 1}</dd>
						<dt>X</dt>
						<dd>{selectedPoint.x}</dd>
						<dt>Y</dt>
						<dd>{selectedPoint.y}</dd>
						<dt>Type</dt>
						<dd>{selectedPoint.onCurve ? "On-curve" : "Off-curve"}</dd>
					</dl>
				)}
			</inspector-section>

			<inspector-section>
				<h2>Preview location</h2>
				<dl>
					{source.axes.flatMap((axis) => [
						<dt key={`${axis.id}:label`}>{axis.tag}</dt>,
						<dd key={`${axis.id}:value`}>
							{location[axis.id] ?? axis.default}
						</dd>,
					])}
				</dl>
			</inspector-section>

			<inspector-section data-status="true">
				<h2>Font validity</h2>
				<validity-card
					role="status"
					aria-live="polite"
					data-state={compilation.ok ? "valid" : "invalid"}
				>
					<strong>
						{compilation.ok
							? "Ready to lower"
							: compilation.stage === "projection-failed"
								? "Projection incomplete"
								: "Ingestion rejected"}
					</strong>
					<span>
						{projectionIssueCount === 0
							? "No diagnostics"
							: `${projectionIssueCount} diagnostic${projectionIssueCount === 1 ? "" : "s"}`}
					</span>
				</validity-card>
			</inspector-section>
		</glyph-inspector>
	)
}
