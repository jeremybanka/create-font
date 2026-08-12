import { CurvatureCombControls } from "@create-art/editor"
import { useI, useO } from "atom.io/react"

import css from "./CurvatureCombTile.module.css"
import type { EditorWorkspace } from "./editor-workspace.ts"

export function CurvatureCombTile({
	workspace,
}: {
	readonly workspace: EditorWorkspace
}) {
	const editingTextIndex = useO(workspace.ui.editingTextIndex)
	const enabled = useO(workspace.ui.showCurvature)
	const size = useO(workspace.ui.curvatureGain)
	const intensity = useO(workspace.ui.curvatureOpacity)
	const side = useO(workspace.ui.curvatureSide)
	const setEnabled = useI(workspace.ui.showCurvature)
	const setSize = useI(workspace.ui.curvatureGain)
	const setIntensity = useI(workspace.ui.curvatureOpacity)
	const setSide = useI(workspace.ui.curvatureSide)
	return (
		<curvature-comb-tile className={css.class}>
			<CurvatureCombControls
				enabled={enabled}
				disabledReason={
					editingTextIndex === null
						? "Double-click a glyph to enter outline editing."
						: null
				}
				size={size}
				intensity={intensity}
				side={side}
				onEnabledChange={setEnabled}
				onSizeChange={setSize}
				onIntensityChange={setIntensity}
				onSideChange={setSide}
			/>
		</curvature-comb-tile>
	)
}
