import type { EditorFontSource, GlyphId } from "@create-font/states"

export type VersionControlChangeKind = "added" | "deleted" | "modified"

export type VersionControlChangeUnit = Readonly<{
	change: VersionControlChangeKind
	id: string
	kind: "glyph" | "source"
	label: string
	paths: readonly string[]
}>

export type VersionControlEndpoint = Readonly<{
	identity: string
	kind: "ref" | "working"
	label: string
	ref?: string
	source: EditorFontSource
}>

export type VersionControlComparison = Readonly<{
	base: VersionControlEndpoint
	changes: readonly VersionControlChangeUnit[]
	identity: string
	target: VersionControlEndpoint
}>

export type VersionControlCommitRequest = Readonly<{
	expectedComparisonIdentity: string
	message: string
	paths: readonly string[]
}>

export type EditorVersionControl = Readonly<{
	comparison?: VersionControlComparison
	error?: string
	loading: boolean
	onCommit: (request: VersionControlCommitRequest) => Promise<void>
	onCompare: (baseRef: string, targetRef?: string) => Promise<void>
}>

export type GlyphDifference = VersionControlChangeKind | "unchanged"

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
