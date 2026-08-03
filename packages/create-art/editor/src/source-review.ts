export type SourceReviewChangeState = "added" | "deleted" | "modified"

/**
 * Product-neutral semantic change returned by a source adapter.
 *
 * `kind` is deliberately open: applications define values such as `glyph`,
 * `object`, `palette`, or `asset` without adding cases to shared UI code.
 */
export type SourceReviewChange = Readonly<{
	change: SourceReviewChangeState
	id: string
	kind: string
	label: string
	paths: readonly string[]
}>

export type SourceReviewEndpoint = Readonly<{
	identity: string
	kind: "ref" | "working"
	label: string
	ref?: string
}>

export type SourceReviewComparison<
	Change extends SourceReviewChange = SourceReviewChange,
	Endpoint extends SourceReviewEndpoint = SourceReviewEndpoint,
> = Readonly<{
	base: Endpoint
	changes: readonly Change[]
	identity: string
	target: Endpoint
}>

export type SourceReviewCommitRequest = Readonly<{
	expectedComparisonIdentity: string
	message: string
	paths: readonly string[]
}>

export type SourceReviewController<
	Change extends SourceReviewChange = SourceReviewChange,
	Endpoint extends SourceReviewEndpoint = SourceReviewEndpoint,
> = Readonly<{
	comparison?: SourceReviewComparison<Change, Endpoint>
	error?: string
	loading: boolean
	onCommit: (request: SourceReviewCommitRequest) => Promise<void>
	onCompare: (baseRef: string, targetRef?: string) => Promise<void>
}>

/**
 * Product-owned review behavior. Shared code never infers navigation from a
 * change kind; an application decides which semantic rows can be reviewed.
 */
export type SourceReviewAdapter<
	Change extends SourceReviewChange = SourceReviewChange,
> = Readonly<{
	canReview?: (change: Change) => boolean
	review: (change: Change) => void
	reviewLabel?: (change: Change) => string
}>

export type SourceReviewCounts = Readonly<
	Record<SourceReviewChangeState, number> & { total: number }
>

export function sourceReviewChangeKey(change: SourceReviewChange): string {
	return `${change.kind}\0${change.id}`
}

export function sourceReviewCounts(
	changes: readonly SourceReviewChange[],
): SourceReviewCounts {
	const counts = {
		added: 0,
		deleted: 0,
		modified: 0,
		total: changes.length,
	}
	for (const change of changes) counts[change.change] += 1
	return counts
}

export function selectedSourceReviewPaths<Change extends SourceReviewChange>(
	changes: readonly Change[],
	selectedKeys: ReadonlySet<string>,
): readonly string[] {
	return [
		...new Set(
			changes
				.filter((change) => selectedKeys.has(sourceReviewChangeKey(change)))
				.flatMap((change) => change.paths),
		),
	]
}
