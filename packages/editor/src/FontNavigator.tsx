import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./FontNavigator.module.css"
import { useO } from "./state-hooks.ts"

export interface FontNavigatorProps {
	readonly workspace: EditorWorkspace
}

export function FontNavigator({ workspace }: FontNavigatorProps) {
	const source = workspace.document
	const activeGlyphId = useO(workspace.ui.activeGlyphId)
	const activeMasterId = useO(workspace.ui.activeMasterId)
	const location = useO(workspace.ui.previewLocation)

	return (
		<font-navigator className={css.class}>
			<nav aria-label="Font navigation">
				<navigation-section>
					<section-heading>
						<span>Masters</span>
						<data value={source.masters.length}>{source.masters.length}</data>
					</section-heading>
					<ul>
						{source.masters.map((master) => (
							<li key={master.id}>
								<button
									type="button"
									aria-pressed={master.id === activeMasterId}
									onClick={() => workspace.actions.selectMaster(master.id)}
								>
									<master-swatch data-master={master.kind} />
									<span>{master.name}</span>
									<small>
										{master.kind === "default" ? "Default" : "Source"}
									</small>
								</button>
							</li>
						))}
					</ul>
				</navigation-section>

				<navigation-section>
					<section-heading>
						<span>Instances</span>
						<data value={source.instances.length}>
							{source.instances.length}
						</data>
					</section-heading>
					<ul>
						{source.instances.map((instance) => {
							const isActive = source.axes.every(
								(axis) =>
									(instance.coordinates[axis.id] ?? axis.default) ===
									(location[axis.id] ?? axis.default),
							)
							const locationLabel = source.axes
								.map((axis) => instance.coordinates[axis.id] ?? axis.default)
								.join("/")
							return (
								<li key={instance.id}>
									<button
										type="button"
										aria-pressed={isActive}
										onClick={() =>
											workspace.actions.selectInstance(instance.id)
										}
									>
										<instance-mark />
										<span>{instance.name}</span>
										<small>{locationLabel}</small>
									</button>
								</li>
							)
						})}
					</ul>
				</navigation-section>

				<navigation-section data-grow="true">
					<section-heading>
						<span>Glyphs</span>
						<data value={source.glyphs.length}>{source.glyphs.length}</data>
					</section-heading>
					<glyph-grid>
						{source.glyphs.map((glyph) => (
							<button
								key={glyph.id}
								type="button"
								aria-pressed={glyph.id === activeGlyphId}
								aria-label={`Edit ${glyph.name}`}
								onClick={() => workspace.actions.selectGlyph(glyph.id)}
							>
								<glyph-tile aria-hidden="true">
									{glyph.name === ".notdef" ? "◌" : glyph.name}
								</glyph-tile>
								<span>{glyph.name}</span>
							</button>
						))}
					</glyph-grid>
				</navigation-section>
			</nav>
		</font-navigator>
	)
}
