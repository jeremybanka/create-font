import {
	refreshWorkingComparison,
	type CommitSourceUnitsInput,
	type CommitSourceUnitsResult,
	type ReadSourceComparisonInput,
	type SourceChangeGroup,
	type SourceComparison,
} from "@create-art/source-rpc"
import type { SourceReviewController } from "@create-font/editor/shared"
import { useEffect, useMemo, useState } from "preact/hooks"

export type DesignSourceReviewChange = SourceChangeGroup
export type DesignSourceReviewController =
	SourceReviewController<SourceChangeGroup>

export interface DesignVersionControlSession {
	commitUnits(input: CommitSourceUnitsInput): Promise<CommitSourceUnitsResult>
	readComparison(input: ReadSourceComparisonInput): Promise<SourceComparison>
	subscribeSourceChange(listener: () => void): () => void
}

export interface DesignVersionControlStore {
	controller(): DesignSourceReviewController
	start(): () => void
	subscribe(
		listener: (controller: DesignSourceReviewController) => void,
	): () => void
}

type ControllerState = Readonly<{
	comparison?: SourceComparison
	error?: string
	loading: boolean
}>

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function comparisonError(error: unknown): string {
	return `Unable to compare source changes. ${errorMessage(error)} Check that this workspace is in a Git repository with an initial commit, then retry.`
}

/**
 * Owns the asynchronous review state independently of Preact. Sequence guards
 * keep late ref responses from replacing newer comparisons, and source events
 * refresh only the live working-source selection.
 */
export function createDesignVersionControlStore(
	session: DesignVersionControlSession,
): DesignVersionControlStore {
	let state: ControllerState = { loading: true }
	let selection: ReadSourceComparisonInput = { baseRef: "HEAD" }
	let requestSequence = 0
	const listeners = new Set<
		(controller: DesignSourceReviewController) => void
	>()

	const snapshot = (): DesignSourceReviewController => ({
		...state,
		onCommit: commit,
		onCompare: compare,
	})
	const publish = (next: ControllerState): void => {
		state = next
		const controller = snapshot()
		for (const listener of listeners) listener(controller)
	}
	const retainComparison = (
		next: Readonly<{ error?: string; loading: boolean }>,
	): ControllerState => ({
		...(state.comparison === undefined ? {} : { comparison: state.comparison }),
		...next,
	})

	async function load(baseRef: string, targetRef?: string): Promise<void> {
		selection = {
			baseRef,
			...(targetRef === undefined ? {} : { targetRef }),
		}
		const sequence = ++requestSequence
		publish(retainComparison({ loading: true }))
		try {
			const comparison = await session.readComparison(selection)
			if (sequence !== requestSequence) return
			publish({ comparison, loading: false })
		} catch (error) {
			if (sequence !== requestSequence) return
			publish(
				retainComparison({ error: comparisonError(error), loading: false }),
			)
			throw error
		}
	}

	async function compare(baseRef: string, targetRef?: string): Promise<void> {
		try {
			await load(baseRef, targetRef)
		} catch {
			// The controller state presents the actionable comparison error. Keeping
			// this promise fulfilled avoids an unhandled rejection from a button click.
		}
	}

	async function commit(
		request: Parameters<DesignSourceReviewController["onCommit"]>[0],
	): Promise<void> {
		if (request.paths.length === 0)
			throw new Error("Select at least one complete source group.")
		const sequence = ++requestSequence
		try {
			const result = await session.commitUnits({
				...request,
				paths: request.paths as [string, ...string[]],
			})
			if (sequence !== requestSequence) return
			publish({ comparison: result.comparison, loading: false })
		} catch (error) {
			// A stale optimistic identity is recoverable. Refresh the live rows while
			// the shared surface keeps the nominated groups and message in its dialog.
			await refreshWorkingComparison(selection, load).catch(() => undefined)
			throw new Error(errorMessage(error))
		}
	}

	return {
		controller: snapshot,
		start() {
			const unsubscribe = session.subscribeSourceChange(() => {
				void refreshWorkingComparison(selection, load).catch(() => undefined)
			})
			void load("HEAD").catch(() => undefined)
			return unsubscribe
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

export function useDesignVersionControl(
	session: DesignVersionControlSession | undefined,
): DesignSourceReviewController | undefined {
	const store = useMemo(
		() =>
			session === undefined
				? undefined
				: createDesignVersionControlStore(session),
		[session],
	)
	const [controller, setController] = useState<DesignSourceReviewController>()

	useEffect(() => {
		if (store === undefined) {
			setController(undefined)
			return
		}
		setController(store.controller())
		const unsubscribeState = store.subscribe(setController)
		const stop = store.start()
		return () => {
			stop()
			unsubscribeState()
		}
	}, [store])

	return controller
}
