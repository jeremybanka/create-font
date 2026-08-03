import type { GlyphId } from "@create-font/states"

import { FontDiffViewControl } from "./FontDiffViewControl.tsx"
import { SourceReviewSurface } from "@create-art/editor"
import css from "./VersionControlTile.module.css"
import {
	createFontSourceReviewAdapter,
	type EditorVersionControl,
} from "./version-control.ts"

export interface VersionControlTileProps {
	readonly diffView: boolean
	readonly onDiffViewChange: (enabled: boolean) => void
	readonly onReviewGlyph: (glyphId: GlyphId) => void
	readonly versionControl?: EditorVersionControl
}

/**
 * Font-owned tile wrapper. Shared review behavior receives a font navigation
 * adapter while Diff View remains explicitly coupled to glyph rendering here.
 */
export function VersionControlTile({
	diffView,
	onDiffViewChange,
	onReviewGlyph,
	versionControl,
}: VersionControlTileProps) {
	return (
		<version-control-tile className={css.class}>
			<SourceReviewSurface
				review={createFontSourceReviewAdapter(onReviewGlyph)}
				visualComparison={
					<FontDiffViewControl
						diffView={diffView}
						disabled={versionControl?.comparison === undefined}
						onDiffViewChange={onDiffViewChange}
					/>
				}
				{...(versionControl === undefined
					? {}
					: { controller: versionControl })}
			/>
		</version-control-tile>
	)
}
