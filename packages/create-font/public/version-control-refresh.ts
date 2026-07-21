export type VersionControlSelection = Readonly<{
	baseRef: string
	targetRef?: string
}>

/** Live source changes only affect comparisons whose target is the working source. */
export function refreshWorkingComparison(
	selection: VersionControlSelection,
	load: (baseRef: string, targetRef?: string) => Promise<void>,
): Promise<void> {
	return selection.targetRef === undefined
		? load(selection.baseRef)
		: Promise.resolve()
}
