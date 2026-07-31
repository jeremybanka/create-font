import type { EditorFontSource, GlyphId } from "@create-font/states"

import type {
	SourceReviewAdapter,
	SourceReviewChange,
	SourceReviewChangeState,
	SourceReviewCommitRequest,
	SourceReviewComparison,
	SourceReviewController,
	SourceReviewEndpoint,
} from "./source-review.ts"

export type VersionControlChangeKind = SourceReviewChangeState

export type VersionControlChangeUnit = SourceReviewChange &
	Readonly<{
		kind: "glyph" | "source"
	}>

export type VersionControlEndpoint = SourceReviewEndpoint &
	Readonly<{
		source: EditorFontSource
	}>

export type VersionControlComparison = Omit<
	SourceReviewComparison,
	"base" | "changes" | "target"
> &
	Readonly<{
		base: VersionControlEndpoint
		changes: readonly VersionControlChangeUnit[]
		target: VersionControlEndpoint
	}>

export type VersionControlCommitRequest = SourceReviewCommitRequest

export type EditorVersionControl = Omit<SourceReviewController, "comparison"> &
	Readonly<{
		comparison?: VersionControlComparison
	}>

export type GlyphDifference = VersionControlChangeKind | "unchanged"

/** Font-owned navigation adapter for the product-neutral review surface. */
export function createFontSourceReviewAdapter(
	onReviewGlyph: (glyphId: GlyphId) => void,
): SourceReviewAdapter<VersionControlChangeUnit> {
	return {
		canReview: (change) => change.kind === "glyph",
		review(change) {
			if (change.kind === "glyph") onReviewGlyph(change.id as GlyphId)
		},
		reviewLabel: (change) =>
			change.kind === "glyph" ? `Review glyph ${change.label}` : change.label,
	}
}

export function glyphDifference(
	comparison: VersionControlComparison | undefined,
	glyphId: GlyphId,
): GlyphDifference {
	return (
		comparison?.changes.find(
			(change) => change.kind === "glyph" && change.id === glyphId,
		)?.change ?? "unchanged"
	)
}
