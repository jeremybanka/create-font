import {
	SourceReviewSurface,
	type SourceReviewAdapter,
} from "@create-font/editor/shared"

import type { DesignTileContext } from "./design-tile-registry.ts"
import type { DesignSourceReviewChange } from "./design-version-control.ts"
import css from "./DesignVersionControlTile.module.css"

const KIND_LABELS: Readonly<Record<string, string>> = {
	artboard: "Artboard",
	asset: "Asset inventory and binary files",
	"asset-index": "Asset inventory",
	document: "Document details",
	object: "Design object",
	palette: "Palette",
	project: "Project format",
	structure: "Coordinated design structure",
}

function designChangeKindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? kind.replaceAll("-", " ")
}

function createDesignSourceReviewAdapter(
	context: Pick<
		DesignTileContext,
		"canReviewSourceChange" | "reviewSourceChange"
	>,
): SourceReviewAdapter<DesignSourceReviewChange> {
	return {
		canReview: (change) => context.canReviewSourceChange?.(change) ?? false,
		review: (change) => context.reviewSourceChange?.(change),
		reviewLabel: (change) =>
			`Review ${designChangeKindLabel(change.kind)}: ${change.label}`,
	}
}

export function DesignVersionControlTile({
	context,
}: {
	readonly context: DesignTileContext
}) {
	return (
		<design-version-control-tile className={css.class}>
			<SourceReviewSurface
				review={createDesignSourceReviewAdapter(context)}
				renderChange={(change) =>
					`${change.label} · ${designChangeKindLabel(change.kind)}`
				}
				{...(context.versionControl === undefined
					? {}
					: { controller: context.versionControl })}
			/>
		</design-version-control-tile>
	)
}
